/* Whisperio — settings tab content. Shared by both designs; `red` gates the few structural
   UX changes (provider expand pattern, autosave affordance). Content ported 1:1 from SettingsForm.tsx. */

const INPUT_DEVICES = [
  { deviceId: '', label: 'System Default' },
  { deviceId: 'mbp', label: 'MacBook Pro Microphone' },
  { deviceId: 'airpods', label: 'AirPods Pro' },
  { deviceId: 'yeti', label: 'Blue Yeti' },
];
const OUTPUT_DEVICES = [
  { deviceId: '', label: 'System Default' },
  { deviceId: 'blackhole', label: 'BlackHole 2ch' },
  { deviceId: 'mbpspk', label: 'MacBook Pro Speakers' },
];

/* ─── General ─── */
function GeneralTab({ state, set, s, theme, design, mode, toggleTheme, accent, setAccent }) {
  const red = design.mode === 'redesign';
  return (
    <>
      <Section title="Startup" s={s} theme={theme} design={design}>
        <ToggleRow label={red ? 'Launch at login' : 'Launch at Windows startup'}
          description="Automatically start Whisperio when you log in"
          checked={state.launchAtStartup} onChange={(v) => set({ launchAtStartup: v })} theme={theme} design={design} />
      </Section>

      <Section title="Appearance" s={s} theme={theme} design={design}>
        <ToggleRow label="Dark theme"
          description={mode === 'dark' ? 'Currently using dark theme' : 'Currently using light theme'}
          checked={mode === 'dark'} onChange={toggleTheme} theme={theme} design={design} />
        {!red && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 16, marginTop: 14, borderTop: `1px solid ${theme.border}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>Accent color</div>
              <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>{WZ_ACCENT_LABELS[accent]}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {WZ_ACCENT_ORDER.map((key) => (
                <button key={key} onClick={() => setAccent(key)} title={WZ_ACCENT_LABELS[key]} aria-label={WZ_ACCENT_LABELS[key]}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.12)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  style={{
                    width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', padding: 0, background: WZ_ACCENTS[key].base,
                    border: `2px solid ${accent === key ? theme.text : 'transparent'}`,
                    boxShadow: accent === key ? `0 0 0 2px ${theme.bg}, 0 0 0 3px ${WZ_ACCENTS[key].base}` : 'none',
                    transition: 'transform .15s, border-color .15s',
                  }} />
              ))}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

/* ─── Providers ─── */
function ProviderExpanded({ id, state, set, s, theme, design }) {
  if (id === 'openai') {
    return (
      <>
        <label style={s.label}>API Key</label>
        <input type="password" value={state.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-..." style={s.input} />
        <label style={{ ...s.label, marginTop: 8 }}>Transcription Prompt</label>
        <textarea value={state.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={2} style={s.textarea} placeholder="Optional — guide the model's output style" />
        <ToggleRow label="AI vocabulary correction" description="LLM pass to fix technical terms after transcription"
          checked={state.aiPostProcessing} onChange={(v) => set({ aiPostProcessing: v })} theme={theme} design={design} />
      </>
    );
  }
  if (id === 'elevenlabs') {
    return (<><label style={s.label}>API Key</label>
      <input type="password" value={state.elevenlabsApiKey} onChange={(e) => set({ elevenlabsApiKey: e.target.value })} placeholder="xi-..." style={s.input} /></>);
  }
  if (id === 'groq' || id === 'deepgram' || id === 'assembly' || id === 'mistral' || id === 'replicate') {
    const ph = { groq: 'gsk_...', deepgram: 'dg_...', assembly: 'aai_...', mistral: 'api key...', replicate: 'r8_...' }[id];
    return (<><label style={s.label}>API Key</label>
      <input type="password" value={state[id + 'ApiKey'] || ''} onChange={(e) => set({ [id + 'ApiKey']: e.target.value })} placeholder={ph} style={s.input} /></>);
  }
  return <SelfhostedSettings state={state} set={set} s={s} theme={theme} design={design} />;
}

function SelfhostedSettings({ state, set, s, theme, design }) {
  const [srvMode, setSrvMode] = React.useState('managed');
  const m = state.models;
  const srv = m.server;
  const downloadedList = MODEL_CATALOG.filter((x) => m.downloaded[x.id]);

  const getModel = (id) => {
    set({ models: { ...m, downloading: { ...m.downloading, [id]: 0 } } });
    let p = 0;
    const iv = setInterval(() => {
      p += 12 + Math.random() * 16;
      const cur = window.__wzModels || m;
      if (p >= 100) {
        clearInterval(iv);
        set((prev) => ({ models: { ...prev.models, downloaded: { ...prev.models.downloaded, [id]: true }, downloading: omit(prev.models.downloading, id) } }));
      } else {
        set((prev) => ({ models: { ...prev.models, downloading: { ...prev.models.downloading, [id]: Math.round(p) } } }));
      }
    }, 320);
  };
  const removeModel = (id) => set((prev) => ({ models: { ...prev.models, downloaded: omit(prev.models.downloaded, id) } }));

  return (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {[['managed', 'Whisperio Server'], ['manual', 'Custom Server']].map(([val, lab], i) => {
          const on = srvMode === val;
          return (
            <button key={val} onClick={() => setSrvMode(val)} style={{
              flex: 1, padding: 6, fontSize: 11, fontWeight: 600, fontFamily: FUI,
              background: on ? theme.accent : theme.bgTertiary, color: on ? theme.accentInk : theme.textMuted,
              border: `1px solid ${on ? theme.accent : theme.border}`, cursor: 'pointer',
              borderRadius: i === 0 ? '5px 0 0 5px' : '0 5px 5px 0',
            }}>{lab}</button>
          );
        })}
      </div>

      {srvMode === 'manual' ? (
        <>
          <label style={s.label}>Server URL</label>
          <input type="text" value={state.openaiBaseUrl} onChange={(e) => set({ openaiBaseUrl: e.target.value })} placeholder="http://localhost:8080/v1" style={s.input} />
          <span style={s.hint}>Any OpenAI-compatible STT server</span>
          <label style={{ ...s.label, marginTop: 8 }}>Model Name</label>
          <input type="text" value={state.whisperModel} onChange={(e) => set({ whisperModel: e.target.value })} placeholder="whisper-1" style={s.input} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: theme.bgTertiary }}>
            <StatusDot color={srv.status === 'running' ? '#22c55e' : theme.textMuted} glow={srv.status === 'running'} />
            <div style={{ flex: 1, fontSize: 12 }}>
              <span style={{ color: theme.text, fontWeight: 500 }}>{srv.status === 'running' ? `Running — port ${srv.port}` : 'Stopped'}</span>
              {srv.model && <span style={{ color: theme.textMuted, marginLeft: 6 }}>{srv.model}</span>}
            </div>
            {srv.status === 'running'
              ? <button onClick={() => set({ models: { ...m, server: { ...srv, status: 'stopped', model: null } } })}
                  style={{ background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, color: theme.danger, cursor: 'pointer', fontFamily: FUI }}>Stop</button>
              : <button onClick={() => downloadedList[0] && set({ models: { ...m, server: { ...srv, status: 'running', model: downloadedList[0].name } } })}
                  style={{ background: theme.accent, border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 10, color: theme.accentInk, cursor: 'pointer', fontFamily: FUI, fontWeight: 600 }}>Start…</button>}
          </div>

          <label style={s.label}>Models</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {MODEL_CATALOG.map((model) => {
              const down = !!m.downloaded[model.id];
              const prog = m.downloading[model.id];
              const active = prog !== undefined;
              return (
                <div key={model.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: theme.bgTertiary, border: `1px solid ${down ? theme.accent + '30' : 'transparent'}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: theme.text }}>{model.name}</span>
                    <span style={{ fontSize: 10, color: theme.textMuted, marginLeft: 6 }}>{model.size}</span>
                    {active && <div style={{ marginTop: 3, height: 3, borderRadius: 2, background: theme.border, overflow: 'hidden' }}><div style={{ height: '100%', width: prog + '%', background: theme.accent, transition: 'width .3s' }} /></div>}
                  </div>
                  {down ? <button onClick={() => removeModel(model.id)} style={{ background: 'transparent', border: 'none', fontSize: 10, color: theme.textMuted, cursor: 'pointer', fontFamily: FUI, padding: '2px 6px' }}>Remove</button>
                    : active ? <span style={{ fontSize: 10, color: theme.accent }}>{prog}%</span>
                      : <button onClick={() => getModel(model.id)} style={{ background: theme.accent, border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, color: theme.accentInk, cursor: 'pointer', fontWeight: 600, fontFamily: FUI }}>Get</button>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
function omit(obj, key) { const n = { ...obj }; delete n[key]; return n; }

function ProvidersTab({ state, set, s, theme, design }) {
  const red = design.mode === 'redesign';
  const [expanded, setExpanded] = React.useState(red ? null : 'selfhosted');
  const chain = state.providerChain;
  const setChain = (c) => set({ providerChain: c });

  const ordered = [
    ...chain.map((id) => PROVIDERS.find((p) => p.id === id)).filter(Boolean),
    ...PROVIDERS.filter((p) => !chain.includes(p.id)),
  ];
  const toggle = (id) => {
    if (chain.includes(id)) { if (chain.length <= 1) return; setChain(chain.filter((x) => x !== id)); if (expanded === id) setExpanded(null); }
    else setChain([...chain, id]);
  };
  const move = (id, dir) => {
    const i = chain.indexOf(id), j = i + dir;
    if (j < 0 || j >= chain.length) return;
    const n = [...chain]; n[i] = n[j]; n[j] = id; setChain(n);
  };

  return (
    <>
      <Section title="Provider Chain" hint="First = primary. If it fails, the next one kicks in. Reorder with the arrows." s={s} theme={theme} design={design}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {ordered.map((p) => {
            const on = chain.includes(p.id);
            const idx = chain.indexOf(p.id);
            const exp = expanded === p.id && on;
            const primary = on && idx === 0;
            return (
              <div key={p.id}>
                <div onClick={red && on ? () => setExpanded(exp ? null : p.id) : undefined} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderRadius: exp ? '8px 8px 0 0' : 8,
                  background: on ? (primary && red ? `rgba(${theme.accentRgb},0.06)` : theme.inputBg) : 'transparent',
                  border: `1px solid ${on ? (primary ? theme.accent + '55' : theme.inputBorder) : theme.border + '30'}`,
                  borderBottom: exp ? `1px solid ${theme.inputBorder}` : undefined,
                  opacity: on ? 1 : 0.45, transition: 'opacity .15s, background .15s',
                  cursor: red && on ? 'pointer' : 'default',
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, background: on ? (primary ? theme.accent : theme.bgTertiary) : 'transparent',
                    color: primary ? theme.accentInk : theme.textMuted,
                  }}>{on ? idx + 1 : '-'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{p.label}</span>
                    <span style={{ fontSize: 11, color: theme.textMuted, marginLeft: 8 }}>{p.desc}</span>
                    {primary && red && <span style={{ fontFamily: FM, fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: theme.accentLight, marginLeft: 8 }}>Primary</span>}
                  </div>
                  {on && chain.length > 1 && (
                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                      <button onClick={() => move(p.id, -1)} disabled={idx === 0} style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? theme.border : theme.textMuted, fontSize: 9, padding: '2px 3px', fontFamily: FUI }}>▲</button>
                      <button onClick={() => move(p.id, 1)} disabled={idx === chain.length - 1} style={{ background: 'transparent', border: 'none', cursor: idx === chain.length - 1 ? 'default' : 'pointer', color: idx === chain.length - 1 ? theme.border : theme.textMuted, fontSize: 9, padding: '2px 3px', fontFamily: FUI }}>▼</button>
                    </div>
                  )}
                  {on && (red
                    ? <span style={{ display: 'flex', color: exp ? theme.accent : theme.textMuted, transform: exp ? 'rotate(90deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}><Icon d={IC.chevRight} size={15} /></span>
                    : <button onClick={(e) => { e.stopPropagation(); setExpanded(exp ? null : p.id); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: exp ? theme.accent : theme.textMuted, padding: 4, borderRadius: 4, display: 'flex' }}><Icon d={IC.cog} size={14} /></button>)}
                  <button onClick={(e) => { e.stopPropagation(); toggle(p.id); }} style={{
                    background: on ? theme.accent : theme.bgTertiary, border: `1px solid ${on ? theme.accent : theme.border}`, borderRadius: 5,
                    padding: '3px 8px', fontSize: 10, fontWeight: 600, color: on ? theme.accentInk : theme.textMuted, cursor: 'pointer', fontFamily: FUI, flexShrink: 0,
                  }}>{on ? 'On' : 'Off'}</button>
                </div>
                {exp && (
                  <div style={{ padding: '12px 14px', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderTop: 'none', borderRadius: '0 0 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <ProviderExpanded id={p.id} state={state} set={set} s={s} theme={theme} design={design} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Language" hint="Expected language of speech. Auto-detect works but setting it explicitly improves accuracy." s={s} theme={theme} design={design}>
        <select value={state.transcriptionLanguage} onChange={(e) => set({ transcriptionLanguage: e.target.value })} style={s.select}>
          {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Section>

      <Section title="Vocabulary" s={s} theme={theme} design={design}>
        <label style={s.label}>Custom Vocabulary</label>
        <textarea value={state.vocabulary} onChange={(e) => set({ vocabulary: e.target.value })} rows={3} placeholder="git, GitHub, npm, TypeScript, React, Docker, kubectl..." style={s.textarea} />
        <span style={s.hint}>Comma-separated terms for better recognition across all providers.</span>
      </Section>
    </>
  );
}

/* ─── Audio ─── */
function AudioTab({ state, set, s, theme, design, onViewRecordings }) {
  return (
    <>
      <Section title="Input Device (Microphone)" s={s} theme={theme} design={design}>
        <select value={state.inputDeviceId} onChange={(e) => set({ inputDeviceId: e.target.value })} style={s.select}>
          {INPUT_DEVICES.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </Section>
      <Section title="Output Device (System Audio)" s={s} theme={theme} design={design}>
        <select value={state.outputDeviceId} onChange={(e) => set({ outputDeviceId: e.target.value })} style={s.select}>
          {OUTPUT_DEVICES.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </Section>
      <Section title="Recording" s={s} theme={theme} design={design}>
        <ToggleRow label="Save recordings to disk" description="Keep audio files for playback and reprocessing"
          checked={state.saveRecordings} onChange={(v) => set({ saveRecordings: v })} theme={theme} design={design} />
        <button onClick={onViewRecordings} onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.background = `${theme.accent}15`; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.background = 'transparent'; }}
          style={{ background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, color: theme.accent, cursor: 'pointer', fontFamily: FUI, fontWeight: 500, marginTop: 4, alignSelf: 'flex-start', transition: 'border-color .2s, background .2s' }}>
          {RECS.length} recordings saved — View all
        </button>
      </Section>
    </>
  );
}

/* ─── Hotkeys ─── */
function HotkeyRecorderField({ label, value, placeholder, onSet, onClear, s, theme, design, first }) {
  const red = design.mode === 'redesign';
  const [recording, setRecording] = React.useState(false);
  const [live, setLive] = React.useState('');

  React.useEffect(() => {
    if (!recording) return;
    const MOD = new Set(['Control', 'Alt', 'Shift', 'Meta']);
    const pressed = new Set();
    let best = '';
    const acc = (k) => {
      if (k === ' ') return 'Space';
      if (k.startsWith('Arrow')) return k.slice(5);
      if (/^F\d+$/.test(k)) return k;
      if (['Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(k)) return k;
      if (k.length === 1) return k.toUpperCase();
      return k;
    };
    const build = () => {
      const parts = [];
      if (pressed.has('Control')) parts.push('Ctrl');
      if (pressed.has('Alt')) parts.push('Alt');
      if (pressed.has('Shift')) parts.push('Shift');
      if (pressed.has('Meta')) parts.push('Meta');
      for (const k of pressed) if (!MOD.has(k)) parts.push(acc(k));
      return parts.join('+');
    };
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape' && pressed.size === 0) { finish(); return; }
      pressed.add(e.key); best = build(); setLive(best);
    };
    const up = (e) => {
      e.preventDefault(); e.stopPropagation();
      pressed.delete(e.key);
      if (pressed.size === 0 && best) finish(best);
    };
    function finish(combo) { if (combo) onSet(combo); setRecording(false); setLive(''); }
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, [recording]);

  if (red) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: first ? 'none' : `1px solid ${theme.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>{label}</div>
        </div>
        {recording ? <span style={{ fontFamily: FM, fontSize: 12, color: theme.accent }}>{live || 'Press keys…'}</span> : <Keycaps combo={value} theme={theme} />}
        <button onClick={() => setRecording((r) => !r)} style={{
          background: recording ? theme.accent : theme.inputBg, border: `1px solid ${recording ? theme.accent : theme.border}`, borderRadius: 8,
          padding: '6px 13px', fontSize: 12, fontWeight: 600, color: recording ? theme.accentInk : theme.textSecondary, cursor: 'pointer', fontFamily: FUI, flexShrink: 0,
        }}>{recording ? 'Cancel' : 'Change'}</button>
        {value && !recording && <button onClick={onClear} title="Clear" style={{ background: theme.bgTertiary, border: `1px solid ${theme.border}`, borderRadius: 8, width: 30, height: 32, cursor: 'pointer', color: theme.textMuted, flexShrink: 0 }}>×</button>}
      </div>
    );
  }
  // original: read-only input
  return (
    <div>
      <label style={first ? s.label : { ...s.label, marginTop: 16 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <input type="text" readOnly value={recording ? (live || 'Press keys...') : value} placeholder={placeholder}
          onClick={() => setRecording(true)} onFocus={() => setRecording(true)}
          style={{ ...s.input, cursor: 'pointer', caretColor: 'transparent', ...(recording ? { border: `2px solid ${theme.accent}`, boxShadow: `0 0 8px ${theme.accentGlow}`, padding: '9px 13px' } : {}) }} />
        {value && !recording && (
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} title="Clear hotkey"
            onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; e.currentTarget.style.borderColor = theme.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = theme.textMuted; e.currentTarget.style.borderColor = theme.border; }}
            style={{ background: theme.bgTertiary, border: `1px solid ${theme.border}`, borderRadius: 6, width: 32, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: theme.textMuted, fontSize: 16, fontFamily: FUI, flexShrink: 0, transition: 'color .15s, border-color .15s' }}>×</button>
        )}
      </div>
    </div>
  );
}
function HotkeysTab({ state, set, s, theme, design }) {
  return (
    <Section title="Keyboard Shortcuts" s={s} theme={theme} design={design}>
      <HotkeyRecorderField first label="Dictation Hotkey" value={state.dictationHotkey} placeholder="Ctrl+Shift+Space (default)"
        onSet={(v) => set({ dictationHotkey: v })} onClear={() => set({ dictationHotkey: '' })} s={s} theme={theme} design={design} />
      <HotkeyRecorderField label="Dictate & Send Hotkey" value={state.dictateAndSendHotkey} placeholder="Not set"
        onSet={(v) => set({ dictateAndSendHotkey: v })} onClear={() => set({ dictateAndSendHotkey: '' })} s={s} theme={theme} design={design} />
      <HotkeyRecorderField label="Output Recording Hotkey" value={state.outputRecordingHotkey} placeholder="Not set"
        onSet={(v) => set({ outputRecordingHotkey: v })} onClear={() => set({ outputRecordingHotkey: '' })} s={s} theme={theme} design={design} />
      <span style={{ ...s.hint, marginTop: 16, display: 'block' }}>Click to record hotkey. Press and release keys to set. Escape to cancel.</span>
    </Section>
  );
}

/* ─── Updates ─── */
function UpdatesTab({ s, theme, design }) {
  const [status, setStatus] = React.useState('idle');
  const check = () => { setStatus('checking'); setTimeout(() => setStatus('idle'), 1600); };
  const checking = status === 'checking';
  return (
    <>
      <Section title="Software Updates" s={s} theme={theme} design={design}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <StatusDot color={checking ? theme.accent : theme.success} size={10} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{checking ? 'Checking for updates…' : "You're up to date"}</div>
            <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>{checking ? 'Contacting the update server.' : 'Whisperio is running the latest available version.'}</div>
          </div>
          <button onClick={check} disabled={checking} style={{ background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 500, color: checking ? theme.textMuted : theme.accent, cursor: checking ? 'default' : 'pointer', fontFamily: FUI, flexShrink: 0, opacity: checking ? 0.6 : 1 }}>Check now</button>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: theme.textMuted }}>Installed version</span>
          <span style={{ color: theme.text, fontWeight: 500 }}>v1.4.0</span>
        </div>
      </Section>
      <Section title="How updates work" s={s} theme={theme} design={design}>
        <span style={s.hint}>Whisperio checks for updates automatically on launch and every 4 hours. New versions download quietly in the background — you keep working while it downloads. When it's ready you'll see a “Restart now” button here and in the tray menu.</span>
      </Section>
    </>
  );
}

Object.assign(window, { GeneralTab, ProvidersTab, AudioTab, HotkeysTab, UpdatesTab, INPUT_DEVICES, OUTPUT_DEVICES });
