import { app } from 'electron'
import {
  existsSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  renameSync,
  copyFileSync,
  statSync,
  readdirSync
} from 'fs'
import { join, resolve, sep, dirname, basename, isAbsolute } from 'path'
import type { SpeakerSegment } from './dictation/conversation'
import { loadSettings, saveSettings } from './settingsManager'
import {
  isDataVaultAvailable,
  getDataKeyForEncrypt,
  getDataKeyForDecrypt,
  shredDataKey,
  dataKeyFileExists,
  registerSealedDataProbe
} from './dataVault'
import {
  encryptWithKeyAad,
  decryptWithKeyAad,
  serializeEnvelope,
  type SecretEnvelope
} from './secretCrypto'
import {
  encryptAudio,
  decryptAudio,
  isEncryptedAudio,
  atomicWriteFileSync,
  renameWithRetry,
  unlinkWithRetry,
  isTransientRenameError,
  peekIsEncryptedAudio,
  AudioVaultError
} from './audioVault'
import { secureDeleteFile, pinForWipe, releasePin, sweepPendingWipes } from './secureDelete'

export interface RecordingEntry {
  id: string
  filename: string
  filepath: string
  timestamp: number
  duration: number
  status: 'completed' | 'failed' | 'pending'
  provider: string
  transcription?: string
  error?: string
  size: number
  // ROUGH-FIRST on-demand cleanup result (v1.4 PR2, RecordingsPanel's "Clean
  // up" action — see transcribe.ts's cleanupOnDemand()). Both optional and
  // additive: entries written before PR2 simply don't have them, and they
  // load fine as `undefined`. `cleanedText` is the last on-demand cleanup
  // result for this recording (raw is untouched — `transcription` stays the
  // original STT output); `cleanedWith` labels what produced it ('full',
  // 'light', a template name, or 'Custom instruction') for display.
  cleanedText?: string
  cleanedWith?: string
  // Context-aware tone (v1.5 Work Item B): a privacy-safe snapshot of the
  // foreground app at the moment this recording was made — process name
  // only by default; `recordedWindowTitle` is populated only when the user
  // has opted into window-title matching (see settingsManager.ts's
  // windowTitlePermissionEnabled and context.ts's getActiveContext()).
  // Captured once, at recording time, in main/index.ts's `recordings:save`
  // handler — never at "Clean up" click time, which could be hours later
  // against a completely different foreground app. handleRecordingsCleanup()
  // (transcribe.ts) reads these back to resolve the SAME tone profile the
  // original dictation would have used. Both optional/additive: recordings
  // saved before this feature landed, or saved while contextAwareTone was
  // off, simply don't have them.
  recordedProcessName?: string
  recordedWindowTitle?: string
  // Last-write-wins sync metadata (PT-offline-first-lww-sync). `updatedAt` is the
  // LWW key bumped on every mutation; `deletedAt`, when set, marks a tombstone —
  // a soft delete that survives in the index so the removal can converge across
  // devices instead of a hard splice that could never propagate. Both are optional
  // so legacy index rows written before this change still load.
  updatedAt?: number
  deletedAt?: number
  // Group-conversation mode (multi-speaker transcription) — additive, absent
  // on every plain (single-speaker) recording, which stay text-only exactly
  // as before. `segments` is the diarized per-speaker breakdown produced by
  // transcribeConversation() (transcribe.ts); `speakerNames` maps a raw
  // speaker id ("speaker_0", …) to a user-assigned display name, mirroring
  // Recording.speakerNames on the mobile app (Conversation.swift's
  // SpeakerSegmentBuilder.displayName reads the same shape). `transcription`
  // still holds the labeled plain-text rendering for these recordings (see
  // conversation.ts's transcriptText()), so every existing text-only
  // consumer (search, copy, cleanup) keeps working unchanged.
  segments?: SpeakerSegment[]
  speakerNames?: Record<string, string>
}

interface RecordingIndex {
  recordings: RecordingEntry[]
}

/**
 * True only when `filepath` resolves to a location strictly inside the recordings
 * directory. Guards every read/delete of an audio file against a tampered index
 * entry (e.g. filepath set to '../x' or an absolute path outside the dir).
 */
export function isInsideRecordingsDir(filepath: unknown): boolean {
  if (typeof filepath !== 'string' || !filepath) return false
  // Follow symlinks for paths that exist, so a link inside the dir that points
  // outside it is refused. A non-existent path is resolved through its nearest
  // existing ancestor, so a symlinked parent (macOS: /var -> /private/var) gives
  // the same prefix for the dir and for a not-yet-written file inside it.
  const real = (p: string): string => {
    const r = resolve(p)
    let head = r
    let tail = ''
    try {
      while (!existsSync(head)) {
        const parent = dirname(head)
        if (parent === head) return r
        tail = tail ? join(basename(head), tail) : basename(head)
        head = parent
      }
      const realHead = realpathSync(head)
      return tail ? join(realHead, tail) : realHead
    } catch {
      return r
    }
  }
  const dir = real(getRecordingsDir())
  const target = real(filepath)
  const prefix = dir.endsWith(sep) ? dir : dir + sep
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  return norm(target).startsWith(norm(prefix))
}

// Bound the on-disk recordings cache. Without a cap the `.webm` files accumulate
// forever, silently eating gigabytes of the user's disk on a long-lived install
// (and eventually failing writes once the volume fills). When a new recording
// pushes the tracked total over `maxDiskBytes`, evict the oldest recordings
// (delete file + index entry) down to ~90% of the cap (hysteresis so we don't
// re-evict on the very next save). The newly-saved entry is always protected.
const DEFAULT_MAX_DISK_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB
let maxDiskBytes = DEFAULT_MAX_DISK_BYTES

/** Override the total on-disk recordings quota (bytes). */
export function setMaxDiskBytes(bytes: number): void {
  maxDiskBytes = bytes
}

/** Current total on-disk recordings quota (bytes). */
export function getMaxDiskBytes(): number {
  return maxDiskBytes
}

