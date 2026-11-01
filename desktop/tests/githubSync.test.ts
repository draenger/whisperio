import { vi, describe, it, expect, beforeEach } from 'vitest'

const TOKEN = 'gho_SUPERSECRETTOKEN123'

const openExternal = vi.fn()
vi.mock('electron', () => ({ shell: { openExternal: (...a: unknown[]) => openExternal(...a) } }))

let settings: Record<string, string>
const saveSettings = vi.fn((patch: Record<string, string>) => {
  settings = { ...settings, ...patch }
})
vi.mock('../src/main/settingsManager', () => ({
  loadSettings: () => settings,
  saveSettings: (p: Record<string, string>) => saveSettings(p)
}))

const saveSettingsWithKeys = vi.fn()
vi.mock('../src/main/secure/keyAccessor', () => ({
  saveSettingsWithKeys: (p: unknown) => saveSettingsWithKeys(p)
}))

let storedToken = ''
const vault = {
  available: true,
  sealForRepo: vi.fn((s: string) => `SEALED(${s})`),
  openFromRepo: vi.fn((s: string) => {
    const m = /^SEALED\(([\s\S]*)\)$/.exec(s)
    if (!m) throw new Error('bad envelope')
    return m[1]
  })
}
vi.mock('../src/main/secretVault', () => ({
  isVaultAvailable: () => vault.available,
  sealForRepo: (s: string) => vault.sealForRepo(s),
  openFromRepo: (s: string) => vault.openFromRepo(s),
  saveGithubToken: (t: string) => {
    storedToken = t
  },
  loadGithubToken: () => storedToken,
  hasGithubToken: () => storedToken !== '',
  clearGithubToken: () => {
    storedToken = ''
  }
}))

const store = {
  isClientConfigured: vi.fn(() => true),
  startDeviceFlow: vi.fn(),
  pollForToken: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  listRepos: vi.fn(),
  readRemoteBlob: vi.fn(),
  writeRemoteBlob: vi.fn()
}
vi.mock('../src/main/githubStore', () => ({
  isClientConfigured: () => store.isClientConfigured(),
  startDeviceFlow: (...a: unknown[]) => store.startDeviceFlow(...a),
  pollForToken: (...a: unknown[]) => store.pollForToken(...a),
  getAuthenticatedUser: (...a: unknown[]) => store.getAuthenticatedUser(...a),
  listRepos: (...a: unknown[]) => store.listRepos(...a),
  readRemoteBlob: (...a: unknown[]) => store.readRemoteBlob(...a),
  writeRemoteBlob: (...a: unknown[]) => store.writeRemoteBlob(...a)
}))

type Sync = typeof import('../src/main/githubSync')
async function load(): Promise<Sync> {
  vi.resetModules() // resets module-level activeFlow
  return import('../src/main/githubSync')
}

const flow = { deviceCode: 'DEV', userCode: 'AB-12', verificationUri: 'https://github.com/login/device', expiresIn: 600, interval: 5 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  settings = { githubUser: '', githubRepo: 'o/r', githubBranch: 'dev', openaiApiKey: 'sk-openai', elevenlabsApiKey: 'el-key' }
  storedToken = TOKEN
  vault.available = true
  store.isClientConfigured.mockReturnValue(true)
  openExternal.mockResolvedValue(undefined)
})

describe('getStatus / selectRepo / disconnect', () => {
  it('reports status without exposing the token', async () => {
    const s = await load()
    settings.githubUser = 'octo'
    const st = s.getStatus()
    expect(st).toEqual({ clientConfigured: true, vaultAvailable: true, connected: true, user: 'octo', repo: 'o/r', branch: 'dev' })
    expect(JSON.stringify(st)).not.toContain(TOKEN)
  })

  it('defaults missing settings to empty strings and connected=false without token', async () => {
    const s = await load()
    settings = {}
    storedToken = ''
    expect(s.getStatus()).toMatchObject({ connected: false, user: '', repo: '', branch: '' })
  })

  it('selectRepo persists selection and returns fresh status', async () => {
    const s = await load()
    const st = s.selectRepo('x/y', 'main')
    expect(saveSettings).toHaveBeenCalledWith({ githubRepo: 'x/y', githubBranch: 'main' })
    expect(st.repo).toBe('x/y')
  })

  it('disconnect clears token + selection and aborts an active flow', async () => {
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    await s.beginConnect()
    const st = s.disconnect()
    expect(storedToken).toBe('')
    expect(saveSettings).toHaveBeenCalledWith({ githubUser: '', githubRepo: '', githubBranch: '' })
    expect(st.connected).toBe(false)
    expect(await s.pollConnect()).toEqual({ status: 'error', message: 'No active connection attempt' })
  })
})

