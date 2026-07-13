import { useState, useEffect, useCallback, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import { OnDeviceBadge } from './CleanupPanel'

/*
 * Usage panel (v1.5 PACZKA UI), wired to `window.api.usage` from the
 * parallel "PACZKA METERING" package (src/main/usageTracker.ts + the
 * `UsageAPI`/`UsageStore`/`UsageMonthly` types on preload's WhisperioAPI).
 * `get()` returns the WHOLE store (every provider x every month it has ever
 * recorded); this panel only displays the current calendar month, same
 * granularity `usageTracker.monthKey()` buckets by main-process side — see
 * `currentMonthKey` below for the renderer-local equivalent (preload doesn't
 * expose `monthKey` itself, so this is a small, easily-verified duplicate,
 * same spirit as modelCatalog.ts's main/renderer split).
 *
 * Cost/credit semantics are entirely usageTracker's call: `estimatedCostUsd`
 * is already forced to 0 there for a free/local provider or for ElevenLabs
 * (which bills `credits` instead), so this panel just renders whatever comes
 * back — it never re-derives "is this provider free" itself, except to
 * decide whether to show the on-device badge next to that $0.00.
 */
type UsageMonthly = Awaited<ReturnType<Window['api']['usage']['get']>>[string][string]

/** Providers metered as always-free (see usageTracker.ts's LOCAL_PROVIDER_IDS) —
 * used here only to decide whether to show the on-device badge next to the
 * (already-zeroed) cost, never to override a real number. */
const FREE_PROVIDERS = new Set(['local', 'selfhosted'])

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  replicate: 'Replicate',
  elevenlabs: 'ElevenLabs',
  local: 'Local',
  selfhosted: 'On-Device'
}

/** "YYYY-MM" (local time) for right now — mirrors usageTracker.ts's `monthKey()`
 * default. Kept in sync by hand (preload doesn't re-export that helper). */
function currentMonthKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${month}`
}

interface UsageRow extends UsageMonthly {
  provider: string
}

/** This month's row per provider that has any recorded activity this month
 * (providers with only past-month data, or none at all, are omitted — an
 * all-zero row for a never-used provider wouldn't tell the user anything). */
function toCurrentMonthRows(store: Awaited<ReturnType<Window['api']['usage']['get']>>): UsageRow[] {
  const month = currentMonthKey()
  return Object.entries(store)
    .filter(([, months]) => !!months[month])
    .map(([provider, months]) => ({ provider, ...months[month] }))
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatAudioMinutes(seconds: number): string {
  return (seconds / 60).toFixed(1)
}

/** Minimal shape of SettingsForm's `makeStyles(theme)` output this panel touches. */
interface SettingsStyles {
  card: CSSProperties
  cardTitle: CSSProperties
  hint: CSSProperties
}

const TABLE_HEAD_CELL: CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  textTransform: 'uppercase'
}

const TABLE_BODY_CELL: CSSProperties = {
  padding: '8px 10px',
  fontSize: '12.5px'
}

/**
 * "Usage" settings section — per-provider spend/usage for the current
 * month, with a Reset action. Refreshes whenever it mounts (i.e. whenever
 * the user opens the section, since SettingsForm only mounts the active
 * tab's content).
 */
export function UsagePanel({ s, theme }: { s: SettingsStyles; theme: Theme }): ReactElement {
  const [rows, setRows] = useState<UsageRow[] | null>(null)
  const [resetting, setResetting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setRows(toCurrentMonthRows(await window.api.usage.get()))
    } catch {
      // Fail-soft: an unreachable usage bridge shows an empty table, never an
      // error — this panel is informational, not load-bearing.
      setRows([])
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleReset = useCallback(async () => {
    setResetting(true)
    try {
      setRows(toCurrentMonthRows(await window.api.usage.reset()))
    } catch {
      setRows([])
    } finally {
      setResetting(false)
    }
  }, [])

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <h3 style={{ ...s.cardTitle, flex: 1 }}>Usage</h3>
        <button
          onClick={handleReset}
          disabled={resetting}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            background: 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '9px',
            padding: '8px 13px',
            fontSize: '13px',
            fontWeight: 500,
            color: theme.textSecondary,
            cursor: resetting ? 'default' : 'pointer',
            fontFamily: 'IBM Plex Sans, sans-serif',
            opacity: resetting ? 0.6 : 1,
            transition: 'border-color 0.15s, color 0.15s'
          }}
        >
          {resetting ? 'Resetting…' : 'Reset'}
        </button>
      </div>

      {rows === null && <span style={s.hint}>Loading…</span>}

      {rows !== null && rows.length === 0 && (
        <span style={s.hint}>No usage recorded yet this month.</span>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Provider', 'Requests', 'Tokens in/out', 'Audio min', 'Est. cost'].map((h) => (
                  <th
                    key={h}
                    style={{ ...TABLE_HEAD_CELL, color: theme.textMuted, borderBottom: `1px solid ${theme.border}` }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const free = FREE_PROVIDERS.has(r.provider)
                const hasCredits = r.credits > 0
                return (
                  <tr key={r.provider}>
                    <td style={{ ...TABLE_BODY_CELL, color: theme.text, fontWeight: 500, borderBottom: `1px solid ${theme.border}` }}>
                      {PROVIDER_DISPLAY_NAMES[r.provider] ?? r.provider}
                    </td>
                    <td style={{ ...TABLE_BODY_CELL, color: theme.textSecondary, borderBottom: `1px solid ${theme.border}` }}>
                      {r.requests}
                    </td>
                    <td style={{ ...TABLE_BODY_CELL, color: theme.textSecondary, borderBottom: `1px solid ${theme.border}` }}>
                      {r.inputTokens} / {r.outputTokens}
                    </td>
                    <td style={{ ...TABLE_BODY_CELL, color: theme.textSecondary, borderBottom: `1px solid ${theme.border}` }}>
                      {formatAudioMinutes(r.audioSeconds)}
                    </td>
                    <td style={{ ...TABLE_BODY_CELL, borderBottom: `1px solid ${theme.border}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {hasCredits ? (
                          <span style={{ color: theme.text, fontWeight: 500 }}>{r.credits} credits</span>
                        ) : (
                          <span style={{ color: theme.text, fontWeight: 500 }}>{formatUsd(r.estimatedCostUsd)}</span>
                        )}
                        {free && <OnDeviceBadge />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <span style={{ ...s.hint, fontStyle: 'italic' }}>
        Estimates based on public pricing — check your provider dashboard for billing truth.
      </span>
    </div>
  )
}
