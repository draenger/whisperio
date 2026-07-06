import type { GitHubClient } from './githubClient'
import { encryptSecrets, decryptSecrets, type SecretEnvelope } from './secretCrypto'

// The encrypted secrets store backed by a single file in the connected repo.
// PURE given an injected client + master key: it reads the ciphertext blob,
// decrypts it locally, mutates the plain object, re-encrypts, and writes it back
// (conflict-safe via the existing blob sha). No plaintext and no key ever leave
// this process — only the AES-GCM envelope (base64) is committed.

export type Secrets = Record<string, string>

export interface SecretStoreConfig {
  owner: string
  repo: string
  branch: string
  path: string
}

export class SecretStore {
  constructor(
    private readonly client: GitHubClient,
    private readonly key: Buffer,
    private readonly config: SecretStoreConfig
  ) {}

  /** Decode → decrypt → parse the secrets object. A missing file means `{}`. */
  async readSecrets(): Promise<Secrets> {
    const file = await this.client.getFile(
      this.config.owner,
      this.config.repo,
      this.config.path,
      this.config.branch
    )
    if (!file) return {}
    const json = Buffer.from(file.contentBase64, 'base64').toString('utf-8')
    const envelope = JSON.parse(json) as SecretEnvelope
    const plaintext = decryptSecrets(envelope, this.key)
    const parsed = JSON.parse(plaintext) as Secrets
    return parsed && typeof parsed === 'object' ? parsed : {}
  }

  /** Encrypt → base64 → putFile, passing the current blob sha for a safe update. */
  async writeSecrets(secrets: Secrets): Promise<void> {
    const envelope = encryptSecrets(JSON.stringify(secrets), this.key)
    const contentBase64 = Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64')
    // Fetch the current sha so an update overwrites the right blob (GitHub
    // rejects a stale/missing sha on an existing file). Absent on first write.
    const existing = await this.client.getFile(
      this.config.owner,
      this.config.repo,
      this.config.path,
      this.config.branch
    )
    await this.client.putFile({
      owner: this.config.owner,
      repo: this.config.repo,
      path: this.config.path,
      contentBase64,
      message: 'Update Whisperio secrets',
      branch: this.config.branch,
      sha: existing?.sha
    })
  }

  async getSecret(name: string): Promise<string | null> {
    const secrets = await this.readSecrets()
    return name in secrets ? secrets[name] : null
  }

  async setSecret(name: string, value: string): Promise<void> {
    const secrets = await this.readSecrets()
    secrets[name] = value
    await this.writeSecrets(secrets)
  }

  async deleteSecret(name: string): Promise<void> {
    const secrets = await this.readSecrets()
    if (name in secrets) {
      delete secrets[name]
      await this.writeSecrets(secrets)
    }
  }

  async listSecretNames(): Promise<string[]> {
    return Object.keys(await this.readSecrets())
  }
}
