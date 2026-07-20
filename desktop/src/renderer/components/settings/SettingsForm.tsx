import { useState, useEffect, useCallback, useRef, type ReactElement, type ReactNode } from 'react'
import { useTheme } from '../../ThemeContext'
import { TitleBar } from '../common/TitleBar'
import type { Theme, ThemeMode } from '../../theme'
import { ACCENTS, ACCENT_ORDER, ACCENT_LABELS } from '../../theme'
import { RecordingsView } from '../recordings/RecordingsPanel'
import { CleanupPanel, type CleanupMode, type AiProvider, type CleanupTemplate } from './CleanupPanel'
import { ContextTonePanel, type ToneProfileId } from './ContextTonePanel'
import { UsagePanel } from './UsagePanel'
import { KeyStorageHint } from './KeyStorageHint'

// Derived from the global window.api typings (preload) without a cross-project import
type UpdaterState = Awaited<ReturnType<Window['api']['updater']['getStatus']>>

/** Subscribes to auto-update status from the main process. */
function useUpdater(): UpdaterState | null {
  const [state, setState] = useState<UpdaterState | null>(null)
  useEffect(() => {
    window.api.updater.getStatus().then(setState)
    const off = window.api.updater.onStatus(setState)
    return off
  }, [])
  return state
}

/** Full-width banner shown when an update is downloading / ready / failed. */
function UpdateBanner({ state, theme }: { state: UpdaterState | null; theme: Theme }): ReactElement | null {
  const [installing, setInstalling] = useState(false)

  if (!state) return null
  const { status, version, percent, error } = state
  // Never banner an update problem at the user — only progress/ready states.
  if (status === 'idle' || status === 'checking' || status === 'not-available' || status === 'error') return null

  const ready = status === 'downloaded'
  const accent = theme.accent

  // After the guard above, status is one of: downloaded | downloading | available.
  let message = ''
  if (ready) message = `Whisperio ${version} is ready to install.`
  else if (status === 'downloading') message = `Downloading update ${version ? 'v' + version : ''}… ${percent ?? 0}%`
  else if (status === 'available') message = `Update ${version ? 'v' + version : ''} found — downloading…`

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '11px 16px',
      background: `${accent}12`,
      borderBottom: `1px solid ${accent}33`,
      flexShrink: 0
    }}>
      <div style={{
        width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: accent,
        boxShadow: ready ? `0 0 8px ${accent}` : 'none'
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>
          {ready ? 'Update ready — restart to install' : 'Updating Whisperio'}
        </div>
        <div style={{ fontSize: '12px', color: theme.textMuted, marginTop: '1px' }}>{message}</div>
        {status === 'downloading' && (
          <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', background: theme.bgTertiary, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${percent ?? 0}%`, background: accent, borderRadius: '2px', transition: 'width 0.3s' }} />
          </div>
        )}
      </div>
      {ready && (
        <button
          onClick={async () => { setInstalling(true); await window.api.updater.install() }}
          disabled={installing}
          style={{
            background: accent, border: 'none', borderRadius: '10px', padding: '8px 16px',
            fontSize: '12px', fontWeight: 600, color: '#fff', cursor: installing ? 'default' : 'pointer',
            fontFamily: 'IBM Plex Sans, sans-serif', flexShrink: 0, opacity: installing ? 0.6 : 1
          }}
        >{installing ? 'Restarting…' : 'Restart now'}</button>
      )}
    </div>
  )
}

// Bridges errorHandler.ts's in-memory ring buffer (main<->preload already
// wired: `errors:getRecent` + the `errors:new` broadcast behind
// `window.api.errors.onError`) to the Usage tab — previously main/preload-only
// with zero renderer consumer. Derived from the preload API's own return type
// rather than importing WhisperioError directly, same pattern as UpdaterState
// above.
type RecentError = Awaited<ReturnType<Window['api']['errors']['getRecent']>>[number]

/** Coarse "Xm ago" / "Xh ago" / "Xd ago" relative timestamp — good enough for
 * a short-lived ring buffer of recent errors; no need for Intl.RelativeTimeFormat
 * ceremony here. */
function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/**
 * "Recent errors" section (Usage tab) — surfaces the same ring buffer
 * RecordingsPanel/notifications already read from, so a bad API key or a
 * flaky provider is visible somewhere other than a transient toast. Loads
 * the backlog once on mount, then stays live via `onError`. Newest first,
 * capped to the same ~50 entries errorHandler.ts keeps.
 */