// Evict oldest-first (by timestamp) until the tracked total is at or below 90%
// of the cap. `protectId` is never evicted (the recording just saved this pass).
// Mutates `index.recordings` in place; the caller persists it.
function evictToQuota(index: RecordingIndex, protectId?: string): void {
  let total = index.recordings.reduce((sum, r) => sum + (r.size || 0), 0)
  if (total <= maxDiskBytes) return

  const target = Math.floor(maxDiskBytes * 0.9)
  const oldestFirst = [...index.recordings].sort((a, b) => a.timestamp - b.timestamp)

  for (const entry of oldestFirst) {
    if (total <= target) break
    if (entry.id === protectId) continue

    if (isInsideRecordingsDir(entry.filepath) && existsSync(entry.filepath)) {
      try {
        unlinkSync(entry.filepath)
      } catch {
        /* best-effort: still drop the index entry so the quota converges */
      }
    }
    const idx = index.recordings.findIndex((r) => r.id === entry.id)
    if (idx !== -1) index.recordings.splice(idx, 1)
    total -= entry.size || 0
  }
}

export function getRecordingsDir(): string {
  const dir = join(app.getPath('userData'), 'recordings')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getIndexPath(): string {
  return join(getRecordingsDir(), 'index.json')
}

/** AAD binding a sealed index envelope to its purpose (design doc 1.2/3.2). */
const INDEX_AAD_V1 = 'whisperio/index/v1'
const INDEX_AAD_VERSION = 2
/** v2 AAD binds the format tag AND the key id, so kid cannot be swapped without failing the GCM tag. */
function indexAadV2(kid: string): string {
  return `whisperio/index/v2|kid=${kid}`
}
/** Seal an index payload (v2: kid bound into AAD). */
function sealIndexPayload(key: Buffer, plaintext: string): SecretEnvelope {
  const env = encryptWithKeyAad(key, plaintext, indexAadV2(INDEX_KID), INDEX_KID)
  env.av = INDEX_AAD_VERSION
  return env
}
/** Open v2 (kid from envelope bound into AAD) or legacy v1 (no av; written by the unreleased D1 draft). */
function openIndexPayload(key: Buffer, env: SecretEnvelope): string {
  if (env.av === undefined) return decryptWithKeyAad(key, env, INDEX_AAD_V1)
  if (env.av !== INDEX_AAD_VERSION || typeof env.kid !== 'string') {
    throw new Error('Unsupported index envelope format')
  }
  return decryptWithKeyAad(key, env, indexAadV2(env.kid))
}
const INDEX_KID = 'hist-1'

/**
 * Thrown by every write path when index.json is sealed but cannot be opened (key missing, wrong or
 * the ciphertext was tampered with). Refusing is what keeps the next save from replacing the
 * user's sealed history with an empty index.
 */
export class KeyShredError extends Error {
  readonly code = 'KEY_SHRED_FAILED'
  constructor() {
    super('The encryption key could not be deleted, so nothing was erased. Close other programs using the app data folder and try again.')
    this.name = 'KeyShredError'
  }
}

export class HistoryLockedError extends Error {
  readonly code = 'HISTORY_LOCKED'
  constructor() {
    super('History is locked: the encrypted index cannot be opened. Refusing to overwrite it.')
    this.name = 'HistoryLockedError'
  }
}

export interface HistoryEncryptionStatus {
  enabled: boolean
  sealedOnDisk: boolean
  locked: boolean
  /**
   * Only present when locked. 'unrecoverable': sealed data but the key file is MISSING.
   * 'transient': key file present but could not be unwrapped (locked Keychain/keyring may be
   * temporary): offer "Try again" before any destructive reset. 'unavailable': the index file
   * could not be read (AV/backup lock, damage) and no sealed data was found: plain history merely
   * unavailable, nothing deleted, reset refused.
   */
  lockKind?: 'transient' | 'unrecoverable' | 'unavailable'
}

function lockKindNow(): 'transient' | 'unrecoverable' {
  return dataKeyFileExists() ? 'transient' : 'unrecoverable'
}

// Reads the encryptHistory flag. Injectable so tests can drive it; defaults to the settings file.
const defaultEncryptHistoryReader = (): boolean => loadSettings().encryptHistory === true
let encryptHistoryReader: () => boolean = defaultEncryptHistoryReader

/** Test seam: override how the encryptHistory flag is read (pass null to restore the default). */
export function setEncryptHistoryReader(fn: (() => boolean) | null): void {
  encryptHistoryReader = fn ?? defaultEncryptHistoryReader
}

function looksSealed(v: unknown): v is SecretEnvelope {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    'v' in o &&
    'alg' in o &&
    typeof o.iv === 'string' &&
    typeof o.ct === 'string' &&
    typeof o.tag === 'string' &&
    !('recordings' in o)
  )
}

interface IndexState {
  index: RecordingIndex
  sealedOnDisk: boolean
  locked: boolean
}

/**
 * Thrown when index.json exists but can't be used safely right now (persistent
 * read error such as an AV/backup lock, or a corrupt file we could not back up).
 * Callers must NOT treat this as "empty history": a following saveIndex() would
 * overwrite the only copy. IPC handlers surface it as a rejected call.
 */
export const INDEX_UNAVAILABLE_CODE = 'INDEX_UNAVAILABLE'

export class IndexUnavailableError extends Error {
  readonly code = INDEX_UNAVAILABLE_CODE
  constructor(message: string) {
    // Electron's ipcMain.handle drops custom error classes/props and only keeps
    // the message, so the code is embedded as a prefix the renderer can match.
    super(`[${INDEX_UNAVAILABLE_CODE}] ${message}`)
    this.name = 'IndexUnavailableError'
  }
}

const READ_RETRIES = 5
// Bounded backoff between index read retries (total 25+50+100+200 = 375 ms).
const READ_BACKOFF_MS = [25, 50, 100, 200]

let sleepImpl: (ms: number) => void = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Blocking sleep (main process, tiny bounded waits only). */
export function sleepSync(ms: number): void {
  sleepImpl(ms)
}

/** Test hook: replace the sleep implementation; call with no arg to restore. */
export function setSleepSyncForTests(fn?: (ms: number) => void): void {
  sleepImpl = fn ?? ((ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) })
}

// Signature (mtime+size) of a corrupt index we already COPIED aside (rename
// failed), so repeated reads don't pile up identical backups.
let copiedCorruptSignature: string | null = null

