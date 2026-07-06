import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'

// The GitHub access token (device-flow OAuth token or a pasted PAT) is a secret:
// it is NEVER written to settings.json. Instead it lives in its own
// safeStorage-wrapped file in userData, mirroring the mobile app scrubbing the
// token out of the settings blob and into the Keychain.
//
// THIN + coverage-excluded: depends on the live safeStorage runtime.

const TOKEN_FILE = 'github-token.bin'

function tokenPath(): string {
  return join(app.getPath('userData'), TOKEN_FILE)
}

export function getToken(): string | null {
  const filePath = tokenPath()
  if (!existsSync(filePath)) return null
  try {
    const wrapped = readFileSync(filePath)
    const token = safeStorage.decryptString(wrapped)
    return token.length > 0 ? token : null
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; cannot store the GitHub token.')
  }
  const filePath = tokenPath()
  const wrapped = safeStorage.encryptString(token)
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, wrapped)
  renameSync(tmpPath, filePath)
}

export function clearToken(): void {
  const filePath = tokenPath()
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath)
    } catch {
      /* best-effort */
    }
  }
}

export function hasToken(): boolean {
  return getToken() !== null
}