function RecentErrorsPanel({ s, theme }: { s: ReturnType<typeof makeStyles>; theme: Theme }): ReactElement {
  const [errors, setErrors] = useState<RecentError[]>([])

  useEffect(() => {
    window.api.errors.getRecent().then(setErrors).catch(() => {})
    const off = window.api.errors.onError((err) => {
      setErrors((prev) => [err, ...prev].slice(0, 50))
    })
    return off
  }, [])

  return (
    <div style={s.card}>
      <SectionHeader title="Recent errors" s={s} theme={theme} />
      {errors.length === 0 ? (
        <span style={s.hint}>No errors yet — provider failures (bad key, rate limit, network) will show up here.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {errors.map((err, i) => (
            <div
              key={`${err.timestamp}-${i}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                padding: '9px 11px',
                borderRadius: '8px',
                border: `1px solid ${theme.border}`
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
                  {err.category} · {err.provider}
                </span>
                <span style={{ fontSize: '11px', color: theme.textMuted, flexShrink: 0 }}>
                  {relativeTime(err.timestamp)}
                </span>
              </div>
              <span style={{ fontSize: '12.5px', color: theme.textMuted }}>{err.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type TabId = 'general' | 'providers' | 'audio' | 'hotkeys' | 'sync' | 'recordings' | 'usage' | 'updates'

type NavGroup = {
  label: string
  tabs: { id: TabId; label: string }[]
}

const TAB_ICONS: Record<string, string> = {
  general: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  providers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  audio: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  hotkeys: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M9 13h6M18 13h.01',
  sync: 'M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16',
  recordings: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 2',
  usage: 'M3 3v18h18M7 15l4-6 3 3 5-8',
  updates: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6'
}

function NavIcon({ d, size = 16 }: { d: string; size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

interface MediaDeviceOption {
  deviceId: string
  label: string
}

/* ─── Status header strip (under the title bar) ─── */

/** Provider ids → short display labels for the engine chain. */
const CHAIN_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  selfhosted: 'On-Device',
  replicate: 'Replicate',
  groq: 'Groq',
  deepgram: 'Deepgram',
  assemblyai: 'AssemblyAI',
  mistral: 'Mistral'
}

function MicroLabel({ children, theme }: { children: ReactNode; theme: Theme }): ReactElement {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '9px',
      fontWeight: 600,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: theme.textMuted,
      flexShrink: 0
    }}>{children}</span>
  )
}

function Keycap({ children, theme }: { children: ReactNode; theme: Theme }): ReactElement {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px',
      fontWeight: 600,
      lineHeight: 1,
      padding: '3px 6px',
      borderRadius: '5px',
      background: theme.bgTertiary,
      border: `1px solid ${theme.border}`,
      boxShadow: `0 1px 0 ${theme.border}`,
      color: theme.textSecondary,
      whiteSpace: 'nowrap'
    }}>{children}</span>
  )
}

/** Compact status strip mounted directly under the title bar. Reads from live settings state. */
function StatusHeader({
  dictationHotkey,
  providerChain,
  cleanupEnabled,
  theme
}: {
  dictationHotkey: string
  providerChain: string[]
  cleanupEnabled: boolean
  theme: Theme
}): ReactElement {
  const keys = (dictationHotkey || 'Ctrl+Shift+Space').split('+')
  const chain = providerChain.length ? providerChain : ['openai']

  const Divider = (): ReactElement => (
    <span style={{ width: '1px', height: '20px', background: theme.border, flexShrink: 0 }} />
  )

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      padding: '10px 18px',
      background: theme.bgSecondary,
      borderBottom: `1px solid ${theme.border}`,
      flexShrink: 0,
      overflowX: 'auto'
    }}>
      {/* STATUS */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <MicroLabel theme={theme}>Status</MicroLabel>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: theme.success, boxShadow: `0 0 6px ${theme.success}`, flexShrink: 0 }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>Ready</span>
        </span>
      </div>

      <Divider />

      {/* DICTATE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <MicroLabel theme={theme}>Dictate</MicroLabel>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {keys.map((k, i) => <Keycap key={i} theme={theme}>{k}</Keycap>)}
        </span>
      </div>

      <Divider />

      {/* ENGINE CHAIN */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <MicroLabel theme={theme}>Engine Chain</MicroLabel>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {chain.map((id, i) => (
            <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              {i > 0 && <span style={{ color: theme.textMuted, fontWeight: 400 }}>→</span>}
              <span style={{ color: i === 0 ? theme.accent : theme.textSecondary }}>{CHAIN_LABELS[id] ?? id}</span>
            </span>
          ))}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* AI cleanup chip — only when the AI Cleanup panel's toggle is on */}
      {cleanupEnabled && (
        <span style={{
          display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
          padding: '4px 10px', borderRadius: '999px',
          background: `${theme.accent}14`,
          border: `1px solid ${theme.accent}40`,
          color: theme.accent,
          fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap'
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
          </svg>
          AI cleanup
        </span>
      )}
    </div>
  )
}

/** Dedicated Updates settings tab. */
function UpdatesTab({ state, s, theme }: { state: UpdaterState | null; s: ReturnType<typeof makeStyles>; theme: Theme }): ReactElement {
  const [installing, setInstalling] = useState(false)
  const status = state?.status ?? 'idle'
  const checking = status === 'checking'
  const downloading = status === 'downloading'
  const ready = status === 'downloaded'
  const failed = status === 'error'

  const dotColor = ready ? theme.accent
    : downloading || checking ? theme.accent
    : failed ? theme.textMuted
    : theme.success

  let headline: string
  let detail: string
  if (ready) {
    headline = 'Update ready to install'
    detail = `Whisperio ${state?.version} has been downloaded. Restart to finish installing.`
  } else if (downloading) {
    headline = 'Downloading update…'
    detail = `Whisperio ${state?.version ?? ''} — ${state?.percent ?? 0}%`
  } else if (checking) {
    headline = 'Checking for updates…'
    detail = 'Contacting the update server.'
  } else if (status === 'available') {
    headline = 'Update found'
    detail = `Whisperio ${state?.version ?? ''} is downloading in the background.`
  } else if (failed) {
    // Never show the raw updater error — keep it calm and non-blocking.
    headline = "Couldn't check right now"
    detail = "No problem — keep using Whisperio. It'll check again automatically later."
  } else {
    headline = "You're up to date"
    detail = 'Whisperio is running the latest available version.'
  }

  return (
    <>
      <div style={s.card}>
        <SectionHeader title="Software Updates" s={s} theme={theme} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, background: dotColor,
            boxShadow: ready ? `0 0 8px ${dotColor}` : 'none'
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: theme.text }}>{headline}</div>
            <div style={{ fontSize: '12.5px', color: theme.textMuted, marginTop: '2px' }}>{detail}</div>
          </div>
          {ready ? (
            <button
              onClick={async () => { setInstalling(true); await window.api.updater.install() }}
              disabled={installing}
              style={{
                background: theme.accent, border: 'none', borderRadius: '8px', padding: '8px 18px',
                fontSize: '13px', fontWeight: 600, color: '#fff', cursor: installing ? 'default' : 'pointer',
                fontFamily: 'IBM Plex Sans, sans-serif', flexShrink: 0, opacity: installing ? 0.6 : 1
              }}
            >{installing ? 'Restarting…' : 'Restart now'}</button>
          ) : (
            <button
              onClick={() => window.api.updater.check()}
              disabled={checking || downloading}
              style={{
                background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: '8px',
                padding: '8px 18px', fontSize: '13px', fontWeight: 500,
                color: checking || downloading ? theme.textMuted : theme.accent,
                cursor: checking || downloading ? 'default' : 'pointer',
                fontFamily: 'IBM Plex Sans, sans-serif', flexShrink: 0,
                opacity: checking || downloading ? 0.6 : 1
              }}
            >Check now</button>
          )}
        </div>

        {downloading && (
          <div style={{ marginTop: '12px', height: '5px', borderRadius: '3px', background: theme.bgTertiary, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${state?.percent ?? 0}%`, background: theme.accent, borderRadius: '3px', transition: 'width 0.3s' }} />
          </div>
        )}

        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
          <span style={{ color: theme.textMuted }}>Installed version</span>
          <span style={{ color: theme.text, fontWeight: 500 }}>v{state?.currentVersion ?? '—'}</span>
        </div>
      </div>

      <div style={s.card}>
        <SectionHeader title="How updates work" s={s} theme={theme} />
        <span style={s.hint}>
          Whisperio checks for updates automatically on launch and every 4 hours. New versions download
          quietly in the background — you keep working while it downloads. When it's ready you'll see a
          notification and a “Restart now” button here (and in the tray menu). The update installs the next
          time Whisperio restarts.
        </span>
      </div>
    </>
  )
}

/*
 * AI Cleanup settings keys — owned by the parallel "A-core" package
 * (settingsManager.ts DEFAULT_SETTINGS / preload's AppSettings). Declared
 * locally here so this file typechecks independently of merge order between
 * packages: `settings.load()`'s declared return type (preload's AppSettings)
 * doesn't include these fields yet, so reads are cast through
 * `SettingsWithCleanup` below. Once preload's AppSettings natively includes
 * them this cast becomes a no-op and can be deleted.
 */
interface CleanupSettings {
  cleanupEnabled: boolean
  cleanupMode: CleanupMode
  aiProvider: AiProvider
  aiBaseUrl: string
  aiModel: string
  anthropicApiKey: string
}
/*
 * Cloud STT+ (v1.6) provider keys — same "declared locally, cast through"
 * situation as CleanupSettings above: preload's AppSettings doesn't know
 * about the Groq/Deepgram/AssemblyAI/Mistral providers yet.
 */
interface ProviderKeySettings {
  groqApiKey: string
  sttGroqModel: string
  deepgramApiKey: string
  sttDeepgramModel: string
  assemblyaiApiKey: string
  sttAssemblyaiModel: string
  mistralApiKey: string
  sttMistralModel: string
}
type SettingsWithCleanup = Awaited<ReturnType<Window['api']['settings']['load']>> &
  Partial<CleanupSettings> &
  Partial<ProviderKeySettings>

export function SettingsForm(): ReactElement {
  const { theme } = useTheme()

  // --- State ---
  const navGroups: NavGroup[] = [
    {
      label: 'Basics',
      tabs: [
        { id: 'general', label: 'General' },
        { id: 'providers', label: 'Providers' },
        { id: 'audio', label: 'Audio' },
        { id: 'hotkeys', label: 'Hotkeys' }
      ]
    },
    {
      label: 'Library',
      tabs: [
        { id: 'sync', label: 'Sync' },
        { id: 'recordings', label: 'Recordings' }
      ]
    },
    {
      label: 'System',
      tabs: [
        { id: 'usage', label: 'Usage' },
        { id: 'updates', label: 'Updates' }
      ]
    }
  ]
  const validTabs: TabId[] = navGroups.flatMap((group) => group.tabs.map((tab) => tab.id))
  const initialTab = ((): TabId => {
    const h = window.location.hash.replace('#', '') as TabId
    return validTabs.includes(h) ? h : 'general'
  })()
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [loading, setLoading] = useState(true)
  // Set only if settings.load() rejects — without this, a rejection left the
  // window stuck on "Loading..." forever (setLoading(false) never ran because
  // it lived inside the .then()). See the retry screen below the loading guard.
  const [loadError, setLoadError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const updater = useUpdater()

  // Show the real app version in the badge (from main process)
  useEffect(() => {
    window.api.window.getVersion().then(setAppVersion).catch(() => {})
  }, [])

  // Allow the tray / main process to switch tabs on an already-open window
  useEffect(() => {
    const off = window.api.settings.onSetTab((tab) => {
      if (validTabs.includes(tab as TabId)) setActiveTab(tab as TabId)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // General
  const [launchAtStartup, setLaunchAtStartup] = useState(true)

  // Providers
  const [sttProvider, setSttProvider] = useState('openai')
  const [providerChain, setProviderChain] = useState<string[]>(['openai'])
  const [apiKey, setApiKey] = useState('')
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('')
  const [whisperModel, setWhisperModel] = useState('')
  const [elevenlabsApiKey, setElevenlabsApiKey] = useState('')
  // STT+ (v1.5): shared with the AI Cleanup Replicate provider below — one
  // key, both uses (see settingsManager.ts's `replicateApiKey` doc comment).
  const [replicateApiKey, setReplicateApiKey] = useState('')
  const [sttReplicateModel, setSttReplicateModel] = useState('')
  // Cloud STT+ (v1.6): Groq/Deepgram/AssemblyAI/Mistral BYO-key providers —
  // mirrors the mobile app's provider chain. Model fields are currently
  // unexposed in the UI (each client falls back to a sensible default model
  // when left blank — see src/main/llm/{groq,deepgram,assembly,mistral}.ts).
  const [groqApiKey, setGroqApiKey] = useState('')
  const [deepgramApiKey, setDeepgramApiKey] = useState('')
  const [assemblyaiApiKey, setAssemblyaiApiKey] = useState('')
  const [mistralApiKey, setMistralApiKey] = useState('')
  const [sttApiKey, setSttApiKey] = useState('')
  const [transcriptionLanguage, setTranscriptionLanguage] = useState('auto')
  const [prompt, setPrompt] = useState('')
  const [vocabulary, setVocabulary] = useState('')
  const [removedDefaultVocabulary, setRemovedDefaultVocabulary] = useState<string[]>([])
  const [aiPostProcessing, setAiPostProcessing] = useState(false)

  // AI Cleanup (supersedes the old aiPostProcessing toggle in the UI — see CleanupPanel)
  const [cleanupEnabled, setCleanupEnabled] = useState(false)
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>('light')
  // ROUGH-FIRST UX (v1.4 PR2): default OFF (raw transcript pastes instantly);
  // see CleanupPanel's cleanupAuto prop doc.
  const [cleanupAuto, setCleanupAuto] = useState(false)
  // Seeded from settings.load()'s settings.cleanupTemplates below — NOT from
  // settingsManager's DEFAULT_CLEANUP_TEMPLATES, which main already seeds on
  // disk for a fresh install; this just mirrors whatever's actually saved.
  const [cleanupTemplates, setCleanupTemplates] = useState<CleanupTemplate[]>([])
  const [aiProvider, setAiProvider] = useState<AiProvider>('openai')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [anthropicApiKey, setAnthropicApiKey] = useState('')

  // Context-aware tone (v1.5 Work Item B)
  const [contextAwareTone, setContextAwareTone] = useState(false)
  const [toneMap, setToneMap] = useState<Record<string, ToneProfileId>>({})
  const [windowTitlePermissionEnabled, setWindowTitlePermissionEnabled] = useState(false)

  // Audio
  const [inputDeviceId, setInputDeviceId] = useState('')
  const [outputDeviceId, setOutputDeviceId] = useState('')
  const [saveRecordings, setSaveRecordings] = useState(true)
  const [inputDevices, setInputDevices] = useState<MediaDeviceOption[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceOption[]>([])

  // Hotkeys
  const [dictationHotkey, setDictationHotkey] = useState('')
  const [dictateAndSendHotkey, setDictateAndSendHotkey] = useState('')
  const [outputRecordingHotkey, setOutputRecordingHotkey] = useState('')

  // --- Load settings ---
  // Pulled out to a stable callback (rather than inline in the effect) so the
  // retry button in the loadError screen below can re-run the exact same load.
  const loadSettings = useCallback((): Promise<void> => {
    setLoadError(false)
    return window.api.settings.load().then((loaded) => {
      const settings = loaded as SettingsWithCleanup
      setSttProvider(settings.sttProvider ?? 'openai')
      setProviderChain(settings.providerChain ?? [settings.sttProvider ?? 'openai'])
      setApiKey(settings.openaiApiKey ?? '')
      setOpenaiBaseUrl(settings.openaiBaseUrl ?? '')
      setWhisperModel(settings.whisperModel ?? '')
      setElevenlabsApiKey(settings.elevenlabsApiKey ?? '')
      setReplicateApiKey(settings.replicateApiKey ?? '')
      setSttReplicateModel(settings.sttReplicateModel ?? '')
      setGroqApiKey(settings.groqApiKey ?? '')
      setDeepgramApiKey(settings.deepgramApiKey ?? '')
      setAssemblyaiApiKey(settings.assemblyaiApiKey ?? '')
      setMistralApiKey(settings.mistralApiKey ?? '')
      setSttApiKey(settings.sttApiKey ?? '')
      setTranscriptionLanguage(settings.transcriptionLanguage ?? 'auto')
      setPrompt(settings.transcriptionPrompt ?? '')
      setVocabulary(settings.customVocabulary ?? '')
      setRemovedDefaultVocabulary(settings.removedDefaultVocabulary ?? [])
      setAiPostProcessing(settings.aiPostProcessing ?? false)
      setLaunchAtStartup(settings.launchAtStartup ?? true)
      setDictationHotkey(settings.dictationHotkey ?? '')
      setDictateAndSendHotkey(settings.dictateAndSendHotkey ?? '')
      setInputDeviceId(settings.inputDeviceId ?? '')
      setOutputDeviceId(settings.outputDeviceId ?? '')
      setSaveRecordings(settings.saveRecordings ?? true)
      setOutputRecordingHotkey(settings.outputRecordingHotkey ?? '')
      setCleanupEnabled(settings.cleanupEnabled ?? false)
      setCleanupMode(settings.cleanupMode ?? 'light')
      setCleanupAuto(settings.cleanupAuto ?? false)
      setCleanupTemplates(settings.cleanupTemplates ?? [])
      setAiProvider(settings.aiProvider ?? 'openai')
      setAiBaseUrl(settings.aiBaseUrl ?? '')
      setAiModel(settings.aiModel ?? '')
      setAnthropicApiKey(settings.anthropicApiKey ?? '')
      setContextAwareTone(settings.contextAwareTone ?? false)
      setToneMap(settings.toneMap ?? {})
      setWindowTitlePermissionEnabled(settings.windowTitlePermissionEnabled ?? false)
      setLoading(false)
    }).catch((err) => {
      // Fail soft: without this, a rejection here left the window stuck on
      // "Loading..." forever since setLoading(false) previously only lived
      // inside the .then(). The already-seeded useState defaults above stand
      // in as the fallback state; the loadError screen offers a retry.
      console.error('[SettingsForm] failed to load settings:', err)
      setLoadError(true)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    loadSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Enumerate media devices ---
  useEffect(() => {
    async function loadDevices(): Promise<void> {
      try {
        // Request permission first so labels are populated
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
          s.getTracks().forEach((t) => t.stop())
        })
        const devices = await navigator.mediaDevices.enumerateDevices()
        setInputDevices(
          devices
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` }))
        )
        setOutputDevices(
          devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d) => ({ deviceId: d.deviceId, label: d.label || `Speaker (${d.deviceId.slice(0, 8)})` }))
        )
      } catch {
        // Ignore — permissions may not be granted
      }
    }
    loadDevices()
  }, [])

  // --- Save ---
  const handleSave = useCallback(async () => {
    // Built as a plain `const` (not passed inline) so the AI Cleanup fields —
    // not yet on preload's AppSettings type, see SettingsWithCleanup above —
    // don't trip TS's excess-property check the way an inline object literal
    // argument would. Once AppSettings includes them this is just a normal payload.
    const payload = {
      sttProvider: providerChain[0] as 'openai' | 'elevenlabs' || 'openai',
      providerChain,
      openaiApiKey: apiKey,
      openaiBaseUrl,
      whisperModel,
      elevenlabsApiKey,
      replicateApiKey,
      sttReplicateModel,
      groqApiKey,
      deepgramApiKey,
      assemblyaiApiKey,
      mistralApiKey,
      sttApiKey,
      transcriptionLanguage,
      transcriptionPrompt: prompt,
      customVocabulary: vocabulary,
      removedDefaultVocabulary,
      aiPostProcessing,
      launchAtStartup,
      dictationHotkey,
      dictateAndSendHotkey,
      inputDeviceId,
      outputDeviceId,
      saveRecordings,
      outputRecordingHotkey,
      fallbackEnabled: providerChain.length > 1,
      cleanupEnabled,
      cleanupMode,
      cleanupAuto,
      cleanupTemplates,
      aiProvider,
      aiBaseUrl,
      aiModel,
      anthropicApiKey,
      contextAwareTone,
      toneMap,
      windowTitlePermissionEnabled
    }
    await window.api.settings.save(
      // `aiProvider` widens ahead of preload's AppSettings type: preload's
      // `aiProvider` is still 'openai'|'anthropic'|'local' while both
      // settingsManager.ts's AiProvider and CleanupPanel's UI-facing
      // AiProvider now include 'replicate' (v1.5 PACZKA UI + LLM+ cleanup).
      // Safe because settingsManager.save() persists whatever string it's
      // given (no runtime validation against the TS union) — the cast can
      // be dropped once preload's AppSettings.aiProvider catches up (out of
      // scope for this package: preload/index.d.ts isn't in its file list).
      payload as unknown as Parameters<Window['api']['settings']['save']>[0]
    )
    setSaved(true)
    // Saved pulse duration per docs/design/wz-shell-excerpts.jsx's auto-save
    // affordance contract (1400ms) — the footer flips back to the resting
    // "Changes save automatically" copy after this.
    setTimeout(() => setSaved(false), 1400)
  }, [
    providerChain, apiKey, openaiBaseUrl, whisperModel, elevenlabsApiKey, replicateApiKey, sttReplicateModel,
    groqApiKey, deepgramApiKey, assemblyaiApiKey, mistralApiKey,
    sttApiKey, transcriptionLanguage, prompt,
    vocabulary, removedDefaultVocabulary, aiPostProcessing, launchAtStartup, dictationHotkey,
    dictateAndSendHotkey, inputDeviceId, outputDeviceId, saveRecordings,
    outputRecordingHotkey, cleanupEnabled, cleanupMode, cleanupAuto, cleanupTemplates,
    aiProvider, aiBaseUrl, aiModel, anthropicApiKey,
    contextAwareTone, toneMap, windowTitlePermissionEnabled
  ])

  // Auto-save: persist whenever any setting changes (debounced). Skips the initial
  // load so we don't write straight back what we just read.
  const didAutoSaveInit = useRef(false)
  useEffect(() => {
    if (loading) return
    if (!didAutoSaveInit.current) {
      didAutoSaveInit.current = true
      return
    }
    const t = setTimeout(() => { handleSave() }, 400)
    return () => clearTimeout(t)
  }, [handleSave, loading])

  const s = makeStyles(theme)

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
        <TitleBar title="Whisperio Settings" />
        <div style={{ ...s.container, justifyContent: 'center', alignItems: 'center' }}>
          <p style={{ color: theme.textMuted }}>Loading...</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
        <TitleBar title="Whisperio Settings" />
        <div style={{ ...s.container, justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
          <p style={{ color: theme.textMuted }}>Failed to load settings.</p>
          <button
            onClick={() => { setLoading(true); loadSettings() }}
            style={s.button as React.CSSProperties}
          >Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
      <TitleBar title={activeTab === 'recordings' ? 'Whisperio Recordings' : 'Whisperio Settings'} />

      <UpdateBanner state={updater} theme={theme} />

      {activeTab !== 'recordings' && (
        <StatusHeader
          dictationHotkey={dictationHotkey}
          providerChain={providerChain}
          cleanupEnabled={cleanupEnabled}
          theme={theme}
        />
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar nav */}
        <nav style={s.sidebar}>
          <div style={s.sidebarLabel}>Settings</div>
          {navGroups.map((group) => (
            <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
              <div style={{
                padding: '8px 10px 4px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: theme.textMuted
              }}>
                {group.label}
              </div>
              {group.tabs.map((tab) => {
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    style={{ ...s.navItem, ...(active ? s.navItemActive : {}) }}
                    onMouseEnter={(e) => {
                      if (!active) {
                        e.currentTarget.style.color = theme.text
                        e.currentTarget.style.background = theme.bgTertiary
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!active) {
                        e.currentTarget.style.color = theme.textSecondary
                        e.currentTarget.style.background = 'transparent'
                      }
                    }}
                  >
                    {active && (
                      <span style={{
                        position: 'absolute', left: 0, top: '7px', bottom: '7px', width: '3px',
                        borderRadius: '2px', background: theme.accent
                      }} />
                    )}
                    <span style={{ display: 'flex', flexShrink: 0, color: active ? theme.accentLight : theme.textMuted }}>
                      <NavIcon d={TAB_ICONS[tab.id]} />
                    </span>
                    {tab.label}
                  </button>
                )
              })}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div
            style={{
              ...s.versionBadge,
              cursor: 'pointer',
              color: updater?.status === 'downloaded' ? theme.accent : undefined
            }}
            title={
              updater?.status === 'downloaded'
                ? `Update ${updater.version} ready — click to restart & install`
                : 'Click to check for updates'
            }
            onClick={() => {
              if (updater?.status === 'downloaded') window.api.updater.install()
              else window.api.updater.check()
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: updater?.status === 'downloaded' || updater?.status === 'downloading' || updater?.status === 'checking'
                ? theme.accent
                : theme.success
            }} />
            {(updater?.currentVersion ?? appVersion) ? `v${updater?.currentVersion ?? appVersion}` : ''}
            {updater?.status === 'downloaded' && ' · update ready'}
            {updater?.status === 'downloading' && ` · ${updater.percent ?? 0}%`}
          </div>
        </nav>

        {/* Content column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {activeTab === 'recordings' ? (
            <RecordingsView />
          ) : (
            <>
              <div style={s.scrollArea}>
                <div style={s.container}>
                  {activeTab === 'general' && (
                    <GeneralTab
                      launchAtStartup={launchAtStartup}
                      setLaunchAtStartup={setLaunchAtStartup}
                      s={s}
                      theme={theme}
                    />
                  )}

                  {activeTab === 'providers' && (
                    <ProvidersTab
                      providerChain={providerChain}
                      setProviderChain={setProviderChain}
                      apiKey={apiKey}
                      setApiKey={setApiKey}
                      openaiBaseUrl={openaiBaseUrl}
                      setOpenaiBaseUrl={setOpenaiBaseUrl}
                      whisperModel={whisperModel}
                      setWhisperModel={setWhisperModel}
                      elevenlabsApiKey={elevenlabsApiKey}
                      setElevenlabsApiKey={setElevenlabsApiKey}
                      replicateApiKey={replicateApiKey}
                      setReplicateApiKey={setReplicateApiKey}
                      sttReplicateModel={sttReplicateModel}
                      setSttReplicateModel={setSttReplicateModel}
                      groqApiKey={groqApiKey}
                      setGroqApiKey={setGroqApiKey}
                      deepgramApiKey={deepgramApiKey}
                      setDeepgramApiKey={setDeepgramApiKey}
                      assemblyaiApiKey={assemblyaiApiKey}
                      setAssemblyaiApiKey={setAssemblyaiApiKey}
                      mistralApiKey={mistralApiKey}
                      setMistralApiKey={setMistralApiKey}
                      sttApiKey={sttApiKey}
                      setSttApiKey={setSttApiKey}
                      transcriptionLanguage={transcriptionLanguage}
                      setTranscriptionLanguage={setTranscriptionLanguage}
                      prompt={prompt}
                      setPrompt={setPrompt}
                      vocabulary={vocabulary}
                      setVocabulary={setVocabulary}
                      removedDefaultVocabulary={removedDefaultVocabulary}
                      setRemovedDefaultVocabulary={setRemovedDefaultVocabulary}
                      cleanupEnabled={cleanupEnabled}
                      setCleanupEnabled={setCleanupEnabled}
                      cleanupMode={cleanupMode}
                      setCleanupMode={setCleanupMode}
                      cleanupAuto={cleanupAuto}
                      setCleanupAuto={setCleanupAuto}
                      cleanupTemplates={cleanupTemplates}
                      setCleanupTemplates={setCleanupTemplates}
                      aiProvider={aiProvider}
                      setAiProvider={setAiProvider}
                      aiBaseUrl={aiBaseUrl}
                      setAiBaseUrl={setAiBaseUrl}
                      aiModel={aiModel}
                      setAiModel={setAiModel}
                      anthropicApiKey={anthropicApiKey}
                      setAnthropicApiKey={setAnthropicApiKey}
                      contextAwareTone={contextAwareTone}
                      setContextAwareTone={setContextAwareTone}
                      toneMap={toneMap}
                      setToneMap={setToneMap}
                      windowTitlePermissionEnabled={windowTitlePermissionEnabled}
                      setWindowTitlePermissionEnabled={setWindowTitlePermissionEnabled}
                      s={s}
                      theme={theme}
                    />
                  )}

                  {activeTab === 'audio' && (
                    <AudioTab
                      inputDeviceId={inputDeviceId}
                      setInputDeviceId={setInputDeviceId}
                      outputDeviceId={outputDeviceId}
                      setOutputDeviceId={setOutputDeviceId}
                      saveRecordings={saveRecordings}
                      setSaveRecordings={setSaveRecordings}
                      inputDevices={inputDevices}
                      outputDevices={outputDevices}
                      s={s}
                      theme={theme}
                    />
                  )}

                  {activeTab === 'hotkeys' && (
                    <HotkeysTab
                      dictationHotkey={dictationHotkey}
                      setDictationHotkey={setDictationHotkey}
                      dictateAndSendHotkey={dictateAndSendHotkey}
                      setDictateAndSendHotkey={setDictateAndSendHotkey}
                      outputRecordingHotkey={outputRecordingHotkey}
                      setOutputRecordingHotkey={setOutputRecordingHotkey}
                      s={s}
                      theme={theme}
                    />
                  )}

                  {activeTab === 'sync' && (
                    <SyncTab s={s} theme={theme} />
                  )}

                  {activeTab === 'usage' && (
                    <>
                      <UsagePanel s={s} theme={theme} />
                      <RecentErrorsPanel s={s} theme={theme} />
                    </>
                  )}

                  {activeTab === 'updates' && (
                    <UpdatesTab state={updater} s={s} theme={theme} />
                  )}
                </div>
              </div>

              {/* Auto-save footer — settings persist on change */}
              <div style={s.saveBar}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: saved ? theme.success : theme.accent,
                  transition: 'color 0.2s'
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                    {saved ? 'Saved' : 'Changes save automatically'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Tab: General ─── */

/* Theme mode picker (Segmented, per docs/design/wz-parts.jsx). Module-level
   so the array identity is stable across renders. */
const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
]

/** Segmented control — ported from docs/design/wz-parts.jsx's Segmented().
 * Exported so feature panels (e.g. CleanupPanel) reuse this instead of a fork. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  theme
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  theme: Theme
}): ReactElement {
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        borderRadius: 10,
        background: theme.bgTertiary,
        border: `1px solid ${theme.border}`
      }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontFamily: 'IBM Plex Sans, sans-serif',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              borderRadius: 8,
              padding: '7px 14px',
              whiteSpace: 'nowrap',
              background: on ? theme.accent : 'transparent',
              color: on ? theme.accentInk : theme.textSecondary,
              transition: 'background .15s, color .15s'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function GeneralTab({
  launchAtStartup,
  setLaunchAtStartup,
  s,
  theme
}: {
  launchAtStartup: boolean
  setLaunchAtStartup: (v: boolean) => void
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const { mode, setMode, accent, setAccent } = useThemeHook()

  return (
    <>
      <div style={s.card}>
        <SectionHeader title="Startup" s={s} theme={theme} />
        <ToggleRow
          label={navigator.platform.toLowerCase().includes('mac')
            ? 'Launch at login'
            : 'Launch at Windows startup'}
          description="Automatically start Whisperio when you log in"
          checked={launchAtStartup}
          onChange={setLaunchAtStartup}
          theme={theme}
        />
      </div>

      <div style={s.card}>
        <SectionHeader title="Appearance" s={s} theme={theme} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>Theme</div>
            <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>
              {THEME_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? 'Dark'}
            </div>
          </div>
          <Segmented options={THEME_MODE_OPTIONS} value={mode} onChange={setMode} theme={theme} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            paddingTop: 16,
            marginTop: 14,
            borderTop: `1px solid ${theme.border}`
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>Accent color</div>
            <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>
              {ACCENT_LABELS[accent]}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCENT_ORDER.map((key) => (
              <button
                key={key}
                onClick={() => setAccent(key)}
                title={ACCENT_LABELS[key]}
                aria-label={ACCENT_LABELS[key]}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  padding: 0,
                  background: ACCENTS[key].base,
                  border: `2px solid ${accent === key ? theme.text : 'transparent'}`,
                  boxShadow: accent === key ? `0 0 0 2px ${theme.bg}, 0 0 0 3px ${ACCENTS[key].base}` : 'none',
                  transition: 'transform .15s, border-color .15s'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.12)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// Alias useTheme to avoid name collision with prop
import { useTheme as useThemeHook } from '../../ThemeContext'

/* ─── Tab: Providers ─── */

/* ─── Selfhosted Provider Settings ─── */

export interface SelfhostedSettingsProps {
  openaiBaseUrl: string
  setOpenaiBaseUrl: (v: string) => void
  whisperModel: string
  setWhisperModel: (v: string) => void
  /** Bearer token for a private/self-hosted STT server (empty = no Authorization header, today's behavior). */
  sttApiKey: string
  setSttApiKey: (v: string) => void
  s: ReturnType<typeof makeStyles>
  theme: Theme
}

export function SelfhostedSettings({
  openaiBaseUrl, setOpenaiBaseUrl,
  whisperModel, setWhisperModel,
  sttApiKey, setSttApiKey,
  s, theme
}: SelfhostedSettingsProps): ReactElement {
  const [mode, setMode] = useState<'managed' | 'manual'>(openaiBaseUrl && !openaiBaseUrl.includes('127.0.0.1:8178') ? 'manual' : 'managed')
  const [models, setModels] = useState<{ id: string; name: string; size: string; description: string; filename: string }[]>([])
  const [localModels, setLocalModels] = useState<{ id: string; name: string; filename: string; size: number; downloaded: boolean }[]>([])
  const [downloading, setDownloading] = useState<Record<string, number>>({})
  const [serverStatus, setServerStatus] = useState<{ status: string; model: string | null; port: number; platform: string }>({ status: 'stopped', model: null, port: 8178, platform: 'win32' })
  const [serverStarting, setServerStarting] = useState(false)
  // Custom Model URL (ported from the formerly-unreachable ModelsTab — see
  // that component's history: it covered the same models.downloadCustom IPC
  // but was never mounted by any nav entry). Reuses this panel's existing
  // `downloading`/onDownloadProgress plumbing above, keyed by `custom:<filename>`.
  const [customUrl, setCustomUrl] = useState('')
  const [customFilename, setCustomFilename] = useState('')

  const refresh = useCallback(async () => {
    const [avail, local, srv] = await Promise.all([
      window.api.models.available(),
      window.api.models.local(),
      window.api.server.status()
    ])
    setModels(avail)
    setLocalModels(local)
    setServerStatus(srv)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const u1 = window.api.models.onDownloadProgress((p) => {
      setDownloading((prev) => ({ ...prev, [p.modelId]: p.percent }))
      if (p.percent >= 100) setTimeout(() => {
        setDownloading((prev) => { const n = { ...prev }; delete n[p.modelId]; return n })
        refresh()
      }, 500)
    })
    const u2 = window.api.server.onStatusChanged((s) => {
      setServerStatus(s)
      setServerStarting(false)
    })
    return () => { u1(); u2() }
  }, [refresh])

  const handleCustomDownload = useCallback(async () => {
    if (!customUrl.trim()) return
    const filename = customFilename.trim() || customUrl.split('/').pop() || 'custom-model.bin'
    const finalFilename = filename.endsWith('.bin') ? filename : filename + '.bin'
    const customId = `custom:${finalFilename}`
    setDownloading((prev) => ({ ...prev, [customId]: 0 }))
    try {
      await window.api.models.downloadCustom(customUrl.trim(), finalFilename)
      setCustomUrl('')
      setCustomFilename('')
    } catch {
      setDownloading((prev) => {
        const next = { ...prev }
        delete next[customId]
        return next
      })
    }
  }, [customUrl, customFilename])

  const downloaded = localModels.filter((m) => m.downloaded)

  return (
    <>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
        <button onClick={() => setMode('managed')} style={{
          flex: 1, padding: '6px', fontSize: '11px', fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif',
          background: mode === 'managed' ? theme.accent : theme.bgTertiary,
          color: mode === 'managed' ? '#fff' : theme.textMuted,
          border: `1px solid ${mode === 'managed' ? theme.accent : theme.border}`,
          borderRadius: '5px 0 0 5px', cursor: 'pointer'
        }}>Whisperio Server</button>
        <button onClick={() => setMode('manual')} style={{
          flex: 1, padding: '6px', fontSize: '11px', fontWeight: 600, fontFamily: 'IBM Plex Sans, sans-serif',
          background: mode === 'manual' ? theme.accent : theme.bgTertiary,
          color: mode === 'manual' ? '#fff' : theme.textMuted,
          border: `1px solid ${mode === 'manual' ? theme.accent : theme.border}`,
          borderRadius: '0 5px 5px 0', cursor: 'pointer'
        }}>Custom Server</button>
      </div>

      {mode === 'manual' ? (
        <>
          <label style={s.label}>Server URL</label>
          <input type="text" value={openaiBaseUrl} onChange={(e) => setOpenaiBaseUrl(e.target.value)} placeholder="http://localhost:8080/v1" style={s.input} />
          <span style={s.hint}>
            Any OpenAI-compatible STT server. http:// only for local/private hosts — public endpoints require https://.
          </span>
          <label style={{ ...s.label, marginTop: '8px' }}>Model Name</label>
          <input type="text" value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)} placeholder="whisper-1" style={s.input} />
          <label style={{ ...s.label, marginTop: '8px' }}>API Key (optional)</label>
          <input
            type="password"
            value={sttApiKey}
            onChange={(e) => setSttApiKey(e.target.value)}
            placeholder="Bearer token, if your server requires one"
            style={s.input}
          />
          <span style={s.hint}>Bearer token for your private STT server. Leave blank if it doesn&apos;t require auth.</span>
          <KeyStorageHint s={s} />
        </>
      ) : (
        <>
          {/* Server status */}
          {serverStatus.platform === 'win32' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', padding: '8px 10px', borderRadius: '6px', background: theme.bgTertiary }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                background: serverStatus.status === 'running' ? '#22c55e' : serverStatus.status === 'starting' ? theme.accent : theme.textMuted,
                boxShadow: serverStatus.status === 'running' ? '0 0 6px rgba(34,197,94,0.5)' : 'none'
              }} />
              <div style={{ flex: 1, fontSize: '12px' }}>
                <span style={{ color: theme.text, fontWeight: 500 }}>
                  {serverStatus.status === 'running' ? `Running — port ${serverStatus.port}` :
                   serverStatus.status === 'starting' ? 'Starting...' : 'Stopped'}
                </span>
                {serverStatus.model && <span style={{ color: theme.textMuted, marginLeft: '6px' }}>{serverStatus.model}</span>}
              </div>
              {serverStatus.status === 'running' ? (
                <button onClick={async () => { await window.api.server.stop(); refresh() }}
                  style={{ background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: '#ef4444', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>Stop</button>
              ) : (
                <select disabled={serverStarting || downloaded.length === 0}
                  onChange={async (e) => {
                    if (!e.target.value) return
                    setServerStarting(true)
                    try {
                      await window.api.server.start(e.target.value)
                      const settings = await window.api.settings.load()
                      const chain = settings.providerChain || ['openai']
                      if (!chain.includes('selfhosted')) chain.push('selfhosted')
                      await window.api.settings.save({
                        openaiBaseUrl: `http://127.0.0.1:${serverStatus.port}`,
                        whisperModel: e.target.value.replace('.bin', ''),
                        providerChain: chain
                      })
                    } catch { setServerStarting(false) }
                    refresh()
                    e.target.value = ''
                  }}
                  style={{ ...s.select, width: 'auto', padding: '3px 8px', fontSize: '10px' }}>
                  <option value="">{serverStarting ? 'Starting...' : 'Start...'}</option>
                  {downloaded.map((m) => <option key={m.filename} value={m.filename}>{m.name}</option>)}
                </select>
              )}
            </div>
          )}
          {serverStatus.platform !== 'win32' && (
            <span style={{ ...s.hint, display: 'block', marginBottom: '8px' }}>
              Auto-start available on Windows only. Install whisper-server manually and use Custom Server mode.
            </span>
          )}

          {/* Model list */}
          <label style={s.label}>Models</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            {models.map((model) => {
              const isDown = localModels.some((m) => m.id === model.id && m.downloaded)
              const progress = downloading[model.id]
              const isActive = progress !== undefined
              return (
                <div key={model.id} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 8px', borderRadius: '6px',
                  background: theme.bgTertiary,
                  border: `1px solid ${isDown ? theme.accent + '30' : 'transparent'}`
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>{model.name}</span>
                    <span style={{ fontSize: '10px', color: theme.textMuted, marginLeft: '6px' }}>{model.size}</span>
                    {isActive && (
                      <div style={{ marginTop: '3px', height: '3px', borderRadius: '2px', background: theme.border, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: theme.accent, transition: 'width 0.3s' }} />
                      </div>
                    )}
                  </div>
                  {isDown ? (
                    <button onClick={async () => { await window.api.models.delete(model.id); refresh() }}
                      style={{ background: 'transparent', border: 'none', fontSize: '10px', color: theme.textMuted, cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', padding: '2px 6px' }}>Remove</button>
                  ) : isActive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '10px', color: theme.accent }}>{progress}%</span>
                      <button
                        onClick={async () => {
                          const ok = await window.api.models.cancelDownload(model.id)
                          if (!ok) {
                            console.warn(`[SettingsForm] cancelDownload(${model.id}) reported no active download`)
                          }
                          setDownloading((p) => { const n = { ...p }; delete n[model.id]; return n })
                        }}
                        style={{ background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: '4px', padding: '2px 6px', fontSize: '10px', color: theme.textMuted, cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}
                      >Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setDownloading((p) => ({ ...p, [model.id]: 0 })); window.api.models.download(model.id) }}
                      style={{ background: theme.accent, border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: '#fff', cursor: 'pointer', fontWeight: 500, fontFamily: 'IBM Plex Sans, sans-serif' }}>Get</button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Custom Model URL — reuses the same models.downloadCustom IPC as the catalog above */}
          <label style={{ ...s.label, marginTop: '10px' }}>Custom model URL</label>
          <span style={s.hint}>
            Paste a direct URL to any GGML .bin model file (HuggingFace or other source).
          </span>
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://huggingface.co/user/repo/resolve/main/model.bin"
            style={{ ...s.input, marginTop: '4px' }}
          />
          <input
            type="text"
            value={customFilename}
            onChange={(e) => setCustomFilename(e.target.value)}
            placeholder="Filename (optional, auto-detected from URL)"
            style={{ ...s.input, marginTop: '4px' }}
          />
          <button
            onClick={handleCustomDownload}
            disabled={!customUrl.trim()}
            style={{
              ...s.button as React.CSSProperties,
              marginTop: '8px',
              opacity: customUrl.trim() ? 1 : 0.5,
              alignSelf: 'flex-start',
              padding: '6px 14px',
              fontSize: '11px'
            }}
          >
            Download from URL
          </button>
        </>
      )}
    </>
  )
}

const ALL_PROVIDERS: { id: string; label: string; desc: string }[] = [
  { id: 'openai', label: 'OpenAI', desc: 'gpt-4o-transcribe' },
  { id: 'elevenlabs', label: 'ElevenLabs', desc: 'Scribe v2' },
  { id: 'selfhosted', label: 'Local Model', desc: 'Offline, private' },
  { id: 'replicate', label: 'Replicate', desc: 'Cloud Whisper' },
  { id: 'groq', label: 'Groq', desc: 'Fast cloud Whisper' },
  { id: 'deepgram', label: 'Deepgram', desc: 'Nova' },
  { id: 'assemblyai', label: 'AssemblyAI', desc: 'Universal' },
  { id: 'mistral', label: 'Mistral', desc: 'Voxtral' }
]

// Built-in seed vocabulary shown as removable/restorable chips. Mirror of
// DEFAULT_VOCABULARY_TERMS in src/main/settingsManager.ts (the source of truth
// for what is actually sent to the providers). Keep the two lists in sync.
const DEFAULT_VOCABULARY_TERMS: string[] = [
  'git', 'GitHub', 'npm', 'yarn', 'pnpm', 'pip', 'Docker', 'Kubernetes', 'kubectl',
  'TypeScript', 'JavaScript', 'React', 'Next.js', 'Node.js', 'VS Code', 'API', 'CLI',
  'SSH', 'YAML', 'JSON', 'REST', 'GraphQL', 'webpack', 'ESLint', 'Prettier',
  'PostgreSQL', 'MongoDB', 'Redis', 'AWS', 'Azure', 'Terraform', 'CI/CD', 'DevOps',
  'localhost', 'regex', 'boolean', 'middleware', 'endpoint', 'repository', 'README',
  'Vite', 'Vitest', 'Electron', 'Python', 'FastAPI', 'Whisper', 'OpenAI'
]

function CogIcon({ size = 14, color = 'currentColor' }: { size?: number; color?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

function ProvidersTab({
  providerChain, setProviderChain,
  apiKey, setApiKey,
  openaiBaseUrl, setOpenaiBaseUrl,
  whisperModel, setWhisperModel,
  elevenlabsApiKey, setElevenlabsApiKey,
  replicateApiKey, setReplicateApiKey,
  sttReplicateModel, setSttReplicateModel,
  groqApiKey, setGroqApiKey,
  deepgramApiKey, setDeepgramApiKey,
  assemblyaiApiKey, setAssemblyaiApiKey,
  mistralApiKey, setMistralApiKey,
  sttApiKey, setSttApiKey,
  transcriptionLanguage, setTranscriptionLanguage,
  prompt, setPrompt,
  vocabulary, setVocabulary,
  removedDefaultVocabulary, setRemovedDefaultVocabulary,
  cleanupEnabled, setCleanupEnabled,
  cleanupMode, setCleanupMode,
  cleanupAuto, setCleanupAuto,
  cleanupTemplates, setCleanupTemplates,
  aiProvider, setAiProvider,
  aiBaseUrl, setAiBaseUrl,
  aiModel, setAiModel,
  anthropicApiKey, setAnthropicApiKey,
  contextAwareTone, setContextAwareTone,
  toneMap, setToneMap,
  windowTitlePermissionEnabled, setWindowTitlePermissionEnabled,
  s, theme
}: {
  providerChain: string[]
  setProviderChain: (v: string[]) => void
  apiKey: string
  setApiKey: (v: string) => void
  openaiBaseUrl: string
  setOpenaiBaseUrl: (v: string) => void
  whisperModel: string
  setWhisperModel: (v: string) => void
  elevenlabsApiKey: string
  setElevenlabsApiKey: (v: string) => void
  /** Shared with the AI Cleanup Replicate provider (CleanupPanel) — one key, both uses. */
  replicateApiKey: string
  setReplicateApiKey: (v: string) => void
  sttReplicateModel: string
  setSttReplicateModel: (v: string) => void
  groqApiKey: string
  setGroqApiKey: (v: string) => void
  deepgramApiKey: string
  setDeepgramApiKey: (v: string) => void
  assemblyaiApiKey: string
  setAssemblyaiApiKey: (v: string) => void
  mistralApiKey: string
  setMistralApiKey: (v: string) => void
  /** Bearer token for a private/self-hosted STT server (empty = no Authorization header, today's behavior). */
  sttApiKey: string
  setSttApiKey: (v: string) => void
  transcriptionLanguage: string
  setTranscriptionLanguage: (v: string) => void
  prompt: string
  setPrompt: (v: string) => void
  vocabulary: string
  setVocabulary: (v: string) => void
  removedDefaultVocabulary: string[]
  setRemovedDefaultVocabulary: (v: string[]) => void
  cleanupEnabled: boolean
  setCleanupEnabled: (v: boolean) => void
  cleanupMode: CleanupMode
  setCleanupMode: (v: CleanupMode) => void
  cleanupAuto: boolean
  setCleanupAuto: (v: boolean) => void
  cleanupTemplates: CleanupTemplate[]
  setCleanupTemplates: (v: CleanupTemplate[]) => void
  aiProvider: AiProvider
  setAiProvider: (v: AiProvider) => void
  aiBaseUrl: string
  setAiBaseUrl: (v: string) => void
  aiModel: string
  setAiModel: (v: string) => void
  anthropicApiKey: string
  setAnthropicApiKey: (v: string) => void
  contextAwareTone: boolean
  setContextAwareTone: (v: boolean) => void
  toneMap: Record<string, ToneProfileId>
  setToneMap: (v: Record<string, ToneProfileId>) => void
  windowTitlePermissionEnabled: boolean
  setWindowTitlePermissionEnabled: (v: boolean) => void
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)

  const toggleProvider = useCallback((id: string) => {
    if (providerChain.includes(id)) {
      if (providerChain.length <= 1) return
      setProviderChain(providerChain.filter((p) => p !== id))
      if (expandedProvider === id) setExpandedProvider(null)
    } else {
      setProviderChain([...providerChain, id])
    }
  }, [providerChain, setProviderChain, expandedProvider])

  const moveProvider = useCallback((id: string, dir: -1 | 1) => {
    const idx = providerChain.indexOf(id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= providerChain.length) return
    const next = [...providerChain]
    next[idx] = next[newIdx]
    next[newIdx] = id
    setProviderChain(next)
  }, [providerChain, setProviderChain])

  // Build ordered list: enabled providers first (in chain order), then disabled
  const orderedProviders = [
    ...providerChain.map((id) => ALL_PROVIDERS.find((p) => p.id === id)!).filter(Boolean),
    ...ALL_PROVIDERS.filter((p) => !providerChain.includes(p.id))
  ]

  return (
    <>
      <div style={s.card}>
        <SectionHeader title="Provider Chain" s={s} theme={theme} />
        <span style={s.hint}>First = primary. If it fails, the next one kicks in. Drag order with arrows.</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
          {orderedProviders.map((provider) => {
            const enabled = providerChain.includes(provider.id)
            const idx = providerChain.indexOf(provider.id)
            const expanded = expandedProvider === provider.id
            const primary = enabled && idx === 0

            return (
              <div key={provider.id}>
                {/* Provider row */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: expanded ? '8px 8px 0 0' : '8px',
                  background: enabled ? (primary ? `rgba(${theme.accentRgb}, 0.06)` : theme.inputBg) : 'transparent',
                  border: `1px solid ${enabled ? (primary ? theme.accent + '50' : theme.inputBorder) : theme.border + '30'}`,
                  borderBottom: expanded ? `1px solid ${theme.inputBorder}` : undefined,
                  opacity: enabled ? 1 : 0.45,
                  transition: 'opacity 0.15s, background 0.15s'
                }}>
                  {/* Rank */}
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '5px',
                    background: enabled ? (primary ? theme.accent : theme.bgTertiary) : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', fontWeight: 700,
                    color: primary ? theme.accentInk : theme.textMuted,
                    flexShrink: 0
                  }}>
                    {enabled ? idx + 1 : '-'}
                  </div>

                  {/* Name + desc */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>{provider.label}</span>
                    <span style={{ fontSize: '11px', color: theme.textMuted, marginLeft: '8px' }}>{provider.desc}</span>
                    {primary && (
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', fontWeight: 700,
                        letterSpacing: '0.1em', textTransform: 'uppercase', color: theme.accentLight, marginLeft: '8px'
                      }}>Primary</span>
                    )}
                  </div>

                  {/* Arrows */}
                  {enabled && providerChain.length > 1 && (
                    <div style={{ display: 'flex', gap: '1px', flexShrink: 0 }}>
                      <button onClick={() => moveProvider(provider.id, -1)} disabled={idx === 0}
                        style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? theme.border : theme.textMuted, fontSize: '9px', padding: '2px 3px', fontFamily: 'IBM Plex Sans, sans-serif' }}>▲</button>
                      <button onClick={() => moveProvider(provider.id, 1)} disabled={idx === providerChain.length - 1}
                        style={{ background: 'transparent', border: 'none', cursor: idx === providerChain.length - 1 ? 'default' : 'pointer', color: idx === providerChain.length - 1 ? theme.border : theme.textMuted, fontSize: '9px', padding: '2px 3px', fontFamily: 'IBM Plex Sans, sans-serif' }}>▼</button>
                    </div>
                  )}

                  {/* Cog */}
                  {enabled && (
                    <button onClick={() => setExpandedProvider(expanded ? null : provider.id)}
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer', color: expanded ? theme.accent : theme.textMuted,
                        padding: '4px', borderRadius: '4px', display: 'flex',
                        transform: expanded ? 'rotate(45deg)' : 'none',
                        transition: 'color 0.15s, transform 0.15s'
                      }}>
                      <CogIcon size={14} />
                    </button>
                  )}

                  {/* On/Off */}
                  <button onClick={() => toggleProvider(provider.id)}
                    style={{
                      background: enabled ? theme.accent : theme.bgTertiary,
                      border: `1px solid ${enabled ? theme.accent : theme.border}`,
                      borderRadius: '5px', padding: '3px 8px', fontSize: '10px', fontWeight: 500,
                      color: enabled ? '#fff' : theme.textMuted, cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif', flexShrink: 0
                    }}>{enabled ? 'On' : 'Off'}</button>
                </div>

                {/* Expanded settings */}
                {expanded && enabled && (
                  <div style={{
                    padding: '12px 14px',
                    background: theme.inputBg,
                    border: `1px solid ${theme.inputBorder}`,
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    display: 'flex', flexDirection: 'column', gap: '8px'
                  }}>
                    {provider.id === 'openai' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." style={s.input} />
                        <KeyStorageHint s={s} />
                        <label style={{ ...s.label, marginTop: '8px' }}>Transcription Prompt</label>
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={s.textarea} />
                      </>
                    )}
                    {provider.id === 'elevenlabs' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input type="password" value={elevenlabsApiKey} onChange={(e) => setElevenlabsApiKey(e.target.value)} placeholder="xi-..." style={s.input} />
                        <KeyStorageHint s={s} />
                      </>
                    )}
                    {provider.id === 'selfhosted' && (
                      <SelfhostedSettings
                        openaiBaseUrl={openaiBaseUrl}
                        setOpenaiBaseUrl={setOpenaiBaseUrl}
                        whisperModel={whisperModel}
                        setWhisperModel={setWhisperModel}
                        sttApiKey={sttApiKey}
                        setSttApiKey={setSttApiKey}
                        s={s}
                        theme={theme}
                      />
                    )}
                    {provider.id === 'replicate' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input
                          type="password"
                          value={replicateApiKey}
                          onChange={(e) => setReplicateApiKey(e.target.value)}
                          placeholder="r8_..."
                          style={s.input}
                        />
                        <span style={s.hint}>Shared with the AI Cleanup Replicate provider below — one key, both uses.</span>
                        <KeyStorageHint s={s} />
                        <label style={{ ...s.label, marginTop: '8px' }}>Model</label>
                        <input
                          type="text"
                          value={sttReplicateModel}
                          onChange={(e) => setSttReplicateModel(e.target.value)}
                          placeholder="openai/whisper"
                          style={s.input}
                        />
                        <span style={s.hint}>Any Replicate speech-to-text model, as owner/name. Defaults to openai/whisper.</span>
                      </>
                    )}
                    {provider.id === 'groq' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input
                          type="password"
                          value={groqApiKey}
                          onChange={(e) => setGroqApiKey(e.target.value)}
                          placeholder="gsk_..."
                          style={s.input}
                        />
                        <KeyStorageHint s={s} />
                      </>
                    )}
                    {provider.id === 'deepgram' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input
                          type="password"
                          value={deepgramApiKey}
                          onChange={(e) => setDeepgramApiKey(e.target.value)}
                          placeholder="dg_..."
                          style={s.input}
                        />
                        <KeyStorageHint s={s} />
                      </>
                    )}
                    {provider.id === 'assemblyai' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input
                          type="password"
                          value={assemblyaiApiKey}
                          onChange={(e) => setAssemblyaiApiKey(e.target.value)}
                          placeholder="aai_..."
                          style={s.input}
                        />
                        <KeyStorageHint s={s} />
                      </>
                    )}
                    {provider.id === 'mistral' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input
                          type="password"
                          value={mistralApiKey}
                          onChange={(e) => setMistralApiKey(e.target.value)}
                          placeholder="api key..."
                          style={s.input}
                        />
                        <KeyStorageHint s={s} />
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <CleanupPanel
        cleanupEnabled={cleanupEnabled}
        setCleanupEnabled={setCleanupEnabled}
        cleanupMode={cleanupMode}
        setCleanupMode={setCleanupMode}
        cleanupAuto={cleanupAuto}
        setCleanupAuto={setCleanupAuto}
        cleanupTemplates={cleanupTemplates}
        setCleanupTemplates={setCleanupTemplates}
        aiProvider={aiProvider}
        setAiProvider={setAiProvider}
        aiBaseUrl={aiBaseUrl}
        setAiBaseUrl={setAiBaseUrl}
        aiModel={aiModel}
        setAiModel={setAiModel}
        anthropicApiKey={anthropicApiKey}
        setAnthropicApiKey={setAnthropicApiKey}
        replicateApiKey={replicateApiKey}
        setReplicateApiKey={setReplicateApiKey}
        s={s}
        theme={theme}
      />

      <ContextTonePanel
        contextAwareTone={contextAwareTone}
        setContextAwareTone={setContextAwareTone}
        toneMap={toneMap}
        setToneMap={setToneMap}
        windowTitlePermissionEnabled={windowTitlePermissionEnabled}
        setWindowTitlePermissionEnabled={setWindowTitlePermissionEnabled}
        s={s}
        theme={theme}
      />

      <div style={s.card}>
        <SectionHeader title="Language" s={s} theme={theme} />
        <select value={transcriptionLanguage} onChange={(e) => setTranscriptionLanguage(e.target.value)} style={s.select}>
          <option value="auto">Auto-detect</option>
          <option value="en">English</option>
          <option value="pl">Polish</option>
          <option value="de">German</option>
          <option value="fr">French</option>
          <option value="es">Spanish</option>
          <option value="it">Italian</option>
          <option value="pt">Portuguese</option>
          <option value="nl">Dutch</option>
          <option value="ja">Japanese</option>
          <option value="ko">Korean</option>
          <option value="zh">Chinese</option>
          <option value="ru">Russian</option>
          <option value="uk">Ukrainian</option>
          <option value="cs">Czech</option>
          <option value="sv">Swedish</option>
          <option value="da">Danish</option>
          <option value="fi">Finnish</option>
          <option value="no">Norwegian</option>
          <option value="tr">Turkish</option>
          <option value="ar">Arabic</option>
          <option value="hi">Hindi</option>
        </select>
        <span style={s.hint}>Expected language of speech. Auto-detect works but setting it explicitly improves accuracy.</span>
      </div>

      <div style={s.card}>
        <SectionHeader title="Vocabulary" s={s} theme={theme} />
        <VocabularyEditor
          vocabulary={vocabulary}
          setVocabulary={setVocabulary}
          removedDefaultVocabulary={removedDefaultVocabulary}
          setRemovedDefaultVocabulary={setRemovedDefaultVocabulary}
          s={s}
          theme={theme}
        />
      </div>
    </>
  )
}

/* ─── Vocabulary editor: soft-deletable default terms + user additions ─── */

function VocabularyEditor({
  vocabulary, setVocabulary,
  removedDefaultVocabulary, setRemovedDefaultVocabulary,
  s, theme
}: {
  vocabulary: string
  setVocabulary: (v: string) => void
  removedDefaultVocabulary: string[]
  setRemovedDefaultVocabulary: (v: string[]) => void
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const removedSet = new Set(removedDefaultVocabulary.map((t) => t.toLowerCase()))
  const activeDefaults = DEFAULT_VOCABULARY_TERMS.filter((t) => !removedSet.has(t.toLowerCase()))
  const removedDefaults = DEFAULT_VOCABULARY_TERMS.filter((t) => removedSet.has(t.toLowerCase()))
  const customTerms = vocabulary.split(',').map((t) => t.trim()).filter(Boolean)

  const softDeleteDefault = (term: string): void => {
    if (removedSet.has(term.toLowerCase())) return
    setRemovedDefaultVocabulary([...removedDefaultVocabulary, term])
  }
  const restoreDefault = (term: string): void => {
    setRemovedDefaultVocabulary(removedDefaultVocabulary.filter((t) => t.toLowerCase() !== term.toLowerCase()))
  }
  const restoreAllDefaults = (): void => setRemovedDefaultVocabulary([])
  const removeCustom = (term: string): void => {
    setVocabulary(customTerms.filter((t) => t.toLowerCase() !== term.toLowerCase()).join(', '))
  }

  const chip = (opts: { key: string; label: string; onAction: () => void; symbol: string; ghost?: boolean; title: string }): ReactElement => (
    <span key={opts.key} style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 6px 3px 9px', borderRadius: '6px',
      background: opts.ghost ? 'transparent' : theme.inputBg,
      border: `1px solid ${opts.ghost ? theme.border + '60' : theme.inputBorder}`,
      fontSize: '12px', color: opts.ghost ? theme.textMuted : theme.text,
      fontFamily: 'IBM Plex Sans, sans-serif', opacity: opts.ghost ? 0.7 : 1
    }}>
      {opts.label}
      <button onClick={opts.onAction} title={opts.title}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.textMuted, fontSize: '12px', lineHeight: 1, padding: '0 1px', fontFamily: 'IBM Plex Sans, sans-serif' }}>
        {opts.symbol}
      </button>
    </span>
  )

  return (
    <>
      <label style={s.label}>Default Terms</label>
      <span style={s.hint}>Built-in terms for better recognition. Remove any you don&apos;t need — they can be restored anytime.</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
        {activeDefaults.map((term) => chip({ key: `d-${term}`, label: term, onAction: () => softDeleteDefault(term), symbol: '×', title: `Remove "${term}"` }))}
        {activeDefaults.length === 0 && <span style={s.hint}>All default terms removed.</span>}
      </div>

      {removedDefaults.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
            <label style={s.label}>Removed ({removedDefaults.length})</label>
            <button onClick={restoreAllDefaults}
              style={{ background: 'transparent', border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, color: theme.accent, cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}>
              Restore defaults
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
            {removedDefaults.map((term) => chip({ key: `r-${term}`, label: term, onAction: () => restoreDefault(term), symbol: '↺', ghost: true, title: `Restore "${term}"` }))}
          </div>
        </>
      )}

      <label style={{ ...s.label, marginTop: '14px' }}>Your Terms</label>
      <textarea value={vocabulary} onChange={(e) => setVocabulary(e.target.value)} rows={2} placeholder="Add your own comma-separated terms..." style={s.textarea} />
      <span style={s.hint}>Comma-separated terms added on top of the defaults above.</span>
      {customTerms.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
          {customTerms.map((term) => chip({ key: `c-${term}`, label: term, onAction: () => removeCustom(term), symbol: '×', title: `Remove "${term}"` }))}
        </div>
      )}
    </>
  )
}