describe('beginConnect', () => {
  it('blocks when the keychain vault is unavailable, before any network call', async () => {
    const s = await load()
    vault.available = false
    await expect(s.beginConnect()).rejects.toThrow(/Keychain is unavailable/)
    expect(store.startDeviceFlow).not.toHaveBeenCalled()
  })

  it('opens the browser and returns only user-facing fields (no device code)', async () => {
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    const prompt = await s.beginConnect()
    expect(openExternal).toHaveBeenCalledWith(flow.verificationUri)
    expect(prompt).toEqual({ userCode: 'AB-12', verificationUri: flow.verificationUri, expiresIn: 600 })
    expect(JSON.stringify(prompt)).not.toContain('DEV')
  })

  it('still succeeds if openExternal rejects', async () => {
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    openExternal.mockRejectedValue(new Error('no browser'))
    await expect(s.beginConnect()).resolves.toMatchObject({ userCode: 'AB-12' })
  })

  it('propagates device flow failures (offline)', async () => {
    const s = await load()
    store.startDeviceFlow.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await expect(s.beginConnect()).rejects.toThrow('ERR_INTERNET_DISCONNECTED')
  })
})

describe('pollConnect', () => {
  it('errors with no active flow', async () => {
    const s = await load()
    expect(await s.pollConnect()).toEqual({ status: 'error', message: 'No active connection attempt' })
    expect(store.pollForToken).not.toHaveBeenCalled()
  })

  it('reports expired (and does not poll) after expiresIn elapsed', async () => {
    vi.useFakeTimers()
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    await s.beginConnect()
    vi.advanceTimersByTime(601_000)
    expect(await s.pollConnect()).toEqual({ status: 'expired' })
    expect(store.pollForToken).not.toHaveBeenCalled()
    expect(await s.pollConnect()).toMatchObject({ status: 'error' })
  })

  it('authorized: stores token in vault, caches login, returns no token', async () => {
    const s = await load()
    storedToken = ''
    store.startDeviceFlow.mockResolvedValue(flow)
    store.pollForToken.mockResolvedValue({ status: 'authorized', token: TOKEN })
    store.getAuthenticatedUser.mockResolvedValue({ login: 'octo', avatarUrl: '' })
    await s.beginConnect()
    const r = await s.pollConnect()
    expect(store.pollForToken).toHaveBeenCalledWith('DEV')
    expect(storedToken).toBe(TOKEN)
    expect(saveSettings).toHaveBeenCalledWith({ githubUser: 'octo' })
    expect(r).toEqual({ status: 'authorized', user: 'octo' })
    expect(JSON.stringify(saveSettings.mock.calls)).not.toContain(TOKEN)
    expect(await s.pollConnect()).toMatchObject({ status: 'error' }) // flow cleared
  })

  it('authorized even if the profile call fails (login empty)', async () => {
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    store.pollForToken.mockResolvedValue({ status: 'authorized', token: TOKEN })
    store.getAuthenticatedUser.mockRejectedValue(new Error('offline'))
    await s.beginConnect()
    expect(await s.pollConnect()).toEqual({ status: 'authorized', user: '' })
    expect(storedToken).toBe(TOKEN)
  })

  it('pending and slow_down both map to pending and keep the flow alive', async () => {
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    await s.beginConnect()
    store.pollForToken.mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce({ status: 'slow_down', interval: 15 })
    expect(await s.pollConnect()).toEqual({ status: 'pending' })
    expect(await s.pollConnect()).toEqual({ status: 'pending' })
    store.pollForToken.mockResolvedValueOnce({ status: 'pending' })
    expect(await s.pollConnect()).toEqual({ status: 'pending' })
    expect(store.pollForToken).toHaveBeenCalledTimes(3)
  })

  it.each(['expired', 'denied'] as const)('%s clears the flow', async (status) => {
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    await s.beginConnect()
    store.pollForToken.mockResolvedValue({ status })
    expect(await s.pollConnect()).toEqual({ status })
    expect(await s.pollConnect()).toMatchObject({ status: 'error', message: 'No active connection attempt' })
  })

  it('passes through error messages', async () => {
    const s = await load()
    store.startDeviceFlow.mockResolvedValue(flow)
    await s.beginConnect()
    store.pollForToken.mockResolvedValue({ status: 'error', message: 'boom' })
    expect(await s.pollConnect()).toEqual({ status: 'error', message: 'boom' })
  })
})

