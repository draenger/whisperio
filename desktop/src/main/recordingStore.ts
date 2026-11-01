import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  renameSync,
  readdirSync
} from 'fs'
import { join, basename, isAbsolute } from 'path'
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
  peekIsEncryptedAudio,
  AudioVaultError
} from './audioVault'

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

    if (existsSync(entry.filepath)) {
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
   * temporary): offer "Try again" before any destructive reset.
   */
  lockKind?: 'transient' | 'unrecoverable'
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

// Self-describing read: a parsed object with `recordings` is plain, one with v/alg/iv/ct/tag is a
// sealed envelope. Corrupt/unreadable plain JSON keeps its historical behaviour (empty list).
function readIndexState(): IndexState {
  const indexPath = getIndexPath()
  if (!existsSync(indexPath)) {
    return { index: { recordings: [] }, sealedOnDisk: false, locked: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(indexPath, 'utf-8'))
  } catch (err) {
    // Unparseable index (truncated by power loss, bit rot; plain or sealed): move it aside as
    // `.corrupt-<ts>` so the next save cannot overwrite the only copy, then start empty.
    try {
      const backupPath = `${indexPath}.corrupt-${Date.now()}`
      renameSync(indexPath, backupPath)
      console.error(
        `[Whisperio] recordings index was unreadable (${err instanceof Error ? err.message : String(err)}); ` +
          `backed up to ${backupPath}.`
      )
    } catch (backupErr) {
      // Could not move it aside: refuse writes rather than overwrite it.
      console.error('[Whisperio] Failed to back up unreadable recordings index:', backupErr)
      return { index: { recordings: [] }, sealedOnDisk: false, locked: true }
    }
    return { index: { recordings: [] }, sealedOnDisk: false, locked: false }
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
  return { index: parsed as RecordingIndex, sealedOnDisk: false, locked: false }
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
  const st = readIndexState()
  let enabled = false
  try {
    enabled = encryptHistoryReader()
  } catch {
    enabled = false
  }
  return st.locked
    ? { enabled, sealedOnDisk: st.sealedOnDisk, locked: true, lockKind: lockKindNow() }
    : { enabled, sealedOnDisk: st.sealedOnDisk, locked: false }
}

function serializeIndex(index: RecordingIndex, seal: boolean): string {
  if (!seal) return JSON.stringify(index, null, 2)
  const key = getDataKeyForEncrypt() // throws when the vault is unavailable: fail closed, never plain
  return serializeEnvelope(sealIndexPayload(key, JSON.stringify(index)))
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
  try {
    renameWithRetry(tmpPath, indexPath)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { /* best-effort cleanup */ }
    throw err
  }
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

export function saveRecording(
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
    // One-second name resolution: a same-second save (or a stepped-back clock) must not reuse an
    // existing file — tmp+rename would silently overwrite the other recording's audio. Safe check:
    // every audio write runs inside this queue. Same fix as main #43 (exclusive create there).
    let filename = `${base}.webm`
    for (let n = 2; existsSync(join(getRecordingsDir(), filename)) || existsSync(join(getRecordingsDir(), `${filename}.tmp`)); n++) {
      filename = `${base}-${n}.webm`
    }
    const filepath = join(getRecordingsDir(), filename)
    if (st.sealedOnDisk || encryptHistoryReader()) {
      const sealed = encryptAudio(getDataKeyForEncrypt(), audioBuffer, id)
      atomicWriteFileSync(filepath, `${filepath}.tmp`, sealed)
    } else {
      writeFileSync(filepath, audioBuffer)
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
    if (existsSync(entry.filepath)) {
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
export function isValidOrphanName(f: unknown): f is string {
  if (typeof f !== 'string' || f.length === 0) return false
  if (f.includes('/') || f.includes('\\') || f.includes('\0') || f.includes('..')) return false
  if (isAbsolute(f) || basename(f) !== f) return false
  if (f.includes(':')) return false // Windows drive-relative names / NTFS alternate data streams
  return f === 'index.json' || f.endsWith('.webm') || f.endsWith('.tmp')
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
  try { names = readdirSync(dir) } catch { /* nothing to wipe */ }
  for (const f of names) {
    // index.json.corrupt-* backups may hold plaintext history: erase/reset removes them too
    // (every other path keeps them).
    if (!(f.endsWith('.webm') || f.endsWith('.tmp') || f.startsWith('index.json.corrupt-'))) continue
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
  const st = readIndexState()
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
    const shred = st.sealedOnDisk || encryptHistoryReader()

    if (shred) {
      if (!shredDataKey()) throw new KeyShredError()
      return wipeAfterShred()
    }

    for (const entry of index.recordings) {
      if (existsSync(entry.filepath)) {
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
        if (!f.startsWith('index.json.corrupt-')) continue
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
    if (!readIndexState().locked) return { ok: false, undeleted: 0 }
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

export type EncryptionUiState = 'off' | 'on' | 'migrating' | 'locked' | 'locked-transient'

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
  const st = readIndexState()
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
      if (existsSync(entry.filepath)) {
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
          if (!entry || !existsSync(entry.filepath)) return 'skipped'
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
          atomicWriteFileSync(entry.filepath, `${entry.filepath}.mig.tmp`, out)
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
    const st = readIndexState()
    if (st.locked) return null
    if (encryptHistoryReader()) return await migrateAudio('encrypt')
    // OFF: only decrypt once the index itself is plain (setHistoryEncryption(false) completed).
    if (!st.sealedOnDisk) return await migrateAudio('decrypt')
    return null
  } catch (err) {
    console.error('[Whisperio] audio migration aborted:', err instanceof Error ? err.message : err)
    return null
  }
}

export type SetHistoryEncryptionResult =
  | { ok: true }
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
