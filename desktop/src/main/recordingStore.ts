import { app } from 'electron'
import { existsSync, realpathSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync, copyFileSync, statSync, readdirSync } from 'fs'
import { join, resolve, sep, dirname } from 'path'
import type { SpeakerSegment } from './dictation/conversation'
import { loadSettings, saveSettings } from './settingsManager'
import {
  isDataVaultAvailable,
  getDataKeyForEncrypt,
  getDataKeyForDecrypt
} from './dataVault'
import {
  encryptWithKeyAad,
  decryptWithKeyAad,
  serializeEnvelope,
  type SecretEnvelope
} from './secretCrypto'

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
  // outside it is refused. Non-existent paths fall back to lexical resolution.
  const real = (p: string): string => {
    const r = resolve(p)
    try {
      return existsSync(r) ? realpathSync(r) : r
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
  try {
    st = readIndexState()
  } catch {
    st = { index: { recordings: [] }, sealedOnDisk: false, locked: true }
  }
  let enabled = false
  try {
    enabled = encryptHistoryReader()
  } catch {
    enabled = false
  }
  return { enabled, sealedOnDisk: st.sealedOnDisk, locked: st.locked }
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
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

function isTransientRenameError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' && TRANSIENT_RENAME_CODES.has(code)
}

export function saveIndex(index: RecordingIndex): void {
  // Never overwrite a sealed index we cannot open (would destroy the user's history).
  const st = readIndexState()
  if (st.locked) throw new HistoryLockedError()
  // Sealing is sticky: a sealed index stays sealed even if the flag reads OFF (e.g. settings.json
  // was reset to defaults after corruption). Only setHistoryEncryption(false) writes plain over it.
  writeIndexFile(index, st.sealedOnDisk || encryptHistoryReader())
}

function writeIndexFile(index: RecordingIndex, seal: boolean): void {
  // Atomic write: serialize to a temp file then rename over the real index.
  // A crash mid-write leaves the previous index intact instead of a truncated
  // (corrupt) file.
  const indexPath = getIndexPath()
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, serializeIndex(index, seal), 'utf-8')

  // The rename can fail (transient Windows lock, disk full, read-only dir).
  // Whatever the reason, the temp file must not be left behind: saveIndex runs
  // on EVERY mutation, so a leaked `.tmp` per failure slowly fills the
  // recordings directory with junk that nothing ever collects.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmpPath, indexPath)
      return
    } catch (err) {
      if (attempt < RENAME_RETRIES - 1 && isTransientRenameError(err)) continue
      try { unlinkSync(tmpPath) } catch { /* best-effort cleanup */ }
      throw err
    }
  }
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
  // Refuse before touching disk when history is locked (no orphan audio file, no overwrite).
  try {
    if (readIndexState().locked) return Promise.reject(new HistoryLockedError())
  } catch (err) {
    return Promise.reject(err) // IndexUnavailableError: refuse, keep the file untouched
  }
  const dir = getRecordingsDir()
  const id = generateId()
  const timestamp = Date.now()
  // Refuse before touching disk when the index is unusable, so no orphan audio.
  try {
    loadIndex()
  } catch (err) {
    return Promise.reject(err)
  }

  // Names have one-second resolution: two saves in the same second (or a clock
  // stepped back) used to share a path, so the second write overwrote the first
  // recording's audio and deleting one entry removed the other's file. Create
  // exclusively ('wx') and add a -2, -3 ... suffix on collision. The exclusive
  // create also makes writing outside the lock safe.
  const base = `recording-${formatTimestamp(timestamp)}`
  let filename = `${base}.webm`
  let filepath = join(dir, filename)
  for (let n = 2; ; n++) {
    try {
      writeFileSync(filepath, audioBuffer, { flag: 'wx' })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== 'EEXIST' || n > 1000) throw err
      filename = `${base}-${n}.webm`
      filepath = join(dir, filename)
    }
  }

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

  return enqueue(() => {
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

export function deleteAllRecordings(): Promise<void> {
  return enqueue(() => {
    const index = loadIndexForWrite()

    for (const entry of index.recordings) {
      if (isInsideRecordingsDir(entry.filepath) && existsSync(entry.filepath)) {
        try {
          unlinkSync(entry.filepath)
        } catch {
          /* best-effort: still drop the index entry so the delete converges */
        }
      }
    }

    saveIndex({ recordings: [] })
  })
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

export function getRecordingAudio(id: string): Buffer | null {
  const entry = getRecording(id)
  if (!entry) return null
  if (!isInsideRecordingsDir(entry.filepath)) return null
  if (!existsSync(entry.filepath)) return null
  return readFileSync(entry.filepath)
}

/**
 * Names of PLAINTEXT index backups: quarantined corrupt copies (`index.corrupt-<ts>.json`, legacy
 * `index.json.corrupt-<ts>`) and the copy kept before invalid entries are filtered out
 * (`index.filtered-<ts>.json`). Exact names only, never `.sealed*` or `.tmp` leftovers.
 */
export const PLAIN_INDEX_BACKUP_RE = /^index(\.json\.corrupt-[0-9]+(\.json)?|\.(corrupt|filtered)-[0-9]+\.json)$/

/**
 * Plaintext index backups (PLAIN_INDEX_BACKUP_RE) hold PLAINTEXT history. When encryption is turned ON they are
 * sealed in place via the same envelope (av=2) and renamed to <name>.sealed.json, then the
 * plaintext copy is removed. A backup that cannot be sealed is left and counted (never silent).
 * There is no read path for recovering a sealed backup yet: the data is preserved, not browsable.
 */
function sealCorruptBackups(): { sealed: number; left: number } {
  let sealed = 0
  let left = 0
  let names: string[] = []
  try {
    names = readdirSync(getRecordingsDir()).filter((n) => PLAIN_INDEX_BACKUP_RE.test(n))
  } catch {
    return { sealed, left }
  }
  for (const n of names) {
    const p = join(getRecordingsDir(), n)
    try {
      const key = getDataKeyForEncrypt()
      const out = `${p}.sealed.json`
      const tmp = `${out}.tmp`
      writeFileSync(tmp, serializeEnvelope(sealIndexPayload(key, readFileSync(p, 'utf-8'))), 'utf-8')
      renameSync(tmp, out)
      unlinkSync(p) // only after the sealed copy is in place
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
 * every intermediate state is readable: a crash in between leaves flag=ON/index=plain (the next
 * save seals it) or flag=OFF/index=sealed-but-readable (the next save writes plain) - both
 * converge to the user's intent and neither loses data. If the index rewrite itself fails the
 * previous flag value is restored. The index is one atomically-written file, so there is no
 * half-migrated state.
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
    try {
      writeIndexFile(st.index, enabled)
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
