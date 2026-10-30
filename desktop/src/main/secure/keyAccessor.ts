import { loadSettings, saveSettings, type AppSettings } from '../settingsManager'
import { getKey, setKey, deleteKey, isEncryptionAvailable } from './keyStore'

/**
 * The AppSettings fields that hold provider API keys — the ONLY fields this
 * module ever routes to/from the encrypted key store (keyStore.ts). Every
 * other settings field always lives in settings.json exactly as before this
 * package. Keep in sync with settingsManager.ts's AppSettings shape.
 */
export const PROVIDER_KEY_FIELDS = [
  'openaiApiKey',
  'elevenlabsApiKey',
  'anthropicApiKey',
  'replicateApiKey',
  'groqApiKey',
  'deepgramApiKey',
  'assemblyaiApiKey',
  'mistralApiKey',
  'sttApiKey'
] as const satisfies readonly (keyof AppSettings)[]

export type ProviderKeyField = (typeof PROVIDER_KEY_FIELDS)[number]

export const SECURE_STORAGE_UNAVAILABLE_MESSAGE =
  'Secure storage unavailable on this system; the key is kept for this session only.'

/** Appended on Linux, where the usual cause is a missing or locked keyring. */
export const SECURE_STORAGE_LINUX_HINT =
  'To save keys permanently, install and start a keyring (gnome-keyring or KWallet), unlock it, and restart Whisperio.'

function unavailableMessage(): string {
  return process.platform === 'linux'
    ? `${SECURE_STORAGE_UNAVAILABLE_MESSAGE} ${SECURE_STORAGE_LINUX_HINT}`
    : SECURE_STORAGE_UNAVAILABLE_MESSAGE
}

/**
 * Fail-closed session store: when OS secure storage is unavailable, newly
 * entered provider keys are NEVER written to disk. They live here (process
 * memory) until the app quits.
 */
const sessionKeys = new Map<ProviderKeyField, string>()

let secureStorageWarningListener: ((message: string) => void) | null = null

/** Main registers this to forward the warning to the renderer. */
export function setSecureStorageWarningListener(fn: ((message: string) => void) | null): void {
  secureStorageWarningListener = fn
}

/** Test helper. */
export function _resetSessionKeysForTests(): void {
  sessionKeys.clear()
}

/**
 * Read the effective settings: settings.json with the key store overlaid on
 * top for the provider-key fields above (key store wins when it has a value
 * — see writeKeyField/migration below for how it gets there). This is the
 * ONE place every consumer that needs a provider key should read from —
 * transcribe.ts (STT provider construction + LLM `selectProvider` via
 * buildCleanupCandidates) and the `settings:load` IPC handler that feeds the
 * renderer. When OS secure storage is unavailable, or a field was never
 * migrated into it, the settings.json value passes through untouched — the
 * documented fallback for keys that were already on disk; new keys entered
 * while storage is unavailable are session-only (see saveSettingsWithKeys).
 */
export function getEffectiveSettings(): AppSettings {
  const settings = loadSettings()
  const sessionOverlay: Partial<AppSettings> = {}
  for (const [field, value] of sessionKeys) sessionOverlay[field] = value
  if (!isEncryptionAvailable()) {
    return sessionKeys.size === 0 ? settings : { ...settings, ...sessionOverlay }
  }
  const overlay: Partial<AppSettings> = {}
  for (const field of PROVIDER_KEY_FIELDS) {
    const stored = getKey(field)
    if (stored !== null) {
      overlay[field] = stored
    }
  }
  // Session keys (a write the key store refused) are newer than anything stored.
  return { ...settings, ...overlay, ...sessionOverlay }
}

/**
 * Write (or clear) a single provider-key field to the key store, with a
 * round-trip verification before reporting success. Returns true when the
 * key store is now the source of truth for this field (safe for the caller
 * to blank the settings.json copy); false when the caller should keep
 * relying on the settings.json copy (write/verify failed — never lose the
 * user's key over a key-store hiccup).
 *
 * Shared by both the migration step and the settings:save routing below so
 * they apply the exact same safety rule.
 */
function writeKeyField(field: ProviderKeyField, value: string): boolean {
  if (!value) {
    // Clearing: best-effort delete. Always safe to blank the settings.json
    // copy too — there is nothing left to lose either way.
    try {
      deleteKey(field)
    } catch (err) {
      console.error(`[Whisperio] failed to delete provider key "${field}" from the key store:`, err)
    }
    return true
  }
  try {
    setKey(field, value)
    const readBack = getKey(field)
    if (readBack === value) return true
    console.error(
      `[Whisperio] round-trip verification failed for provider key "${field}" — keeping the plaintext copy in settings.json.`
    )
    return false
  } catch (err) {
    console.error(`[Whisperio] failed to write provider key "${field}" to the key store:`, err)
    return false
  }
}

