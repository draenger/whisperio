import { useState, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import { ToggleRow, SectionHeader } from './SettingsForm'

/*
 * Context-aware tone panel (v1.5 Work Item B).
 *
 * PRIVACY CONTRACT: this component (and everything under src/renderer/) never
 * touches active-win, even indirectly — the only IPC surface it calls is
 * window.api.context.enableWindowTitleMatching(), a single explicit
 * permission-request action (see preload/index.ts's ContextAPI). The actual
 * foreground-app lookup (process name + optional window title) happens
 * entirely in the main process — see src/main/context.ts's file header for
 * the full contract. Nothing here ever reads pixels, calls getUserMedia, or
 * touches Electron's desktopCapturer/screen/nativeImage — it's just a toggle,
 * an editable substring->tone table, and one opt-in permission button.
 */
export type ToneProfileId = 'neutral' | 'casual' | 'formal' | 'technical'

const TONE_PROFILE_OPTIONS: { value: ToneProfileId; label: string }[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'technical', label: 'Technical' }
]

/** Minimal shape of SettingsForm's `makeStyles(theme)` output this panel
 * touches — same narrow local-type pattern as CleanupPanel.tsx, so this file
 * only takes a *value* import from SettingsForm (ToggleRow). */
interface SettingsStyles {
  card: CSSProperties
  cardTitle: CSSProperties
  label: CSSProperties
  input: CSSProperties
  select: CSSProperties
  hint: CSSProperties
}

export interface ContextTonePanelProps {
  contextAwareTone: boolean
  setContextAwareTone: (v: boolean) => void
  toneMap: Record<string, ToneProfileId>
  setToneMap: (v: Record<string, ToneProfileId>) => void
  windowTitlePermissionEnabled: boolean
  setWindowTitlePermissionEnabled: (v: boolean) => void
  s: SettingsStyles
  theme: Theme
}

/**
 * "Context-aware tone" section: match the AI cleanup register to whichever
 * app the user was dictating into (Slack gets casual, Gmail gets formal,
 * VS Code stays technical), driven entirely by the FOREGROUND APP NAME — see
 * the KONTRAKT note above. Off by default. Meaning is never touched, only
 * register (same invariant CLEANUP_RULES rule 7 enforces server-side).
 */
export function ContextTonePanel({
  contextAwareTone, setContextAwareTone,
  toneMap, setToneMap,
  windowTitlePermissionEnabled, setWindowTitlePermissionEnabled,
  s, theme
}: ContextTonePanelProps): ReactElement {
  const [newKey, setNewKey] = useState('')
  const [newProfile, setNewProfile] = useState<ToneProfileId>('neutral')
  const [permBusy, setPermBusy] = useState(false)
  const entries = Object.entries(toneMap)

  const renameKey = (oldKey: string, nextKeyRaw: string): void => {
    const nextKey = nextKeyRaw.trim().toLowerCase()
    const { [oldKey]: profile, ...rest } = toneMap
    setToneMap(nextKey ? { ...rest, [nextKey]: profile } : rest)
  }
  const setProfileFor = (key: string, profile: ToneProfileId): void => {
    setToneMap({ ...toneMap, [key]: profile })
  }
  const removeEntry = (key: string): void => {
    const { [key]: _removed, ...rest } = toneMap
    setToneMap(rest)
  }
  const addEntry = (): void => {
    const key = newKey.trim().toLowerCase()
    if (!key || key in toneMap) return
    setToneMap({ ...toneMap, [key]: newProfile })
    setNewKey('')
    setNewProfile('neutral')
  }

  const handleEnableWindowTitle = async (): Promise<void> => {
    setPermBusy(true)
    try {
      const settings = await window.api.context.enableWindowTitleMatching()
      setWindowTitlePermissionEnabled(
        (settings as unknown as { windowTitlePermissionEnabled?: boolean }).windowTitlePermissionEnabled ?? true
      )
    } finally {
      setPermBusy(false)
    }
  }

  return (
    <div style={s.card}>
      <SectionHeader title="Context-aware tone" s={s} theme={theme} />

      <ToggleRow
        label="Match tone to the app you're dictating into"
        description="Whisperio reads only the app name — never your screen."
        checked={contextAwareTone}
        onChange={setContextAwareTone}
        theme={theme}
      />

      {contextAwareTone && (
        <>
          <span style={s.hint}>
            When AI cleanup rewrites your transcript, Whisperio checks the foreground app&apos;s process name
            against the table below and nudges the register accordingly — meaning never changes, only tone.
            Raw dictation is never affected.
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
            {entries.map(([key, profile]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="text"
                  defaultValue={key}
                  onBlur={(e) => renameKey(key, e.target.value)}
                  style={{ ...s.input, flex: 1 }}
                  aria-label="App name substring"
                />
                <select
                  value={profile}
                  onChange={(e) => setProfileFor(key, e.target.value as ToneProfileId)}
                  style={s.select}
                >
                  {TONE_PROFILE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeEntry(key)}
                  title={`Remove "${key}"`}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: theme.danger,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    flexShrink: 0
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            {entries.length === 0 && <span style={s.hint}>No app mappings yet — add one below.</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="app name substring, e.g. slack"
              style={{ ...s.input, flex: 1 }}
            />
            <select
              value={newProfile}
              onChange={(e) => setNewProfile(e.target.value as ToneProfileId)}
              style={s.select}
            >
              {TONE_PROFILE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={addEntry}
              disabled={!newKey.trim()}
              style={{
                background: 'transparent',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                color: theme.accent,
                cursor: newKey.trim() ? 'pointer' : 'default',
                opacity: newKey.trim() ? 1 : 0.5,
                fontFamily: 'inherit',
                flexShrink: 0
              }}
            >
              + Add
            </button>
          </div>

          <div
            style={{
              marginTop: '14px',
              paddingTop: '14px',
              borderTop: `1px solid ${theme.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text }}>
              Window-title matching (macOS)
            </div>
            <span style={s.hint}>
              Off by default — only the app name is read, which is already enough to drive the table above.
              Turning this on lets Whisperio also read the window title, which asks macOS for Screen Recording
              permission the first time. Still never a screenshot — just text metadata.
            </span>
            {windowTitlePermissionEnabled ? (
              <button
                onClick={() => setWindowTitlePermissionEnabled(false)}
                style={{
                  alignSelf: 'flex-start',
                  background: 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: theme.textMuted,
                  cursor: 'pointer',
                  fontFamily: 'inherit'
                }}
              >
                Disable window-title matching
              </button>
            ) : (
              <button
                onClick={handleEnableWindowTitle}
                disabled={permBusy}
                style={{
                  alignSelf: 'flex-start',
                  background: 'transparent',
                  border: `1px solid ${theme.inputBorder}`,
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: theme.accent,
                  cursor: permBusy ? 'default' : 'pointer',
                  opacity: permBusy ? 0.6 : 1,
                  fontFamily: 'inherit'
                }}
              >
                {permBusy ? 'Requesting…' : 'Enable window-title matching'}
              </button>
            )}
          </div>
        </>
      )}

      <span style={{ ...s.hint, fontStyle: 'italic', marginTop: contextAwareTone ? '10px' : 0, display: 'block' }}>
        Context-aware tone only ever changes register — never meaning or content.
      </span>
    </div>
  )
}
