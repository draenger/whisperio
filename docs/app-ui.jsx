/* Whisperio desktop app — interactive preview (React) */
const { useState, useEffect, useRef } = React;

/* ───────── theme tokens ───────── */
const DARK = {
  mode: 'dark',
  bg: '#0a0911', titlebar: '#0e0c17', surface: '#15121f', input: '#1c1830', elevated: '#221d33',
  line: 'rgba(255,255,255,0.08)', lineSoft: 'rgba(255,255,255,0.05)', line2: 'rgba(167,139,250,0.35)',
  text: '#ECEBF4', muted: '#9d9bb4', faint: '#6a6880',
  accent: '#8b5cf6', accentLight: '#a78bfa', grad: 'linear-gradient(118deg,#a78bfa,#6366f1)',
  green: '#34d399', red: '#f0556b', amber: '#fbbf24', cyan: '#2dd4bf',
  shadow: '0 40px 90px -30px rgba(0,0,0,.85), 0 0 0 1px rgba(167,139,250,.07)'
};
const LIGHT = {
  mode: 'light',
  bg: '#f6f5fc', titlebar: '#ffffff', surface: '#ffffff', input: '#f6f5fc', elevated: '#efedf8',
  line: 'rgba(20,18,40,0.10)', lineSoft: 'rgba(20,18,40,0.06)', line2: 'rgba(124,58,237,0.30)',
  text: '#1b1830', muted: '#5b5870', faint: '#9b98ad',
  accent: '#7c3aed', accentLight: '#8b5cf6', grad: 'linear-gradient(118deg,#8b5cf6,#6366f1)',
  green: '#16a34a', red: '#dc2626', amber: '#d97706', cyan: '#0d9488',
  shadow: '0 40px 90px -34px rgba(40,30,90,.35), 0 0 0 1px rgba(124,58,237,.06)'
};

/* accent palettes (switchable) */
const ACCENTS = {
  graphite: { base: '#94a3b8', light: '#cbd5e1', darkc: '#475569', grad: 'linear-gradient(118deg,#cbd5e1,#94a3b8)', ink: '#0b0e16', rgb: '148,163,184' },
  blue:     { base: '#4a8cf7', light: '#6ea9fb', darkc: '#2f7df0', grad: 'linear-gradient(118deg,#6ea9fb,#4a8cf7)', ink: '#fff', rgb: '74,140,247' },
  teal:     { base: '#2dd4bf', light: '#5eead4', darkc: '#0d9488', grad: 'linear-gradient(118deg,#5eead4,#14b8a6)', ink: '#04241f', rgb: '45,212,191' },
  emerald:  { base: '#34d399', light: '#6ee7b7', darkc: '#059669', grad: 'linear-gradient(118deg,#6ee7b7,#10b981)', ink: '#04231a', rgb: '52,211,153' },
  amber:    { base: '#f59e0b', light: '#fbbf24', darkc: '#b45309', grad: 'linear-gradient(118deg,#fbbf24,#f59e0b)', ink: '#241600', rgb: '245,158,11' },
  violet:   { base: '#8b5cf6', light: '#a78bfa', darkc: '#7c3aed', grad: 'linear-gradient(118deg,#a78bfa,#6366f1)', ink: '#fff', rgb: '139,92,246' },
};
const ACCENT_ORDER = ['graphite', 'blue', 'teal', 'emerald', 'amber', 'violet'];

const F = "'IBM Plex Sans', sans-serif";
const FD = "'Space Grotesk', sans-serif";
const FM = "'JetBrains Mono', monospace";

