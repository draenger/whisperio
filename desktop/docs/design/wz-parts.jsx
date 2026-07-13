/* Whisperio — style factory (makeUI) + shared primitives.
   ORIGINAL branch reproduces desktop/src/renderer/components/settings makeStyles 1:1.
   REDESIGN branch applies Rezme geometry (bordered cards, radius 12–14, elevation, quieter density). */

function makeUI(theme, design) {
  const red = design.mode === 'redesign';
  const dense = design.density === 'compact';
  const cardPad = red ? (dense ? '13px 14px' : '16px 18px') : '0';
  const inputPad = dense ? '8px 12px' : '10px 14px';

  const inputBase = {
    background: theme.inputBg, border: `1px solid ${theme.inputBorder}`,
    borderRadius: red ? 10 : 8, padding: inputPad, fontSize: 14, color: theme.text,
    outline: 'none', fontFamily: FUI, width: '100%', transition: 'border-color .15s, box-shadow .15s',
  };

  return {
    container: {
      padding: red ? (dense ? '18px 20px 24px' : '22px 24px 28px') : '24px 26px 28px',
      display: 'flex', flexDirection: 'column', gap: red ? (dense ? 12 : 16) : 30,
    },
    scrollArea: { flex: 1, overflowY: 'auto', overflowX: 'hidden' },
    sidebar: {
      width: red ? 198 : 184, flexShrink: 0, borderRight: `1px solid ${theme.border}`,
      padding: red ? '16px 12px' : '14px 12px', display: 'flex', flexDirection: 'column', gap: 3,
      background: theme.bgSecondary,
    },
    sidebarLabel: {
      fontFamily: FM, fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
      color: theme.textMuted, padding: '2px 10px 10px',
    },
    navItem: {
      display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', cursor: 'pointer',
      border: 'none', borderRadius: red ? 10 : 9, padding: red ? '9px 12px' : '9px 11px',
      fontFamily: FUI, fontSize: 13.5, fontWeight: 600, background: 'transparent',
      color: theme.textSecondary, transition: 'background .15s, color .15s', position: 'relative',
    },
    navItemActive: red ? {
      background: `rgba(${theme.accentRgb},0.13)`, color: theme.accentLight, boxShadow: theme.e1,
    } : {
      background: theme.inputBg, color: theme.text, boxShadow: `inset 0 0 0 1px ${theme.border}`,
    },
    versionBadge: {
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px',
      fontFamily: FM, fontSize: 10.5, color: theme.textMuted,
    },
    card: red ? {
      display: 'flex', flexDirection: 'column', gap: dense ? 8 : 10, padding: cardPad,
      background: theme.bgSecondary, border: `1px solid ${theme.border}`, borderRadius: 14, boxShadow: theme.e1,
    } : {
      display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 4,
    },
    cardTitle: {
      fontFamily: FD, fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 4, letterSpacing: '.01em',
    },
    label: { fontSize: 12, fontWeight: 500, color: theme.textSecondary, marginTop: 4 },
    input: inputBase,
    textarea: { ...inputBase, resize: 'vertical', minHeight: 60, lineHeight: 1.5 },
    select: { ...inputBase, cursor: 'pointer' },
    hint: { fontSize: red ? 11.5 : 11, color: theme.textMuted, lineHeight: red ? 1.5 : 1.4 },
    saveBar: {
      padding: '12px 24px', borderTop: `1px solid ${theme.border}`, background: theme.bg,
      flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12,
    },
    button: {
      background: theme.accent, color: theme.accentInk, border: 'none', borderRadius: red ? 10 : 8,
      padding: '10px 26px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FD,
      transition: 'background .2s, box-shadow .2s, opacity .2s', letterSpacing: '.01em',
    },
  };
}

/* Titled section. Original = flat titled group (verbatim). Redesign = bordered card + accent tick. */
function Section({ title, hint, headerRight, children, s, theme, design }) {
  const red = design.mode === 'redesign';
  return (
    <div style={s.card}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: hint ? 2 : 4 }}>
          {red && <span style={{ width: 3, height: 15, borderRadius: 2, background: theme.accent, flexShrink: 0 }} />}
          <h3 style={{ ...s.cardTitle, marginBottom: 0, flex: 1 }}>{title}</h3>
          {headerRight}
        </div>
      )}
      {hint && <span style={{ ...s.hint, marginLeft: red ? 12 : 0, marginBottom: 2, display: 'block' }}>{hint}</span>}
      {children}
    </div>
  );
}