function fileSignature(path: string): string | null {
  try {
    const st = statSync(path)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
}

// Move an unreadable index aside so the next saveIndex() cannot overwrite the
// only copy of the user's history metadata. Never deletes anything. Returns
// false when no backup could be made (caller must then refuse, not go empty).
function quarantineCorruptIndex(indexPath: string): boolean {
  const name = `index.corrupt-${Date.now()}.json`
  const backup = join(dirname(indexPath), name)
  try {
    renameSync(indexPath, backup)
    copiedCorruptSignature = null
    console.warn(`[recordingStore] recordings index unreadable; moved aside to ${name}`)
    return true
  } catch {
    /* fall through to copy */
  }
  const sig = fileSignature(indexPath)
  if (sig !== null && sig === copiedCorruptSignature) return true // already backed up
  try {
    copyFileSync(indexPath, backup)
    copiedCorruptSignature = sig
    console.warn(`[recordingStore] recordings index unreadable; copied aside to ${name}`)
    return true
  } catch {
    return false
  }
}

function readIndexText(indexPath: string): string {
  for (let attempt = 0; ; attempt++) {
    try {
      return readFileSync(indexPath, 'utf-8')
    } catch (err) {
      // A transient lock (Defender, an indexer, OneDrive) must never be
      // mistaken for corruption: retry, then refuse rather than go empty.
      if (attempt < READ_RETRIES - 1 && isTransientRenameError(err)) {
        sleepSync(READ_BACKOFF_MS[Math.min(attempt, READ_BACKOFF_MS.length - 1)])
        continue
      }
      const code = (err as NodeJS.ErrnoException | null)?.code ?? 'unknown'
      throw new IndexUnavailableError(`Recordings index could not be read (${code}); history left untouched.`)
    }
  }
}

function quarantineOrThrow(indexPath: string): IndexState {
  if (quarantineCorruptIndex(indexPath)) {
    return { index: { recordings: [] }, sealedOnDisk: false, locked: false }
  }
  throw new IndexUnavailableError('Recordings index is unreadable and could not be backed up; history left untouched.')
}

// Self-describing read: a parsed object with `recordings` is plain, one with v/alg/iv/ct/tag is a
// sealed envelope. Read errors (locks) refuse via IndexUnavailableError; only a JSON SyntaxError or
// a wrong shape is quarantined (moved/copied aside, never deleted).
function readIndexState(): IndexState {
  const indexPath = getIndexPath()
  if (!existsSync(indexPath)) {
    return { index: { recordings: [] }, sealedOnDisk: false, locked: false }
  }
  const raw = readIndexText(indexPath)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    // Log only the error name: JSON.parse messages can embed a fragment of transcript text.
    console.error(`[Whisperio] recordings index is not valid JSON (${err instanceof Error ? err.name : 'Error'})`)
    return quarantineOrThrow(indexPath)
  }
  if (looksSealed(parsed)) {
    const lockedState: IndexState = { index: { recordings: [] }, sealedOnDisk: true, locked: true }
    try {
      const key = getDataKeyForDecrypt()
      if (!key) return lockedState
      const plain = JSON.parse(openIndexPayload(key, parsed)) as RecordingIndex
      if (!plain || !Array.isArray(plain.recordings)) return lockedState
      return { index: plain, sealedOnDisk: true, locked: false }
    } catch {
      return lockedState
    }
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as { recordings?: unknown }).recordings)
  ) {
    return quarantineOrThrow(indexPath)
  }
  const obj = parsed as RecordingIndex
  const valid = obj.recordings.filter(
    (r) => r !== null && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string'
  )
  if (valid.length === obj.recordings.length) return { index: obj, sealedOnDisk: false, locked: false }
  backupBeforeFilter(indexPath, obj.recordings.length - valid.length, obj.recordings.length)
  return { index: { ...obj, recordings: valid }, sealedOnDisk: false, locked: false }
}

export function loadIndex(): RecordingIndex {
  return readIndexState().index
}

/** Index for a read-modify-write: throws HistoryLockedError instead of a fake-empty index. */
function loadIndexForWrite(): RecordingIndex {
  const st = readIndexState()
  if (st.locked) throw new HistoryLockedError()
  return st.index
}

export function getHistoryEncryptionStatus(): HistoryEncryptionStatus {
  let st: IndexState
  let unavailable = false
  try {
    st = readIndexState()
  } catch {
    // IndexUnavailableError (persistent read error): never 'unrecoverable' - nothing was proven lost.
    unavailable = true
    st = { index: { recordings: [] }, sealedOnDisk: false, locked: true }
  }
  let enabled = false
  try {
    enabled = encryptHistoryReader()
  } catch {
    enabled = false
  }
  return st.locked
    ? { enabled, sealedOnDisk: st.sealedOnDisk, locked: true, lockKind: unavailable ? (sealedDataExists() ? 'transient' : 'unavailable') : lockKindNow() }
    : { enabled, sealedOnDisk: st.sealedOnDisk, locked: false }
}

function serializeIndex(index: RecordingIndex, seal: boolean): string {
  if (!seal) return JSON.stringify(index, null, 2)
  const key = getDataKeyForEncrypt() // throws when the vault is unavailable: fail closed, never plain
  return serializeEnvelope(sealIndexPayload(key, JSON.stringify(index)))
}

// Entries without a string id are dropped from the in-memory list; the next
// saveIndex() would erase them for good. Keep a copy of the original first
// (never deleted), once per distinct file state. Logs counts only.
let filteredBackupSignature: string | null = null
function backupBeforeFilter(indexPath: string, dropped: number, total: number): void {
  const sig = fileSignature(indexPath)
  if (sig !== null && sig === filteredBackupSignature) return
  const name = `index.filtered-${Date.now()}.json`
  try {
    copyFileSync(indexPath, join(dirname(indexPath), name))
  } catch {
    throw new IndexUnavailableError('Recordings index has invalid entries and could not be backed up; history left untouched.')
  }
  filteredBackupSignature = sig
  console.warn(`[recordingStore] dropped ${dropped} of ${total} invalid index entries; original copied to ${name}`)
}

// Windows hands out a transient EPERM/EBUSY for a rename when another process
// (Defender/an indexer/a backup agent) still holds the freshly-written temp
// file open. That window is short, so a couple of immediate retries turn a
// spurious "failed to save recordings" into a normal save.
const RENAME_RETRIES = 5
// isTransientRenameError (EPERM/EBUSY/EACCES) is imported from audioVault.