/* ─── Tab: Audio ─── */

function AudioTab({
  inputDeviceId, setInputDeviceId,
  outputDeviceId, setOutputDeviceId,
  saveRecordings, setSaveRecordings,
  inputDevices, outputDevices,
  s, theme
}: {
  inputDeviceId: string
  setInputDeviceId: (v: string) => void
  outputDeviceId: string
  setOutputDeviceId: (v: string) => void
  saveRecordings: boolean
  setSaveRecordings: (v: boolean) => void
  inputDevices: MediaDeviceOption[]
  outputDevices: MediaDeviceOption[]
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const [recordingCount, setRecordingCount] = useState<number | null>(null)

  useEffect(() => {
    window.api.recordings.list().then((list) => setRecordingCount(list.length))
  }, [])

  return (
    <>
      <div style={s.card}>
        <SectionHeader title="Input Device (Microphone)" s={s} theme={theme} />
        <select
          value={inputDeviceId}
          onChange={(e) => setInputDeviceId(e.target.value)}
          style={s.select}
        >
          <option value="">System Default</option>
          {inputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </div>

      <div style={s.card}>
        <SectionHeader title="Output Device (System Audio)" s={s} theme={theme} />
        <select
          value={outputDeviceId}
          onChange={(e) => setOutputDeviceId(e.target.value)}
          style={s.select}
        >
          <option value="">System Default</option>
          {outputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </div>

      <div style={s.card}>
        <SectionHeader title="Recording" s={s} theme={theme} />
        <ToggleRow
          label="Save recordings to disk"
          description="Keep audio files for playback and reprocessing"
          checked={saveRecordings}
          onChange={setSaveRecordings}
          theme={theme}
        />
        {recordingCount !== null && recordingCount > 0 && (
          <button
            onClick={() => window.api.recordings.openWindow()}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              color: theme.accent,
              cursor: 'pointer',
              fontFamily: 'IBM Plex Sans, sans-serif',
              fontWeight: 500,
              marginTop: '4px',
              transition: 'border-color 0.2s, background 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = theme.accent
              e.currentTarget.style.background = `${theme.accent}15`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = theme.border
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {recordingCount} recording{recordingCount !== 1 ? 's' : ''} saved — View all
          </button>
        )}
      </div>
    </>
  )
}

/* ─── Tab: Hotkeys ─── */

type HotkeyField = 'dictation' | 'send' | 'output'

/** Renders a "Ctrl+Shift+Space" accelerator as individual keycaps, or a muted
 * "Not set" when empty — ported from docs/design/wz-parts.jsx's Keycaps(). */
function Keycaps({ combo, theme }: { combo: string; theme: Theme }): ReactElement {
  if (!combo) {
    return (
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: theme.textMuted }}>
        Not set
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
      {combo.split('+').map((k, i) => <Keycap key={i} theme={theme}>{k}</Keycap>)}
    </div>
  )
}

/** Hotkey recorder row — Keycaps + Change/Cancel + clear ×, per
 * docs/design/wz-tabs.jsx's HotkeyRecorderField. Key-capture itself lives in
 * HotkeysTab's window-level listener (unchanged); this only renders it and
 * exposes Change (start) / Cancel (abort) / × (clear) as buttons instead of
 * a fake readonly text input. */
function HotkeyInput({
  label,
  value,
  placeholder,
  isRecording,
  liveKeys,
  onStartRecording,
  onCancelRecording,
  onClear,
  theme,
  first
}: {
  label: string
  value: string
  placeholder: string
  isRecording: boolean
  liveKeys: string
  onStartRecording: () => void
  onCancelRecording: () => void
  onClear: () => void
  theme: Theme
  first?: boolean
}): ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 0',
      borderTop: first ? 'none' : `1px solid ${theme.border}`
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text }}>{label}</div>
        {!value && !isRecording && (
          <div style={{ fontSize: '12px', color: theme.textMuted, marginTop: '2px' }}>{placeholder}</div>
        )}
      </div>

      {isRecording ? (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', fontWeight: 600,
          color: theme.accent, whiteSpace: 'nowrap'
        }}>
          {liveKeys || 'Press keys…'}
        </span>
      ) : (
        <Keycaps combo={value} theme={theme} />
      )}

      <button
        onClick={isRecording ? onCancelRecording : onStartRecording}
        style={{
          background: isRecording ? theme.accent : theme.inputBg,
          border: `1px solid ${isRecording ? theme.accent : theme.border}`,
          borderRadius: '8px',
          padding: '6px 13px',
          fontSize: '12px',
          fontWeight: 600,
          color: isRecording ? theme.accentInk : theme.textSecondary,
          cursor: 'pointer',
          fontFamily: 'IBM Plex Sans, sans-serif',
          flexShrink: 0,
          transition: 'background 0.15s, color 0.15s, border-color 0.15s'
        }}
      >
        {isRecording ? 'Cancel' : 'Change'}
      </button>

      {value && !isRecording && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          style={{
            background: theme.bgTertiary,
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            width: '30px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: theme.textMuted,
            fontSize: '15px',
            fontFamily: 'IBM Plex Sans, sans-serif',
            flexShrink: 0,
            transition: 'color 0.15s, border-color 0.15s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = theme.text
            e.currentTarget.style.borderColor = theme.accent
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = theme.textMuted
            e.currentTarget.style.borderColor = theme.border
          }}
          title="Clear hotkey"
        >
          ×
        </button>
      )}
    </div>
  )
}