/* Toggle row — from SettingsForm.tsx ToggleRow, redesign gets a slightly larger teal switch. */
function ToggleRow({ label, description, checked, onChange, theme, design }) {
  const red = design && design.mode === 'redesign';
  const w = red ? 44 : 40, h = red ? 24 : 22, knob = red ? 18 : 16;
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', cursor: 'pointer', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: theme.text }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2, textWrap: 'pretty' }}>{description}</div>}
      </div>
      <div style={{
        width: w, height: h, borderRadius: h / 2, background: checked ? theme.accent : theme.bgTertiary,
        border: `1px solid ${checked ? theme.accent : theme.border}`, position: 'relative',
        transition: 'background .2s, border-color .2s', flexShrink: 0,
        boxShadow: checked ? `0 0 8px ${theme.accentGlow}` : 'none',
      }}>
        <div style={{
          width: knob, height: knob, borderRadius: '50%', background: checked ? '#fff' : theme.textMuted,
          position: 'absolute', top: 2, left: checked ? w - knob - 3 : 2, transition: 'left .2s cubic-bezier(.16,.84,.44,1), background .2s',
          boxShadow: checked ? '0 1px 2px rgba(0,0,0,.35)' : 'none',
        }} />
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ display: 'none' }} />
    </label>
  );
}

/* Segmented control (redesign top-nav + option pickers). */
function Segmented({ options, value, onChange, theme, size = 'md' }) {
  const pad = size === 'sm' ? '5px 11px' : '7px 14px';
  return (
    <div style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 10, background: theme.bgTertiary, border: `1px solid ${theme.border}` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            display: 'flex', alignItems: 'center', gap: 7, fontFamily: FUI, fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer', border: 'none', borderRadius: 8, padding: pad, whiteSpace: 'nowrap',
            background: on ? theme.accent : 'transparent', color: on ? theme.accentInk : theme.textSecondary,
            boxShadow: on ? theme.e1 : 'none', transition: 'background .15s, color .15s',
          }}>
            {o.icon && <span style={{ display: 'flex' }}><Icon d={o.icon} size={15} /></span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* Keycaps — render a "Ctrl+Shift+Space" accelerator as caps (redesign hotkeys). */
function Keycaps({ combo, theme }) {
  if (!combo) return <span style={{ fontFamily: FM, fontSize: 12, color: theme.textMuted }}>Not set</span>;
  const keys = combo.split('+');
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {keys.map((k, i) => (
        <span key={i} style={{
          fontFamily: FM, fontSize: 11.5, fontWeight: 600, color: theme.text, padding: '4px 9px',
          borderRadius: 7, background: theme.bgTertiary, border: `1px solid ${theme.border}`,
          boxShadow: `0 1px 0 ${theme.border}`,
        }}>{k}</span>
      ))}
    </div>
  );
}

function StatusDot({ color, glow, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, boxShadow: glow ? `0 0 8px ${color}` : 'none', flexShrink: 0 }} />;
}

/* Primary action button honoring redesign gradient/solid + hover. */
function PrimaryButton({ children, onClick, theme, design, style, disabled }) {
  const grad = design.mode === 'redesign' && theme.primaryStyle === 'gradient';
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: grad ? theme.gradient : theme.accent, color: grad ? '#fff' : theme.accentInk,
        border: 'none', borderRadius: design.mode === 'redesign' ? 10 : 8, padding: '10px 26px',
        fontSize: 14, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontFamily: FD, letterSpacing: '.01em',
        opacity: disabled ? 0.55 : (hover && grad ? 0.9 : 1),
        boxShadow: hover && !disabled ? `0 0 20px ${theme.accentGlow}` : 'none',
        transition: 'background .2s, box-shadow .2s, opacity .2s', ...style,
      }}>
      {children}
    </button>
  );
}

/* Ghost / outline button used across recordings + detail. */
function GhostButton({ children, onClick, theme, danger, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, background: hover && danger ? 'rgba(240,85,107,.08)' : 'none',
        border: `1px solid ${hover ? (danger ? theme.danger : theme.accent) : theme.border}`, borderRadius: 9,
        padding: '8px 13px', fontSize: 13, fontWeight: 500, color: danger ? theme.danger : (hover ? theme.text : theme.textSecondary),
        cursor: 'pointer', fontFamily: FUI, transition: 'border-color .15s, color .15s, background .15s', ...style,
      }}>
      {children}
    </button>
  );
}

Object.assign(window, { makeUI, Section, ToggleRow, Segmented, Keycaps, StatusDot, PrimaryButton, GhostButton });
