/* Whisperio Apple — mobile core: theme (violet aurora original + Rezme redesign), icons,
   primitives, sample data, categories. Ported from Theme.swift / StyleKit.swift / Components.swift.
   Reuses Logo, Icon, buildRezmeTheme, FD/FUI/FM from wz-data.jsx. */

/* ─── Theme (unified mobile token shape) ─── */
function buildMobTheme(design, mode, rezAccent) {
  if (design === 'redesign') {
    const rz = buildRezmeTheme(mode, rezAccent || 'teal', 'gradient');
    return {
      mode, design: 'redesign',
      bg: rz.bg, bg2: mode === 'dark' ? '#05090f' : '#eef2f6', surface: rz.bgSecondary, surfaceUp: rz.inputBg, elevated: rz.bgTertiary,
      line: rz.border, lineSoft: mode === 'dark' ? 'rgba(255,255,255,.05)' : 'rgba(20,40,60,.05)', hair: `rgba(${rz.accentRgb},.30)`,
      text: rz.text, muted: rz.textSecondary, faint: rz.textMuted,
      accent: rz.accent, accentLite: rz.accentLight, accentRgb: rz.accentRgb, gradient: rz.gradient,
      green: rz.success, red: rz.danger, amber: rz.warning || '#f59e0b', cyan: rz.accent,
    };
  }
  // original — violet "aurora" (Theme.swift verbatim)
  const dark = mode === 'dark';
  return dark ? {
    mode, design: 'original',
    bg: '#0a0911', bg2: '#07060d', surface: '#15121f', surfaceUp: '#1c1830', elevated: '#221d33',
    line: 'rgba(255,255,255,0.08)', lineSoft: 'rgba(255,255,255,0.05)', hair: 'rgba(167,139,250,0.22)',
    text: '#ECEBF4', muted: '#9d9bb4', faint: '#6a6880',
    accent: '#8b5cf6', accentLite: '#a78bfa', accentRgb: '139,92,246',
    gradient: 'linear-gradient(135deg, #2dd4bf 0%, #7c8cf8 52%, #6366f1 100%)',
    green: '#34d399', red: '#f0556b', amber: '#fbbf24', cyan: '#2dd4bf',
  } : {
    mode, design: 'original',
    bg: '#f4f3fb', bg2: '#ecebf3', surface: '#ffffff', surfaceUp: '#f6f5fc', elevated: '#efedf8',
    line: 'rgba(20,18,40,0.10)', lineSoft: 'rgba(20,18,40,0.06)', hair: 'rgba(124,58,237,0.20)',
    text: '#1b1830', muted: '#5b5870', faint: '#9b98ad',
    accent: '#7c3aed', accentLite: '#8b5cf6', accentRgb: '124,58,237',
    gradient: 'linear-gradient(135deg, #14b8a6 0%, #6d78ea 52%, #6366f1 100%)',
    green: '#16a34a', red: '#dc2626', amber: '#d97706', cyan: '#0d9488',
  };
}

/* ─── Icons (lucide paths; SF-Symbol equivalents in the Swift map) ─── */
const M_IC = {
  micFill: 'M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4zM19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 0 0 2 0v-3.08A7 7 0 0 0 19 11z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  stopFill: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  copy: 'M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  chevR: 'M9 6l6 6-6 6', chevL: 'M15 18l-6-6 6-6', chevD: 'M6 9l6 6 6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  x: 'M18 6L6 18M6 6l12 12', check: 'M20 6L9 17l-5-5', plus: 'M12 5v14M5 12h14',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
  cpu: 'M6 6h12v12H6zM9 9h6v6H9M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2',
  spark: 'M12 2l2.2 6.4L21 11l-6.8 2.6L12 20l-2.2-6.4L3 11l6.8-2.6z',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  keyboard: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M9 13h6M18 13h.01',
  watch: 'M9 3h6l.8 3.5a6 6 0 0 1 0 11L15 21H9l-.8-3.5a6 6 0 0 1 0-11zM12 9v3l1.5 1.5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 0 2 2h13',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  sync: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.5 15',
  arrowUR: 'M7 17L17 7M8 7h9v9',
  message: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  briefcase: 'M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2 12h20',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6',
  idea: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  timer: 'M10 2h4M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 14l3-3',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  hammer: 'M15 12l-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9M17.64 15 22 10.64M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91',
  command: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3',
  people: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  server: 'M2 4h20v7H2zM2 13h20v7H2zM6 7.5h.01M6 16.5h.01',
  pencil: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  play: 'M5 3l14 9-14 9V3z',
  stop: 'M6 6h12v12H6z',
};
function MIcon({ k, size = 18, fill = 'none', sw = 2, style }) {
  const filled = k === 'micFill' || k === 'stopFill';
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}><path d={M_IC[k]} /></svg>;
}
const WGhost = ({ size = 26, style }) => <Logo size={size} style={style} />;