/* ───────── icons (lucide-style) ───────── */
const I = {
  sun: "M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
};
function Icon({ d, size = 16, fill = 'none', stroke = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: '<path d="' + d + '" />' }} />;
}
const Ghost = ({ size = 18, color = '#94a3b8' }) => (
  <svg width={size} height={size} viewBox="0 0 1024 1024" style={{ flexShrink: 0, color }}>
    <path d="M602 157c52.7 27.6 86.2 78.55 104.13 134.02 1.34 4.3 2.61 8.61 3.88 12.94 12.61 43.08 21.34 90.05 25.06 134.83 2.3 0.8 3.56 1.15 5.9 0.34 20.8-11.9 40.7-27.5 55.5-46 6.62-7.66 16.54-14.72 26.75-16 9.22-0.3 16.15 3 23 9 9.05 11.73 11.99 23.56 10.38 38.19-1.55 10.6-4.7 19.9-8.5 28.96-6.65 17.15-18.05 33.07-30.59 46.41-15.6 17.8-33.6 30.4-52.3 41.5-9.96 5.74-20.35 9.95-31.13 13.9-0.07 0.87-0.13 1.74-0.2 2.63-2.7 35.16-9.23 68.64-22.8 101.37-14.3 33.9-34 64.2-58.9 91.4-7.63 8.73-15.93 16.83-25.03 24.02-16.76 14.52-38.96 29.89-62.16 28.9-6.74-0.92-11.74-2.85-16.09-8.29-1.76-5.27-1.92-10.69 0.44-15.81 2.6-4.6 5.8-8.5 8.7-12.6 4.75-6.21 7.44-11.07 7.44-18.94-0.71-3.21-0.71-3.21-3.09-4.8-8.45-3.87-20.17-1.7-28.63 1.29-15.08 6.36-27.05 15.7-39.39 26.27-7.5 6.4-15.4 12.1-23.6 17.6-19.84 15.29-42.33 28.88-66.93 34.39-19.07 3.08-39.8-1.39-55.6-12.58-4.16-4.19-6.88-9-7.15-14.98 0.83-11.06 8.51-17.46 15.98-24.8 20.19-19.4 20.19-19.4 28.48-45.17 0.04-1.04-1-4-1-4-0.53-3.63-1.54-4.72-4.42-6.91-11.45-3.05-23.92 2.66-34.85 5.99-17.74 5.37-33.38 8.24-51.9 8.38-17.62 0.16-35.29-2.81-49.13-14.4-2.22-2.2-4.16-4.48-6-7-3.76-8.07-4.33-16.98-1.27-25.36 4.53-9.87 11.35-13.21 20.9-17.52 31.32-14.58 57.62-35.08 70.05-68.28 2.43-7.27 4.42-16.03 2.07-23.52-1.28 0.82-1.28 0.82-2.58 1.65-27.45 17.23-61.8 30.32-94.5 23.39-8.71-2.12-16.44-6.9-21.92-14.04-5.28-8.76-6.45-17.65-4.46-27.76 4.77-13.93 16.95-21.08 29.4-27.23 3-1.5 6.1-2.9 9.2-4.4 7.6-3.62 7.6-3.62 9.86-3.62 0.33-0.66 0.66-1.32 1-2 1.65-0.7 3.32-1.36 5-2 24.52-12.85 43.29-31.37 51.97-57.96 4.34-15.27 1.1-30.82-0.97-46.23-0.7-5.4-1.5-10.8-2.08-15.7-0.8-6.08-1.07-11.99-0.92-18.12-0.66-0.33-2-1-2-1-3.04-56.54-3.04-56.54 1-83 5.69-37.5 19.5-69.3 42.5-98.2 6.5-8.1 13.7-15.6 21.5-22.4 0.66 0 2-2 2-2 67-51.2 151.9-60.6 226.8-20.4z" fill="currentColor" />
    <path d="M619 385c2.87 1.79 4.49 2.98 6 6 0.83 6.56-0.22 11.58-4 17-10.17 12.77-27.85 21.49-43.87 23.77-19.88 2.12-42.49-0.42-58.61-13.28-2.41-2.37-4.28-4.3-4.95-7.68-0.01-4.09 0.08-6.26 2.3-9.81 3.46-3.26 6.14-3.56 10.78-3.56 6.89 1.16 13.16 4.65 19.39 7.71 10.69 4.65 27.03 3.44 37.7-0.65 9.33-3.88 17.14-9.47 23.25-17.5 4.02-2.68 7.28-2.7 12-2z" fill="#222734" />
    <path d="M502.9 303.75c8.23 4.9 12.09 11.21 15.1 20.25 1.03 9.89-0.78 17.83-5.9 26.31-5.05 5.33-12.89 8.99-20.19 9.31-8.12-0.57-15.46-4.52-20.81-10.62-3.92-6.27-5.2-11.88-5.25-19.25-0.08-8.3 2.75-13.95 8.23-19.65 8.6-7.72 18.67-9.35 28.98-4.11z" fill="#222734" />
    <path d="M631.44 292.56c6.12 3.75 11.24 8.85 13.9 15.59 2.12 9.07 2.24 19.59-2.65 27.75-4.8 5.93-11.04 10.58-18.74 11.42-8.21 0.1-13.61-0.54-19.85-6-6.41-6.59-9.24-14.34-9.6-23.46 0.38-9.58 4.64-16.38 11.5-22.88 6.91-5.64 17.31-6.1 25.44-2.42z" fill="#222734" />
  </svg>
);