describe('listRepositories', () => {
  it('requires a token', async () => {
    const s = await load()
    storedToken = ''
    await expect(s.listRepositories()).rejects.toThrow('Not connected to GitHub')
    expect(store.listRepos).not.toHaveBeenCalled()
  })
  it('passes the vault token to the store', async () => {
    const s = await load()
    store.listRepos.mockResolvedValue([{ fullName: 'a/b' }])
    expect(await s.listRepositories()).toEqual([{ fullName: 'a/b' }])
    expect(store.listRepos).toHaveBeenCalledWith(TOKEN)
  })
})

describe('pushSecrets', () => {
  it('guards: no token / no repo, with no network', async () => {
    const s = await load()
    storedToken = ''
    await expect(s.pushSecrets()).rejects.toThrow('Not connected to GitHub')
    storedToken = TOKEN
    settings.githubRepo = ''
    await expect(s.pushSecrets()).rejects.toThrow('No repository selected')
    expect(store.readRemoteBlob).not.toHaveBeenCalled()
  })

  it('first sync (404 -> null): writes without sha; only the sealed envelope reaches the repo', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue(null)
    store.writeRemoteBlob.mockResolvedValue({ sha: 'n' })
    const r = await s.pushSecrets()
    expect(r).toEqual({ ok: true, path: 'whisperio/secrets.enc.json', keys: ['openaiApiKey', 'elevenlabsApiKey'] })
    expect(store.readRemoteBlob).toHaveBeenCalledWith(TOKEN, 'o/r', 'whisperio/secrets.enc.json', 'dev')
    const [tok, repo, path, b64, msg, sha, branch] = store.writeRemoteBlob.mock.calls[0]
    expect([tok, repo, path, sha, branch]).toEqual([TOKEN, 'o/r', 'whisperio/secrets.enc.json', undefined, 'dev'])
    const sealedText = Buffer.from(b64 as string, 'base64').toString('utf-8')
    expect(sealedText.startsWith('SEALED(')).toBe(true)
    const inner = JSON.parse(vault.sealForRepo.mock.calls[0][0])
    expect(inner.schema).toBe('whisperio.secrets/1')
    expect(inner.secrets).toEqual({ openaiApiKey: 'sk-openai', elevenlabsApiKey: 'el-key' })
    expect(msg).toBe(`chore(whisperio): update encrypted secrets ${inner.updatedAt}`)
    expect(msg).not.toContain(TOKEN)
    expect(b64).not.toContain(TOKEN)
  })

  it('update: passes the existing blob sha; empty branch becomes undefined; missing keys sync as ""', async () => {
    const s = await load()
    settings.githubBranch = ''
    delete settings.elevenlabsApiKey
    store.readRemoteBlob.mockResolvedValue({ contentBase64: 'x', sha: 'OLD' })
    store.writeRemoteBlob.mockResolvedValue({ sha: 'n' })
    await s.pushSecrets()
    expect(store.readRemoteBlob.mock.calls[0][3]).toBeUndefined()
    expect(store.writeRemoteBlob.mock.calls[0][5]).toBe('OLD')
    expect(store.writeRemoteBlob.mock.calls[0][6]).toBeUndefined()
    expect(JSON.parse(vault.sealForRepo.mock.calls[0][0]).secrets.elevenlabsApiKey).toBe('')
  })

  it('conflict (409/422) from write propagates and nothing is saved locally', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue({ contentBase64: 'x', sha: 'STALE' })
    store.writeRemoteBlob.mockRejectedValue(new Error('GitHub write failed (HTTP 409)'))
    await expect(s.pushSecrets()).rejects.toThrow('HTTP 409')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('401 / rate limit / offline on read reject soft: no write, no local mutation, token not in message', async () => {
    const s = await load()
    for (const msg of ['GitHub read failed (HTTP 401)', 'GitHub read failed (HTTP 403)', 'net::ERR_INTERNET_DISCONNECTED']) {
      store.readRemoteBlob.mockRejectedValueOnce(new Error(msg))
      const err = (await s.pushSecrets().catch((e: Error) => e)) as Error
      expect(err.message).toBe(msg)
      expect(err.message).not.toContain(TOKEN)
    }
    expect(store.writeRemoteBlob).not.toHaveBeenCalled()
    expect(saveSettingsWithKeys).not.toHaveBeenCalled()
  })

  it('sealing failure aborts before any network call', async () => {
    const s = await load()
    vault.sealForRepo.mockImplementationOnce(() => {
      throw new Error('vault locked')
    })
    await expect(s.pushSecrets()).rejects.toThrow('vault locked')
    expect(store.readRemoteBlob).not.toHaveBeenCalled()
  })
})

