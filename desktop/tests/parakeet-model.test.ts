import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let userData = ''
vi.mock('electron', () => ({
  app: { getPath: () => userData, getAppPath: () => userData },
  net: { request: vi.fn() }
}))

import {
  PARAKEET_FILES,
  PARAKEET_DIR_NAME,
  resolveParakeetFile,
  getParakeetDir,
  getParakeetModelStatus,
  getParakeetModelPaths,
  isParakeetModelReady,
  deleteParakeetModel
} from '../src/main/stt/parakeetModel'

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pk-model-'))
})
afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('parakeet model resolver', () => {
  it('lists the four sherpa-onnx transducer files with https URLs', () => {
    expect(PARAKEET_FILES.map((f) => f.name)).toEqual([
      'encoder.int8.onnx',
      'decoder.int8.onnx',
      'joiner.int8.onnx',
      'tokens.txt'
    ])
    for (const f of PARAKEET_FILES) expect(f.url.startsWith('https://')).toBe(true)
  })

  it('resolves files inside userData/models/<dir> only', () => {
    const p = resolveParakeetFile('tokens.txt')
    expect(p).toBe(join(userData, 'models', PARAKEET_DIR_NAME, 'tokens.txt'))
  })

  it('rejects names outside the catalog and traversal', () => {
    expect(() => resolveParakeetFile('../evil.bin')).toThrow(/Invalid/)
    expect(() => resolveParakeetFile('model.bin')).toThrow(/Invalid/)
    expect(() => resolveParakeetFile('..\\tokens.txt')).toThrow(/Invalid/)
  })

  it('is not ready when files are missing and getModelPaths throws', () => {
    expect(isParakeetModelReady()).toBe(false)
    const st = getParakeetModelStatus()
    expect(st.missing).toHaveLength(4)
    expect(() => getParakeetModelPaths()).toThrow(/incomplete/)
  })

  function writeFiles(): void {
    for (const f of PARAKEET_FILES) writeFileSync(resolveParakeetFile(f.name), 'x')
  }
  function writeManifest(sizeOverride?: Record<string, number>): void {
    const files: Record<string, { size: number; sha256: string }> = {}
    for (const f of PARAKEET_FILES) files[f.name] = { size: sizeOverride?.[f.name] ?? 1, sha256: f.sha256 as string }
    writeFileSync(join(getParakeetDir(), 'verified.json'), JSON.stringify({ files }))
  }

  it('files without a verified record are NOT ready and never reach the recognizer (e.g. left by an interrupted download)', () => {
    writeFiles()
    const st = getParakeetModelStatus()
    expect(st.ready).toBe(false)
    expect(st.verified).toBe(false)
    expect(st.missing).toHaveLength(4)
    expect(isParakeetModelReady()).toBe(false)
    expect(() => getParakeetModelPaths()).toThrow(/incomplete/)
  })

  it('is ready only when every file has a manifest record matching its pin and size', () => {
    writeFiles()
    writeManifest()
    const st = getParakeetModelStatus()
    expect(st.ready).toBe(true)
    expect(st.verified).toBe(true)
    expect(getParakeetModelPaths().encoder.endsWith('encoder.int8.onnx')).toBe(true)
  })

  it('a file whose size changed since it was verified is not ready', () => {
    writeFiles()
    writeManifest({ 'joiner.int8.onnx': 999 })
    const st = getParakeetModelStatus()
    expect(st.ready).toBe(false)
    expect(st.missing).toEqual(['joiner.int8.onnx'])
  })

  it('a manifest record with a different sha256 than the pin is ignored', () => {
    writeFiles()
    const files = Object.fromEntries(PARAKEET_FILES.map((f) => [f.name, { size: 1, sha256: 'ab'.repeat(32) }]))
    writeFileSync(join(getParakeetDir(), 'verified.json'), JSON.stringify({ files }))
    expect(isParakeetModelReady()).toBe(false)
  })

  it('delete removes the files and the manifest', () => {
    writeFiles()
    writeManifest()
    deleteParakeetModel()
    expect(existsSync(resolveParakeetFile('tokens.txt'))).toBe(false)
    expect(existsSync(join(getParakeetDir(), 'verified.json'))).toBe(false)
    expect(isParakeetModelReady()).toBe(false)
  })

  it('pins every file to a 64-hex SHA-256 and a 40-hex HF revision URL', () => {
    for (const f of PARAKEET_FILES) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(f.url).toMatch(/\/resolve\/[0-9a-f]{40}\//)
    }
  })
})
