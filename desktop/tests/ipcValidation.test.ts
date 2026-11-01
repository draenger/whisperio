import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `whisperio-ipcv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const outsideDir = join(tmpdir(), `whisperio-ipcv-outside-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => testDir) } }))

import { isTrustedAppUrl, assertTrustedSender, sanitizeRecordingUpdate } from '../src/main/ipcValidation'
import {
  saveRecording,
  updateRecording,
  deleteRecording,
  getRecordingAudio,
  getRecording,
  loadIndex,
  saveIndex,
  isInsideRecordingsDir,
  getRecordingsDir
} from '../src/main/recordingStore'

describe('sanitizeRecordingUpdate', () => {
  it('keeps status/transcription/error and strips filepath and unknown fields', () => {
    const out = sanitizeRecordingUpdate({
      status: 'completed',
      transcription: 'hi',
      error: undefined,
      filepath: 'C:/Windows/win.ini',
      filename: 'x',
      id: 'other',
      size: 1,
      segments: [],
      evil: true
    })
    expect(out).toEqual({ status: 'completed', transcription: 'hi', error: undefined })
    expect(out).not.toHaveProperty('filepath')
    expect(out).not.toHaveProperty('evil')
  })
  it('validates types and rejects bad status / non-object', () => {
    expect(sanitizeRecordingUpdate({ status: 'hax', transcription: 5, error: 3 })).toEqual({})
    expect(sanitizeRecordingUpdate(null)).toEqual({})
    expect(sanitizeRecordingUpdate('x')).toEqual({})
  })
  it('caps lengths', () => {
    expect(sanitizeRecordingUpdate({ error: 'a'.repeat(20_001) })).toEqual({})
  })
})

describe('trusted sender', () => {
  it('accepts file:// and the dev server origin', () => {
    expect(isTrustedAppUrl('file:///C:/app/renderer/settings/settings.html')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:5173/settings/settings.html', 'http://localhost:5173')).toBe(true)
    expect(isTrustedAppUrl('http://localhost:5173', 'http://localhost:5173')).toBe(true)
  })
  it('rejects foreign / empty / lookalike origins', () => {
    expect(isTrustedAppUrl('https://evil.com/')).toBe(false)
    expect(isTrustedAppUrl('http://localhost:5173.evil.com/', 'http://localhost:5173')).toBe(false)
    expect(isTrustedAppUrl('http://localhost:5173/x')).toBe(false) // no dev url configured
    expect(isTrustedAppUrl('')).toBe(false)
    expect(isTrustedAppUrl(undefined)).toBe(false)
  })
  it('assertTrustedSender throws for untrusted frames and passes for app frames', () => {
    expect(() => assertTrustedSender({ senderFrame: { url: 'file:///app/index.html' } }, undefined)).not.toThrow()
    expect(() => assertTrustedSender({ senderFrame: { url: 'https://evil.com' } }, undefined)).toThrow(/untrusted/)
    expect(() => assertTrustedSender({ senderFrame: null }, undefined)).toThrow(/untrusted/)
    expect(() => assertTrustedSender({ senderFrame: null, sender: { getURL: () => 'file:///a.html' } }, undefined)).not.toThrow()
  })
})

describe('recordingStore path confinement', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
  })
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
  })

  it('isInsideRecordingsDir rejects traversal, absolute and lookalike paths', () => {
    const dir = getRecordingsDir()
    expect(isInsideRecordingsDir(join(dir, 'a.webm'))).toBe(true)
    expect(isInsideRecordingsDir(join(dir, '..', 'x'))).toBe(false)
    expect(isInsideRecordingsDir(join(outsideDir, 'x'))).toBe(false)
    expect(isInsideRecordingsDir(dir + '-sibling/x')).toBe(false)
    expect(isInsideRecordingsDir(dir)).toBe(false)
    expect(isInsideRecordingsDir('')).toBe(false)
    expect(isInsideRecordingsDir(undefined)).toBe(false)
  })

  it('refuses to read or delete a file outside the dir even if the index points at it', async () => {
    const victim = join(outsideDir, 'secret.txt')
    writeFileSync(victim, 'secret')
    const entry = await saveRecording(Buffer.from('audio'), { duration: 1, provider: 'p' })
    const index = loadIndex()
    index.recordings[0].filepath = victim
    saveIndex(index)

    expect(getRecordingAudio(entry.id)).toBeNull()
    expect(await deleteRecording(entry.id)).toBe(true)
    expect(existsSync(victim)).toBe(true)
  })

  it('refuses a ../ relative filepath', async () => {
    const entry = await saveRecording(Buffer.from('audio'), { duration: 1, provider: 'p' })
    const rel = join(getRecordingsDir(), '..', 'escape.txt')
    writeFileSync(rel, 'x')
    await updateRecording(entry.id, { filepath: rel })
    expect(getRecordingAudio(entry.id)).toBeNull()
    await deleteRecording(entry.id)
    expect(existsSync(rel)).toBe(true)
    expect(getRecording(entry.id)).toBeNull()
  })

  it('still reads and deletes legit recordings', async () => {
    const entry = await saveRecording(Buffer.from('audio'), { duration: 1, provider: 'p' })
    expect(getRecordingAudio(entry.id)?.toString()).toBe('audio')
    await deleteRecording(entry.id)
    expect(existsSync(entry.filepath)).toBe(false)
  })
})
