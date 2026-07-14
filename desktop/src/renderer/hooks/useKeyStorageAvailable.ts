import { useEffect, useState } from 'react'

/**
 * Whether OS-backed secure storage (Keychain/libsecret/DPAPI) is available on
 * this machine for provider API keys — see src/main/secure/keyStore.ts. Used
 * only to render an honest hint next to API key fields; never gates any
 * functionality (the settings.json fallback always works regardless).
 *
 * `null` while the one-shot IPC call is in flight, so callers can render
 * nothing rather than flash the wrong hint for a frame.
 */
export function useKeyStorageAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    // Guard against a test/SSR/storybook render where the preload bridge
    // isn't present — this hook must never throw, only ever report "unknown
    // yet" (null) or "unavailable" (false).
    const api = typeof window !== 'undefined' ? window.api?.settings : undefined
    if (!api) return
    api
      .keyStorageAvailable()
      .then((value) => {
        if (!cancelled) setAvailable(value)
      })
      .catch(() => {
        // Fail soft to "unavailable" — an IPC hiccup here must never crash
        // the settings UI; it just means the hint defaults to the more
        // conservative (fallback) copy until the next mount/retry.
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
