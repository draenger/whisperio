/**
 * electron-updater hook: replaces NsisUpdater's script-shell-based Get-AuthenticodeSignature
 * check (Bitdefender kills script shells spawned by the app) with the pure-Node verifier.
 * electron-updater only calls it when app-update.yml has publisherName, which electron-builder
 * writes on every signed build; returning a string rejects the update (it is not installed).
 */

import { verifyAuthenticode } from './authenticode'

/** SHA-1 thumbprints of the certificates allowed to sign Whisperio updates (same Daniel Kasprzyk code-signing cert as Jarvis) (CN=Jarvis (Daniel Kasprzyk)). */
export const PINNED_UPDATE_SIGNERS: readonly string[] = ['2A917C6457B67B928C52413DB00FA34CAAF15206']

export type VerifyUpdateCodeSignature = (publisherNames: string[], path: string) => Promise<string | null>

export function createUpdateVerifier(
  pins: readonly string[] = PINNED_UPDATE_SIGNERS,
  log: (msg: string) => void = () => {}
): VerifyUpdateCodeSignature {
  return async (_publisherNames, path) => {
    const r = await verifyAuthenticode(path, pins)
    if (r.ok) {
      log(`[updater] signature OK: ${r.thumbprint} (${r.digest})`)
      return null
    }
    log(`[updater] REJECTED update ${path}: ${r.reason}`)
    return `update signature rejected: ${r.reason}`
  }
}
