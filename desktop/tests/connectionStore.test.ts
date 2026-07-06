import { vi, describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockRenameSync = vi.fn()
const mockUnlinkSync = vi.fn()

vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
  writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
  renameSync: (...a: unknown[]) => mockRenameSync(...a),
  unlinkSync: (...a: unknown[]) => mockUnlinkSync(...a)
}))

import { loadConnection, saveConnection, clearConnection } from '../src/main/github/connectionStore'

const FILE = join('/mock/userData', 'github-connection.json')

const CONN = {
  login: 'octocat',
  owner: 'octocat',
  repo: 'notes',
  defaultBranch: 'main',
  secretsPath: '.whisperio/secrets.json.enc'
}

describe('connectionStore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when no file exists', () => {
    mockExistsSync.mockReturnValue(false)
    expect(loadConnection()).toBeNull()
  })

  it('saves atomically (temp + rename) and round-trips', () => {
    const saved = saveConnection(CONN)
    expect(saved).toEqual(CONN)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    const [tmpPath, content] = mockWriteFileSync.mock.calls[0]
    expect(String(tmpPath).startsWith(`${FILE}.`)).toBe(true)
    expect(String(tmpPath).endsWith('.tmp')).toBe(true)
    expect(mockRenameSync).toHaveBeenCalledWith(tmpPath, FILE)

    // Loading the written content reproduces the connection.
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(content)
    expect(loadConnection()).toEqual(CONN)
  })

  it('NEVER persists a token even if one is passed in', () => {
    // A caller mistake: an access token riding along on the object.
    saveConnection({ ...CONN, token: 'gho_secret', accessToken: 'gho_secret' } as never)
    const [, content] = mockWriteFileSync.mock.calls[0]
    const parsed = JSON.parse(String(content))
    expect(parsed).toEqual(CONN)
    expect(content).not.toContain('gho_secret')
    expect('token' in parsed).toBe(false)
    expect('accessToken' in parsed).toBe(false)
  })

  it('returns null on a corrupt file', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('not json{{')
    expect(loadConnection()).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ login: 'x' }))
    expect(loadConnection()).toBeNull()
  })

  it('clearConnection unlinks the file when present', () => {
    mockExistsSync.mockReturnValue(true)
    clearConnection()
    expect(mockUnlinkSync).toHaveBeenCalledWith(FILE)
  })
})