/* ─── Sample data (SampleData.swift) ─── */
const M_RECS = [
  { id: 1, title: 'Refactor the auth module to use JWT tokens and add refresh-token rotation', src: 'keyboard', app: 'Terminal', dur: '0:09', when: 'Just now', words: 14, engine: 'on-device', category: 'code', today: true },
  { id: 2, title: 'Reply: Thanks for the update — let’s push the launch to next Thursday so QA has a full cycle.', src: 'action', app: 'Mail', dur: '0:12', when: '2m ago', words: 19, engine: 'on-device', category: 'work', today: true },
  { id: 9, title: 'Launch moves to Thursday; staging cert lands Tuesday — Mara owns the follow-up.', src: 'mic', app: 'Conversation', dur: '12:40', when: '1h ago', words: 182, engine: 'cloud', category: 'work', today: true, segments: [
    { speaker: 'speaker_1', text: 'Okay, so the launch moves to Thursday — everyone fine with that?' },
    { speaker: 'speaker_2', text: 'Works for me, but the staging cert has to land by Tuesday or QA loses the window.' },
    { speaker: 'speaker_1', text: 'Deal. I’ll ping infra today and own the follow-up.' },
    { speaker: 'speaker_2', text: 'Then I’ll take the release notes and the App Store copy.' },
  ], speakerNames: { speaker_2: 'Mara' } },
  { id: 3, title: 'Idea: a weekly digest that summarizes every voice note into three bullet points.', src: 'watch', app: 'Synced from Watch', dur: '0:07', when: '14m ago', words: 13, engine: 'on-device', category: 'ideas', today: true },
  { id: 4, title: 'Grocery: oat milk, sourdough, the good olive oil, lemons, and coffee beans.', src: 'backtap', app: 'Notes', dur: '0:06', when: '1h ago', words: 11, engine: 'on-device', category: 'todo', today: true },
  { id: 5, title: 'Standup notes — shipped the export pipeline, blocked on the staging cert, pairing with Mara after lunch.', src: 'app', app: 'In-app', dur: '0:15', when: 'Yesterday', words: 18, engine: 'cloud', category: 'work', today: false },
  { id: 6, title: 'Text Sam: running ten late, grab us a table by the window if you can.', src: 'keyboard', app: 'Messages', dur: '0:05', when: 'Yesterday', words: 14, engine: 'on-device', category: 'messages', today: false },
];
const M_MODELS = [
  { id: 'apple', name: 'Apple Speech', sub: 'Built-in · on-device', size: 'System', state: 'active', tag: 'Default' },
  { id: 'apple-int', name: 'Apple Intelligence', sub: 'Cleanup & summaries · on-device', size: 'System', state: 'ready', tag: 'A17+ / M-series' },
  { id: 'whisper-s', name: 'Whisper small', sub: 'Higher accuracy · 99 languages', size: '466 MB', state: 'ready' },
  { id: 'whisper-b', name: 'Whisper base', sub: 'Balanced · multilingual', size: '142 MB', state: 'downloading', pct: 64 },
  { id: 'whisper-t', name: 'Whisper tiny', sub: 'Fastest · English', size: '75 MB', state: 'get' },
];
const M_CATS = [
  { id: 'work', label: 'Work', icon: 'briefcase', hue: '#4a8cf7' },
  { id: 'code', label: 'Code', icon: 'code', hue: '#a78bfa' },
  { id: 'ideas', label: 'Ideas', icon: 'idea', hue: '#fbbf24' },
  { id: 'todo', label: 'To-do', icon: 'check', hue: '#34d399' },
  { id: 'messages', label: 'Messages', icon: 'message', hue: '#f472b6' },
];
const catOf = (id) => M_CATS.find((c) => c.id === id) || M_CATS[0];
const srcIconOf = (src) => ({ watch: 'watch', action: 'bolt', backtap: 'more', keyboard: 'keyboard' }[src] || 'mic');
const srcLabelOf = (src) => ({ keyboard: 'Keyboard', action: 'Action Button', backtap: 'Back-Tap', watch: 'Watch', lock: 'Lock Screen' }[src] || 'In-app');