function HotkeysTab({
  dictationHotkey, setDictationHotkey,
  dictateAndSendHotkey, setDictateAndSendHotkey,
  outputRecordingHotkey, setOutputRecordingHotkey,
  s, theme
}: {
  dictationHotkey: string
  setDictationHotkey: (v: string) => void
  dictateAndSendHotkey: string
  setDictateAndSendHotkey: (v: string) => void
  outputRecordingHotkey: string
  setOutputRecordingHotkey: (v: string) => void
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const [recordingField, setRecordingField] = useState<HotkeyField | null>(null)
  const [liveKeys, setLiveKeys] = useState('')

  const startRecording = useCallback((field: HotkeyField) => {
    window.api.settings.pauseHotkeys()
    setRecordingField(field)
    setLiveKeys('')
  }, [])

  const stopRecording = useCallback((combo?: string) => {
    if (combo !== undefined && recordingField) {
      const setter = recordingField === 'dictation'
        ? setDictationHotkey
        : recordingField === 'send'
          ? setDictateAndSendHotkey
          : setOutputRecordingHotkey
      setter(combo)
    }
    setRecordingField(null)
    setLiveKeys('')
    window.api.settings.resumeHotkeys()
  }, [recordingField, setDictationHotkey, setDictateAndSendHotkey, setOutputRecordingHotkey])

  useEffect(() => {
    if (!recordingField) return

    const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta'])
    const pressed = new Set<string>()
    let bestCombo = ''

    function toAccelerator(key: string): string {
      if (key === ' ') return 'Space'
      if (key === 'ArrowUp') return 'Up'
      if (key === 'ArrowDown') return 'Down'
      if (key === 'ArrowLeft') return 'Left'
      if (key === 'ArrowRight') return 'Right'
      if (key.startsWith('F') && key.length >= 2 && !isNaN(Number(key.slice(1)))) return key
      if (key === 'Enter') return 'Enter'
      if (key === 'Tab') return 'Tab'
      if (key === 'Backspace') return 'Backspace'
      if (key === 'Delete') return 'Delete'
      if (key === 'Insert') return 'Insert'
      if (key === 'Home') return 'Home'
      if (key === 'End') return 'End'
      if (key === 'PageUp') return 'PageUp'
      if (key === 'PageDown') return 'PageDown'
      if (key === 'PrintScreen') return 'PrintScreen'
      if (key === 'ScrollLock') return 'ScrollLock'
      if (key === 'Pause') return 'Pause'
      if (key === 'NumLock') return 'numlk'
      if (key.length === 1) return key.toUpperCase()
      return key
    }

    function buildCombo(): string {
      const parts: string[] = []
      if (pressed.has('Control')) parts.push('Ctrl')
      if (pressed.has('Alt')) parts.push('Alt')
      if (pressed.has('Shift')) parts.push('Shift')
      if (pressed.has('Meta')) parts.push('Meta')
      for (const k of pressed) {
        if (!modifierKeys.has(k)) parts.push(toAccelerator(k))
      }
      return parts.join('+')
    }

    function handleKeyDown(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape' && pressed.size === 0) {
        stopRecording()
        return
      }

      pressed.add(modifierKeys.has(e.key) ? e.key : e.key)
      bestCombo = buildCombo()
      setLiveKeys(bestCombo)
    }

    function handleKeyUp(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()

      pressed.delete(e.key)

      if (pressed.size === 0 && bestCombo) {
        // All keys released — finalize
        stopRecording(bestCombo)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [recordingField, stopRecording])

  return (
    <>
      <div style={s.card}>
        <SectionHeader title="Keyboard Shortcuts" s={s} theme={theme} />

        <HotkeyInput
          label="Dictation Hotkey"
          value={dictationHotkey}
          placeholder="Ctrl+Shift+Space (default)"
          isRecording={recordingField === 'dictation'}
          liveKeys={recordingField === 'dictation' ? liveKeys : ''}
          onStartRecording={() => startRecording('dictation')}
          onCancelRecording={() => stopRecording()}
          onClear={() => setDictationHotkey('')}
          theme={theme}
          first
        />

        <HotkeyInput
          label="Dictate & Send Hotkey"
          value={dictateAndSendHotkey}
          placeholder="Not set"
          isRecording={recordingField === 'send'}
          liveKeys={recordingField === 'send' ? liveKeys : ''}
          onStartRecording={() => startRecording('send')}
          onCancelRecording={() => stopRecording()}
          onClear={() => setDictateAndSendHotkey('')}
          theme={theme}
        />

        <HotkeyInput
          label="Output Recording Hotkey"
          value={outputRecordingHotkey}
          placeholder="Not set"
          isRecording={recordingField === 'output'}
          liveKeys={recordingField === 'output' ? liveKeys : ''}
          onStartRecording={() => startRecording('output')}
          onCancelRecording={() => stopRecording()}
          onClear={() => setOutputRecordingHotkey('')}
          theme={theme}
        />

        <span style={{ ...s.hint, marginTop: '16px', display: 'block' }}>
          Click Change to record a hotkey. Press and release keys to set. Escape or Cancel to abort.
        </span>
      </div>
    </>
  )
}

/* ─── Shared: Toggle Row ─── */

/** Exported so feature panels (e.g. CleanupPanel) reuse this instead of a fork. */
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  theme
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  theme: Theme
}): ReactElement {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 0',
      cursor: 'pointer',
      gap: '12px'
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text }}>{label}</div>
        <div style={{ fontSize: '12px', color: theme.textMuted, marginTop: '2px' }}>{description}</div>
      </div>
      <div
        style={{
          width: '40px',
          height: '22px',
          borderRadius: '11px',
          background: checked ? theme.accent : theme.bgTertiary,
          border: `1px solid ${checked ? theme.accent : theme.border}`,
          position: 'relative',
          transition: 'background 0.2s, border-color 0.2s',
          flexShrink: 0,
          boxShadow: checked ? `0 0 8px ${theme.accentGlow}` : 'none'
        }}
      >
        <div
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            background: checked ? '#ffffff' : theme.textMuted,
            position: 'absolute',
            top: '2px',
            left: checked ? '20px' : '2px',
            transition: 'left 0.2s, background 0.2s'
          }}
        />
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ display: 'none' }}
      />
    </label>
  )
}

