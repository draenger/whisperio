/**
 * electron-updater hook: replaces NsisUpdater's script-shell-based Get-AuthenticodeSignature
 * check (Bitdefender kills script shells spawned by the app) with the pure-Node verifier.
 * electron-updater only calls it when app-update.yml has publisherName, which electron-builder
 * writes on every signed build; returning a string rejects the update (it is not installed).
 */

import { verifyAuthenticode, type SignerPins } from './authenticode'

/**
 * Pinned update signers (CN=Jarvis (Daniel Kasprzyk), valid to 2031-08-06). Primary pins are SHA-256
 * hashes of the signer's SubjectPublicKeyInfo - a LIST so a new key can be added in a release signed
 * by the old one before the old cert is retired. The SHA-1 cert thumbprint is a secondary pin.
 * Compute a pin: scripts/verify-signed-installer.mjs prints it, or
 * `openssl x509 -in cert.cer -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256`.
 */
export const PINNED_UPDATE_SIGNERS: SignerPins = {
  spkiSha256: ['3183F4B2FE26039DF691AFE6A63167F7D30CFD078D0110DE66DFF075777FA290'],
  thumbprints: ['2A917C6457B67B928C52413DB00FA34CAAF15206']
}

export type VerifyUpdateCodeSignature = (publisherNames: string[], path: string) => Promise<string | null>

export function createUpdateVerifier(
  pins: SignerPins = PINNED_UPDATE_SIGNERS,
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
