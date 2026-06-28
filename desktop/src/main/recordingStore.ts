import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync } from 'fs'
import { join } from 'path'

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
}

interface RecordingIndex {
  recordings: RecordingEntry[]
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

export function loadIndex(): RecordingIndex {
  const indexPath = getIndexPath()
  if (!existsSync(indexPath)) {
    return { recordings: [] }
  }
  try {
    const raw = readFileSync(indexPath, 'utf-8')
    return JSON.parse(raw) as RecordingIndex
  } catch {
    return { recordings: [] }
  }
}

export function saveIndex(index: RecordingIndex): void {
  // Atomic write: serialize to a temp file then rename over the real index.
  // A crash mid-write leaves the previous index intact instead of a truncated
  // (corrupt) file.
  const indexPath = getIndexPath()
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8')
  renameSync(tmpPath, indexPath)
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
  metadata: { duration: number; provider: string }
): Promise<RecordingEntry> {
  const dir = getRecordingsDir()
  const id = generateId()
  const timestamp = Date.now()
  const filename = `recording-${formatTimestamp(timestamp)}.webm`
  const filepath = join(dir, filename)

  // The audio file has a unique name, so writing it outside the lock is safe.
  writeFileSync(filepath, audioBuffer)

  const entry: RecordingEntry = {
    id,
    filename,
    filepath,
    timestamp,
    duration: metadata.duration,
    status: 'pending',
    provider: metadata.provider,
    size: audioBuffer.length
  }

  return enqueue(() => {
    const index = loadIndex()
    index.recordings.push(entry)
    saveIndex(index)
    return entry
  })
}

export function updateRecording(id: string, updates: Partial<RecordingEntry>): Promise<RecordingEntry | null> {
  return enqueue(() => {
    const index = loadIndex()
    const idx = index.recordings.findIndex((r) => r.id === id)
    if (idx === -1) return null

    index.recordings[idx] = { ...index.recordings[idx], ...updates }
    saveIndex(index)
    return index.recordings[idx]
  })
}

export function getRecordings(): RecordingEntry[] {
  const index = loadIndex()
  return [...index.recordings].sort((a, b) => b.timestamp - a.timestamp)
}

export function getRecording(id: string): RecordingEntry | null {
  const index = loadIndex()
  return index.recordings.find((r) => r.id === id) || null
}

export function deleteRecording(id: string): Promise<boolean> {
  return enqueue(() => {
    const index = loadIndex()
    const idx = index.recordings.findIndex((r) => r.id === id)
    if (idx === -1) return false

    const entry = index.recordings[idx]
    if (existsSync(entry.filepath)) {
      unlinkSync(entry.filepath)
    }

    index.recordings.splice(idx, 1)
    saveIndex(index)
    return true
  })
}

export function deleteAllRecordings(): Promise<void> {
  return enqueue(() => {
    const index = loadIndex()

    for (const entry of index.recordings) {
      if (existsSync(entry.filepath)) {
        unlinkSync(entry.filepath)
      }
    }

    saveIndex({ recordings: [] })
  })
}

export function deleteRecordingsByDate(dateStr: string): Promise<void> {
  return enqueue(() => {
    const index = loadIndex()
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
        unlinkSync(entry.filepath)
      }
    }

    saveIndex({ recordings: toKeep })
  })
}

export function getRecordingAudio(id: string): Buffer | null {
  const entry = getRecording(id)
  if (!entry) return null
  if (!existsSync(entry.filepath)) return null
  return readFileSync(entry.filepath)
}