/* ───────── primitives ───────── */
function Toggle({ checked, onChange, t }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0,
      background: checked ? t.accent : t.elevated, position: 'relative', transition: 'background .2s',
      boxShadow: 'inset 0 0 0 1px ' + (checked ? 'transparent' : t.line)
    }}>
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3, width: 18, height: 18, borderRadius: '50%',
        background: '#fff', transition: 'left .2s cubic-bezier(.16,.84,.44,1)', boxShadow: '0 1px 3px rgba(0,0,0,.4)'
      }} />
    </button>
  );
}
function ToggleRow({ label, desc, checked, onChange, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{label}</div>
        {desc && <div style={{ fontSize: 12.5, color: t.muted, marginTop: 2 }}>{desc}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} t={t} />
    </div>
  );
}
function Card({ title, icon, desc, t, children, style }) {
  return (
    <div style={{ ...style }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: desc ? 4 : 13 }}>
          {icon && <span style={{ color: t.accentLight, display: 'flex', flexShrink: 0 }}><Icon d={icon} size={15} /></span>}
          <h3 style={{ fontFamily: FD, fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>{title}</h3>
        </div>
      )}
      {desc && <div style={{ fontSize: 12, color: t.muted, margin: '0 0 13px 24px' }}>{desc}</div>}
      {children}
    </div>
  );
}
const inputStyle = (t) => ({
  width: '100%', background: t.input, border: `1px solid ${t.line}`, borderRadius: 9,
  padding: '9px 12px', fontSize: 13, color: t.text, fontFamily: F, outline: 'none'
});
function Field({ label, hint, t, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      {label && <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: t.muted, marginBottom: 6 }}>{label}</label>}
      {children}
      {hint && <div style={{ fontSize: 11.5, color: t.faint, marginTop: 6, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

/* ───────── title bar ───────── */
function TitleBar({ title, t, onToggleTheme }) {
  const ctrl = { width: 30, height: 30, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.faint };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 44, paddingLeft: 16, paddingRight: 8,
      background: t.titlebar, borderBottom: `1px solid ${t.line}`, flexShrink: 0
    }}>
      <Ghost size={17} color={t.accentLight} />
      <span style={{ marginLeft: 10, fontSize: 12.5, fontWeight: 500, color: t.muted, flex: 1, letterSpacing: '.02em' }}>{title}</span>
      <button onClick={onToggleTheme} title="Toggle theme" style={ctrl}
        onMouseEnter={(e) => { e.currentTarget.style.background = t.elevated; e.currentTarget.style.color = t.accent; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.faint; }}>
        {t.mode === 'dark'
          ? <Icon d={I.sun + 'M0 0'} size={15} />
          : <Icon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" size={15} />}
      </button>
      <div style={{ display: 'flex', gap: 2, marginLeft: 2 }}>
        <button style={ctrl} onMouseEnter={(e) => e.currentTarget.style.background = t.elevated} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><svg width="10" height="10"><line x1="1" y1="5" x2="9" y2="5" stroke={t.faint} strokeWidth="1.3" /></svg></button>
        <button style={ctrl} onMouseEnter={(e) => e.currentTarget.style.background = t.elevated} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><svg width="10" height="10"><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" stroke={t.faint} strokeWidth="1.3" fill="none" /></svg></button>
        <button style={ctrl} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(240,85,107,.16)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><svg width="10" height="10"><line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke={t.faint} strokeWidth="1.3" /><line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke={t.faint} strokeWidth="1.3" /></svg></button>
      </div>
    </div>
  );
}

/* ───────── Settings tabs ───────── */
const TABS = [
  { id: 'general', label: 'General', icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { id: 'providers', label: 'Providers', icon: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'audio', label: 'Audio', icon: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3' },
  { id: 'hotkeys', label: 'Hotkeys', icon: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M9 13h6M18 13h.01' },
  { id: 'recordings', label: 'Recordings', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 2' },
];

function GeneralTab({ t, state, set }) {
  return (
    <>
      <Card title="Startup" icon="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" t={t}>
        <ToggleRow label="Launch at startup" desc="Start Whisperio automatically when you log in" checked={state.launch} onChange={(v) => set({ launch: v })} t={t} />
      </Card>
      <Card title="Appearance" icon="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" t={t}>
        <ToggleRow label="Dark theme" desc={t.mode === 'dark' ? 'Currently using dark theme' : 'Currently using light theme'} checked={t.mode === 'dark'} onChange={() => set({ theme: t.mode === 'dark' ? 'light' : 'dark' })} t={t} />
      </Card>
      <Card title="Tray" icon="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" t={t}>
        <ToggleRow label="Minimize to system tray" desc="Keep Whisperio running quietly in the background" checked={state.tray} onChange={(v) => set({ tray: v })} t={t} />
      </Card>
    </>
  );
}

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', desc: 'gpt-4o-transcribe' },
  { id: 'elevenlabs', label: 'ElevenLabs', desc: 'Scribe v2' },
  { id: 'selfhosted', label: 'Local Model', desc: 'Offline · private', local: true },
];
function ProvidersTab({ t, state, set }) {
  const [expanded, setExpanded] = useState('selfhosted');
  const chain = state.chain;
  const ordered = [...chain.map((id) => PROVIDERS.find((p) => p.id === id)), ...PROVIDERS.filter((p) => !chain.includes(p.id))].filter(Boolean);
  const move = (id, dir) => {
    const i = chain.indexOf(id), j = i + dir;
    if (j < 0 || j >= chain.length) return;
    const n = [...chain]; n[i] = n[j]; n[j] = id; set({ chain: n });
  };
  const toggle = (id) => {
    if (chain.includes(id)) { if (chain.length <= 1) return; set({ chain: chain.filter((x) => x !== id) }); }
    else set({ chain: [...chain, id] });
  };
  return (
    <>
      <Card title="Provider Chain" icon="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" t={t}>
        <div style={{ fontSize: 11.5, color: t.faint, marginBottom: 12 }}>First = primary. If it fails, the next one takes over. Reorder with the arrows.</div>
        <div style={{ border: `1px solid ${t.line}`, borderRadius: 10, overflow: 'hidden' }}>
          {ordered.map((p, oi) => {
            const on = chain.includes(p.id), idx = chain.indexOf(p.id), exp = expanded === p.id && on;
            return (
              <div key={p.id} style={{ borderTop: oi === 0 ? 'none' : `1px solid ${t.lineSoft}` }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', position: 'relative',
                  background: on && idx === 0 ? `rgba(${t.accRgb},.07)` : 'transparent', opacity: on ? 1 : .5
                }}>
                  {on && idx === 0 && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: t.accent }} />}
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: FM, fontSize: 11, fontWeight: 700, flexShrink: 0,
                    background: on ? (idx === 0 ? t.accent : (p.local ? 'rgba(45,212,191,.15)' : t.elevated)) : 'transparent',
                    color: idx === 0 ? t.accInk : (p.local && on ? t.cyan : t.faint)
                  }}>{on ? idx + 1 : '–'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{p.label}</span>
                    <span style={{ fontSize: 11.5, color: t.muted, marginLeft: 8 }}>{p.desc}</span>
                  </div>
                  {on && chain.length > 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: .7 }}>
                      <button onClick={() => move(p.id, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? t.lineSoft : t.faint, fontSize: 9, padding: '1px 3px' }}>▲</button>
                      <button onClick={() => move(p.id, 1)} disabled={idx === chain.length - 1} style={{ background: 'none', border: 'none', cursor: idx === chain.length - 1 ? 'default' : 'pointer', color: idx === chain.length - 1 ? t.lineSoft : t.faint, fontSize: 9, padding: '1px 3px' }}>▼</button>
                    </div>
                  )}
                  {on && <button onClick={() => setExpanded(exp ? null : p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: exp ? t.accent : t.faint, padding: 4, display: 'flex' }}><Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" size={14} /></button>}
                  <button onClick={() => toggle(p.id)} style={{
                    background: on ? t.accent : t.elevated, border: `1px solid ${on ? 'transparent' : t.line}`, borderRadius: 6,
                    padding: '4px 10px', fontSize: 10.5, fontWeight: 600, color: on ? t.accInk : t.faint, cursor: 'pointer', fontFamily: F, flexShrink: 0
                  }}>{on ? 'On' : 'Off'}</button>
                </div>
                {exp && (
                  <div style={{ padding: '4px 13px 14px', borderTop: `1px solid ${t.lineSoft}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {p.id === 'openai' && <><Field label="API Key" t={t}><input type="password" defaultValue="sk-proj-••••••••••••" style={inputStyle(t)} /></Field><ToggleRow label="AI vocabulary correction" desc="LLM pass to fix technical terms" checked={state.aipp} onChange={(v) => set({ aipp: v })} t={t} /></>}
                    {p.id === 'elevenlabs' && <Field label="API Key" t={t}><input type="password" defaultValue="xi-••••••••••••" style={inputStyle(t)} /></Field>}
                    {p.id === 'selfhosted' && <SelfHosted t={t} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Language" icon="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" t={t}>
        <select defaultValue="en" style={{ ...inputStyle(t), appearance: 'none' }}>
          <option value="auto">Auto-detect</option><option value="en">English</option><option value="pl">Polish</option><option value="de">German</option><option value="fr">French</option><option value="es">Spanish</option>
        </select>
        <div style={{ fontSize: 11.5, color: t.faint, marginTop: 6 }}>Setting it explicitly improves accuracy over auto-detect.</div>
      </Card>

      <Card title="Vocabulary" icon="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" t={t}>
        <Field label="Custom vocabulary" hint="Comma-separated terms for better recognition across all providers." t={t}>
          <textarea rows={2} defaultValue="git, GitHub, npm, TypeScript, React, Docker, kubectl" style={{ ...inputStyle(t), resize: 'none', lineHeight: 1.5 }} />
        </Field>
      </Card>
    </>
  );
}

const LOCAL_MODELS = [
  { name: 'tiny.en', size: '75 MB', got: true },
  { name: 'base', size: '142 MB', got: true },
  { name: 'small', size: '466 MB', got: false, prog: 64 },
  { name: 'large-v3', size: '2.9 GB', got: false },
];
function SelfHosted({ t }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 2px 11px', marginBottom: 6, borderBottom: `1px solid ${t.lineSoft}` }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.green }} />
        <span style={{ flex: 1, fontSize: 12.5, color: t.text, fontWeight: 500 }}>Running — port 8178 <span style={{ color: t.muted, fontWeight: 400 }}>base</span></span>
        <button style={{ background: 'none', border: `1px solid ${t.line}`, borderRadius: 6, padding: '3px 9px', fontSize: 10.5, color: t.red, cursor: 'pointer', fontFamily: F }}>Stop</button>
      </div>
      <label style={{ fontSize: 12, fontWeight: 600, color: t.muted }}>Models</label>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {LOCAL_MODELS.map((m) => (
          <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 2px', borderBottom: `1px solid ${t.lineSoft}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: FM, fontSize: 12, fontWeight: 500, color: t.text }}>{m.name}</span>
              <span style={{ fontSize: 10.5, color: t.faint, marginLeft: 7 }}>{m.size}</span>
              {m.prog != null && <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: t.line, overflow: 'hidden' }}><div style={{ height: '100%', width: m.prog + '%', background: t.accent }} /></div>}
            </div>
            {m.got ? <button style={{ background: 'none', border: 'none', fontSize: 10.5, color: t.faint, cursor: 'pointer', fontFamily: F }}>Remove</button>
              : m.prog != null ? <span style={{ fontSize: 10.5, color: t.accent, fontFamily: FM }}>{m.prog}%</span>
                : <button style={{ background: t.accent, border: 'none', borderRadius: 5, padding: '3px 9px', fontSize: 10.5, color: t.accInk, cursor: 'pointer', fontWeight: 600, fontFamily: F }}>Get</button>}
          </div>
        ))}
      </div>
    </>
  );
}