/* ─── Primitives (Components.swift) ─── */
function PrivacyBadge({ mode = 'device', small, t }) {
  const device = mode === 'device';
  const c = device ? t.green : t.amber;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', fontFamily: FM, fontSize: small ? 10.5 : 11.5, fontWeight: 600, color: c, padding: small ? '3px 9px' : '5px 11px', borderRadius: 999, background: hexA(c, t.mode === 'dark' ? 0.12 : 0.09), border: `1px solid ${hexA(c, t.mode === 'dark' ? 0.28 : 0.25)}` }}>
      <MIcon k={device ? 'lock' : 'cloud'} size={small ? 11 : 12} /> {device ? 'On-device' : 'Cloud'}
    </span>
  );
}
function EngineChip({ label, icon = 'cpu', on = true, t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FM, fontSize: 11, fontWeight: 600, color: on ? t.accentLite : t.muted, padding: '5px 11px', borderRadius: 999, background: on ? hexA(t.accent, t.mode === 'dark' ? 0.16 : 0.10) : t.surfaceUp, border: `1px solid ${on ? t.hair : t.line}` }}>
      <MIcon k={icon} size={12} /> {label}
    </span>
  );
}
function SourceBadge({ src, t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FM, fontSize: 10.5, fontWeight: 500, color: t.muted, padding: '3px 8px', borderRadius: 999, background: t.surfaceUp, border: `1px solid ${t.line}` }}>
      <MIcon k={srcIconOf(src)} size={11} /> {srcLabelOf(src)}
    </span>
  );
}
function GradButton({ title, icon, onClick, t, style }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: FUI, fontSize: 15, fontWeight: 600, color: '#fff', padding: '13px 20px', borderRadius: 14, border: 'none', cursor: 'pointer', background: t.gradient, boxShadow: `0 8px 20px -4px ${hexA(t.accent, 0.5)}`, ...style }}>
      {icon && <MIcon k={icon} size={17} />} {title}
    </button>
  );
}
function GhostBtn({ title, icon, onClick, t, style }) {
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: FUI, fontSize: 14, fontWeight: 600, color: t.text, padding: '12px 18px', borderRadius: 14, cursor: 'pointer', background: t.surfaceUp, border: `1px solid ${t.line}`, ...style }}>
      {icon && <MIcon k={icon} size={16} />} {title}
    </button>
  );
}
function MToggle({ on, onChange, t }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 46, height: 28, borderRadius: 999, border: on ? 'none' : `1px solid ${t.line}`, background: on ? t.accent : t.elevated, position: 'relative', cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'background .2s' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.4)', transition: 'left .22s cubic-bezier(.16,.84,.44,1)' }} />
    </button>
  );
}
function MSegmented({ options, value, onChange, t }) {
  return (
    <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 12, background: t.surfaceUp, border: `1px solid ${t.line}` }}>
      {options.map((o) => {
        const on = o.id === value;
        return <button key={o.id} onClick={() => onChange(o.id)} style={{ flex: 1, fontFamily: FUI, fontSize: 13, fontWeight: 600, color: on ? '#fff' : t.muted, background: on ? t.accent : 'transparent', border: 'none', borderRadius: 9, padding: '8px 6px', cursor: 'pointer' }}>{o.label}</button>;
      })}
    </div>
  );
}
function Waveform({ t, color, bars = 28, height = 56, active = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height }}>
      {Array.from({ length: bars }).map((_, i) => {
        const base = 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7));
        return <span key={i} style={{ width: 3, height: '100%', borderRadius: 3, background: color || t.accent, transformOrigin: 'center', transform: `scaleY(${active ? base : 0.2})`, animation: active ? `mwave ${(0.7 + (i % 5) * 0.12).toFixed(2)}s ease-in-out ${(i * 0.045).toFixed(2)}s infinite` : 'none' }} />;
      })}
    </div>
  );
}
function MiniWave({ t, color, n = 22, height = 18 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height }}>
      {Array.from({ length: n }).map((_, i) => <span key={i} style={{ width: 2, height: height * (0.2 + 0.8 * Math.abs(Math.sin(i * 0.9 + 1))), borderRadius: 2, background: color || t.accent, opacity: 0.55 }} />)}
    </div>
  );
}
function SectionLabel({ text, t }) {
  return <div style={{ fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: t.faint }}>{text}</div>;
}
function SquareIconButton({ icon, onClick, t }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.text, cursor: 'pointer', flexShrink: 0 }}>
      <MIcon k={icon} size={17} />
    </button>
  );
}
function WHeader({ title, onBack, right, t, logo }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 12px' }}>
      {onBack && <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.text, cursor: 'pointer' }}><MIcon k="chevL" size={18} /></button>}
      {logo && window.ListeningGhost && <ListeningGhost phase="sway" size={40} clickFun />}
      <h1 style={{ fontFamily: FD, fontSize: 24, fontWeight: 600, color: t.text, letterSpacing: '-.01em', flex: 1 }}>{title}</h1>
      {right}
    </div>
  );
}
function CategoryTag({ cat, t }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FM, fontSize: 9.5, fontWeight: 600, color: cat.hue, padding: '2px 7px', borderRadius: 999, background: hexA(cat.hue, t.mode === 'dark' ? 0.14 : 0.10), border: `1px solid ${hexA(cat.hue, t.mode === 'dark' ? 0.26 : 0.22)}` }}>
      <MIcon k={cat.icon} size={9.5} /> {cat.label}
    </span>
  );
}
function CategoryFilterChip({ cat, selected, onClick, t }) {
  const c = cat ? cat.hue : t.accent;
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FUI, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', color: selected ? (cat ? c : t.accentLite) : t.muted, padding: '6px 12px', borderRadius: 999, cursor: 'pointer', background: selected ? hexA(c, t.mode === 'dark' ? 0.16 : 0.11) : t.surfaceUp, border: `1px solid ${selected ? hexA(c, 0.4) : t.line}` }}>
      {cat && <MIcon k={cat.icon} size={12} />} {cat ? cat.label : 'All'}
    </button>
  );
}