export function saveIndex(index: RecordingIndex): void {
  // Never overwrite a sealed index we cannot open (would destroy the user's history).
  const st = readIndexState()
  if (st.locked) throw new HistoryLockedError()
  // Sealing is sticky: a sealed index stays sealed even if the flag reads OFF (e.g. settings.json
  // was reset to defaults after corruption). Only setHistoryEncryption(false) writes plain over it.
  const seal = st.sealedOnDisk || encryptHistoryReader()
  // Flag ON but index still plain (crash between flag and rewrite): this save seals it, so the
  // plaintext it replaces is wiped (L4).
  writeIndexFile(index, seal, seal && !st.sealedOnDisk)
}

/**
 * wipePrevious: the index being replaced is PLAINTEXT and the new one is sealed (encryption
 * migration). The old inode is pinned with a hard link before the rename and overwritten with
 * zeros after it (best-effort, never fails the write - see secureDelete.ts for the limits).
 */
function writeIndexFile(index: RecordingIndex, seal: boolean, wipePrevious = false): void {
  // Atomic write: serialize to a temp file then rename over the real index.
  // A crash mid-write leaves the previous index intact instead of a truncated
  // (corrupt) file.
  const indexPath = getIndexPath()
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, serializeIndex(index, seal), 'utf-8')
  const pin = wipePrevious && existsSync(indexPath) ? pinForWipe(indexPath) : null

  // The rename can fail (transient Windows lock, disk full, read-only dir).
  // Whatever the reason, the temp file must not be left behind: saveIndex runs
  // on EVERY mutation, so a leaked `.tmp` per failure slowly fills the
  // recordings directory with junk that nothing ever collects.
  try {
    renameWithRetry(tmpPath, indexPath)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { /* best-effort cleanup */ }
    releasePin(pin) // still a second name of the live index: unlinked, never overwritten
    throw err
  }
  releasePin(pin) // now the only name of the replaced plaintext index: zeroed, then unlinked
  forgetOrphan('index.json') // a freshly written index is live data, not an orphan
}

// Serialize every read-modify-write so overlapping IPC mutations (e.g. an
// async reprocess completing while the user saves/deletes another recording)
// can't lost-update each other. Each mutation re-reads the index inside its
// critical section rather than caching a snapshot across an await.
let mutationQueue: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => T): Promise<T> {
  const result = mutationQueue.then(() => fn())
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function generateId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export async function saveRecording(
  audioBuffer: Buffer,
  metadata: {
    duration: number
    provider: string
    /** See RecordingEntry.recordedProcessName above — captured by the caller
     * (main/index.ts's `recordings:save` handler) at recording time. */
    recordedProcessName?: string
    recordedWindowTitle?: string
    /** Group-conversation mode — see RecordingEntry.segments doc comment. */
    segments?: SpeakerSegment[]
    transcription?: string
    status?: 'completed' | 'failed' | 'pending'
  }
): Promise<RecordingEntry> {
  const id = generateId()
  const timestamp = Date.now()
  const base = `recording-${formatTimestamp(timestamp)}`

  // The seal decision AND the file write happen inside the mutation queue, i.e. serialized with
  // setHistoryEncryption and every migration slot: a save overlapping an ON toggle can never write
  // plaintext that a migration snapshot already passed over. When history encryption is ON (or the
  // index is already sealed) the audio is sealed BEFORE it touches disk; an unavailable vault
  // rejects the save (fail closed). Locked history refuses before any file is written.
  return enqueue(() => {
    const st = readIndexState()
    if (st.locked) throw new HistoryLockedError()
    const dir = getRecordingsDir()
    const seal = st.sealedOnDisk || encryptHistoryReader()
    const data = seal ? encryptAudio(getDataKeyForEncrypt(), audioBuffer, id) : audioBuffer
    // One-second name resolution: a same-second save (or a stepped-back clock) must not reuse an
    // existing file. Create exclusively ('wx') and add a -2, -3 ... suffix on collision (main #43).
    // Sealed audio reserves the name with an empty placeholder and then replaces it atomically, so
    // plaintext never touches disk.
    let filename = `${base}.webm`
    let filepath = join(dir, filename)
    for (let n = 2; ; n++) {
      try {
        writeFileSync(filepath, seal ? Buffer.alloc(0) : data, { flag: 'wx' })
        break
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code !== 'EEXIST' || n > 1000) throw err
        filename = `${base}-${n}.webm`
        filepath = join(dir, filename)
      }
    }
    if (seal) {
      try {
        atomicWriteFileSync(filepath, `${filepath}.tmp`, data)
      } catch (err) {
        try { unlinkSync(filepath) } catch { /* best-effort: drop the placeholder */ }
        throw err
      }
    }
    forgetOrphan(filename) // the name is live again: the startup sweep must never delete it
    const entry: RecordingEntry = {
      id,
      filename,
      filepath,
      timestamp,
      duration: metadata.duration,
      status: metadata.status ?? 'pending',
      provider: metadata.provider,
      size: audioBuffer.length,
      updatedAt: timestamp,
      recordedProcessName: metadata.recordedProcessName,
      recordedWindowTitle: metadata.recordedWindowTitle,
      segments: metadata.segments,
      transcription: metadata.transcription
    }
    try {
      const index = loadIndexForWrite()
      index.recordings.push(entry)
      evictToQuota(index, entry.id)
      saveIndex(index)
      return entry
    } catch (err) {
      try { unlinkSync(filepath) } catch { /* best-effort: drop the just-written audio */ }
      throw err
    }
  })
}

export function updateRecording(id: string, updates: Partial<RecordingEntry>): Promise<RecordingEntry | null> {
  return enqueue(() => {
    const index = loadIndexForWrite()
    const idx = index.recordings.findIndex((r) => r.id === id && !r.deletedAt)
    if (idx === -1) return null

    // Bump the LWW key so a stale copy on another device can't clobber this edit.
    index.recordings[idx] = { ...index.recordings[idx], ...updates, updatedAt: Date.now() }
    saveIndex(index)
    return index.recordings[idx]
  })
}

export function getRecordings(): RecordingEntry[] {
  const index = loadIndex()
  // Hide tombstones from readers — a soft-deleted recording is gone as far as the
  // UI is concerned, even though its row lingers in the index for sync convergence.
  return index.recordings
    .filter((r) => !r.deletedAt)
    .sort((a, b) => b.timestamp - a.timestamp)
}

export function getRecording(id: string): RecordingEntry | null {
  const index = loadIndex()
  return index.recordings.find((r) => r.id === id && !r.deletedAt) || null
}