function AudioTab({ t, state, set, goRecordings }) {
  return (
    <>
      <Card title="Input device (microphone)" icon="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3" t={t}>
        <select defaultValue="0" style={{ ...inputStyle(t), appearance: 'none' }}><option value="0">MacBook Pro Microphone</option><option>System Default</option></select>
      </Card>
      <Card title="Output device (system audio)" icon="M11 5 6 9H2v6h4l5 4zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" t={t}>
        <select defaultValue="0" style={{ ...inputStyle(t), appearance: 'none' }}><option value="0">BlackHole 2ch</option><option>System Default</option></select>
      </Card>
      <Card title="Recording" icon="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" t={t}>
        <ToggleRow label="Save recordings to disk" desc="Keep audio for playback and reprocessing" checked={state.save} onChange={(v) => set({ save: v })} t={t} />
        <button onClick={goRecordings} style={{ background: 'none', border: `1px solid ${t.line}`, borderRadius: 9, padding: '9px 14px', fontSize: 13, color: t.accent, cursor: 'pointer', fontFamily: F, fontWeight: 500, marginTop: 8 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.line2; e.currentTarget.style.background = t.input; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.line; e.currentTarget.style.background = 'none'; }}>
          124 recordings saved — View all →
        </button>
      </Card>
    </>
  );
}

