/* Whisperio — settings tab content (DESIGN REFERENCE, vendored from the Claude Design project).
   The `red` (redesign) branch is the TARGET look for the shipping app: bordered Section cards,
   provider chain with expandable rows + Primary badge, HotkeyRecorderField with Keycaps + Change
   button, Updates tab with status row. See wz-parts.jsx for primitives and wz-shell-excerpts.jsx
   for the shell (StatusHeader / SideNav accent tick / auto-save bar / TitleBar). */

/* ─── Providers — the redesign signature: expandable chain rows ─── */
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
    </>
  );
}

/* ─── Local model manager rows (Get / % / Remove, server status strip) ─── */
function SelfhostedSettings({ state, set, s, theme, design }) {
  const m = state.models;
  const srv = m.server;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: theme.bgTertiary }}>
        <StatusDot color={srv.status === 'running' ? '#22c55e' : theme.textMuted} glow={srv.status === 'running'} />
        <div style={{ flex: 1, fontSize: 12 }}>
          <span style={{ color: theme.text, fontWeight: 500 }}>{srv.status === 'running' ? `Running — port ${srv.port}` : 'Stopped'}</span>
          {srv.model && <span style={{ color: theme.textMuted, marginLeft: 6 }}>{srv.model}</span>}
        </div>
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
              {down ? <button style={{ background: 'transparent', border: 'none', fontSize: 10, color: theme.textMuted, cursor: 'pointer', fontFamily: FUI, padding: '2px 6px' }}>Remove</button>
                : active ? <span style={{ fontSize: 10, color: theme.accent }}>{prog}%</span>
                  : <button style={{ background: theme.accent, border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, color: theme.accentInk, cursor: 'pointer', fontWeight: 600, fontFamily: FUI }}>Get</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─── Hotkeys — redesign: Keycaps + Change/Cancel + clear × ─── */
function HotkeyRecorderField({ label, value, onSet, onClear, s, theme, design, first }) {
  const [recording, setRecording] = React.useState(false);
  const [live, setLive] = React.useState('');
  /* key-capture logic identical to the shipped SettingsForm — omitted */
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

/* ─── Updates — status row + how-it-works card ─── */
function UpdatesTab({ s, theme, design }) {
  const checking = false;
  return (
    <>
      <Section title="Software Updates" s={s} theme={theme} design={design}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <StatusDot color={checking ? theme.accent : theme.success} size={10} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{checking ? 'Checking for updates…' : "You're up to date"}</div>
            <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 2 }}>Whisperio is running the latest available version.</div>
          </div>
          <button style={{ background: 'transparent', border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 500, color: theme.accent, cursor: 'pointer', fontFamily: FUI, flexShrink: 0 }}>Check now</button>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span style={{ color: theme.textMuted }}>Installed version</span>
          <span style={{ color: theme.text, fontWeight: 500 }}>v1.5.0</span>
        </div>
      </Section>
      <Section title="How updates work" s={s} theme={theme} design={design}>
        <span style={s.hint}>Whisperio checks for updates automatically on launch and every 4 hours. New versions download quietly in the background — you keep working while it downloads. When it's ready you'll see a "Restart now" button here and in the tray menu.</span>
      </Section>
    </>
  );
}