export function deleteRecording(id: string): Promise<boolean> {
  return enqueue(() => {
    const index = loadIndexForWrite()
    const idx = index.recordings.findIndex((r) => r.id === id && !r.deletedAt)
    if (idx === -1) return false

    const entry = index.recordings[idx]
    // Reclaim the audio file immediately, but keep a tombstone row instead of
    // hard-splicing it out: bump `updatedAt` and stamp `deletedAt` so the delete
    // is a last-write-wins fact that can propagate to other devices, and zero the
    // tracked size so the freed bytes no longer count against the disk quota.
    // A hard `splice` here could never converge — a stale device would resurrect
    // the row on the next merge (PT-offline-first-lww-sync).
    if (isInsideRecordingsDir(entry.filepath) && existsSync(entry.filepath)) {
      try {
        unlinkSync(entry.filepath)
      } catch {
        /* best-effort: still tombstone the entry so the delete converges */
      }
    }

    const now = Date.now()
    index.recordings[idx] = { ...entry, deletedAt: now, updatedAt: now, size: 0 }
    saveIndex(index)
    return true
  })
}

const ORPHANS_FILE = 'shredded-orphans.json'

function orphansPath(): string {
  return join(getRecordingsDir(), ORPHANS_FILE)
}

/**
 * Orphan entries are untrusted (the file lives in userData): accept only plain basenames that are
 * ours to delete - `*.webm`, `*.tmp` or exactly `index.json`. Anything with a separator, `..` or an
 * absolute path is dropped on read.
 */
/**
 * Index backups, plain (PLAIN_INDEX_BACKUP_RE) or their sealed copies (`<name>.sealed.json`), that
 * erase/reset must remove.
 */
const CORRUPT_BACKUP_RE =
  /^index(\.json\.corrupt-[0-9]+(\.json)?|\.(corrupt|filtered)-[0-9]+\.json)(\.sealed(\.json)?)?$/

export function isValidOrphanName(f: unknown): f is string {
  if (typeof f !== 'string' || f.length === 0) return false
  if (f.includes('/') || f.includes('\\') || f.includes('\0') || f.includes('..')) return false
  if (isAbsolute(f) || basename(f) !== f) return false
  if (f.includes(':')) return false // Windows drive-relative names / NTFS alternate data streams
  return f === 'index.json' || CORRUPT_BACKUP_RE.test(f) || f.endsWith('.webm') || f.endsWith('.tmp')
}

/** Drop a name from the orphan list (a new file legitimately reuses it). Never throws. */
function forgetOrphan(name: string): void {
  try {
    if (!existsSync(orphansPath())) return
    const names = readOrphans()
    if (names.includes(name)) writeOrphans(names.filter((n) => n !== name))
  } catch { /* best-effort */ }
}

/** Names (not paths) of sealed files whose key was destroyed but which could not be deleted yet. */
function readOrphans(): string[] {
  try {
    const p = orphansPath()
    if (!existsSync(p)) return []
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as { files?: unknown }
    return Array.isArray(parsed.files) ? parsed.files.filter(isValidOrphanName) : []
  } catch {
    return []
  }
}

function writeOrphans(names: string[]): void {
  try {
    const p = orphansPath()
    if (names.length === 0) {
      if (existsSync(p)) unlinkSync(p)
      return
    }
    writeFileSync(p, JSON.stringify({ files: names }), 'utf-8')
  } catch { /* best-effort: the startup sweep also finds nothing to retry then, which is acceptable */ }
}

export interface ShredReport {
  /** Files that could not be deleted after the key was destroyed (retried at next start). */
  undeleted: number
}

/**
 * After a SUCCESSFUL deliberate key shred: delete EVERY audio/tmp file in the recordings dir (not
 * only indexed ones), then the index. Anything that still cannot be deleted holds data sealed under
 * a destroyed key (garbage); it is recorded by name in shredded-orphans.json so the sealed-data
 * probe ignores it (else minting a new key would be refused forever) and the startup sweep retries.
 */
function wipeAfterShred(): ShredReport {
  const dir = getRecordingsDir()
  const stuck: string[] = []
  let names: string[] = []
  sweepPendingWipes(dir) // leftover plaintext pins (crash mid-migration): overwrite, not just unlink
  try { names = readdirSync(dir) } catch { /* nothing to wipe */ }
  for (const f of names) {
    // index backups (corrupt/filtered copies) may hold plaintext history: erase/reset removes them too
    // (every other path keeps them).
    if (!(f.endsWith('.webm') || f.endsWith('.tmp') || CORRUPT_BACKUP_RE.test(f))) continue
    try { unlinkWithRetry(join(dir, f)) } catch { stuck.push(f) }
  }
  const indexPath = getIndexPath()
  if (existsSync(indexPath)) {
    try {
      unlinkWithRetry(indexPath)
    } catch {
      // Cannot delete the sealed index: try replacing it with an empty plain one.
      try { writeIndexFile({ recordings: [] }, false) } catch { stuck.push('index.json') }
    }
  }
  const all = Array.from(new Set([...readOrphans(), ...stuck]))
  writeOrphans(all)
  return { undeleted: stuck.length }
}

/**
 * Retry deleting files left behind by an earlier shred (startup). Entries are dropped from the list
 * once gone. index.json is only removed while it is still unopenable (never a healthy new index).
 */
export function sweepShreddedOrphans(): ShredReport {
  const names = readOrphans()
  if (names.length === 0) return { undeleted: 0 }
  const dir = getRecordingsDir()
  const left: string[] = []
  // Files the current, readable index references are live data (a reused name after a clock
  // rollback, a new recording): never delete them, just forget the stale orphan entry.
  let st: IndexState
  try {
    st = readIndexState()
  } catch (err) {
    // Index unreadable right now: delete nothing, keep the orphan list for the next startup.
    if (err instanceof IndexUnavailableError) return { undeleted: names.length }
    throw err
  }
  const live = new Set<string>()
  if (!st.locked) {
    for (const r of st.index.recordings) {
      if (r.filename) live.add(r.filename)
      if (r.filepath) live.add(basename(r.filepath))
    }
  }
  for (const f of names) {
    const p = join(dir, f)
    try {
      if (!existsSync(p)) continue
      if (f === 'index.json' && !st.locked) continue
      if (live.has(f)) continue
      unlinkWithRetry(p)
    } catch {
      left.push(f)
    }
  }
  writeOrphans(left)
  return { undeleted: left.length }
}

