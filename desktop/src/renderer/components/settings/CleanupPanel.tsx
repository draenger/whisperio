import { useMemo, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import { ToggleRow, Segmented } from './SettingsForm'

/*
 * AI Cleanup panel (desktop v1.4 cleanup line).
 *
 * KONTRAKT: the settings keys this panel reads/writes — cleanupEnabled,
 * cleanupMode, aiProvider, aiBaseUrl, aiModel, anthropicApiKey — are owned by
 * the parallel "A-core" package (settingsManager.ts / preload). This file
 * only defines the UI-facing types for them (below); SettingsForm.tsx is the
 * single place that reconciles them against the real AppSettings shape once
 * A-core's types land (see the CleanupSettings cast there).
 *
 * Note this panel's CleanupMode ('off' | 'light' | 'full') is intentionally
 * a superset of src/main/llm/prompts.ts's CleanupMode ('full' | 'light') —
 * 'off' here just means cleanupEnabled's effect, i.e. "don't call the LLM at
 * all", so it never reaches the prompt builder. The two types don't need to
 * match; they describe different layers (UI toggle vs. prompt shape).
 */
export type CleanupMode = 'off' | 'light' | 'full'
export type AiProvider = 'openai' | 'anthropic' | 'local'

/** Minimal shape of SettingsForm's `makeStyles(theme)` output this panel touches.
 * Kept as a narrow local type (rather than importing `makeStyles` itself) so this
 * file only takes on a *value* import from SettingsForm (ToggleRow/Segmented) — the
 * styles object is passed in structurally, no extra coupling needed for its type. */
interface SettingsStyles {
  card: CSSProperties
  cardTitle: CSSProperties
  label: CSSProperties
  input: CSSProperties
  select: CSSProperties
  hint: CSSProperties
}

const CLEANUP_MODE_OPTIONS: { value: CleanupMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'light', label: 'Light' },
  { value: 'full', label: 'Full' }
]

// Kept in sync with the rule set in src/main/llm/prompts.ts (CLEANUP_RULES /
// RULE_INDEXES_BY_MODE) — light = fillers + punctuation, full additionally
// resolves self-corrections and tone.
const CLEANUP_MODE_HINTS: Record<CleanupMode, string> = {
  off: 'No cleanup — the raw transcription is pasted as-is.',
  light: 'Removes filler words and hesitations, and fixes punctuation.',
  full: 'Light, plus resolves self-corrections and adjusts tone.'
}

const AI_PROVIDER_OPTIONS: { value: AiProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI (cloud)' },
  { value: 'anthropic', label: 'Anthropic (cloud)' },
  { value: 'local', label: 'Local (on-device)' }
]

const AI_MODEL_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku',
  local: 'llama3'
}

/*
 * Loopback / RFC1918-private / mDNS-local hostname check, used ONLY to decide
 * whether to show the quiet "on-device" reassurance badge next to the AI Base
 * URL field. This mirrors the semantics of isLocalHost() in
 * src/main/llm/provider.ts (the real enforcement point that picks providers
 * and decides fail-soft-to-local behavior) — but this is a separate, renderer-
 * only copy: the renderer bundle can't import src/main code (different
 * electron-vite build target), and this copy only drives a cosmetic badge, not
 * any actual provider selection. If the two ever need to diverge that's fine;
 * if you're touching the *real* local/remote decision, edit provider.ts, not this.
 */
const LOCAL_HOSTNAME_RE = /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|0\.0\.0\.0)$/i
const PRIVATE_HOSTNAME_RE = /^(10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})$/
const MDNS_LOCAL_RE = /\.local$/i

/**
 * True when `rawUrl`'s host is loopback, RFC1918-private, or `.local` mDNS —
 * i.e. it never leaves this machine/LAN. Tolerates bare `host:port` input
 * (no scheme) since that's exactly what users type for e.g. Ollama. Never
 * throws: a malformed or mid-typed URL just reads as "not on-device" rather
 * than breaking the settings form.
 */
export function isOnDeviceBaseUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim()
  if (!trimmed) return false
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let hostname: string
  try {
    hostname = new URL(withScheme).hostname
  } catch {
    return false
  }
  return LOCAL_HOSTNAME_RE.test(hostname) || PRIVATE_HOSTNAME_RE.test(hostname) || MDNS_LOCAL_RE.test(hostname)
}