/* ─── iOS status bar + screen scaffold ─── */
function StatusBar({ t, light }) {
  const fg = light ? '#fff' : t.text;
  return (
    <div style={{ height: 44, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', padding: '0 26px 6px', flexShrink: 0 }}>
      <span style={{ fontFamily: FUI, fontSize: 15, fontWeight: 600, color: fg }}>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="12" viewBox="0 0 18 12" fill={fg}><rect x="0" y="7" width="3" height="5" rx="1" /><rect x="5" y="4" width="3" height="8" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" opacity="0.4" /><rect x="15" y="0" width="3" height="12" rx="1" opacity="0.4" /></svg>
        <svg width="16" height="12" viewBox="0 0 18 13" fill="none" stroke={fg} strokeWidth="1.5"><path d="M1 5a12 12 0 0 1 16 0M4 8a7 7 0 0 1 10 0M6.5 10.5a3.5 3.5 0 0 1 5 0" strokeLinecap="round" /></svg>
        <svg width="26" height="13" viewBox="0 0 28 14" fill="none"><rect x="1" y="1.5" width="22" height="11" rx="3" stroke={fg} strokeOpacity="0.5" /><rect x="3" y="3.5" width="17" height="7" rx="1.5" fill={fg} /><rect x="24.5" y="5" width="2" height="4" rx="1" fill={fg} fillOpacity="0.5" /></svg>
      </div>
    </div>
  );
}
function ScreenScaffold({ t, bg, light, children }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: bg || t.bg, overflow: 'hidden' }}>
      <StatusBar t={t} light={light} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

function hexA(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

Object.assign(window, {
  buildMobTheme, M_IC, MIcon, WGhost, M_RECS, M_MODELS, M_CATS, catOf, srcIconOf, srcLabelOf,
  PrivacyBadge, EngineChip, SourceBadge, GradButton, GhostBtn, MToggle, MSegmented, Waveform, MiniWave,
  SectionLabel, SquareIconButton, WHeader, CategoryTag, CategoryFilterChip, StatusBar, ScreenScaffold, hexA,
});