/**
 * Erase all history. When history is encrypted (sealed index on disk or the flag ON) this is a
 * crypto-shred (design 4.3): (1) destroy the wrapped data key FIRST (if that fails nothing is
 * deleted and KeyShredError is thrown); (2) delete every audio file and the index, tolerating files
 * that cannot be deleted (reported in the result, retried at startup). Erase still succeeds then:
 * those files are unreadable without the key. A later save mints a fresh key. Plain history keeps
 * the old path.
 */
export function deleteAllRecordings(): Promise<ShredReport> {
  return enqueue((): ShredReport => {
    const st = readIndexState()
    if (st.locked) throw new HistoryLockedError()
    const index = st.index
    // Flag OFF but sealed audio left (e.g. failed decrypt migration): still shred + delete.
    const shred = st.sealedOnDisk || encryptHistoryReader() || sealedDataExists()

    if (shred) {
      if (!shredDataKey()) throw new KeyShredError()
      return wipeAfterShred()
    }

    for (const entry of index.recordings) {
      if (isInsideRecordingsDir(entry.filepath) && existsSync(entry.filepath)) {
        try {
          unlinkSync(entry.filepath)
        } catch {
          /* best-effort: still drop the index entry so the delete converges */
        }
      }
    }
    let undeleted = 0
    try {
      for (const f of readdirSync(getRecordingsDir())) {
        if (!CORRUPT_BACKUP_RE.test(f)) continue // exact backup names only, never look-alikes
        try { unlinkWithRetry(join(getRecordingsDir(), f)) } catch { undeleted++ }
      }
    } catch { /* no recordings dir: nothing to remove */ }
    saveIndex({ recordings: [] })
    return { undeleted }
  })
}

export interface ResetReport extends ShredReport {
  ok: boolean
  /** True when refused because the key file exists (possibly transient lock): needs confirmDestroy. */
  needsConfirmDestroy?: boolean
}

/**
 * Locked-history recovery: SEALED data exists on disk (sealed index or WHSPAUD audio) but cannot be
 * opened (key lost / keychain gone). If the key file is MISSING the data is unrecoverable and reset is
 * allowed. If the key file is PRESENT but could not be unwrapped (possibly a temporarily locked
 * Keychain/keyring) reset is refused unless confirmDestroy === true (the UI offers "Try again" first).
 * (1) remove the key file; if that fails, return ok:false and
 * delete nothing; (2) delete audio, leaked tmp files and index.json and index.json.corrupt-* backups, tolerating undeletable files like erase does; (3) encryption OFF so the next save
 * starts a fresh history. Refuses (ok:false) for a merely unparsable or AV-locked PLAIN index: that
 * is not lost-key data and must not be destroyed.
 */
export function resetLockedHistory(confirmDestroy?: boolean): Promise<ResetReport> {
  return enqueue((): ResetReport => {
    try {
      if (!readIndexState().locked) return { ok: false, undeleted: 0 }
    } catch (err) {
      // Index unreadable (persistent read error / no backup possible): not proven lost -> refuse.
      if (err instanceof IndexUnavailableError) return { ok: false, undeleted: 0 }
      throw err
    }
    if (!sealedDataExists()) return { ok: false, undeleted: 0 }
    if (dataKeyFileExists() && confirmDestroy !== true) {
      return { ok: false, undeleted: 0, needsConfirmDestroy: true }
    }
    if (!shredDataKey()) return { ok: false, undeleted: 0 } // key first, abort before touching files
    const report = wipeAfterShred()
    saveSettings({ encryptHistory: false })
    return { ok: true, undeleted: report.undeleted }
  })
}

export type EncryptionUiState = 'off' | 'on' | 'migrating' | 'locked' | 'locked-transient' | 'unavailable'

export interface EncryptionProgress {
  state: EncryptionUiState
  done: number
  total: number
}

/**
 * Status for the Privacy panel. While a migration runs it answers from counters kept by the job (no
 * index decrypt, no file opens), so a 1 s poll is cheap. Otherwise one header peek per audio file
 * (called on open and after actions, not per tick).
 */
export function getEncryptionProgress(): EncryptionProgress {
  if (migrationRunning && migrationCounts) {
    return { state: 'migrating', done: migrationCounts.done, total: migrationCounts.total }
  }
  let st: IndexState
  try {
    st = readIndexState()
  } catch (err) {
    if (err instanceof IndexUnavailableError) {
      return { state: sealedDataExists() ? 'locked-transient' : 'unavailable', done: 0, total: 0 }
    }
    throw err
  }
  if (st.locked) {
    return { state: lockKindNow() === 'transient' ? 'locked-transient' : 'locked', done: 0, total: 0 }
  }
  let enabled = false
  try { enabled = encryptHistoryReader() } catch { enabled = false }
  let done = 0
  let total = 0
  for (const r of st.index.recordings) {
    if (r.deletedAt || !existsSync(r.filepath)) continue
    total++
    if (peekIsEncryptedAudio(r.filepath) === enabled) done++
  }
  return { state: enabled ? 'on' : 'off', done, total }
}

export function deleteRecordingsByDate(dateStr: string): Promise<void> {
  return enqueue(() => {
    const index = loadIndexForWrite()
    const toDelete: RecordingEntry[] = []
    const toKeep: RecordingEntry[] = []

    for (const entry of index.recordings) {
      const d = new Date(entry.timestamp)
      const pad = (n: number): string => n.toString().padStart(2, '0')
      const entryDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      if (entryDate === dateStr) {
        toDelete.push(entry)
      } else {
        toKeep.push(entry)
      }
    }

    for (const entry of toDelete) {
      if (isInsideRecordingsDir(entry.filepath) && existsSync(entry.filepath)) {
        try {
          unlinkSync(entry.filepath)
        } catch {
          /* best-effort: still drop the index entry so the delete converges */
        }
      }
    }

    saveIndex({ recordings: toKeep })
  })
}

/**
 * Single read path for kept audio (re-transcribe, playback IPC, export). Dispatches on the header
 * magic: legacy plaintext passes through, sealed audio is authenticated + decrypted IN MEMORY (never
 * written to disk). Returns null when the recording/file does not exist. Throws AudioVaultError
 * (clear message) when the file is sealed but cannot be opened.
 */
