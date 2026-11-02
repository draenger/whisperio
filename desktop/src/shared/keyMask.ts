/**
 * Pure helpers that keep raw provider API keys out of the renderer.
 * `redactKeys` blanks the key fields of a settings object; `buildKeyStatus`
 * produces the additive `keyStatus` map (set flag + short mask) the UI shows
 * instead. No Electron / fs imports — unit-testable.
 */

export interface KeyStatusEntry {
  set: boolean
  hint: string
}

export type KeyStatus = Record<string, KeyStatusEntry>

/** `sk-…a1b2`: first 3 + last 4 chars, only for keys of >= 12 chars (else ''). */
export function maskKey(key: string | null | undefined): string {
  if (typeof key !== 'string' || key.length < 12) return ''
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export function buildKeyStatus(
  settings: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): KeyStatus {
  const out: KeyStatus = {}
  for (const f of fields) {
    const v = settings[f]
    const value = typeof v === 'string' ? v : ''
    out[f] = { set: value.length > 0, hint: maskKey(value) }
  }
  return out
}

/** Copy of `settings` with every key field set to '' plus `keyStatus`. Never mutates the input. */
export function redactKeys<T extends object>(
  settings: T,
  fields: readonly string[]
): T & { keyStatus: KeyStatus } {
  const copy: Record<string, unknown> = { ...settings }
  const keyStatus = buildKeyStatus(copy, fields)
  for (const f of fields) copy[f] = ''
  return { ...(copy as T), keyStatus }
}

/**
 * Normalise a renderer save payload: an empty key field means "unchanged"
 * (dropped) unless listed in `clearKeys`, in which case it becomes '' (clear).
 * A non-empty value always passes through (replace). `clearKeys` itself is
 * removed from the result. Unknown names in clearKeys are ignored.
 */
export function sanitizeRendererSave<T extends Record<string, unknown>>(
  payload: T,
  fields: readonly string[]
): Omit<T, 'clearKeys' | 'keyStatus'> {
  const { clearKeys, keyStatus: _ks, ...rest } = payload as Record<string, unknown>
  void _ks
  const clear = new Set(
    Array.isArray(clearKeys) ? (clearKeys as unknown[]).filter((k): k is string => typeof k === 'string') : []
  )
  for (const f of fields) {
    if (!(f in rest)) {
      if (clear.has(f)) rest[f] = ''
      continue
    }
    const v = rest[f]
    if (clear.has(f)) rest[f] = ''
    else if (typeof v !== 'string' || v === '') delete rest[f]
  }
  return rest as Omit<T, 'clearKeys' | 'keyStatus'>
}