/* ─── Shared: Section header (accent tick + title) ─── */

/** Card section header: 3×15 accent tick + title, ported from
 * docs/design/wz-parts.jsx's Section(). Exported so feature panels
 * (CleanupPanel, UsagePanel) reuse this instead of a bare
 * `<h3 style={s.cardTitle}>` — keeps every settings card's header visually
 * consistent (General/Providers/Audio/Hotkeys/Updates/Sync/AI Cleanup/Usage). */
export function SectionHeader({
  title,
  right,
  theme,
  s
}: {
  title: string
  right?: ReactNode
  theme: Theme
  s: { cardTitle: React.CSSProperties }
}): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
      <span style={{ width: '3px', height: '15px', borderRadius: '2px', background: theme.accent, flexShrink: 0 }} />
      <h3 style={{ ...s.cardTitle, flex: 1 }}>{title}</h3>
      {right}
    </div>
  )
}

/* ─── Tab: Sync (GitHub secret store) ─── */

type GithubStatus = Awaited<ReturnType<Window['api']['github']['status']>>
type GithubRepo = Awaited<ReturnType<Window['api']['github']['listRepos']>>[number]

/**
 * GitHub secret-store tab. The renderer never sees the access token or the
 * encryption key — it only drives the main-process flow (connect → pick repo →
 * push/pull) and shows status. Secrets are sealed client-side in main before
 * they ever reach GitHub.
 */
