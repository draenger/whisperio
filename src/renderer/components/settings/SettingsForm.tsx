import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import { useTheme } from '../../ThemeContext'
import { TitleBar } from '../common/TitleBar'
import type { Theme } from '../../theme'

type TabId = 'general' | 'providers' | 'models' | 'audio' | 'hotkeys'

interface MediaDeviceOption {
  deviceId: string
  label: string
}

export function SettingsForm(): ReactElement {
  const { theme } = useTheme()

  // --- State ---
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)

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
    { id: 'audio', label: 'Audio' },
    { id: 'hotkeys', label: 'Hotkeys' }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
      <TitleBar title="Whisperio Settings" />

      {/* Tab bar */}
      <div style={s.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...s.tabButton,
              ...(activeTab === tab.id ? s.tabButtonActive : {})
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.color = theme.text
                e.currentTarget.style.background = theme.bgTertiary
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.color = theme.textMuted
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
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
        </div>
      </div>

      {/* Save bar */}
      <div style={s.saveBar}>
        <button
          onClick={handleSave}
          style={s.button}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.accentHover
            e.currentTarget.style.boxShadow = `0 0 20px ${theme.accentGlow}`
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = theme.accent
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
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
  const { mode, toggleTheme } = useThemeHook()

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
          flex: 1, padding: '6px', fontSize: '11px', fontWeight: 600, fontFamily: 'Inter, sans-serif',
          background: mode === 'managed' ? theme.accent : theme.bgTertiary,
          color: mode === 'managed' ? '#fff' : theme.textMuted,
          border: `1px solid ${mode === 'managed' ? theme.accent : theme.border}`,
          borderRadius: '5px 0 0 5px', cursor: 'pointer'
        }}>Whisperio Server</button>
        <button onClick={() => setMode('manual')} style={{
          flex: 1, padding: '6px', fontSize: '11px', fontWeight: 600, fontFamily: 'Inter, sans-serif',
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
                  style={{ background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: '#ef4444', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Stop</button>
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
                      style={{ background: 'transparent', border: 'none', fontSize: '10px', color: theme.textMuted, cursor: 'pointer', fontFamily: 'Inter, sans-serif', padding: '2px 6px' }}>Remove</button>
                  ) : isActive ? (
                    <span style={{ fontSize: '10px', color: theme.accent }}>{progress}%</span>
                  ) : (
                    <button onClick={() => { setDownloading((p) => ({ ...p, [model.id]: 0 })); window.api.models.download(model.id) }}
                      style={{ background: theme.accent, border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', color: '#fff', cursor: 'pointer', fontWeight: 500, fontFamily: 'Inter, sans-serif' }}>Get</button>
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
                        style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? theme.border : theme.textMuted, fontSize: '9px', padding: '2px 3px', fontFamily: 'Inter, sans-serif' }}>▲</button>
                      <button onClick={() => moveProvider(provider.id, 1)} disabled={idx === providerChain.length - 1}
                        style={{ background: 'transparent', border: 'none', cursor: idx === providerChain.length - 1 ? 'default' : 'pointer', color: idx === providerChain.length - 1 ? theme.border : theme.textMuted, fontSize: '9px', padding: '2px 3px', fontFamily: 'Inter, sans-serif' }}>▼</button>
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
                      color: enabled ? '#fff' : theme.textMuted, cursor: 'pointer', fontFamily: 'Inter, sans-serif', flexShrink: 0
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
              fontFamily: 'Inter, sans-serif',
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
                        fontFamily: 'Inter, sans-serif'
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
                        fontFamily: 'Inter, sans-serif'
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
                    fontFamily: 'Inter, sans-serif'
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
                    fontFamily: 'Inter, sans-serif'
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
              fontFamily: 'Inter, sans-serif',
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

/* ─── Styles ─── */

function makeStyles(theme: Theme) {
  return {
    container: {
      padding: '20px 24px 24px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '16px'
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto' as const,
      overflowX: 'hidden' as const
    },
    tabBar: {
      display: 'flex',
      gap: '4px',
      padding: '12px 24px 0',
      borderBottom: `1px solid ${theme.border}`,
      background: theme.bg,
      flexShrink: 0
    },
    tabButton: {
      background: 'transparent',
      border: 'none',
      borderBottom: '2px solid transparent',
      padding: '8px 16px 10px',
      fontSize: '13px',
      fontWeight: 500,
      color: theme.textMuted,
      cursor: 'pointer',
      fontFamily: 'Inter, sans-serif',
      borderRadius: '8px 8px 0 0',
      transition: 'color 0.15s, background 0.15s'
    } as React.CSSProperties,
    tabButtonActive: {
      color: theme.accent,
      borderBottomColor: theme.accent,
      background: theme.bgSecondary,
      boxShadow: `0 1px 6px ${theme.accentGlow}`
    } as React.CSSProperties,
    card: {
      background: theme.bgSecondary,
      border: `1px solid ${theme.border}`,
      borderRadius: '12px',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '8px'
    },
    cardTitle: {
      fontSize: '14px',
      fontWeight: 600,
      color: theme.text,
      marginBottom: '4px',
      letterSpacing: '0.2px'
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
      fontFamily: 'Inter, sans-serif',
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
      fontFamily: 'Inter, sans-serif',
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
      fontFamily: 'Inter, sans-serif',
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
      padding: '12px 24px',
      borderTop: `1px solid ${theme.border}`,
      background: theme.bg,
      flexShrink: 0,
      display: 'flex',
      justifyContent: 'flex-end'
    },
    button: {
      background: theme.accent,
      color: '#ffffff',
      border: 'none',
      borderRadius: '8px',
      padding: '10px 28px',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'Inter, sans-serif',
      transition: 'background 0.2s, box-shadow 0.2s'
    } as React.CSSProperties
  }
}