export function readRecordingAudio(id: string): Buffer | null {
  const entry = getRecording(id)
  if (!entry) return null
  if (!isInsideRecordingsDir(entry.filepath)) return null
  if (!existsSync(entry.filepath)) return null
  const raw = readFileSync(entry.filepath)
  if (!isEncryptedAudio(raw)) return raw
  const key = getDataKeyForDecrypt()
  if (!key) throw new AudioVaultError('Recording is encrypted and the history key is unavailable')
  return decryptAudio(key, raw, entry.id)
}

/** Back-compat name used by the IPC layer; same single read path. */
export const getRecordingAudio = readRecordingAudio

export interface AudioMigrationResult {
  converted: number
  skipped: number
  failed: number
}

let migrationCounts: { done: number; total: number } | null = null
let migrationRunning: { direction: 'encrypt' | 'decrypt'; promise: Promise<AudioMigrationResult> } | null = null

function sweepLeakedAudioTmp(): void {
  try {
    const dir = getRecordingsDir()
    sweepPendingWipes(dir) // plaintext pins left by a crash mid-migration (L4)
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.webm.mig.tmp') || f.endsWith('.webm.tmp')) {
        try { unlinkSync(join(dir, f)) } catch { /* best-effort */ }
      }
    }
  } catch { /* best-effort */ }
}

/**
 * Background audio migration: seal existing plaintext audio ('encrypt') or restore it ('decrypt').
 * Idempotent per file, resumable (leaked tmp files are swept), and mixed state is always valid
 * because reads dispatch on the header. Per file: convert in memory, write `<file>.mig.tmp` + fsync,
 * atomic rename over the same path (index unchanged, readable at every instant). One file per queue
 * slot so saves/deletes interleave.
 *
 * DIRECTION: the desired direction is re-read inside every slot (flag + sealed-index state). If the
 * user flips the toggle mid-run the running job finishes its current file, skips the rest, and a
 * call for the opposite direction is chained to run right after it ends - so the last intent wins
 * and every file ends in the final state.
 */
