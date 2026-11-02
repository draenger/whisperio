// Dependency-free (no Node/DOM types). Decides whether the silence-trimmed
// 16 kHz WAV is worth uploading instead of the original recording.
//
// The trimmed WAV is uncompressed PCM, so it is often LARGER than the original
// WebM/Opus and can exceed a provider's upload cap (OpenAI: 25 MB). Send it
// only when it is strictly smaller than the original AND under the cap of every
// provider that could receive it; otherwise the original is sent.

const MB = 1024 * 1024

export const DEFAULT_PROVIDER_UPLOAD_CAP_BYTES = 25 * MB

// Per-provider upload size caps. Unknown providers use the default.
export const PROVIDER_UPLOAD_CAP_BYTES: Readonly<Record<string, number>> = {
  openai: 25 * MB,
  elevenlabs: 25 * MB,
  selfhosted: 25 * MB,
}

export function providerUploadCap(id: string): number {
  return PROVIDER_UPLOAD_CAP_BYTES[id] ?? DEFAULT_PROVIDER_UPLOAD_CAP_BYTES
}

/** Smallest cap across the chain (the trimmed WAV may go to any of them). */
export function chainUploadCap(chain: readonly string[] | undefined | null): number {
  if (!chain || chain.length === 0) return DEFAULT_PROVIDER_UPLOAD_CAP_BYTES
  return Math.min(...chain.map(providerUploadCap))
}

export function shouldUseTrimmed(
  originalBytes: number,
  trimmedBytes: number,
  chain?: readonly string[] | null
): boolean {
  if (!(trimmedBytes > 0)) return false
  if (trimmedBytes >= originalBytes) return false
  return trimmedBytes <= chainUploadCap(chain)
}