function SyncTab({ s, theme }: { s: ReturnType<typeof makeStyles>; theme: Theme }): ReactElement {
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [prompt, setPrompt] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const st = await window.api.github.status()
    setStatus(st)
    return st
  }, [])

  useEffect(() => {
    refresh()
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [refresh])

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setMessage({ kind, text })
    setTimeout(() => setMessage(null), 4000)
  }, [])

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true)
    try {
      setRepos(await window.api.github.listRepos())
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Failed to load repositories')
    } finally {
      setLoadingRepos(false)
    }
  }, [flash])

  const poll = useCallback(async () => {
    try {
      const r = await window.api.github.poll()
      if (r.status === 'pending') {
        pollTimer.current = setTimeout(poll, 5000)
        return
      }
      setConnecting(false)
      setPrompt(null)
      if (r.status === 'authorized') {
        await refresh()
        loadRepos()
        flash('ok', `Connected as ${r.user || 'GitHub user'}`)
      } else if (r.status === 'expired') {
        flash('err', 'Authorization expired — please try again')
      } else if (r.status === 'denied') {
        flash('err', 'Authorization was denied')
      } else {
        flash('err', r.message || 'Connection failed')
      }
    } catch (e) {
      setConnecting(false)
      setPrompt(null)
      flash('err', e instanceof Error ? e.message : 'Connection failed')
    }
  }, [refresh, loadRepos, flash])

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    setMessage(null)
    try {
      const p = await window.api.github.connect()
      setPrompt({ userCode: p.userCode, verificationUri: p.verificationUri })
      pollTimer.current = setTimeout(poll, 5000)
    } catch (e) {
      setConnecting(false)
      flash('err', e instanceof Error ? e.message : 'Could not start GitHub connection')
    }
  }, [poll, flash])

  const handleSelectRepo = useCallback(async (repo: GithubRepo) => {
    await window.api.github.selectRepo(repo.fullName, repo.defaultBranch)
    setPicking(false)
    await refresh()
    flash('ok', `Store set to ${repo.fullName}`)
  }, [refresh, flash])

  const handleDisconnect = useCallback(async () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
    setPrompt(null)
    setRepos(null)
    setStatus(await window.api.github.disconnect())
  }, [])

  const handlePush = useCallback(async () => {
    setBusy('push')
    try {
      const r = await window.api.github.push()
      flash('ok', `Encrypted secrets pushed to ${r.path}`)
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Push failed')
    } finally {
      setBusy(null)
    }
  }, [flash])

  const handlePull = useCallback(async () => {
    setBusy('pull')
    try {
      const r = await window.api.github.pull()
      flash('ok', `Pulled & decrypted ${r.keys.length} secret${r.keys.length === 1 ? '' : 's'}`)
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Pull failed')
    } finally {
      setBusy(null)
    }
  }, [flash])

  const btnPrimary: React.CSSProperties = {
    background: theme.accent, color: '#fff', border: 'none', borderRadius: '8px',
    padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    fontFamily: 'IBM Plex Sans, sans-serif'
  }
  const btnGhost: React.CSSProperties = {
    background: 'transparent', color: theme.accent, border: `1px solid ${theme.border}`,
    borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif'
  }

  if (!status) {
    return <div style={s.card}><span style={s.hint}>Loading…</span></div>
  }

  const showPicker = status.connected && (picking || !status.repo)

  return (
    <>
      {/* Security explainer — always visible */}
      <div style={{ ...s.card, background: `${theme.accent}0d`, border: `1px solid ${theme.accent}33`, borderRadius: '10px', padding: '14px 16px' }}>
        <SectionHeader title="Encrypted secret store" s={s} theme={theme} />
        <span style={s.hint}>
          Connect a GitHub repo to back up your API keys. Everything is encrypted on THIS device
          with AES-256-GCM before it leaves the app — the key is held in your macOS Keychain and is
          never uploaded. Only unreadable ciphertext is committed to the repo, so GitHub and any
          collaborators can never see your keys.
        </span>
      </div>

      {message && (
        <div style={{
          ...s.card, padding: '10px 14px', borderRadius: '8px',
          background: message.kind === 'ok' ? `${theme.success}18` : '#ef444418',
          border: `1px solid ${message.kind === 'ok' ? theme.success + '55' : '#ef444455'}`
        }}>
          <span style={{ fontSize: '12.5px', color: message.kind === 'ok' ? theme.success : '#ef4444', fontWeight: 500 }}>
            {message.text}
          </span>
        </div>
      )}

      {!status.vaultAvailable && (
        <div style={s.card}>
          <span style={{ fontSize: '13px', color: '#ef4444', fontWeight: 600 }}>OS Keychain unavailable</span>
          <span style={s.hint}>
            Secure storage isn’t available on this system, so Whisperio will not sync secrets
            (it refuses to store them unencrypted). Sync is disabled.
          </span>
        </div>
      )}

      {status.vaultAvailable && !status.clientConfigured && (
        <div style={s.card}>
          <SectionHeader title="Setup required" s={s} theme={theme} />
          <span style={s.hint}>
            A GitHub OAuth App (with Device Flow enabled and the <code>repo</code> scope) must be
            configured for this build. Set <code>WHISPERIO_GITHUB_CLIENT_ID</code> to its client id,
            then restart Whisperio. The connection flow below activates once it’s set.
          </span>
        </div>
      )}

      {/* Connection card */}
      {status.vaultAvailable && status.clientConfigured && (
        <div style={s.card}>
          <SectionHeader title="GitHub connection" s={s} theme={theme} />

          {!status.connected && !prompt && (
            <>
              <span style={s.hint}>Authorize Whisperio in your browser to use a repo as your secret store.</span>
              <div>
                <button onClick={handleConnect} disabled={connecting} style={{ ...btnPrimary, opacity: connecting ? 0.6 : 1 }}>
                  {connecting ? 'Starting…' : 'Connect GitHub'}
                </button>
              </div>
            </>
          )}

          {prompt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={s.hint}>
                Your browser opened <b>{prompt.verificationUri}</b>. Enter this code to authorize, then
                come back — Whisperio is waiting.
              </span>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: '26px', fontWeight: 700,
                letterSpacing: '0.22em', color: theme.accent, padding: '10px 0'
              }}>{prompt.userCode}</div>
              <span style={{ fontSize: '11px', color: theme.textMuted }}>Waiting for authorization…</span>
            </div>
          )}

          {status.connected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: theme.success, boxShadow: `0 0 6px ${theme.success}` }} />
              <span style={{ fontSize: '13px', color: theme.text, fontWeight: 600 }}>
                Connected{status.user ? ` as ${status.user}` : ''}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={handleDisconnect} style={{ ...btnGhost, color: '#ef4444', padding: '6px 12px', fontSize: '12px' }}>Disconnect</button>
            </div>
          )}
        </div>
      )}

      {/* Repo picker */}
      {showPicker && (
        <div style={s.card}>
          <SectionHeader title="Choose store repository" s={s} theme={theme} />
          {!repos && !loadingRepos && (
            <button onClick={loadRepos} style={btnGhost}>Load my repositories</button>
          )}
          {loadingRepos && <span style={s.hint}>Loading repositories…</span>}
          {repos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '260px', overflowY: 'auto' }}>
              {repos.length === 0 && <span style={s.hint}>No repositories found.</span>}
              {repos.map((r) => (
                <button key={r.fullName} onClick={() => handleSelectRepo(r)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
                    padding: '9px 11px', borderRadius: '8px', cursor: 'pointer',
                    background: r.fullName === status.repo ? `${theme.accent}18` : theme.inputBg,
                    border: `1px solid ${r.fullName === status.repo ? theme.accent + '55' : theme.inputBorder}`,
                    fontFamily: 'IBM Plex Sans, sans-serif'
                  }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: theme.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.fullName}</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px',
                    background: r.private ? `${theme.accent}22` : theme.bgTertiary, color: r.private ? theme.accent : theme.textMuted
                  }}>{r.private ? 'private' : 'public'}</span>
                </button>
              ))}
            </div>
          )}
          {status.repo && (
            <button onClick={() => setPicking(false)} style={{ ...btnGhost, alignSelf: 'flex-start', padding: '6px 12px', fontSize: '12px' }}>Cancel</button>
          )}
        </div>
      )}

      {/* Sync actions */}
      {status.connected && status.repo && !picking && (
        <div style={s.card}>
          <SectionHeader title="Secret store" s={s} theme={theme} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={s.hint}>Store repo:</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: theme.text }}>{status.repo}</span>
            <span style={{ fontSize: '11px', color: theme.textMuted }}>({status.branch || 'default'})</span>
            <button onClick={() => { setPicking(true); if (!repos) loadRepos() }} style={{ ...btnGhost, padding: '4px 10px', fontSize: '11px' }}>Change</button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handlePush} disabled={busy !== null} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
              {busy === 'push' ? 'Encrypting & pushing…' : 'Encrypt & push'}
            </button>
            <button onClick={handlePull} disabled={busy !== null} style={{ ...btnGhost, opacity: busy ? 0.6 : 1 }}>
              {busy === 'pull' ? 'Pulling & decrypting…' : 'Pull & decrypt'}
            </button>
          </div>
          <span style={{ ...s.hint, marginTop: '6px' }}>
            Push seals your current API keys and commits the ciphertext. Pull restores them on another
            machine (that machine needs its own Keychain key — see note above).
          </span>
        </div>
      )}
    </>
  )
}