describe('pullSecrets', () => {
  const blobOf = (obj: unknown) => ({
    contentBase64: Buffer.from(`SEALED(${JSON.stringify(obj)})`, 'utf-8').toString('base64'),
    sha: 's'
  })

  it('guards: no token / no repo', async () => {
    const s = await load()
    settings.githubRepo = ''
    await expect(s.pullSecrets()).rejects.toThrow('No repository selected')
    storedToken = ''
    await expect(s.pullSecrets()).rejects.toThrow('Not connected to GitHub')
  })

  it('404 first-sync: clear error, nothing saved', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue(null)
    await expect(s.pullSecrets()).rejects.toThrow('No encrypted secrets found')
    expect(saveSettingsWithKeys).not.toHaveBeenCalled()
  })

  it('decrypts and routes recovered keys through the key accessor (not saveSettings)', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue(blobOf({ secrets: { openaiApiKey: 'sk-new', elevenlabsApiKey: 'el-new' } }))
    const r = await s.pullSecrets()
    expect(store.readRemoteBlob).toHaveBeenCalledWith(TOKEN, 'o/r', 'whisperio/secrets.enc.json', 'dev')
    expect(saveSettingsWithKeys).toHaveBeenCalledWith({ openaiApiKey: 'sk-new', elevenlabsApiKey: 'el-new' })
    expect(saveSettings).not.toHaveBeenCalled()
    expect(r).toEqual({ ok: true, path: 'whisperio/secrets.enc.json', keys: ['openaiApiKey', 'elevenlabsApiKey'] })
  })

  it('merge: only string fields of known keys are applied; unknown/non-string ignored', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue(
      blobOf({ secrets: { openaiApiKey: 'sk-only', elevenlabsApiKey: 123, githubToken: 'evil', isAdmin: 'true' } })
    )
    const r = await s.pullSecrets()
    expect(saveSettingsWithKeys).toHaveBeenCalledWith({ openaiApiKey: 'sk-only' })
    expect(r.keys).toEqual(['openaiApiKey'])
  })

  it('payload without secrets yields an empty patch', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue(blobOf({ schema: 'x' }))
    const r = await s.pullSecrets()
    expect(saveSettingsWithKeys).toHaveBeenCalledWith({})
    expect(r.keys).toEqual([])
  })

  it('tampered/undecryptable envelope rejects and saves nothing', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue({ contentBase64: Buffer.from('garbage').toString('base64'), sha: 's' })
    await expect(s.pullSecrets()).rejects.toThrow('bad envelope')
    expect(saveSettingsWithKeys).not.toHaveBeenCalled()
  })

  it('non-JSON plaintext rejects and saves nothing', async () => {
    const s = await load()
    store.readRemoteBlob.mockResolvedValue({ contentBase64: Buffer.from('SEALED(not json)').toString('base64'), sha: 's' })
    await expect(s.pullSecrets()).rejects.toThrow()
    expect(saveSettingsWithKeys).not.toHaveBeenCalled()
  })

  it('offline / 401 on read rejects without leaking the token and without touching local secrets', async () => {
    const s = await load()
    store.readRemoteBlob.mockRejectedValue(new Error('GitHub read failed (HTTP 401)'))
    const err = (await s.pullSecrets().catch((e: Error) => e)) as Error
    expect(err.message).not.toContain(TOKEN)
    expect(saveSettingsWithKeys).not.toHaveBeenCalled()
  })
})
