import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { SecretStore } from '../src/main/github/secretStore'
import type { GitHubClient, GitHubFile } from '../src/main/github/githubClient'

// A fake GitHub contents API: one file per path. Models GitHub faithfully — our
// putFile content is base64(envelope JSON), and getFile returns that same base64
// (GitHub would return base64 of the decoded bytes, which equals what we sent).
class FakeClient {
  files = new Map<string, GitHubFile>()
  putCalls: Array<{ path: string; sha?: string; contentBase64: string }> = []
  private shaCounter = 0

  async getFile(_owner: string, _repo: string, path: string): Promise<GitHubFile | null> {
    return this.files.get(path) ?? null
  }

  async putFile(args: { path: string; contentBase64: string; sha?: string }): Promise<{ sha: string; commitSha: string }> {
    this.putCalls.push({ path: args.path, sha: args.sha, contentBase64: args.contentBase64 })
    const sha = `sha-${++this.shaCounter}`
    this.files.set(args.path, { contentBase64: args.contentBase64, sha })
    return { sha, commitSha: `commit-${this.shaCounter}` }
  }
}

const KEY = randomBytes(32)
const CONFIG = { owner: 'o', repo: 'r', branch: 'main', path: '.whisperio/secrets.json.enc' }

function makeStore(): { store: SecretStore; client: FakeClient } {
  const client = new FakeClient()
  const store = new SecretStore(client as unknown as GitHubClient, KEY, CONFIG)
  return { store, client }
}

describe('SecretStore', () => {
  it('reads an empty object when the file is missing', async () => {
    const { store } = makeStore()
    expect(await store.readSecrets()).toEqual({})
    expect(await store.getSecret('missing')).toBeNull()
    expect(await store.listSecretNames()).toEqual([])
  })

  it('set → get round-trips through encrypted storage', async () => {
    const { store, client } = makeStore()
    await store.setSecret('OPENAI_API_KEY', 'sk-abc')
    expect(await store.getSecret('OPENAI_API_KEY')).toBe('sk-abc')
    // The committed blob is ciphertext, never the plaintext value.
    const stored = Buffer.from(client.files.get(CONFIG.path)!.contentBase64, 'base64').toString('utf-8')
    expect(stored).not.toContain('sk-abc')
    expect(JSON.parse(stored)).toHaveProperty('v')
  })

  it('lists and deletes secret names', async () => {
    const { store } = makeStore()
    await store.setSecret('A', '1')
    await store.setSecret('B', '2')
    expect((await store.listSecretNames()).sort()).toEqual(['A', 'B'])
    await store.deleteSecret('A')
    expect(await store.listSecretNames()).toEqual(['B'])
    expect(await store.getSecret('A')).toBeNull()
  })

  it('passes the existing blob sha through on update (conflict-safe)', async () => {
    const { store, client } = makeStore()
    await store.setSecret('A', '1') // first write: no sha
    await store.setSecret('B', '2') // update: must carry the prior sha
    expect(client.putCalls[0].sha).toBeUndefined()
    expect(client.putCalls[1].sha).toBe('sha-1')
  })

  it('deleteSecret on an absent key does not write', async () => {
    const { store, client } = makeStore()
    await store.deleteSecret('nope')
    expect(client.putCalls.length).toBe(0)
  })
})