export function migrateAudio(direction: 'encrypt' | 'decrypt'): Promise<AudioMigrationResult> {
  if (migrationRunning) {
    // Always chain (even same direction): an ON -> OFF -> ON flip within one sweep would otherwise
    // leave files skipped during the OFF window as plaintext until next launch. A redundant pass
    // costs only 8-byte header peeks. entry.promise clears migrationRunning before it settles.
    return migrationRunning.promise.then(() => migrateAudio(direction))
  }
  const job = (async (): Promise<AudioMigrationResult> => {
    const result: AudioMigrationResult = { converted: 0, skipped: 0, failed: 0 }
    const st = readIndexState()
    if (st.locked) return result
    sweepLeakedAudioTmp()
    let key: Buffer | null
    try {
      key = direction === 'encrypt' ? getDataKeyForEncrypt() : getDataKeyForDecrypt()
    } catch {
      key = null
    }
    if (!key) {
      result.failed = st.index.recordings.filter((r) => !r.deletedAt).length
      return result
    }
    const ids = st.index.recordings.filter((r) => !r.deletedAt).map((r) => r.id)
    migrationCounts = { done: 0, total: ids.length }
    for (const id of ids) {
      const r = await enqueue((): 'converted' | 'skipped' | 'failed' => {
        try {
          const cur = readIndexState()
          if (cur.locked) return 'skipped'
          const entry = cur.index.recordings.find((e) => e.id === id && !e.deletedAt)
          // Same containment as playback/delete: a tampered index must never make the migration
          // rewrite (and then wipe) a file outside the recordings dir.
          if (!entry || !isInsideRecordingsDir(entry.filepath) || !existsSync(entry.filepath)) return 'skipped'
          // Re-check intent inside the slot: a toggle flipped mid-run is handled by the chained run.
          const flagOn = encryptHistoryReader()
          if (direction === 'encrypt' && !flagOn) return 'skipped'
          if (direction === 'decrypt' && (flagOn || cur.sealedOnDisk)) return 'skipped'
          const sealed = peekIsEncryptedAudio(entry.filepath)
          if (direction === 'decrypt' && !sealed) return 'skipped'
          const raw = readFileSync(entry.filepath)
          if (direction === 'encrypt' && sealed) {
            // Already sealed: it must open with the CURRENT key, else report it instead of hiding it.
            decryptAudio(key!, raw, entry.id)
            return 'skipped'
          }
          const out =
            direction === 'encrypt' ? encryptAudio(key!, raw, entry.id) : decryptAudio(key!, raw, entry.id)
          // Encrypt: pin the plaintext inode so it can be overwritten once the sealed copy has
          // replaced it (L4, best-effort; a pin failure never blocks the migration).
          const pin = direction === 'encrypt' ? pinForWipe(entry.filepath) : null
          try {
            atomicWriteFileSync(entry.filepath, `${entry.filepath}.mig.tmp`, out)
          } finally {
            releasePin(pin)
          }
          return 'converted'
        } catch (err) {
          console.error(
            `[Whisperio] audio migration (${direction}) failed for ${id}:`,
            err instanceof Error ? err.message : err
          )
          return 'failed'
        }
      })
      result[r]++
      if (migrationCounts) migrationCounts.done++
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return result
  })()
  const entry = {
    direction,
    promise: job.finally(() => {
      if (migrationRunning === entry) {
        migrationRunning = null
        migrationCounts = null
      }
    })
  }
  migrationRunning = entry
  return entry.promise
}

/** Startup/after-toggle hook: converge audio to the current setting. Never throws. */
export async function resumeAudioMigration(): Promise<AudioMigrationResult | null> {
  try {
    const direction = await enqueue((): 'encrypt' | 'decrypt' | null => {
      const st = readIndexState()
      if (st.locked) return null
      if (encryptHistoryReader()) {
        // Complete an interrupted enable before migrating audio: otherwise the setting can report
        // encryption enabled while index.json still exposes transcripts in plaintext.
        if (!st.sealedOnDisk) {
          writeIndexFile(st.index, true, true)
        }
        sealCorruptBackups()
        return 'encrypt'
      }
      // OFF: only decrypt once the index itself is plain (setHistoryEncryption(false) completed).
      // Sealing is sticky (see saveIndex): a flag that reads OFF because settings.json was reset must
      // never make startup write transcripts or audio back in plaintext.
      return st.sealedOnDisk ? null : 'decrypt'
    })
    return direction ? await migrateAudio(direction) : null
  } catch (err) {
    console.error('[Whisperio] audio migration aborted:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Names of PLAINTEXT index backups: quarantined corrupt copies (`index.corrupt-<ts>.json`, legacy
 * `index.json.corrupt-<ts>`) and the copy kept before invalid entries are filtered out
 * (`index.filtered-<ts>.json`). Exact names only, never `.sealed*` or `.tmp` leftovers: sealing anything else would produce a
 * name outside CORRUPT_BACKUP_RE that no erase/reset ever deletes - an orphan after crypto-shred (L5).
 */
export const PLAIN_INDEX_BACKUP_RE = /^index(\.json\.corrupt-[0-9]+(\.json)?|\.(corrupt|filtered)-[0-9]+\.json)$/

/**
 * Plaintext index backups (PLAIN_INDEX_BACKUP_RE) hold PLAINTEXT history. When encryption is turned ON they are
 * sealed in place via the same envelope (av=2) and renamed to <name>.sealed.json, then the
 * plaintext copy is overwritten with zeros and removed (best-effort, L4). A backup that cannot be
 * sealed or removed is left and counted (never silent).
 * There is no read path for recovering a sealed backup yet: the data is preserved, not browsable.
 */
/** Leftover of an interrupted atomic index write (see writeIndex: `${indexPath}.${pid}.${ts}.tmp`). */
const INDEX_WRITE_TMP_RE = /^index\.json\.[0-9]+\.[0-9]+\.tmp$/

function sealCorruptBackups(): { sealed: number; left: number } {
  let sealed = 0
  let left = 0
  let names: string[] = []
  try {
    names = readdirSync(getRecordingsDir()).filter((n) => PLAIN_INDEX_BACKUP_RE.test(n))
  } catch {
    return { sealed, left }
  }
  // A crash mid index write leaves `index.json.<pid>.<ts>.tmp`, a plaintext copy of the history. The
  // rename never happened, so index.json is the canonical copy: the leftover is removed, not sealed.
  try {
    for (const n of readdirSync(getRecordingsDir()).filter((x) => INDEX_WRITE_TMP_RE.test(x))) {
      try { unlinkSync(join(getRecordingsDir(), n)) } catch { left++ }
    }
  } catch { /* dir unreadable: handled above */ }
  for (const n of names) {
    const p = join(getRecordingsDir(), n)
    try {
      const key = getDataKeyForEncrypt()
      const out = `${p}.sealed.json`
      const tmp = `${out}.tmp`
      writeFileSync(tmp, serializeEnvelope(sealIndexPayload(key, readFileSync(p, 'utf-8'))), 'utf-8')
      renameSync(tmp, out)
      // only after the sealed copy is in place; overwrite failure falls back to a plain unlink
      if (secureDeleteFile(p) === 'failed') throw new Error('plaintext backup could not be removed')
      sealed++
    } catch {
      left++
      console.error(`[Whisperio] could not seal plaintext index backup ${n}`)
    }
  }
  return { sealed, left }
}

export type SetHistoryEncryptionResult =
  | { ok: true; sealedBackups?: number; plainBackupsLeft?: number }
  | { ok: false; reason: 'unavailable' | 'weak-backend' | 'locked' }

/**
 * Turn history encryption on/off. Runs in the same mutation queue as every other write.
 *
 * ORDER: the flag is persisted FIRST, then the index is rewritten. Reads are self-describing, so
 * every intermediate state is readable: a crash in between leaves flag=ON/index=plain (startup
 * resume seals it before migrating audio) or flag=OFF/index=sealed-but-readable (sticky: stays
 * sealed until the user turns encryption off again; data is never lost). If
 * the index rewrite itself fails the previous flag value is restored. The index is one
 * atomically-written file, so there is no half-migrated state.
 */
export function setHistoryEncryption(enabled: boolean): Promise<SetHistoryEncryptionResult> {
  return enqueue((): SetHistoryEncryptionResult => {
    const st = readIndexState()
    if (st.locked) return { ok: false, reason: 'locked' }

    if (enabled) {
      const avail = isDataVaultAvailable()
      if (!avail.ok) return { ok: false, reason: avail.reason }
      try {
        // Prove the key works (create/unwrap + seal + open a probe) before committing anything.
        const key = getDataKeyForEncrypt()
        const probe = 'probe'
        const sealed = sealIndexPayload(key, probe)
        if (openIndexPayload(key, sealed) !== probe) {
          return { ok: false, reason: 'unavailable' }
        }
      } catch {
        // A key file exists that cannot be unwrapped (never replaced) or sealing failed.
        return { ok: false, reason: 'locked' }
      }
    }

    let prevFlag = false
    try {
      prevFlag = encryptHistoryReader()
    } catch {
      prevFlag = false
    }
    saveSettings({ encryptHistory: enabled })
    if (enabled) sweepPendingWipes(getRecordingsDir())
    try {
      writeIndexFile(st.index, enabled, enabled && !st.sealedOnDisk)
    } catch (err) {
      try { saveSettings({ encryptHistory: prevFlag }) } catch { /* best-effort rollback */ }
      throw err
    }
    if (enabled) {
      const r = sealCorruptBackups()
      if (r.sealed || r.left) return { ok: true, sealedBackups: r.sealed, plainBackupsLeft: r.left }
    }
    return { ok: true }
  })
}

/**
 * True when sealed user data exists on disk (sealed index.json or any WHSPAUD audio file). Used by
 * dataVault to refuse minting a replacement DEK that would permanently orphan that data.
 */
export function sealedDataExists(): boolean {
  try {
    const dir = getRecordingsDir()
    const indexPath = join(dir, 'index.json')
    if (existsSync(indexPath) && !readOrphans().includes('index.json')) {
      const txt = readFileSync(indexPath, 'utf-8')
      try {
        if (looksSealed(JSON.parse(txt))) return true
      } catch {
        if (/"ct"\s*:/.test(txt) && /"alg"\s*:/.test(txt)) return true
      }
    }
    const orphans = new Set(readOrphans()) // sealed under a destroyed key: garbage, never blocks a new key
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.tmp') || f === 'index.json' || f === ORPHANS_FILE || orphans.has(f)) continue
      if (peekIsEncryptedAudio(join(dir, f))) return true
    }
  } catch { /* unreadable dir: nothing provably sealed */ }
  return false
}
registerSealedDataProbe(sealedDataExists)
