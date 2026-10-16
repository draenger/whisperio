import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
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
  const [warning, setWarning] = useState<string | null>(null)
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.api?.settings : undefined
    return api?.onSecureStorageWarning?.(setWarning)
  }, [])
  if (warning) return <span style={{ ...s.hint, color: '#e5484d' }}>{warning}</span>
  if (available === null) return null
  return (
    <span style={s.hint}>
      {available
        ? 'Keys are encrypted with your OS secure storage.'
        : 'OS secure storage unavailable — new keys are kept for this session only and are not saved.'}
    </span>
  )
}
