import { vi, describe, it, expect, beforeEach } from 'vitest'

/**
 * Key-loss guard at the sync layer: when the vault key cannot be unlocked, pushSecrets/pullSecrets
 * must fail with the lock error BEFORE any network write, so the remote sealed blob is never
 * overwritten with data sealed under a new key.
 */
const h = vi.hoisted(() => {
  class VaultLockedError extends Error {}
  return { VaultLockedError }
})

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: vi.fn(() => ({ githubRepo: 'me/repo', githubBranch: 'main' })),
  saveSettings: vi.fn()
}))
vi.mock('../src/main/secure/keyAccessor', () => ({ saveSettingsWithKeys: vi.fn() }))
vi.mock('../src/main/secretVault', () => ({
  VaultLockedError: h.VaultLockedError,
  isVaultAvailable: vi.fn(() => true),
  sealForRepo: vi.fn(() => {
    throw new h.VaultLockedError('vault locked')
  }),
  openFromRepo: vi.fn(() => {
    throw new h.VaultLockedError('vault locked')
  }),
  saveGithubToken: vi.fn(),
  loadGithubToken: vi.fn(() => 'gh-token'),
  hasGithubToken: vi.fn(() => true),
  clearGithubToken: vi.fn()
}))
vi.mock('../src/main/githubStore', () => ({
  isClientConfigured: vi.fn(() => true),
  startDeviceFlow: vi.fn(),
  pollForToken: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  listRepos: vi.fn(),
  readRemoteBlob: vi.fn(async () => ({
    sha: 'abc',
    contentBase64: Buffer.from('{}').toString('base64')
  })),
  writeRemoteBlob: vi.fn()
}))

import { pushSecrets, pullSecrets } from '../src/main/githubSync'
import { writeRemoteBlob } from '../src/main/githubStore'
import { saveSettingsWithKeys } from '../src/main/secure/keyAccessor'

beforeEach(() => vi.clearAllMocks())

describe('locked vault never reaches the remote or local settings', () => {
  it('pushSecrets rejects with the lock error and performs no remote write', async () => {
    await expect(pushSecrets()).rejects.toBeInstanceOf(h.VaultLockedError)
    expect(writeRemoteBlob).not.toHaveBeenCalled()
  })

  it('pullSecrets rejects with the lock error and saves nothing locally', async () => {
    await expect(pullSecrets()).rejects.toBeInstanceOf(h.VaultLockedError)
    expect(saveSettingsWithKeys).not.toHaveBeenCalled()
  })
})