const KEYS = {
  dict: ['Ctrl', 'Shift', 'Space'],
  send: ['Ctrl', 'Shift', 'Enter'],
  out: ['Ctrl', 'Shift', 'O'],
};
function Keycaps({ keys, t, recording }) {
  if (recording) return <span style={{ fontFamily: FM, fontSize: 12, color: t.accent }}>Press keys…</span>;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {keys.map((k) => (
        <span key={k} style={{ fontFamily: FM, fontSize: 11, fontWeight: 600, color: t.text, padding: '4px 9px', borderRadius: 6, background: t.elevated, border: `1px solid ${t.line}`, boxShadow: `0 1px 0 ${t.line}` }}>{k}</span>
      ))}
    </div>
  );
}
function HotkeyRow({ label, desc, keys, t, id, rec, setRec }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: t.text }}>{label}</div>
        <div style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>{desc}</div>
      </div>
      <Keycaps keys={keys} t={t} recording={rec === id} />
      <button onClick={() => setRec(rec === id ? null : id)} style={{
        background: rec === id ? t.accent : t.input, border: `1px solid ${rec === id ? 'transparent' : t.line}`, borderRadius: 8,
        padding: '6px 13px', fontSize: 12, fontWeight: 600, color: rec === id ? t.accInk : t.muted, cursor: 'pointer', fontFamily: F, flexShrink: 0
      }}>{rec === id ? 'Cancel' : 'Change'}</button>
    </div>
  );
}
function HotkeysTab({ t }) {
  const [rec, setRec] = useState(null);
  return (
    <Card title="Global hotkeys" t={t}>
      <div style={{ fontSize: 11.5, color: t.faint, marginBottom: 4 }}>Work system-wide from any app. Click Change, then press any combination.</div>
      <HotkeyRow id="dict" label="Dictation" desc="Start / stop recording" keys={KEYS.dict} t={t} rec={rec} setRec={setRec} />
      <div style={{ height: 1, background: t.lineSoft }} />
      <HotkeyRow id="send" label="Dictate & Send" desc="Paste, then press Enter" keys={KEYS.send} t={t} rec={rec} setRec={setRec} />
      <div style={{ height: 1, background: t.lineSoft }} />
      <HotkeyRow id="out" label="Output recording" desc="Record system audio" keys={KEYS.out} t={t} rec={rec} setRec={setRec} />
    </Card>
  );
}

