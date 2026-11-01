import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync, readdirSync } from 'fs'
import { join } from 'path'
import type { SpeakerSegment } from './dictation/conversation'
import { loadSettings, saveSettings } from './settingsManager'
import {
  isDataVaultAvailable,
  getDataKeyForEncrypt,
  getDataKeyForDecrypt,
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
const INDEX_AAD = 'whisperio/index/v1'
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
      const plain = JSON.parse(decryptWithKeyAad(key, parsed, INDEX_AAD)) as RecordingIndex
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
  return { enabled, sealedOnDisk: st.sealedOnDisk, locked: st.locked }
}

function serializeIndex(index: RecordingIndex, seal: boolean): string {
  if (!seal) return JSON.stringify(index, null, 2)
  const key = getDataKeyForEncrypt() // throws when the vault is unavailable: fail closed, never plain
  return serializeEnvelope(encryptWithKeyAad(key, JSON.stringify(index), INDEX_AAD, INDEX_KID))
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
  const filename = `recording-${formatTimestamp(timestamp)}.webm`

  // The seal decision AND the file write happen inside the mutation queue, i.e. serialized with
  // setHistoryEncryption and every migration slot: a save overlapping an ON toggle can never write
  // plaintext that a migration snapshot already passed over. When history encryption is ON (or the
  // index is already sealed) the audio is sealed BEFORE it touches disk; an unavailable vault
  // rejects the save (fail closed). Locked history refuses before any file is written.
  return enqueue(() => {
    const st = readIndexState()
    if (st.locked) throw new HistoryLockedError()
    const filepath = join(getRecordingsDir(), filename)
    if (st.sealedOnDisk || encryptHistoryReader()) {
      const sealed = encryptAudio(getDataKeyForEncrypt(), audioBuffer, id)
      atomicWriteFileSync(filepath, `${filepath}.tmp`, sealed)
    } else {
      writeFileSync(filepath, audioBuffer)
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

export function deleteAllRecordings(): Promise<void> {
  return enqueue(() => {
    const index = loadIndexForWrite()

    for (const entry of index.recordings) {
      if (existsSync(entry.filepath)) {
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
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return result
  })()
  const entry = {
    direction,
    promise: job.finally(() => {
      if (migrationRunning === entry) migrationRunning = null
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
        const sealed = encryptWithKeyAad(key, probe, INDEX_AAD, INDEX_KID)
        if (decryptWithKeyAad(key, sealed, INDEX_AAD) !== probe) {
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
    if (existsSync(indexPath)) {
      const txt = readFileSync(indexPath, 'utf-8')
      try {
        if (looksSealed(JSON.parse(txt))) return true
      } catch {
        if (/"ct"\s*:/.test(txt) && /"alg"\s*:/.test(txt)) return true
      }
    }
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.tmp') || f === 'index.json') continue
      if (peekIsEncryptedAudio(join(dir, f))) return true
    }
  } catch { /* unreadable dir: nothing provably sealed */ }
  return false
}
registerSealedDataProbe(sealedDataExists)
