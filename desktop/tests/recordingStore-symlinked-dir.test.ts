import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'

// userData reached through a symlink (macOS: tmpdir /var/folders -> /private/var/folders).
// The recordings dir exists (realpath'd) while a new recording file does not yet:
// both must resolve to the same prefix, or a valid path is refused.
const base = join(tmpdir(), `whisperio-symdir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
const realDir = join(base, 'real')
const linkDir = join(base, 'link')

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => linkDir) } }))

import { isInsideRecordingsDir, getRecordingsDir } from '../src/main/recordingStore'

describe('isInsideRecordingsDir with a symlinked userData dir', () => {
  beforeAll(() => {
    mkdirSync(realDir, { recursive: true })
    symlinkSync(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir')
    mkdirSync(getRecordingsDir(), { recursive: true })
  })
  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('accepts a not-yet-written file inside the dir', () => {
    expect(isInsideRecordingsDir(join(getRecordingsDir(), 'new.webm'))).toBe(true)
    expect(isInsideRecordingsDir(join(getRecordingsDir(), 'sub', 'new.webm'))).toBe(true)
  })

  it('still refuses traversal and siblings', () => {
    expect(isInsideRecordingsDir(join(getRecordingsDir(), '..', 'x'))).toBe(false)
    expect(isInsideRecordingsDir(getRecordingsDir() + '-sibling/x')).toBe(false)
    expect(isInsideRecordingsDir(join(base, 'elsewhere', 'x'))).toBe(false)
  })
})