function SettingsView({ t, state, set, tab, setTab }) {
  const [saved, setSaved] = useState(false);
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: t.bg }}>
      {/* sidebar nav */}
      <nav style={{ width: 190, flexShrink: 0, borderRight: `1px solid ${t.line}`, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 3, background: t.mode === 'dark' ? 'rgba(255,255,255,.015)' : 'rgba(20,18,40,.02)' }}>
        <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: t.faint, padding: '2px 10px 10px' }}>Settings</div>
        {TABS.map((tb) => {
          const on = tab === tb.id;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)} style={{
              display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', cursor: 'pointer',
              border: 'none', borderRadius: 9, padding: '9px 11px', fontFamily: F, fontSize: 13.5, fontWeight: 600,
              background: on ? t.input : 'transparent', color: on ? t.text : t.muted,
              boxShadow: on ? `inset 0 0 0 1px ${t.line}` : 'none', transition: 'background .15s, color .15s'
            }}
              onMouseEnter={(e) => { if (!on) { e.currentTarget.style.background = t.mode === 'dark' ? 'rgba(255,255,255,.04)' : 'rgba(20,18,40,.04)'; e.currentTarget.style.color = t.text; } }}
              onMouseLeave={(e) => { if (!on) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.muted; } }}>
              <span style={{ color: on ? t.accentLight : t.faint, display: 'flex', flexShrink: 0 }}><Icon d={tb.icon} size={16} /></span>
              {tb.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', fontFamily: FM, fontSize: 10.5, color: t.faint }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.green }} />v1.0.0
        </div>
      </nav>
      {/* content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 30 }}>
          {tab === 'general' && <GeneralTab t={t} state={state} set={set} />}
          {tab === 'providers' && <ProvidersTab t={t} state={state} set={set} />}
          {tab === 'audio' && <AudioTab t={t} state={state} set={set} goRecordings={() => setTab('recordings')} />}
          {tab === 'hotkeys' && <HotkeysTab t={t} />}
          {tab === 'recordings' && <RecordingsView t={t} />}
        </div>
        {tab !== 'recordings' && (
          <div style={{ padding: 12, borderTop: `1px solid ${t.line}`, background: t.titlebar, flexShrink: 0 }}>
            <button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1600); }} style={{
              width: '100%', background: saved ? t.green : t.accent, border: 'none', borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 600,
              color: saved ? '#fff' : t.accInk, cursor: 'pointer', fontFamily: F, boxShadow: 'none', transition: 'background .15s'
            }}>{saved ? '✓ Saved' : 'Save Settings'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Recordings ───────── */
const RECS = [
  { st: 'completed', date: '2026-06-14 09:41:02', dur: '8.2s', prov: 'Local', text: 'Add rate limiting to the /api/users endpoint, one hundred requests per minute.' },
  { st: 'completed', date: '2026-06-14 09:12:55', dur: '14.0s', prov: 'OpenAI', text: 'We agreed to ship the new API by Friday and deprecate the v1 endpoints next quarter.' },
  { st: 'completed', date: '2026-06-13 17:30:18', dur: '4.6s', prov: 'Local', text: 'electron global hotkey dictation app open source' },
  { st: 'failed', date: '2026-06-13 16:02:41', dur: '2.1s', prov: 'OpenAI', text: 'Provider error: rate limit exceeded — falling back…' },
  { st: 'completed', date: '2026-06-13 11:48:09', dur: '22.7s', prov: 'ElevenLabs', text: 'Meeting recap: the design review went well, follow up with marketing about the launch banner.' },
];
function RecordingDetail({ t, r, onBack, stColor, stChar, stLabel }) {
  const failed = r.st === 'failed';
  const bars = [6,11,18,9,22,14,28,17,24,10,19,30,13,21,8,16,26,12,20,9,15,23,11,18,27,14,7,19,25,12,16,9,21,13,28,10,17,22,8,14];
  const sizes = { '8.2s': '128 KB', '14.0s': '214 KB', '4.6s': '72 KB', '2.1s': '33 KB', '22.7s': '355 KB' };
  const meta = [['Duration', r.dur], ['Provider', r.prov], ['Status', stLabel[r.st]], ['Size', sizes[r.dur] || '—']];
  const ghostBtn = { display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: `1px solid ${t.line}`, borderRadius: 9, padding: '8px 13px', fontSize: 13, fontWeight: 500, color: t.muted, cursor: 'pointer', fontFamily: F };
  return (
    <div>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', color: t.muted, fontFamily: F, fontSize: 13, fontWeight: 500, padding: 0, marginBottom: 18 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = t.text)} onMouseLeave={(e) => (e.currentTarget.style.color = t.muted)}>
        <Icon d="M19 12H5M12 19l-7-7 7-7" size={15} /> Recordings
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: stColor[r.st], flexShrink: 0 }}>{stChar[r.st]}</span>
        <h2 style={{ fontFamily: FD, fontSize: 18, fontWeight: 600, color: t.text, letterSpacing: '-.01em' }}>{r.date}</h2>
      </div>
      <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', paddingBottom: 20, borderBottom: `1px solid ${t.lineSoft}` }}>
        {meta.map(([k, v]) => (
          <div key={k}>
            <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: t.faint, marginBottom: 5 }}>{k}</div>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: t.text }}>{v}</div>
          </div>
        ))}
      </div>
      {!failed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderRadius: 12, border: `1px solid ${t.line}`, margin: '22px 0' }}>
          <button style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: t.accent, color: t.accInk, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon d="M6 4l14 8-14 8z" size={15} fill="currentColor" stroke="none" />
          </button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, height: 34 }}>
            {bars.map((h, bi) => (
              <span key={bi} style={{ flex: 1, height: h + 'px', background: bi < 11 ? t.accent : (t.mode === 'dark' ? 'rgba(255,255,255,.16)' : 'rgba(20,18,40,.16)'), borderRadius: 2 }} />
            ))}
          </div>
          <span style={{ fontFamily: FM, fontSize: 12, color: t.faint, flexShrink: 0 }}>0:03 / {r.dur}</span>
        </div>
      )}
      <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: t.faint, margin: failed ? '24px 0 10px' : '4px 0 10px' }}>Transcription</div>
      <div style={{ fontSize: 14.5, color: failed ? t.red : t.text, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{r.text}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 26, flexWrap: 'wrap' }}>
        {!failed && <button style={ghostBtn} onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.line2; e.currentTarget.style.color = t.text; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.line; e.currentTarget.style.color = t.muted; }}><Icon d="M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" size={14} /> Copy</button>}
        <button style={ghostBtn} onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.line2; e.currentTarget.style.color = t.text; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.line; e.currentTarget.style.color = t.muted; }}><Icon d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.5 15" size={14} /> Re-transcribe</button>
        <button style={{ ...ghostBtn, color: t.red }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.red; e.currentTarget.style.background = 'rgba(240,85,107,.08)'; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.line; e.currentTarget.style.background = 'none'; }}><Icon d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" size={14} /> Delete</button>
      </div>
    </div>
  );
}