/** Quiet green "on-device" badge — ported from docs/design/wz-overlay.jsx's
 * OvlOnDevice, using the --wsp-ondevice-* tokens (no hardcoded hex). */
function OnDeviceBadge(): ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '10px',
        fontWeight: 600,
        letterSpacing: '0.06em',
        color: 'var(--wsp-ondevice-fg)',
        padding: '3px 8px',
        borderRadius: 'var(--wsp-radius-pill)',
        background: 'var(--wsp-ondevice-bg)',
        border: '1px solid var(--wsp-ondevice-border)',
        flexShrink: 0,
        whiteSpace: 'nowrap'
      }}
      data-testid="ondevice-badge"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      on-device
    </span>
  )
}

export interface CleanupPanelProps {
  cleanupEnabled: boolean
  setCleanupEnabled: (v: boolean) => void
  cleanupMode: CleanupMode
  setCleanupMode: (v: CleanupMode) => void
  aiProvider: AiProvider
  setAiProvider: (v: AiProvider) => void
  aiBaseUrl: string
  setAiBaseUrl: (v: string) => void
  aiModel: string
  setAiModel: (v: string) => void
  anthropicApiKey: string
  setAnthropicApiKey: (v: string) => void
  s: SettingsStyles
  theme: Theme
}

/**
 * "AI Cleanup" section — supersedes the old inline "AI vocabulary correction"
 * toggle that used to live under the OpenAI provider's expanded settings
 * (SettingsForm.tsx's ProvidersTab still round-trips that legacy
 * `aiPostProcessing` key via load/save so existing installs don't lose it,
 * it's just no longer surfaced here).
 *
 * Fail-soft is a hard invariant: if the configured AI provider can't be
 * reached, the raw transcription is pasted — this panel never blocks
 * dictation on an LLM call succeeding, and says so under the section.
 */
export function CleanupPanel({
  cleanupEnabled, setCleanupEnabled,
  cleanupMode, setCleanupMode,
  aiProvider, setAiProvider,
  aiBaseUrl, setAiBaseUrl,
  aiModel, setAiModel,
  anthropicApiKey, setAnthropicApiKey,
  s, theme
}: CleanupPanelProps): ReactElement {
  const onDevice = useMemo(() => isOnDeviceBaseUrl(aiBaseUrl), [aiBaseUrl])

  return (
    <div style={s.card}>
      <h3 style={s.cardTitle}>AI Cleanup</h3>

      <ToggleRow
        label="Clean up transcriptions"
        description="Removes filler words, fixes punctuation, and smooths self-corrections — language-aware, works in 100+ languages."
        checked={cleanupEnabled}
        onChange={setCleanupEnabled}
        theme={theme}
      />

      {cleanupEnabled && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text }}>Cleanup level</div>
              <div style={{ fontSize: '12.5px', color: theme.textMuted, marginTop: '2px' }}>
                {CLEANUP_MODE_HINTS[cleanupMode]}
              </div>
            </div>
            <Segmented options={CLEANUP_MODE_OPTIONS} value={cleanupMode} onChange={setCleanupMode} theme={theme} />
          </div>

          <div
            style={{
              marginTop: '4px',
              paddingTop: '14px',
              borderTop: `1px solid ${theme.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <label style={s.label}>AI Provider</label>
            <select
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value as AiProvider)}
              style={s.select}
            >
              {AI_PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            <label style={{ ...s.label, marginTop: '8px' }}>AI Base URL</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="text"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:11434"
                style={s.input}
              />
              {onDevice && <OnDeviceBadge />}
            </div>
            <span style={s.hint}>
              e.g. http://127.0.0.1:11434 for Ollama — loopback = processing stays on this machine.
            </span>

            <label style={{ ...s.label, marginTop: '8px' }}>AI Model</label>
            <input
              type="text"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder={AI_MODEL_PLACEHOLDER[aiProvider]}
              style={s.input}
            />

            {aiProvider === 'anthropic' && (
              <>
                <label style={{ ...s.label, marginTop: '8px' }}>Anthropic API Key</label>
                <input
                  type="password"
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  style={s.input}
                />
              </>
            )}
          </div>
        </>
      )}

      <span style={{ ...s.hint, fontStyle: 'italic' }}>
        If the AI provider is unreachable, the raw transcription is pasted — dictation never breaks.
      </span>
    </div>
  )
}
