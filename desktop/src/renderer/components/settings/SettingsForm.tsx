import { useState, useEffect, useCallback, useRef, type ReactElement, type ReactNode } from 'react'
import { useTheme } from '../../ThemeContext'
import { TitleBar } from '../common/TitleBar'
import type { Theme } from '../../theme'
import { ACCENTS, ACCENT_ORDER, ACCENT_LABELS } from '../../theme'
import { RecordingsView } from '../recordings/RecordingsPanel'

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
      padding: '10px 16px',
      background: `${accent}14`,
      borderBottom: `1px solid ${accent}40`,
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
            background: accent, border: 'none', borderRadius: '6px', padding: '7px 16px',
            fontSize: '12px', fontWeight: 600, color: '#fff', cursor: installing ? 'default' : 'pointer',
            fontFamily: 'IBM Plex Sans, sans-serif', flexShrink: 0, opacity: installing ? 0.6 : 1
          }}
        >{installing ? 'Restarting…' : 'Restart now'}</button>
      )}
    </div>
  )
}

type TabId = 'general' | 'providers' | 'rewrite' | 'github' | 'models' | 'audio' | 'hotkeys' | 'recordings' | 'updates'

const TAB_ICONS: Record<string, string> = {
  general: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  providers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  audio: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  hotkeys: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M9 13h6M18 13h.01',
  recordings: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 2',
  updates: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  rewrite: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  github: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22'
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
  selfhosted: 'On-Device'
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
  aiPostProcessing,
  theme
}: {
  dictationHotkey: string
  providerChain: string[]
  aiPostProcessing: boolean
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
      gap: '18px',
      padding: '9px 18px',
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

      {/* AI cleanup chip — only when post-processing is on */}
      {aiPostProcessing && (
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
        <h3 style={s.cardTitle}>Software Updates</h3>

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
        <h3 style={s.cardTitle}>How updates work</h3>
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

export function SettingsForm(): ReactElement {
  const { theme } = useTheme()

  // --- State ---
  const validTabs: TabId[] = ['general', 'providers', 'rewrite', 'github', 'audio', 'hotkeys', 'updates', 'recordings']
  const initialTab = ((): TabId => {
    const h = window.location.hash.replace('#', '') as TabId
    return validTabs.includes(h) ? h : 'general'
  })()
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [loading, setLoading] = useState(true)
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
  const [transcriptionLanguage, setTranscriptionLanguage] = useState('auto')
  const [prompt, setPrompt] = useState('')
  const [vocabulary, setVocabulary] = useState('')
  const [aiPostProcessing, setAiPostProcessing] = useState(false)
  const [fallbackEnabled, setFallbackEnabled] = useState(false)

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
  useEffect(() => {
    window.api.settings.load().then((settings) => {
      setSttProvider(settings.sttProvider ?? 'openai')
      setProviderChain(settings.providerChain ?? [settings.sttProvider ?? 'openai'])
      setApiKey(settings.openaiApiKey ?? '')
      setOpenaiBaseUrl(settings.openaiBaseUrl ?? '')
      setWhisperModel(settings.whisperModel ?? '')
      setElevenlabsApiKey(settings.elevenlabsApiKey ?? '')
      setTranscriptionLanguage(settings.transcriptionLanguage ?? 'auto')
      setPrompt(settings.transcriptionPrompt ?? '')
      setVocabulary(settings.customVocabulary ?? '')
      setAiPostProcessing(settings.aiPostProcessing ?? false)
      setLaunchAtStartup(settings.launchAtStartup ?? true)
      setDictationHotkey(settings.dictationHotkey ?? '')
      setDictateAndSendHotkey(settings.dictateAndSendHotkey ?? '')
      setInputDeviceId(settings.inputDeviceId ?? '')
      setOutputDeviceId(settings.outputDeviceId ?? '')
      setSaveRecordings(settings.saveRecordings ?? true)
      setOutputRecordingHotkey(settings.outputRecordingHotkey ?? '')
      setFallbackEnabled(settings.fallbackEnabled ?? false)
      setLoading(false)
    })
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
    await window.api.settings.save({
      sttProvider: providerChain[0] as 'openai' | 'elevenlabs' || 'openai',
      providerChain,
      openaiApiKey: apiKey,
      openaiBaseUrl,
      whisperModel,
      elevenlabsApiKey,
      transcriptionLanguage,
      transcriptionPrompt: prompt,
      customVocabulary: vocabulary,
      aiPostProcessing,
      launchAtStartup,
      dictationHotkey,
      dictateAndSendHotkey,
      inputDeviceId,
      outputDeviceId,
      saveRecordings,
      outputRecordingHotkey,
      fallbackEnabled: providerChain.length > 1
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [
    providerChain, apiKey, openaiBaseUrl, whisperModel, elevenlabsApiKey, transcriptionLanguage, prompt,
    vocabulary, aiPostProcessing, launchAtStartup, dictationHotkey,
    dictateAndSendHotkey, inputDeviceId, outputDeviceId, saveRecordings,
    outputRecordingHotkey
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

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'providers', label: 'Providers' },
    { id: 'rewrite', label: 'Rewrite' },
    { id: 'github', label: 'GitHub' },
    { id: 'audio', label: 'Audio' },
    { id: 'hotkeys', label: 'Hotkeys' },
    { id: 'updates', label: 'Updates' },
    { id: 'recordings', label: 'Recordings' }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
      <TitleBar title={activeTab === 'recordings' ? 'Whisperio Recordings' : 'Whisperio Settings'} />

      <UpdateBanner state={updater} theme={theme} />

      {activeTab !== 'recordings' && (
        <StatusHeader
          dictationHotkey={dictationHotkey}
          providerChain={providerChain}
          aiPostProcessing={aiPostProcessing}
          theme={theme}
        />
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar nav */}
        <nav style={s.sidebar}>
          <div style={s.sidebarLabel}>Settings</div>
          {tabs.map((tab) => {
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
                <span style={{ display: 'flex', flexShrink: 0, color: active ? theme.accent : theme.textMuted }}>
                  <NavIcon d={TAB_ICONS[tab.id]} />
                </span>
                {tab.label}
              </button>
            )
          })}
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
                      transcriptionLanguage={transcriptionLanguage}
                      setTranscriptionLanguage={setTranscriptionLanguage}
                      prompt={prompt}
                      setPrompt={setPrompt}
                      vocabulary={vocabulary}
                      setVocabulary={setVocabulary}
                      aiPostProcessing={aiPostProcessing}
                      setAiPostProcessing={setAiPostProcessing}
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

                  {activeTab === 'updates' && (
                    <UpdatesTab state={updater} s={s} theme={theme} />
                  )}

                  {activeTab === 'rewrite' && <RewriteTab s={s} theme={theme} />}

                  {activeTab === 'github' && <GitHubTab s={s} theme={theme} />}
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
  const { mode, toggleTheme, accent, setAccent } = useThemeHook()

  return (
    <>
      <div style={s.card}>
        <h3 style={s.cardTitle}>Startup</h3>
        <ToggleRow
          label="Launch at Windows startup"
          description="Automatically start Whisperio when you log in"
          checked={launchAtStartup}
          onChange={setLaunchAtStartup}
          theme={theme}
        />
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Appearance</h3>
        <ToggleRow
          label="Dark theme"
          description={mode === 'dark' ? 'Currently using dark theme' : 'Currently using light theme'}
          checked={mode === 'dark'}
          onChange={() => toggleTheme()}
          theme={theme}
        />
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

function SelfhostedSettings({
  openaiBaseUrl, setOpenaiBaseUrl,
  whisperModel, setWhisperModel,
  s, theme
}: {
  openaiBaseUrl: string
  setOpenaiBaseUrl: (v: string) => void
  whisperModel: string
  setWhisperModel: (v: string) => void
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const [mode, setMode] = useState<'managed' | 'manual'>(openaiBaseUrl && !openaiBaseUrl.includes('127.0.0.1:8178') ? 'manual' : 'managed')
  const [models, setModels] = useState<{ id: string; name: string; size: string; description: string; filename: string }[]>([])
  const [localModels, setLocalModels] = useState<{ id: string; name: string; filename: string; size: number; downloaded: boolean }[]>([])
  const [downloading, setDownloading] = useState<Record<string, number>>({})
  const [serverStatus, setServerStatus] = useState<{ status: string; model: string | null; port: number; platform: string }>({ status: 'stopped', model: null, port: 8178, platform: 'win32' })
  const [serverStarting, setServerStarting] = useState(false)

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
          <span style={s.hint}>Any OpenAI-compatible STT server</span>
          <label style={{ ...s.label, marginTop: '8px' }}>Model Name</label>
          <input type="text" value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)} placeholder="whisper-1" style={s.input} />
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
                    <span style={{ fontSize: '10px', color: theme.accent }}>{progress}%</span>
                  ) : (
                    <button onClick={() => { setDownloading((p) => ({ ...p, [model.id]: 0 })); window.api.models.download(model.id) }}
                      style={{ background: theme.accent, border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: '#fff', cursor: 'pointer', fontWeight: 500, fontFamily: 'IBM Plex Sans, sans-serif' }}>Get</button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

const ALL_PROVIDERS: { id: string; label: string; desc: string }[] = [
  { id: 'openai', label: 'OpenAI', desc: 'gpt-4o-transcribe' },
  { id: 'elevenlabs', label: 'ElevenLabs', desc: 'Scribe v2' },
  { id: 'selfhosted', label: 'Local Model', desc: 'Offline, private' }
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
  transcriptionLanguage, setTranscriptionLanguage,
  prompt, setPrompt,
  vocabulary, setVocabulary,
  aiPostProcessing, setAiPostProcessing,
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
  transcriptionLanguage: string
  setTranscriptionLanguage: (v: string) => void
  prompt: string
  setPrompt: (v: string) => void
  vocabulary: string
  setVocabulary: (v: string) => void
  aiPostProcessing: boolean
  setAiPostProcessing: (v: boolean) => void
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
        <h3 style={s.cardTitle}>Provider Chain</h3>
        <span style={s.hint}>First = primary. If it fails, the next one kicks in. Drag order with arrows.</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
          {orderedProviders.map((provider) => {
            const enabled = providerChain.includes(provider.id)
            const idx = providerChain.indexOf(provider.id)
            const expanded = expandedProvider === provider.id

            return (
              <div key={provider.id}>
                {/* Provider row */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: expanded ? '8px 8px 0 0' : '8px',
                  background: enabled ? theme.inputBg : 'transparent',
                  border: `1px solid ${enabled ? (idx === 0 ? theme.accent + '50' : theme.inputBorder) : theme.border + '30'}`,
                  borderBottom: expanded ? `1px solid ${theme.inputBorder}` : undefined,
                  opacity: enabled ? 1 : 0.45,
                  transition: 'opacity 0.15s'
                }}>
                  {/* Rank */}
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '5px',
                    background: enabled ? (idx === 0 ? theme.accent : theme.bgTertiary) : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', fontWeight: 700,
                    color: idx === 0 ? '#fff' : theme.textMuted,
                    flexShrink: 0
                  }}>
                    {enabled ? idx + 1 : '-'}
                  </div>

                  {/* Name + desc */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>{provider.label}</span>
                    <span style={{ fontSize: '11px', color: theme.textMuted, marginLeft: '8px' }}>{provider.desc}</span>
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
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: expanded ? theme.accent : theme.textMuted, padding: '4px', borderRadius: '4px', display: 'flex', transition: 'color 0.15s' }}>
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
                        <label style={{ ...s.label, marginTop: '8px' }}>Transcription Prompt</label>
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={s.textarea} />
                        <ToggleRow label="AI vocabulary correction" description="LLM pass to fix technical terms after transcription" checked={aiPostProcessing} onChange={setAiPostProcessing} theme={theme} />
                      </>
                    )}
                    {provider.id === 'elevenlabs' && (
                      <>
                        <label style={s.label}>API Key</label>
                        <input type="password" value={elevenlabsApiKey} onChange={(e) => setElevenlabsApiKey(e.target.value)} placeholder="xi-..." style={s.input} />
                      </>
                    )}
                    {provider.id === 'selfhosted' && (
                      <SelfhostedSettings
                        openaiBaseUrl={openaiBaseUrl}
                        setOpenaiBaseUrl={setOpenaiBaseUrl}
                        whisperModel={whisperModel}
                        setWhisperModel={setWhisperModel}
                        s={s}
                        theme={theme}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Language</h3>
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
        <h3 style={s.cardTitle}>Vocabulary</h3>
        <label style={s.label}>Custom Vocabulary</label>
        <textarea value={vocabulary} onChange={(e) => setVocabulary(e.target.value)} rows={3} placeholder="git, GitHub, npm, TypeScript, React, Docker, kubectl..." style={s.textarea} />
        <span style={s.hint}>Comma-separated terms for better recognition across all providers.</span>
      </div>
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
        <h3 style={s.cardTitle}>Input Device (Microphone)</h3>
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
        <h3 style={s.cardTitle}>Output Device (System Audio)</h3>
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
        <h3 style={s.cardTitle}>Recording</h3>
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

/* ─── Tab: Models ─── */

interface ModelInfoUI {
  id: string
  name: string
  size: string
  description: string
  filename: string
}

interface LocalModelUI {
  id: string
  name: string
  filename: string
  size: number
  downloaded: boolean
}

function ModelsTab({
  s,
  theme
}: {
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const [models, setModels] = useState<ModelInfoUI[]>([])
  const [localModels, setLocalModels] = useState<LocalModelUI[]>([])
  const [downloading, setDownloading] = useState<Record<string, number>>({})
  const [customUrl, setCustomUrl] = useState('')
  const [customFilename, setCustomFilename] = useState('')
  const [serverStatus, setServerStatus] = useState<{ status: string; model: string | null; port: number; error?: string; platform: string }>({ status: 'stopped', model: null, port: 8178, platform: 'win32' })
  const [serverStarting, setServerStarting] = useState(false)

  const refreshModels = useCallback(async () => {
    const [available, local, srvStatus] = await Promise.all([
      window.api.models.available(),
      window.api.models.local(),
      window.api.server.status()
    ])
    setModels(available)
    setLocalModels(local)
    setServerStatus(srvStatus)
  }, [])

  useEffect(() => {
    refreshModels()
  }, [refreshModels])

  useEffect(() => {
    const unsub = window.api.server.onStatusChanged((status) => {
      setServerStatus(status)
      setServerStarting(false)
    })
    return unsub
  }, [])

  useEffect(() => {
    const unsub = window.api.models.onDownloadProgress((progress) => {
      setDownloading((prev) => ({
        ...prev,
        [progress.modelId]: progress.percent
      }))
      if (progress.percent >= 100) {
        setTimeout(() => {
          setDownloading((prev) => {
            const next = { ...prev }
            delete next[progress.modelId]
            return next
          })
          refreshModels()
        }, 500)
      }
    })
    return unsub
  }, [refreshModels])

  const handleDownload = useCallback(async (modelId: string) => {
    setDownloading((prev) => ({ ...prev, [modelId]: 0 }))
    try {
      await window.api.models.download(modelId)
    } catch (err) {
      setDownloading((prev) => {
        const next = { ...prev }
        delete next[modelId]
        return next
      })
    }
  }, [])

  const handleDelete = useCallback(async (modelId: string) => {
    await window.api.models.delete(modelId)
    refreshModels()
  }, [refreshModels])

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

  const isDownloaded = (modelId: string): boolean =>
    localModels.some((m) => m.id === modelId && m.downloaded)

  const downloadedModels = localModels.filter((m) => m.downloaded)
  const customModels = localModels.filter((m) => m.id.startsWith('custom:'))

  const formatSize = (bytes: number): string => {
    if (bytes > 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
    if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`
    return `${(bytes / 1_000).toFixed(0)} KB`
  }

  return (
    <>
      <div style={s.card}>
        <h3 style={s.cardTitle}>Whisper Models (GGML)</h3>
        <span style={s.hint}>
          Download models for local/offline transcription. Use with whisper.cpp, faster-whisper, or any compatible server.
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
          {models.map((model) => {
            const downloaded = isDownloaded(model.id)
            const progress = downloading[model.id]
            const isActive = progress !== undefined

            return (
              <div
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: theme.inputBg,
                  border: `1px solid ${downloaded ? theme.accent + '40' : theme.inputBorder}`,
                  gap: '12px'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>
                    {model.name}
                    <span style={{ fontWeight: 400, color: theme.textMuted, marginLeft: '8px' }}>
                      {model.size}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: theme.textMuted, marginTop: '2px' }}>
                    {model.description}
                  </div>
                  {isActive && (
                    <div style={{
                      marginTop: '6px',
                      height: '4px',
                      borderRadius: '2px',
                      background: theme.bgTertiary,
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${progress}%`,
                        background: theme.accent,
                        borderRadius: '2px',
                        transition: 'width 0.3s'
                      }} />
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0 }}>
                  {downloaded ? (
                    <button
                      onClick={() => handleDelete(model.id)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${theme.border}`,
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        color: theme.textMuted,
                        cursor: 'pointer',
                        fontFamily: 'IBM Plex Sans, sans-serif'
                      }}
                    >
                      Delete
                    </button>
                  ) : isActive ? (
                    <span style={{ fontSize: '12px', color: theme.accent, fontWeight: 500 }}>
                      {progress}%
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDownload(model.id)}
                      style={{
                        background: theme.accent,
                        border: 'none',
                        borderRadius: '6px',
                        padding: '6px 14px',
                        fontSize: '12px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontFamily: 'IBM Plex Sans, sans-serif'
                      }}
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Local Server</h3>
        {serverStatus.platform !== 'win32' ? (
          <>
            <span style={s.hint}>
              Auto-start is available on Windows. On macOS/Linux, install and run the server manually:
            </span>
            <div style={{
              marginTop: '8px',
              padding: '10px 14px',
              borderRadius: '8px',
              background: theme.inputBg,
              border: `1px solid ${theme.inputBorder}`,
              fontSize: '12px',
              fontFamily: 'monospace',
              color: theme.textMuted,
              lineHeight: '1.6'
            }}>
              {serverStatus.platform === 'darwin' ? (
                <>brew install whisper-cpp<br/>whisper-server -m ~/.whisperio/models/MODEL.bin --port 8178</>
              ) : (
                <>sudo apt install whisper.cpp<br/>whisper-server -m ~/.whisperio/models/MODEL.bin --port 8178</>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: serverStatus.status === 'running' ? '#22c55e' : serverStatus.status === 'starting' ? theme.accent : serverStatus.status === 'error' ? '#ef4444' : theme.textMuted,
                boxShadow: serverStatus.status === 'running' ? '0 0 8px rgba(34,197,94,0.5)' : 'none',
                flexShrink: 0
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                  {serverStatus.status === 'running' ? `Running on port ${serverStatus.port}` :
                   serverStatus.status === 'starting' ? 'Starting...' :
                   serverStatus.status === 'error' ? 'Error' : 'Stopped'}
                </div>
                {serverStatus.model && (
                  <div style={{ fontSize: '11px', color: theme.textMuted }}>Model: {serverStatus.model}</div>
                )}
                {serverStatus.error && (
                  <div style={{ fontSize: '11px', color: '#ef4444' }}>{serverStatus.error}</div>
                )}
              </div>

              {serverStatus.status === 'running' ? (
                <button
                  onClick={async () => {
                    await window.api.server.stop()
                    refreshModels()
                  }}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '6px',
                    padding: '6px 14px',
                    fontSize: '12px',
                    color: '#ef4444',
                    cursor: 'pointer',
                    fontWeight: 500,
                    fontFamily: 'IBM Plex Sans, sans-serif'
                  }}
                >Stop</button>
              ) : (
                <select
                  disabled={serverStarting || downloadedModels.length === 0}
                  onChange={async (e) => {
                    if (!e.target.value) return
                    setServerStarting(true)
                    try {
                      await window.api.server.start(e.target.value)
                      // Auto-configure: set URL, model, and enable selfhosted in provider chain
                      const modelName = e.target.value.replace('.bin', '')
                      const currentSettings = await window.api.settings.load()
                      const chain = currentSettings.providerChain || ['openai']
                      if (!chain.includes('selfhosted')) chain.push('selfhosted')
                      await window.api.settings.save({
                        openaiBaseUrl: `http://127.0.0.1:${serverStatus.port}`,
                        whisperModel: modelName,
                        providerChain: chain
                      })
                    } catch {
                      setServerStarting(false)
                    }
                    refreshModels()
                    e.target.value = ''
                  }}
                  style={{
                    ...s.select,
                    width: 'auto',
                    padding: '6px 12px',
                    fontSize: '12px',
                    opacity: downloadedModels.length === 0 ? 0.5 : 1
                  }}
                >
                  <option value="">{serverStarting ? 'Starting...' : 'Start with model...'}</option>
                  {downloadedModels.map((m) => (
                    <option key={m.filename} value={m.filename}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>
            {downloadedModels.length === 0 && (
              <span style={{ ...s.hint, marginTop: '8px', display: 'block' }}>
                Download a model above first, then start the local server.
              </span>
            )}
          </>
        )}
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Custom Model from HuggingFace</h3>
        <span style={s.hint}>
          Paste a direct URL to any GGML .bin model file from HuggingFace or other source.
        </span>
        <label style={{ ...s.label, marginTop: '8px' }}>Model URL</label>
        <input
          type="text"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          placeholder="https://huggingface.co/user/repo/resolve/main/model.bin"
          style={s.input}
        />
        <label style={{ ...s.label, marginTop: '8px' }}>Filename (optional)</label>
        <input
          type="text"
          value={customFilename}
          onChange={(e) => setCustomFilename(e.target.value)}
          placeholder="Auto-detected from URL"
          style={s.input}
        />
        <button
          onClick={handleCustomDownload}
          disabled={!customUrl.trim()}
          style={{
            ...s.button as React.CSSProperties,
            marginTop: '12px',
            opacity: customUrl.trim() ? 1 : 0.5,
            alignSelf: 'flex-start',
            padding: '8px 20px',
            fontSize: '13px'
          }}
        >
          Download Model
        </button>
      </div>

      {customModels.length > 0 && (
        <div style={s.card}>
          <h3 style={s.cardTitle}>Custom Models</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {customModels.map((model) => (
              <div
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: theme.inputBg,
                  border: `1px solid ${theme.inputBorder}`
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                    {model.filename}
                  </div>
                  <div style={{ fontSize: '11px', color: theme.textMuted }}>
                    {formatSize(model.size)}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(model.filename)}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    color: theme.textMuted,
                    cursor: 'pointer',
                    fontFamily: 'IBM Plex Sans, sans-serif'
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ─── Tab: Hotkeys ─── */

type HotkeyField = 'dictation' | 'send' | 'output'

function HotkeyInput({
  label,
  value,
  placeholder,
  isRecording,
  liveKeys,
  onStartRecording,
  onClear,
  s,
  theme
}: {
  label: string
  value: string
  placeholder: string
  isRecording: boolean
  liveKeys: string
  onStartRecording: () => void
  onClear: () => void
  s: ReturnType<typeof makeStyles>
  theme: Theme
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)

  const recordingStyle: React.CSSProperties = isRecording
    ? {
        border: `2px solid ${theme.accent}`,
        boxShadow: `0 0 8px ${theme.accentGlow}`,
        padding: '9px 13px'
      }
    : {}

  const displayValue = isRecording
    ? (liveKeys || 'Press keys...')
    : value

  return (
    <div>
      <label style={label === 'Dictation Hotkey' ? s.label : { ...s.label, marginTop: '16px' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={displayValue}
          placeholder={placeholder}
          onClick={onStartRecording}
          onFocus={onStartRecording}
          style={{
            ...s.input,
            cursor: 'pointer',
            caretColor: 'transparent',
            ...recordingStyle
          }}
        />
        {value && !isRecording && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            style={{
              background: theme.bgTertiary,
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              width: '32px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: theme.textMuted,
              fontSize: '16px',
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
            x
          </button>
        )}
      </div>
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
        <h3 style={s.cardTitle}>Keyboard Shortcuts</h3>

        <HotkeyInput
          label="Dictation Hotkey"
          value={dictationHotkey}
          placeholder="Ctrl+Shift+Space (default)"
          isRecording={recordingField === 'dictation'}
          liveKeys={recordingField === 'dictation' ? liveKeys : ''}
          onStartRecording={() => startRecording('dictation')}
          onClear={() => setDictationHotkey('')}
          s={s}
          theme={theme}
        />

        <HotkeyInput
          label="Dictate & Send Hotkey"
          value={dictateAndSendHotkey}
          placeholder="Not set"
          isRecording={recordingField === 'send'}
          liveKeys={recordingField === 'send' ? liveKeys : ''}
          onStartRecording={() => startRecording('send')}
          onClear={() => setDictateAndSendHotkey('')}
          s={s}
          theme={theme}
        />

        <HotkeyInput
          label="Output Recording Hotkey"
          value={outputRecordingHotkey}
          placeholder="Not set"
          isRecording={recordingField === 'output'}
          liveKeys={recordingField === 'output' ? liveKeys : ''}
          onStartRecording={() => startRecording('output')}
          onClear={() => setOutputRecordingHotkey('')}
          s={s}
          theme={theme}
        />

        <span style={{ ...s.hint, marginTop: '16px', display: 'block' }}>
          Click to record hotkey. Press and release keys to set. Escape to cancel.
        </span>
      </div>
    </>
  )
}

/* ─── Shared: Toggle Row ─── */

function ToggleRow({
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

/* ─── Rewrite tab (presets + categorization config) ─── */

// Derive the shapes from the preload typings so the UI stays in sync with the
// bridge without a cross-project import.
type RewritePreset = Awaited<ReturnType<Window['api']['presets']['list']>>[number]
type CategorizationConfig = Awaited<ReturnType<Window['api']['categorization']['get']>>

function smallButton(theme: Theme, variant: 'solid' | 'ghost' | 'danger' = 'solid'): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: '7px',
    padding: '7px 13px',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'IBM Plex Sans, sans-serif',
    transition: 'all 0.15s'
  }
  if (variant === 'solid') return { ...base, background: theme.accent, color: '#fff', border: 'none' }
  if (variant === 'danger')
    return { ...base, background: 'transparent', color: theme.danger, border: `1px solid ${theme.danger}55` }
  return { ...base, background: 'transparent', color: theme.textSecondary, border: `1px solid ${theme.inputBorder}` }
}

function RewriteTab({ s, theme }: { s: ReturnType<typeof makeStyles>; theme: Theme }): ReactElement {
  const [presets, setPresets] = useState<RewritePreset[]>([])
  const [defaultPresetId, setDefaultPresetId] = useState<string>('')
  const [config, setConfig] = useState<CategorizationConfig | null>(null)
  const [catPrompt, setCatPrompt] = useState('')
  const [status, setStatus] = useState('')

  const reloadPresets = useCallback(async () => {
    setPresets(await window.api.presets.list())
  }, [])

  useEffect(() => {
    reloadPresets()
    window.api.settings.load().then((st) => setDefaultPresetId(st.defaultRewritePresetId ?? ''))
    window.api.categorization.get().then((c) => {
      setConfig(c)
      setCatPrompt(c.systemPrompt)
    })
  }, [reloadPresets])

  const flash = (msg: string): void => {
    setStatus(msg)
    setTimeout(() => setStatus(''), 2000)
  }

  return (
    <>
      <div style={s.card}>
        <h3 style={s.cardTitle}>Rewrite presets</h3>
        <p style={s.hint}>
          The transcript rewrite / post-processing prompt. Pick the default used after dictation, delete the
          built-ins you don&apos;t want (they can always be restored), and the picker in the rewrite flow uses
          the same list.
        </p>

        <label style={{ ...s.label, marginTop: '8px' }}>Default rewrite preset</label>
        <select
          value={defaultPresetId}
          onChange={async (e) => {
            const id = e.target.value
            setDefaultPresetId(id)
            await window.api.settings.save({ defaultRewritePresetId: id })
            flash('Saved')
          }}
          style={s.select}
        >
          <option value="">Fix technical terms (default)</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
          {presets.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '9px 12px',
                background: theme.inputBg,
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '8px'
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>{p.name}</div>
                <div
                  style={{
                    fontSize: '11.5px',
                    color: theme.textMuted,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '340px'
                  }}
                >
                  {p.prompt}
                </div>
              </div>
              <button
                onClick={async () => {
                  await window.api.presets.delete(p.id)
                  await reloadPresets()
                }}
                style={smallButton(theme, 'danger')}
              >
                {p.isSeed ? 'Hide' : 'Delete'}
              </button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '10px' }}>
          <button
            onClick={async () => {
              await window.api.presets.restoreDefaults()
              await reloadPresets()
              flash('Defaults restored')
            }}
            style={smallButton(theme, 'ghost')}
          >
            Restore defaults
          </button>
        </div>
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Categorization prompt</h3>
        <p style={s.hint}>
          The system prompt used to categorize a note. Editable here rather than hardcoded; categories:{' '}
          {config?.categories.map((c) => c.id).join(', ')}.
        </p>
        <textarea
          value={catPrompt}
          onChange={(e) => setCatPrompt(e.target.value)}
          style={{ ...s.textarea, minHeight: '90px' }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={async () => {
              const saved = await window.api.categorization.save({
                systemPrompt: catPrompt,
                categories: config?.categories ?? []
              })
              setConfig(saved)
              setCatPrompt(saved.systemPrompt)
              flash('Saved')
            }}
            style={smallButton(theme, 'solid')}
          >
            Save prompt
          </button>
          <button
            onClick={async () => {
              const reset = await window.api.categorization.reset()
              setConfig(reset)
              setCatPrompt(reset.systemPrompt)
              flash('Reset to default')
            }}
            style={smallButton(theme, 'ghost')}
          >
            Reset to default
          </button>
          {status && (
            <span style={{ alignSelf: 'center', fontSize: '12px', color: theme.success, fontWeight: 600 }}>
              {status}
            </span>
          )}
        </div>
      </div>
    </>
  )
}

/* ─── GitHub tab (connect + encrypted secret store) ─── */

type GitHubStatus = Awaited<ReturnType<Window['api']['github']['status']>>
type GitHubRepo = Awaited<ReturnType<Window['api']['github']['listRepos']>>[number]
type GitHubDeviceCode = Awaited<ReturnType<Window['api']['github']['startDeviceFlow']>>

function GitHubTab({ s, theme }: { s: ReturnType<typeof makeStyles>; theme: Theme }): ReactElement {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [pat, setPat] = useState('')
  const [device, setDevice] = useState<GitHubDeviceCode | null>(null)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [secrets, setSecrets] = useState<string[]>([])
  const [newSecretName, setNewSecretName] = useState('')
  const [newSecretValue, setNewSecretValue] = useState('')
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const st = await window.api.github.status()
    setStatus(st)
    if (st.connected && st.connection) {
      try {
        setSecrets(await window.api.github.secretList())
      } catch {
        setSecrets([])
      }
    }
  }, [])

  useEffect(() => {
    refresh()
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [refresh])

  const say = (m: string): void => {
    setMessage(m)
  }

  const startDeviceFlow = async (): Promise<void> => {
    setBusy(true)
    say('')
    try {
      const code = await window.api.github.startDeviceFlow()
      setDevice(code)
      // Poll until the user authorizes (or it expires).
      const poll = async (): Promise<void> => {
        try {
          const result = await window.api.github.pollDeviceFlow(code.deviceCode)
          if (result.status === 'success') {
            setDevice(null)
            setBusy(false)
            say('Connected to GitHub')
            await refresh()
            return
          }
          if (result.status === 'expired_token' || result.status === 'access_denied') {
            setDevice(null)
            setBusy(false)
            say(result.status === 'expired_token' ? 'Code expired — try again' : 'Access denied')
            return
          }
          const delay = (result.status === 'slow_down' ? result.interval : code.interval) * 1000
          pollRef.current = setTimeout(poll, delay)
        } catch (err) {
          setBusy(false)
          say(err instanceof Error ? err.message : 'Device flow failed')
        }
      }
      pollRef.current = setTimeout(poll, code.interval * 1000)
    } catch (err) {
      setBusy(false)
      say(err instanceof Error ? err.message : 'Could not start device flow')
    }
  }

  const connectPat = async (): Promise<void> => {
    setBusy(true)
    say('')
    try {
      await window.api.github.pastePat(pat.trim())
      setPat('')
      say('Connected to GitHub')
      await refresh()
    } catch (err) {
      say(err instanceof Error ? err.message : 'Token rejected')
    } finally {
      setBusy(false)
    }
  }

  const loadRepos = async (): Promise<void> => {
    setBusy(true)
    try {
      setRepos(await window.api.github.listRepos())
    } catch (err) {
      say(err instanceof Error ? err.message : 'Could not list repos')
    } finally {
      setBusy(false)
    }
  }

  const connection = status?.connection ?? null

  return (
    <>
      <div style={s.card}>
        <h3 style={s.cardTitle}>GitHub secret store</h3>
        <p style={s.hint}>
          Connect a GitHub account and pick a repository to hold your app secrets. Secrets are encrypted on
          this device (AES-256-GCM) before they leave the app — only the ciphertext is committed; the key
          stays in the OS keychain and is never uploaded.
        </p>

        {status && !status.secretStorageAvailable && (
          <div
            style={{
              marginTop: '8px',
              padding: '9px 12px',
              borderRadius: '8px',
              background: `${theme.danger}14`,
              border: `1px solid ${theme.danger}44`,
              fontSize: '12px',
              color: theme.danger
            }}
          >
            OS secure storage (Keychain / DPAPI) is unavailable on this machine, so secrets can&apos;t be
            encrypted safely. Secret sync is disabled.
          </div>
        )}

        {!status?.connected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
            {status?.hasClientId && (
              <div>
                <button onClick={startDeviceFlow} disabled={busy} style={smallButton(theme, 'solid')}>
                  Connect with GitHub (device flow)
                </button>
                {device && (
                  <div style={{ marginTop: '8px', fontSize: '12.5px', color: theme.text }}>
                    Enter code{' '}
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: theme.accent }}>
                      {device.userCode}
                    </span>{' '}
                    at{' '}
                    <span style={{ fontFamily: 'monospace' }}>{device.verificationUri}</span> (opened in your
                    browser). Waiting for authorization…
                  </div>
                )}
              </div>
            )}

            <div>
              <label style={s.label}>
                {status?.hasClientId ? 'Or paste a Personal Access Token' : 'Paste a Personal Access Token'}
              </label>
              <p style={s.hint}>Needs the classic `repo` scope (or fine-grained Contents: read/write).</p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_..."
                  style={{ ...s.input, flex: 1 }}
                />
                <button onClick={connectPat} disabled={busy || !pat.trim()} style={smallButton(theme, 'solid')}>
                  Connect
                </button>
              </div>
            </div>
          </div>
        )}

        {status?.connected && !connection && (
          <div style={{ marginTop: '8px' }}>
            <p style={s.hint}>Connected. Choose the repository to store secrets in.</p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button onClick={loadRepos} disabled={busy} style={smallButton(theme, 'ghost')}>
                {busy ? 'Loading…' : 'Load my repositories'}
              </button>
              <button
                onClick={async () => {
                  await window.api.github.disconnect()
                  await refresh()
                }}
                style={smallButton(theme, 'danger')}
              >
                Disconnect
              </button>
            </div>
            {repos.length > 0 && (
              <select
                onChange={async (e) => {
                  const repo = repos.find((r) => r.fullName === e.target.value)
                  if (!repo) return
                  await window.api.github.selectRepo({ ...repo, login: repo.owner })
                  await refresh()
                }}
                defaultValue=""
                style={{ ...s.select, marginTop: '8px' }}
              >
                <option value="" disabled>
                  Select a repository…
                </option>
                {repos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName}
                    {r.private ? ' (private)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {status?.connected && connection && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '13px', color: theme.text }}>
              Repository:{' '}
              <span style={{ fontWeight: 600 }}>
                {connection.owner}/{connection.repo}
              </span>{' '}
              <span style={{ color: theme.textMuted }}>({connection.defaultBranch})</span>
            </div>
            <div style={{ fontSize: '11.5px', color: theme.textMuted, marginTop: '2px' }}>
              Secrets file: {connection.secretsPath}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={async () => {
                  try {
                    const r = await window.api.github.testConnection()
                    say(`Access OK — ${r.fullName}`)
                  } catch (err) {
                    say(err instanceof Error ? err.message : 'Test failed')
                  }
                }}
                style={smallButton(theme, 'ghost')}
              >
                Test connection
              </button>
              <button
                onClick={async () => {
                  await window.api.github.disconnect()
                  setRepos([])
                  await refresh()
                }}
                style={smallButton(theme, 'danger')}
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {message && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: theme.textSecondary }}>{message}</div>
        )}
      </div>

      {status?.connected && connection && (
        <div style={s.card}>
          <h3 style={s.cardTitle}>Stored secrets</h3>
          <p style={s.hint}>Names are shown; values stay encrypted in the repo and are never displayed here.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
            {secrets.length === 0 && (
              <div style={{ fontSize: '12.5px', color: theme.textMuted }}>No secrets stored yet.</div>
            )}
            {secrets.map((name) => (
              <div
                key={name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: theme.inputBg,
                  border: `1px solid ${theme.inputBorder}`,
                  borderRadius: '8px'
                }}
              >
                <span style={{ fontFamily: 'monospace', fontSize: '12.5px', color: theme.text }}>{name}</span>
                <button
                  onClick={async () => {
                    await window.api.github.secretDelete(name)
                    setSecrets(await window.api.github.secretList())
                  }}
                  style={smallButton(theme, 'danger')}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <label style={{ ...s.label, marginTop: '10px' }}>Add / update a secret</label>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <input
              type="text"
              value={newSecretName}
              onChange={(e) => setNewSecretName(e.target.value)}
              placeholder="NAME"
              style={{ ...s.input, flex: 1 }}
            />
            <input
              type="password"
              value={newSecretValue}
              onChange={(e) => setNewSecretValue(e.target.value)}
              placeholder="value"
              style={{ ...s.input, flex: 1 }}
            />
            <button
              disabled={busy || !newSecretName.trim() || !newSecretValue}
              onClick={async () => {
                setBusy(true)
                try {
                  await window.api.github.secretSet(newSecretName.trim(), newSecretValue)
                  setNewSecretName('')
                  setNewSecretValue('')
                  setSecrets(await window.api.github.secretList())
                  say('Secret saved')
                } catch (err) {
                  say(err instanceof Error ? err.message : 'Could not save secret')
                } finally {
                  setBusy(false)
                }
              }}
              style={smallButton(theme, 'solid')}
            >
              Save
            </button>
          </div>
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
      gap: '30px'
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto' as const,
      overflowX: 'hidden' as const
    },
    sidebar: {
      width: '184px',
      flexShrink: 0,
      borderRight: `1px solid ${theme.border}`,
      padding: '14px 12px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '3px',
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
      gap: '11px',
      width: '100%',
      textAlign: 'left' as const,
      cursor: 'pointer',
      border: 'none',
      borderRadius: '9px',
      padding: '9px 11px',
      fontFamily: "'IBM Plex Sans', sans-serif",
      fontSize: '13.5px',
      fontWeight: 600,
      background: 'transparent',
      color: theme.textSecondary,
      transition: 'background 0.15s, color 0.15s'
    } as React.CSSProperties,
    navItemActive: {
      background: `${theme.accent}14`,
      color: theme.text,
      boxShadow: `inset 3px 0 0 ${theme.accent}`
    } as React.CSSProperties,
    versionBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 11px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10.5px',
      color: theme.textMuted
    } as React.CSSProperties,
    card: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '10px',
      paddingBottom: '4px'
    },
    cardTitle: {
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize: '14px',
      fontWeight: 600,
      color: theme.text,
      marginBottom: '4px',
      letterSpacing: '0.01em'
    },
    label: {
      fontSize: '12px',
      fontWeight: 500,
      color: theme.textSecondary,
      marginTop: '4px'
    },
    input: {
      background: theme.inputBg,
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '14px',
      color: theme.text,
      outline: 'none',
      fontFamily: 'IBM Plex Sans, sans-serif',
      width: '100%',
      transition: 'border-color 0.15s'
    } as React.CSSProperties,
    textarea: {
      background: theme.inputBg,
      border: `1px solid ${theme.inputBorder}`,
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '14px',
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
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '14px',
      color: theme.text,
      outline: 'none',
      fontFamily: 'IBM Plex Sans, sans-serif',
      width: '100%',
      cursor: 'pointer',
      transition: 'border-color 0.15s'
    } as React.CSSProperties,
    hint: {
      fontSize: '11px',
      color: theme.textMuted,
      lineHeight: '1.4'
    },
    saveBar: {
      padding: '14px 26px',
      borderTop: `1px solid ${theme.border}`,
      background: theme.bg,
      flexShrink: 0,
      display: 'flex',
      justifyContent: 'flex-start'
    },
    button: {
      background: theme.accent,
      color: theme.accentInk,
      border: 'none',
      borderRadius: '8px',
      padding: '10px 28px',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: "'IBM Plex Sans', sans-serif",
      transition: 'background 0.2s, box-shadow 0.2s'
    } as React.CSSProperties
  }
}