/* ─── Styles ─── */

function makeStyles(theme: Theme) {
  return {
    container: {
      padding: '24px 26px 28px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '24px',
      maxWidth: '1120px',
      width: '100%',
      boxSizing: 'border-box' as const,
      margin: '0 auto'
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto' as const,
      overflowX: 'hidden' as const
    },
    sidebar: {
      width: '212px',
      flexShrink: 0,
      borderRight: `1px solid ${theme.border}`,
      padding: '16px 12px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '4px',
      background: theme.bgSecondary
    } as React.CSSProperties,
    sidebarLabel: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px',
      letterSpacing: '0.18em',
      textTransform: 'uppercase' as const,
      color: theme.textMuted,
      padding: '2px 10px 10px'
    } as React.CSSProperties,
    navItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      width: '100%',
      textAlign: 'left' as const,
      cursor: 'pointer',
      border: 'none',
      borderRadius: '10px',
      padding: '10px 12px',
      fontFamily: "'IBM Plex Sans', sans-serif",
      fontSize: '13px',
      fontWeight: 600,
      background: 'transparent',
      color: theme.textSecondary,
      position: 'relative' as const,
      transition: 'background 0.15s, color 0.15s'
    } as React.CSSProperties,
    navItemActive: {
      background: `rgba(${theme.accentRgb}, 0.13)`,
      color: theme.accentLight,
      boxShadow: theme.e1
    } as React.CSSProperties,
    versionBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '9px 12px',
      borderRadius: '999px',
      background: theme.bg,
      border: `1px solid ${theme.border}`,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10.5px',
      color: theme.textMuted
    } as React.CSSProperties,
    card: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '10px',
      padding: '18px 18px 16px',
      background: theme.bgSecondary,
      border: `1px solid ${theme.border}`,
      borderRadius: '14px',
      boxShadow: theme.e1
    },
    cardTitle: {
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize: '13px',
      fontWeight: 600,
      color: theme.text,
      marginBottom: 0,
      letterSpacing: '0.015em'
    },
    label: {
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      color: theme.textSecondary,
      marginTop: '4px'
    },
    input: {
      background: theme.inputBg,
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '10px',
      padding: '11px 14px',
      fontSize: '13px',
      color: theme.text,
      outline: 'none',
      fontFamily: 'IBM Plex Sans, sans-serif',
      width: '100%',
      transition: 'border-color 0.15s'
    } as React.CSSProperties,
    textarea: {
      background: theme.inputBg,
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '10px',
      padding: '11px 14px',
      fontSize: '13px',
      color: theme.text,
      outline: 'none',
      fontFamily: 'IBM Plex Sans, sans-serif',
      width: '100%',
      resize: 'vertical' as const,
      minHeight: '60px',
      transition: 'border-color 0.15s'
    } as React.CSSProperties,
    select: {
      background: theme.inputBg,
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '10px',
      padding: '11px 14px',
      fontSize: '13px',
      color: theme.text,
      outline: 'none',
      fontFamily: 'IBM Plex Sans, sans-serif',
      width: '100%',
      cursor: 'pointer',
      transition: 'border-color 0.15s'
    } as React.CSSProperties,
    hint: {
      fontSize: '12px',
      color: theme.textMuted,
      lineHeight: '1.5'
    },
    saveBar: {
      padding: '14px 26px',
      borderTop: `1px solid ${theme.border}`,
      background: theme.bgSecondary,
      flexShrink: 0,
      display: 'flex',
      justifyContent: 'flex-start'
    },
    button: {
      background: theme.accent,
      color: theme.accentInk,
      border: 'none',
      borderRadius: '10px',
      padding: '10px 20px',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: "'IBM Plex Sans', sans-serif",
      transition: 'background 0.2s, box-shadow 0.2s'
    } as React.CSSProperties
  }
}