function RecordingsView({ t }) {
  const [hov, setHov] = useState(null);
  const [sel, setSel] = useState(null);
  const stColor = { completed: t.green, failed: t.red, pending: t.amber };
  const stChar = { completed: '✓', failed: '✕', pending: '◌' };
  const stLabel = { completed: 'Completed', failed: 'Failed', pending: 'Pending' };
  if (sel !== null) return <RecordingDetail t={t} r={RECS[sel]} onBack={() => setSel(null)} stColor={stColor} stChar={stChar} stLabel={stLabel} />;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: t.accentLight, display: 'flex' }}><Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 2" size={15} /></span>
          <h3 style={{ fontFamily: FD, fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: '.02em' }}>Recordings</h3>
          <span style={{ fontSize: 11.5, color: t.faint, marginLeft: 4 }}>· {RECS.length} saved</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ background: 'none', border: `1px solid ${t.line}`, borderRadius: 8, padding: '6px 10px', color: t.muted, cursor: 'pointer', display: 'flex' }}><Icon d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.5 15" size={14} /></button>
          <button style={{ background: 'none', border: `1px solid ${t.line}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, color: t.red, cursor: 'pointer', fontFamily: F }}>Delete All</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {RECS.map((r, i) => (
          <div key={i} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => setSel(i)} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '13px 10px', borderRadius: 8, cursor: 'pointer',
            background: hov === i ? (t.mode === 'dark' ? 'rgba(255,255,255,.03)' : 'rgba(20,18,40,.03)') : 'transparent',
            borderBottom: `1px solid ${t.lineSoft}`, transition: 'background .15s'
          }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: stColor[r.st], width: 22, textAlign: 'center', flexShrink: 0 }}>{stChar[r.st]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
                <span style={{ fontFamily: FM, fontSize: 11.5, fontWeight: 500, color: t.text }}>{r.date}</span>
                <span style={{ fontSize: 11, color: t.faint, fontFamily: FM }}>{r.dur}</span>
                <span style={{ fontSize: 11, color: t.faint }}>· {r.prov}</span>
              </div>
              <div style={{ fontSize: 13, color: r.st === 'failed' ? t.red : t.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.text}</div>
            </div>
            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 2, flexShrink: 0, opacity: hov === i ? 1 : 0, transition: 'opacity .15s' }}>
              {['M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1', 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'].map((d, k) => (
                <button key={k} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent', color: t.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = t.elevated; e.currentTarget.style.color = k === 1 ? t.red : t.accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.faint; }}>
                  <Icon d={d} size={13} />
                </button>
              ))}
            </div>
            <span style={{ flexShrink: 0, color: t.faint, display: 'flex' }}><Icon d="M9 6l6 6-6 6" size={15} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── system tray + menu ───────── */
function TrayMenu({ t, tab, setTab }) {
  const [open, setOpen] = useState(true);
  const dim = t.mode === 'dark';
  const glyph = (d) => <span style={{ color: dim ? 'rgba(236,235,244,.55)' : 'rgba(27,24,48,.5)', display: 'flex' }}><Icon d={d} size={15} /></span>;
  const item = (label, active, onClick, danger) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', cursor: 'pointer',
      border: 'none', borderRadius: 7, padding: '7px 10px', fontFamily: F, fontSize: 13, fontWeight: 500,
      background: active ? (dim ? 'rgba(167,139,250,.16)' : 'rgba(124,58,237,.12)') : 'transparent',
      color: danger ? t.red : (active ? t.accentLight : t.text)
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = danger ? 'rgba(240,85,107,.14)' : (dim ? 'rgba(255,255,255,.06)' : 'rgba(20,18,40,.05)'); }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ width: 14, opacity: active ? 1 : 0, color: t.accent }}>✓</span>{label}
    </button>
  );
  return (
    <div className="menubar">
      <div className="mb-spacer" />
      <div className="mb-right">
        {glyph('M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01')}
        {glyph('M6 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM23 13v-2M6 11v2')}
        <span style={{ fontFamily: FM, fontSize: 12.5, color: dim ? 'rgba(236,235,244,.7)' : 'rgba(27,24,48,.65)' }}>9:41</span>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setOpen((o) => !o)} title="Whisperio — press Ctrl+Shift+Space to dictate" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 24, borderRadius: 6, cursor: 'pointer',
            border: 'none', background: open ? (dim ? 'rgba(167,139,250,.18)' : 'rgba(124,58,237,.12)') : 'transparent'
          }}><Ghost size={15} color={t.accentLight} /></button>
          {open && (
            <div style={{
              position: 'absolute', top: 32, right: 0, width: 220, padding: 6, zIndex: 30,
              background: dim ? 'rgba(18,16,28,.97)' : 'rgba(255,255,255,.98)',
              border: `1px solid ${t.line}`, borderRadius: 12,
              boxShadow: dim ? '0 24px 60px -20px rgba(0,0,0,.85), 0 0 0 1px rgba(167,139,250,.08)' : '0 24px 60px -24px rgba(40,30,90,.35)'
            }}>
              <div style={{ padding: '8px 10px 9px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: `1px solid ${t.lineSoft}`, marginBottom: 4 }}>
                <Ghost size={20} color={t.accentLight} />
                <div style={{ lineHeight: 1.25 }}>
                  <div style={{ fontFamily: FD, fontSize: 13, fontWeight: 600, color: t.text }}>Whisperio</div>
                  <div style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>Ctrl+Shift+Space to dictate</div>
                </div>
              </div>
              {item('Settings', tab !== 'recordings', () => setTab('general'))}
              {item('Recordings', tab === 'recordings', () => setTab('recordings'))}
              <div style={{ height: 1, background: t.lineSoft, margin: '5px 8px' }} />
              {item('Quit Whisperio', false, () => {}, true)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── dictation indicator (overlay) ───────── */
function OverlayPill({ t }) {
  const [mode, setMode] = useState('input'); // input | output
  const [phase, setPhase] = useState('rec'); // rec → proc → hidden
  useEffect(() => {
    const seq = () => { setPhase('rec'); setTimeout(() => setPhase('proc'), 3000); setTimeout(() => setPhase('hidden'), 4600); };
    seq();
    const iv = setInterval(seq, 6200);
    return () => clearInterval(iv);
  }, [mode]);
  const out = mode === 'output';
  const accent = out ? '#4f9bff' : t.accentLight;
  const dot = out ? '#4f9bff' : t.red;
  const border = out ? 'rgba(79,155,255,.32)' : 'rgba(167,139,250,.3)';
  const source = out ? 'System Audio' : 'MacBook Pro Microphone';
  return (
    <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, position: 'relative', zIndex: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: t.faint }}>Dictation indicator</span>
        <div style={{ display: 'inline-flex', padding: 3, borderRadius: 9, gap: 2, background: t.mode === 'dark' ? 'rgba(255,255,255,.05)' : 'rgba(20,18,40,.05)', border: `1px solid ${t.lineSoft}` }}>
          <button onClick={() => setMode('input')} style={segBtn(t, mode === 'input', t.accent, t.accInk)}>Microphone</button>
          <button onClick={() => setMode('output')} style={segBtn(t, mode === 'output', 'linear-gradient(118deg,#4f9bff,#3b82f6)', '#fff')}>System audio</button>
        </div>
      </div>

      <div style={{ position: 'relative', height: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
        {/* tooltip */}
        <div style={{
          padding: '6px 12px', borderRadius: 8, marginBottom: 8,
          background: 'rgba(8,7,14,.95)', border: '1px solid rgba(255,255,255,.1)', whiteSpace: 'nowrap',
          opacity: phase === 'rec' ? 1 : 0, transition: 'opacity .3s'
        }}>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.72)', fontFamily: F }}>Press <b style={{ color: '#fff' }}>Ctrl+Shift+Space</b> to stop · <b style={{ color: '#fff' }}>Esc</b> to cancel</span>
        </div>
        {/* pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 11, padding: '10px 20px 10px 16px', borderRadius: 100,
          background: 'rgba(8,7,14,.92)', border: `1px solid ${border}`,
          boxShadow: `0 14px 40px -12px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.05)`,
          opacity: phase === 'hidden' ? 0 : 1, transform: phase === 'hidden' ? 'translateY(8px) scale(.96)' : 'none', transition: 'opacity .35s, transform .35s'
        }}>
          {phase === 'proc' ? <>
            <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid rgba(255,255,255,.16)`, borderTopColor: accent, animation: 'spin .7s linear infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.9)' }}>Transcribing…</span>
          </> : <>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, animation: 'pdot 1.2s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.9)' }}>{source}</span>
            <span style={{ display: 'flex', gap: 2.5, alignItems: 'center', height: 17 }}>
              {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ width: 2.6, height: '100%', borderRadius: 2, background: accent, transformOrigin: 'center', animation: `wb .8s ease-in-out ${i * 0.13}s infinite` }} />)}
            </span>
          </>}
        </div>
      </div>
    </div>
  );
}
function segBtn(t, on, grad, ink) {
  return {
    fontFamily: F, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 7, padding: '5px 12px', whiteSpace: 'nowrap',
    background: on ? grad : 'transparent', color: on ? (ink || '#fff') : t.muted,
    boxShadow: on ? '0 4px 12px -4px rgba(0,0,0,.5)' : 'none'
  };
}

