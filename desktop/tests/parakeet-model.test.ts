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

  it('is ready when all files exist but never verified without SHA-256 pins', () => {
    for (const f of PARAKEET_FILES) writeFileSync(resolveParakeetFile(f.name), 'x')
    const st = getParakeetModelStatus()
    expect(st.ready).toBe(true)
    expect(st.verified).toBe(false)
    expect(getParakeetModelPaths().encoder.endsWith('encoder.int8.onnx')).toBe(true)
    deleteParakeetModel()
    expect(existsSync(resolveParakeetFile('tokens.txt'))).toBe(false)
  })

  it('has sha256 pins unset (TODO) so verification stays refused', () => {
    expect(PARAKEET_FILES.every((f) => f.sha256 === null)).toBe(true)
  })
})
