import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

// Sealed save (history encryption ON): the name is reserved with an empty placeholder, then the
// encrypted audio replaces it atomically. When that write fails (disk full, AV lock) the save must
// reject with the real error, leave no empty placeholder or temp file behind, add no index entry,
// and not block the next save.

const testDir = join(tmpdir(), `whisperio-sealfail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const RECORDINGS_DIR = join(testDir, 'recordings')

const h = vi.hoisted(() => ({ failAudioWrite: false }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(`ENC:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').slice(4)
  }
}))

vi.mock('../src/main/audioVault', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/audioVault')>()
  return {
    ...real,
    atomicWriteFileSync: (finalPath: string, tmpPath: string, data: Buffer): void => {
      if (h.failAudioWrite && finalPath.endsWith('.webm')) {
        const err = new Error('ENOSPC: no space left on device, write') as NodeJS.ErrnoException
        err.code = 'ENOSPC'
        throw err
      }
      real.atomicWriteFileSync(finalPath, tmpPath, data)
    }
  }
})

import { saveRecording, getRecordings, setEncryptHistoryReader } from '../src/main/recordingStore'
import { shredDataKey } from '../src/main/dataVault'

const files = (): string[] => (existsSync(RECORDINGS_DIR) ? readdirSync(RECORDINGS_DIR).sort() : [])
const save = (): ReturnType<typeof saveRecording> =>
  saveRecording(Buffer.from('audio-bytes'), { duration: 1, provider: 'openai', transcription: 't', status: 'completed' })

describe('saveRecording with history encryption ON: the sealed audio write fails', () => {
  beforeEach(() => {
    h.failAudioWrite = false
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(testDir, { recursive: true })
    shredDataKey()
    setEncryptHistoryReader(() => true)
  })
  afterEach(() => {
    setEncryptHistoryReader(null)
    shredDataKey()
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('rejects with the write error and leaves no placeholder, temp file or index entry', async () => {
    await save() // one good sealed recording first, so the index exists
    const before = files()
    expect(getRecordings()).toHaveLength(1)

    h.failAudioWrite = true
    await expect(save()).rejects.toMatchObject({ code: 'ENOSPC' })

    expect(files()).toEqual(before) // no empty .webm placeholder, no .tmp
    expect(getRecordings()).toHaveLength(1)
  })

  it('the next save after a failed one succeeds and its audio is not empty', async () => {
    h.failAudioWrite = true
    await expect(save()).rejects.toThrow('ENOSPC')
    expect(files().filter((f) => f.endsWith('.webm'))).toEqual([])

    h.failAudioWrite = false
    const rec = await save()
    expect(getRecordings().map((r) => r.id)).toEqual([rec.id])
    expect(files()).toContain(rec.filename)
    const audio = readFileSync(rec.filepath)
    expect(audio.length).toBeGreaterThan(0) // the placeholder was replaced
    expect(audio.includes(Buffer.from('audio-bytes'))).toBe(false) // sealed, never plaintext
  })
})
