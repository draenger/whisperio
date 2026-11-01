import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-idx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const h = vi.hoisted(() => ({ ebusyLeft: 0, calls: 0 }))

vi.mock('fs', async (orig) => {
  const real = (await orig()) as typeof import('fs')
  return {
    ...real,
    readFileSync: ((p: any, ...rest: any[]) => {
      if (h.ebusyLeft !== 0 && String(p).endsWith('index.json')) {
        h.calls++
        if (h.ebusyLeft > 0) h.ebusyLeft--
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
      return (real.readFileSync as any)(p, ...rest)
    }) as typeof real.readFileSync
  }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => testDir) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (s: string) => Buffer.from(`ENC:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').slice(4)
  }
}))

import {
  saveRecording,
  getRecordings,
  setHistoryEncryption,
  setEncryptHistoryReader,
  IndexUnavailableError
} from '../src/main/recordingStore'
import { shredDataKey } from '../src/main/dataVault'

const DIR = join(testDir, 'recordings')
const INDEX = join(DIR, 'index.json')
const SECRET = 'transcript-secret-zebra-42'
const plainIndex = JSON.stringify({ recordings: [{ id: 'a', filename: 'a.webm', filepath: join(DIR, 'a.webm'), timestamp: 1, duration: 1, status: 'completed', provider: 'x', size: 1 }] })

describe('recordingStore index recovery', () => {
  beforeEach(() => {
    h.ebusyLeft = 0
    h.calls = 0
    setEncryptHistoryReader(() => false)
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
    mkdirSync(DIR, { recursive: true })
    shredDataKey()
  })
  afterEach(() => {
    h.ebusyLeft = 0
    setEncryptHistoryReader(null)
    shredDataKey()
    vi.restoreAllMocks()
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('transient EBUSY once is retried and the index loads', () => {
    writeFileSync(INDEX, plainIndex)
    h.ebusyLeft = 1
    expect(getRecordings()).toHaveLength(1)
    expect(h.calls).toBe(1)
  })

  it('persistent EBUSY refuses, leaves the file untouched, never quarantines, save refused', async () => {
    writeFileSync(INDEX, plainIndex)
    h.ebusyLeft = -1
    expect(() => getRecordings()).toThrow(IndexUnavailableError)
    expect(() => getRecordings()).toThrow(/\[INDEX_UNAVAILABLE\]/)
    await expect(saveRecording(Buffer.from('a'), { duration: 1, provider: 'x', status: 'completed' })).rejects.toThrow(/INDEX_UNAVAILABLE/)
    h.ebusyLeft = 0
    expect(readFileSync(INDEX, 'utf-8')).toBe(plainIndex)
    expect(readdirSync(DIR).filter((f) => f.includes('corrupt'))).toEqual([])
  })

  it('SyntaxError is quarantined (moved aside, content kept)', () => {
    writeFileSync(INDEX, '{"recordings": [ {"id": "a"')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getRecordings()).toEqual([])
    const b = readdirSync(DIR).filter((f) => f.startsWith('index.json.corrupt-'))
    expect(b).toHaveLength(1)
    expect(readFileSync(join(DIR, b[0]), 'utf-8')).toBe('{"recordings": [ {"id": "a"')
  })

  it('wrong shape (recordings not an array) is quarantined', () => {
    writeFileSync(INDEX, '{"recordings": "nope"}')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getRecordings()).toEqual([])
    expect(readdirSync(DIR).filter((f) => f.startsWith('index.json.corrupt-'))).toHaveLength(1)
  })

  it('does not log the JSON.parse message (may contain transcript text)', () => {
    writeFileSync(INDEX, `{"recordings":[{"transcription":"${SECRET}" oops`)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    getRecordings()
    const all = JSON.stringify([...err.mock.calls, ...warn.mock.calls, ...log.mock.calls])
    expect(all).not.toContain(SECRET)
    expect(all).not.toMatch(/Unexpected|position|JSON at/)
  })

  it('turning encryption ON seals plaintext .corrupt-* backups and removes the plaintext', async () => {
    writeFileSync(INDEX, plainIndex)
    writeFileSync(join(DIR, 'index.json.corrupt-111'), `{"recordings":[{"transcription":"${SECRET}"`)
    const res = await setHistoryEncryption(true)
    expect(res).toEqual({ ok: true, sealedBackups: 1, plainBackupsLeft: 0 })
    const files = readdirSync(DIR)
    expect(files).toContain('index.json.corrupt-111.sealed.json')
    expect(files).not.toContain('index.json.corrupt-111')
    const raw = readFileSync(join(DIR, 'index.json.corrupt-111.sealed.json'), 'utf-8')
    expect(raw).not.toContain(SECRET)
    expect(JSON.parse(raw).av).toBe(2)
  })
})
