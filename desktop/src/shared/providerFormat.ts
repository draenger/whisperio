// Dependency-free (no Node/DOM types) so BOTH the main process
// (main/audioFormat.ts) and the renderer (renderer/audio/formatPlan.ts) can
// import it.
//
// SINGLE SOURCE OF TRUTH for "this provider cannot read WebM and needs WAV".
// A new WAV-only provider (e.g. parakeet, #47) only has to add its id here.
const WAV_ONLY_PROVIDERS: ReadonlySet<string> = new Set(['selfhosted', 'parakeet'])

export function providerNeedsWav(id: string): boolean {
  return WAV_ONLY_PROVIDERS.has(id)
}

/**
 * 'parakeet' is experimental and ignored by main unless the flag is on, so it
 * only counts as "needs WAV" for a chain when the flag is enabled.
 */
export function chainNeedsWav(
  chain: readonly string[] | undefined | null,
  experimentalParakeet?: boolean
): boolean {
  if (!chain) return false
  return chain.some((id) => (id === 'parakeet' && experimentalParakeet !== true ? false : providerNeedsWav(id)))
}
