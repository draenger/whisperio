// Decides which audio the renderer must prepare before calling main.
// The original WebM/Opus is ALWAYS sent (cloud providers use it as-is); a WAV
// is produced only when `selfhosted` (whisper.cpp) is in the chain, and is
// sent as an additional buffer so main can pick per provider.

export interface FormatPlan {
  sendOriginal: true
  needsWav: boolean
}

export function planAudioFormats(chain: readonly string[] | undefined | null): FormatPlan {
  return { sendOriginal: true, needsWav: !!chain && chain.includes('selfhosted') }
}
