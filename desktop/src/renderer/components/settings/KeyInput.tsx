import { createContext, useContext, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'

/**
 * Provider API key input. The renderer never holds a raw key: `value` is only
 * what the user typed this session. When a key is already stored, the
 * placeholder shows its mask ("Saved: sk-…a1b2") and a small "Clear" action
 * deletes it via an explicit clear (an empty input alone means "unchanged").
 */
export interface KeyStatusEntry {
  set: boolean
  hint: string
}

export interface KeyStatusContextValue {
  status: Record<string, KeyStatusEntry>
  clearKey: (field: string) => void
}

export const KeyStatusContext = createContext<KeyStatusContextValue>({ status: {}, clearKey: () => undefined })

interface KeyInputProps {
  /** AppSettings key field name, e.g. 'openaiApiKey'. */
  field: string
  value: string
  onChange: (v: string) => void
  /** Placeholder when no key is stored yet. */
  placeholder: string
  s: { input: CSSProperties; hint: CSSProperties }
  theme: Theme
}

export function KeyInput({ field, value, onChange, placeholder, s, theme }: KeyInputProps): ReactElement {
  const { status, clearKey } = useContext(KeyStatusContext)
  const entry = status[field]
  const isSet = !!entry?.set
  const shownPlaceholder = isSet
    ? entry.hint
      ? `Saved: ${entry.hint}`
      : 'Saved (hidden)'
    : placeholder
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={shownPlaceholder}
        autoComplete="off"
        style={{ ...s.input, flex: 1 }}
      />
      {isSet && value === '' && (
        <button
          type="button"
          onClick={() => clearKey(field)}
          style={{
            background: 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            padding: '6px 10px',
            fontSize: '11px',
            color: theme.danger,
            cursor: 'pointer',
            fontFamily: 'IBM Plex Sans, sans-serif',
            flexShrink: 0
          }}
        >Clear</button>
      )}
    </div>
  )
}
