// Dependency-free (no Node/DOM types) so BOTH the main process
// (main/audioFormat.ts) and the renderer (renderer/audio/formatPlan.ts) can
// import it.
//
// SINGLE SOURCE OF TRUTH for "this provider cannot read WebM and needs WAV".
// A new WAV-only provider (e.g. parakeet, #47) only has to add its id here.
const WAV_ONLY_PROVIDERS: ReadonlySet<string> = new Set(['selfhosted'])

export function providerNeedsWav(id: string): boolean {
  return WAV_ONLY_PROVIDERS.has(id)
}