/* ───────── App ───────── */
function App() {
  const [theme, setTheme] = useState('dark');
  const [accent, setAccent] = useState(() => { try { var v = localStorage.getItem('wh-app-accent-v2'); return v || 'blue'; } catch (e) { return 'blue'; } });
  const [tab, setTab] = useState('providers');
  const [state, setState] = useState({ launch: true, tray: true, save: true, aipp: true, chain: ['selfhosted', 'openai', 'elevenlabs'] });
  const base = theme === 'dark' ? DARK : LIGHT;
  const acc = ACCENTS[accent] || ACCENTS.graphite;
  const t = { ...base,
    accent: theme === 'dark' ? acc.base : acc.darkc,
    accentLight: theme === 'dark' ? acc.light : acc.base,
    grad: theme === 'dark' ? acc.grad : ('linear-gradient(118deg,' + acc.darkc + ',' + acc.base + ')'),
    accInk: theme === 'dark' ? acc.ink : '#fff',
    accRgb: acc.rgb,
    line2: 'rgba(' + acc.rgb + ',' + (theme === 'dark' ? '0.35' : '0.3') + ')'
  };
  const pickAccent = (k) => { setAccent(k); try { localStorage.setItem('wh-app-accent-v2', k); } catch (e) {} };
  const set = (patch) => { if (patch.theme) { setTheme(patch.theme); delete patch.theme; } setState((s) => ({ ...s, ...patch })); };

  return (
    <div className={'scene' + (theme === 'light' ? ' light' : '')} style={{ '--acRgb': acc.rgb, '--acGrad': t.accent, '--acInk': t.accInk }}>
      <TrayMenu t={t} tab={tab} setTab={setTab} />
      <div className="ptoolbar">
        <div className="pt-brand"><Ghost size={24} color={t.accentLight} /><span className="nm">Whisperio</span></div>
        <div className="acc-switch">
          {ACCENT_ORDER.map((k) => (
            <button key={k} className={'sw' + (accent === k ? ' on' : '')} onClick={() => pickAccent(k)} title={k} style={{ background: ACCENTS[k].base }} />
          ))}
        </div>
        <a className="pt-back" href="index.html"><Icon d="M19 12H5M12 19l-7-7 7-7" size={14} /> Website</a>
      </div>

      <div style={{ width: 800, maxWidth: '94vw', height: 600, display: 'flex', flexDirection: 'column', background: t.bg, borderRadius: 16, overflow: 'hidden', boxShadow: t.shadow, position: 'relative', zIndex: 2 }}>
        <TitleBar title={tab === 'recordings' ? 'Whisperio Recordings' : 'Whisperio Settings'} t={t} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <SettingsView t={t} state={state} set={set} tab={tab} setTab={setTab} />
      </div>

      <OverlayPill t={t} />
      <div className="scene-caption">// The indicator appears on every monitor while you dictate and never steals focus.<br />Whisperio lives in the system tray — open the tray menu (top-right) for Settings &amp; Recordings.</div>
    </div>
  );
}

const style = document.createElement('style');
style.textContent = '@keyframes pdot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.82)}}@keyframes wb{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
