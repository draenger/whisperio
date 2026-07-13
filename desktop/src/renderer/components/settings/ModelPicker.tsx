import { useState, useEffect, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import type { AiProvider } from './CleanupPanel'
import {
  listModelsForProvider,
  findCatalogModel,
  type LLMCatalogProviderId
} from '../../modelCatalog'

/** Sentinel `<option>` value for "Custom…" — never a real model id (catalog ids are
 * always non-empty `owner/name` or bare model strings, never this exact token). */
const CUSTOM_OPTION_VALUE = '__custom__'

const AI_MODEL_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  replicate: 'meta/meta-llama-3-8b-instruct',
  local: 'llama3'
}

function toCatalogProvider(provider: AiProvider): LLMCatalogProviderId | null {
  return provider === 'openai' || provider === 'anthropic' || provider === 'replicate' ? provider : null
}

/**
 * Whether the dropdown (rather than the free-text escape hatch) should be
 * shown for this provider + current model value. An EMPTY `modelId` counts
 * as "dropdown" — it means "use the provider's default", same meaning the
 * free-text field's placeholder conveys when this same value is blank — only
 * a non-empty value that doesn't match any catalog entry should force custom
 * mode.
 */
function shouldShowDropdown(provider: AiProvider, modelId: string): boolean {
  const catalogProvider = toCatalogProvider(provider)
  if (!catalogProvider) return false
  if (!modelId) return true
  return findCatalogModel(catalogProvider, modelId) !== undefined
}

/** Minimal shape of SettingsForm's `makeStyles(theme)` output this component touches. */
interface SettingsStyles {
  label: CSSProperties
  input: CSSProperties
  select: CSSProperties
  hint: CSSProperties
}

export interface ModelPickerProps {
  aiProvider: AiProvider
  aiModel: string
  setAiModel: (v: string) => void
  /**
   * True when `aiBaseUrl` resolves to a loopback/private/mDNS host (see
   * `isOnDeviceBaseUrl` in CleanupPanel.tsx) — a private server never has a
   * curated catalog, so the field is always free text regardless of
   * `aiProvider`, same as `aiProvider === 'local'`.
   */
  onDevice: boolean
  s: SettingsStyles
  theme: Theme
}

/**
 * AI Cleanup's model field. For a hosted, catalog-backed provider
 * (openai/anthropic/replicate) not pointed at a private host, this renders a
 * curated dropdown + a "Custom…" escape hatch. For `local` or any private/
 * on-device base URL, it's ALWAYS a free-text field — there is no catalog
 * for a self-hosted endpoint, so a dropdown would be actively misleading.
 */
export function ModelPicker({ aiProvider, aiModel, setAiModel, onDevice, s, theme }: ModelPickerProps): ReactElement {
  const forceFreeText = aiProvider === 'local' || onDevice
  const [customMode, setCustomMode] = useState(() => !shouldShowDropdown(aiProvider, aiModel))

  // Re-derive dropdown vs. free-text whenever the provider (or the on-device
  // classification of the base URL) changes, so a stale "custom" flag from a
  // previous provider doesn't linger once the field's meaning has changed.
  useEffect(() => {
    setCustomMode(!shouldShowDropdown(aiProvider, aiModel))
    // Deliberately excludes `aiModel` — this effect exists to reset state when
    // *provider identity* changes, not to react to every keystroke (that would
    // fight the user out of custom mode mid-typing whenever they happen to
    // type a full match for a catalog id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiProvider, forceFreeText])

  if (forceFreeText) {
    return (
      <input
        type="text"
        value={aiModel}
        onChange={(e) => setAiModel(e.target.value)}
        placeholder={AI_MODEL_PLACEHOLDER[aiProvider]}
        style={s.input}
        data-testid="model-freetext"
      />
    )
  }

  const catalogProvider = toCatalogProvider(aiProvider) as LLMCatalogProviderId
  const catalogModels = listModelsForProvider(catalogProvider)

  if (customMode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <input
          type="text"
          value={aiModel}
          onChange={(e) => setAiModel(e.target.value)}
          placeholder={AI_MODEL_PLACEHOLDER[aiProvider]}
          style={s.input}
          data-testid="model-freetext"
        />
        <button
          type="button"
          onClick={() => setCustomMode(false)}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: '11px',
            fontWeight: 600,
            color: theme.accent,
            cursor: 'pointer',
            fontFamily: 'IBM Plex Sans, sans-serif'
          }}
        >
          Choose from list
        </button>
      </div>
    )
  }

  return (
    <select
      value={aiModel}
      onChange={(e) => {
        if (e.target.value === CUSTOM_OPTION_VALUE) {
          setCustomMode(true)
          setAiModel('')
          return
        }
        setAiModel(e.target.value)
      }}
      style={s.select}
      data-testid="model-select"
    >
      <option value="">Default — {catalogModels.find((m) => m.default)?.label ?? catalogModels[0]?.label}</option>
      {catalogModels.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
      <option value={CUSTOM_OPTION_VALUE}>Custom…</option>
    </select>
  )
}