/**
 * Save settings from the renderer's `settings:save` call. Provider-key
 * fields present in `partial` are routed to the encrypted key store instead
 * of settings.json when OS secure storage is available (round-trip verified
 * before the settings.json copy is cleared — same rule as migration). Every
 * other field saves exactly as before via settingsManager.saveSettings.
 *
 * This is a deliberate design choice, not an oversight: the renderer <->
 * main IPC channel is local, same-trust-boundary process communication
 * (contextIsolation still applies, but there is no network hop) — so the
 * renderer keeps sending/receiving plaintext key values over IPC exactly as
 * it always has (AppSettings' shape is unchanged); only the value's resting
 * place on disk changes.
 */
export function saveSettingsWithKeys(partial: Partial<AppSettings>): AppSettings {
  const jsonPatch: Partial<AppSettings> = { ...partial }
  if (isEncryptionAvailable()) {
    let sessionOnly = false
    for (const field of PROVIDER_KEY_FIELDS) {
      if (!(field in partial)) continue
      const value = (partial[field] as string | undefined) ?? ''
      sessionKeys.delete(field)
      if (!writeKeyField(field, value)) {
        // FAIL CLOSED: the key store refused the write (or the read-back did
        // not match). Never fall back to plaintext on disk; keep the key in
        // memory for this session and tell the renderer.
        sessionKeys.set(field, value)
        sessionOnly = true
      }
      // Routed to (or cleared from) the key store, or held in memory only:
      // either way settings.json must not keep the secret.
      ;(jsonPatch as Record<string, unknown>)[field] = ''
    }
    if (sessionOnly) {
      console.warn(
        '[Whisperio] OS secure storage write failed — provider key(s) kept in memory for this session only, not persisted.'
      )
      secureStorageWarningListener?.(unavailableMessage())
    }
    const saved = saveSettings(jsonPatch)
    return sessionKeys.size === 0 ? saved : { ...saved, ...Object.fromEntries(sessionKeys) }
  }
  // Storage unavailable. FAIL CLOSED: never persist a new secret in plaintext. Keep it in
  // memory for this session, tell the renderer, and log a warning.
  const onDisk = loadSettings()
  let sessionOnly = false
  for (const field of PROVIDER_KEY_FIELDS) {
    if (!(field in partial)) continue
    const value = (partial[field] as string | undefined) ?? ''
    if (value === '') {
      sessionKeys.delete(field)
      continue // clearing is always safe to persist
    }
    if (value === (onDisk[field] ?? '')) {
      delete (jsonPatch as Record<string, unknown>)[field] // unchanged legacy value, nothing new to write
      continue
    }
    if (sessionKeys.get(field) !== value) {
      sessionKeys.set(field, value)
      sessionOnly = true
    }
    // Never persist the new secret; also clear any legacy plaintext copy it replaces.
    ;(jsonPatch as Record<string, unknown>)[field] = ''

  }
  if (sessionOnly) {
    console.warn(
      '[Whisperio] OS secure storage unavailable — provider key(s) kept in memory for this session only, not persisted.'
    )
    secureStorageWarningListener?.(unavailableMessage())
  }
  const saved = saveSettings(jsonPatch)
  return sessionKeys.size === 0 ? saved : { ...saved, ...Object.fromEntries(sessionKeys) }
}

/**
 * One-time startup migration: move any non-empty provider-key plaintext
 * values out of settings.json and into the encrypted key store, verifying
 * each round-trip before clearing the settings.json copy (never dropped —
 * the field stays present, just set to ''). Idempotent: a field with
 * nothing left in settings.json (already migrated, or never set) is a
 * no-op, and a field whose round-trip verification failed is retried on the
 * next launch (its plaintext is deliberately left in place). Call once from
 * main's `app.whenReady()`, before any consumer reads settings.
 */
export function migrateProviderKeysToKeyStore(): void {
  if (!isEncryptionAvailable()) {
    console.log('[Whisperio] provider-key migration skipped — OS secure storage unavailable on this machine.')
    return
  }
  const settings = loadSettings()
  const patch: Partial<AppSettings> = {}
  let migratedCount = 0
  for (const field of PROVIDER_KEY_FIELDS) {
    const value = settings[field]
    if (!value) continue // nothing to migrate for this field
    if (writeKeyField(field, value)) {
      ;(patch as Record<string, unknown>)[field] = ''
      migratedCount++
    }
  }
  if (migratedCount > 0) {
    saveSettings(patch)
    console.log(`[Whisperio] provider-key migration: moved ${migratedCount} key(s) into OS secure storage.`)
  } else {
    console.log('[Whisperio] provider-key migration: nothing to migrate.')
  }
}
