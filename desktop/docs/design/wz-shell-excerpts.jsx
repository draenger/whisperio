/* Whisperio — app shell excerpts (DESIGN REFERENCE, vendored from the Claude Design project
   wz2/wz-shell.jsx). TARGET patterns for the shipping settings window (760×780):
   StatusHeader strip, SideNav with accent tick + version badge, auto-save bar (NO Save button
   in the redesign), TitleBar with logo + theme toggle. Tweaks-panel/App scaffolding omitted. */

/* ─── Redesign-only status strip: puts the key runtime info in its place ─── */
function StatusHeader({ state, theme }) {
  const engines = state.providerChain.map((id) => (PROVIDERS.find((p) => p.id === id) || {}).label).filter(Boolean);
  const item = (label, node) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ fontFamily: FM, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: theme.textMuted }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{node}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '11px 20px', background: theme.bgSecondary, borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
      {item('Status', <><StatusDot color={theme.success} glow /><span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Ready</span></>)}
      <div style={{ width: 1, height: 26, background: theme.border }} />
      {item('Dictate', <Keycaps combo={state.dictationHotkey || 'Ctrl+Shift+Space'} theme={theme} />)}
      <div style={{ width: 1, height: 26, background: theme.border }} />
      {item('Engine chain', <span style={{ fontSize: 12.5, color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {engines.map((e, i) => <React.Fragment key={i}>{i > 0 && <span style={{ color: theme.textMuted, margin: '0 5px' }}>→</span>}<span style={{ color: i === 0 ? theme.accentLight : theme.textSecondary, fontWeight: i === 0 ? 600 : 400 }}>{e}</span></React.Fragment>)}
      </span>)}
      <div style={{ flex: 1 }} />
      {state.aiPostProcessing && <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: theme.textMuted }}><Icon d={IC.bolt} size={13} style={{ color: theme.accentLight }} /> AI cleanup</span>}
    </div>
  );
}

/* ─── Sidebar navigation — mono eyebrow, accent tick on active, version badge ─── */
function SideNav({ activeTab, setTab, s, theme, design, version }) {
  return (
    <nav style={s.sidebar}>
      <div style={s.sidebarLabel}>Settings</div>
      {TABS.map((tb) => {
        const on = activeTab === tb.id;
        return (
          <button key={tb.id} onClick={() => setTab(tb.id)} style={{ ...s.navItem, ...(on ? s.navItemActive : {}) }}>
            {design.mode === 'redesign' && on && <span style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 3, borderRadius: 2, background: theme.accent }} />}
            <span style={{ display: 'flex', flexShrink: 0, color: on ? theme.accentLight : theme.textMuted }}><Icon d={NAV_ICON[tb.id]} size={16} /></span>
            {tb.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <div style={s.versionBadge}><StatusDot color={theme.success} size={6} /> v1.5.0</div>
    </nav>
  );
}

/* ─── Auto-save affordance (redesign replaces the Save button entirely) ───
   In SettingsWindow:
     <div style={{ ...s.saveBar, justifyContent: 'flex-start' }}>
       <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5,
                      color: savedPulse ? theme.success : theme.textMuted, transition: 'color .3s' }}>
         <Icon d={IC.check} size={14} style={{ color: savedPulse ? theme.success : theme.accentLight }} />
         {savedPulse ? 'Saved' : 'Changes save automatically'}
       </span>
     </div>
   savedPulse: set(patch) flips it true and a 1400ms timeout flips it back. */

/* ─── TitleBar — logo + window title + theme toggle (sun/moon), macOS traffic lights
   or Windows min/max/close depending on platform; height 38, titlebarBg blur. ─── */
