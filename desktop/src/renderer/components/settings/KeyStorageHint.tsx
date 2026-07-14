import type { CSSProperties, ReactElement } from 'react'
import { useKeyStorageAvailable } from '../../hooks/useKeyStorageAvailable'

/**
 * Discreet hint rendered under a provider API key field, honestly reflecting
 * whether OS secure storage is actually available on this machine — never a
 * blanket "always encrypted" claim (see src/main/secure/keyStore.ts /
 * keyAccessor.ts for the storage this describes). Renders nothing while the
 * one-shot availability check is in flight.
 */
export function KeyStorageHint({ s }: { s: { hint: CSSProperties } }): ReactElement | null {
  const available = useKeyStorageAvailable()
  if (available === null) return null
  return (
    <span style={s.hint}>
      {available
        ? 'Keys are encrypted with your OS secure storage.'
        : 'OS secure storage unavailable — keys are stored in the local settings file.'}
    </span>
  )
}
