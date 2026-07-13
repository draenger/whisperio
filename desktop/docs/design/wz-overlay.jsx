/* Whisperio — G1: desktop dictation overlay, full state set.
   States: armed → recording → transcribing → pasted → hidden, plus Command Mode.
   Redesign (cool): red dot = live semantic, teal→sky = transcribing, quiet on-device badge.
   Original (violet legacy) keeps its palette. Pin any state via Tweaks; Auto cycles. */

const OVL_IC = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  check: 'M20 6L9 17l-5-5',
};

function OvlOnDevice({ color }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FM, fontSize: 10, fontWeight: 600, letterSpacing: '.06em', color, padding: '3px 8px', borderRadius: 999, background: 'rgba(34,197,94,.10)', border: '1px solid rgba(34,197,94,.26)' }}>
      <Icon d={OVL_IC.lock} size={10} /> on-device
    </span>
  );
}

function DictationOverlay({ theme, design, pinned = 'Auto', offline = true, hint = true }) {
  const [auto, setAuto] = React.useState('rec');
  const [secs, setSecs] = React.useState(0);
  const isAuto = pinned === 'Auto';
  const phase = isAuto ? auto : ({ Idle: 'armed', Recording: 'rec', Command: 'cmd', Transcribing: 'proc', Pasted: 'done' }[pinned] || 'rec');

  React.useEffect(() => {
    if (!isAuto) return;
    let ts = [];
    const seq = () => {
      setAuto('armed'); setSecs(0);
      ts = [
        setTimeout(() => setAuto('rec'), 1100),
        setTimeout(() => setAuto('proc'), 4600),
        setTimeout(() => setAuto('done'), 6100),
        setTimeout(() => setAuto('hidden'), 7300),
      ];
    };
    seq();
    const iv = setInterval(seq, 8600);
    return () => { clearInterval(iv); ts.forEach(clearTimeout); };
  }, [isAuto]);
  React.useEffect(() => {
    if (phase !== 'rec' && phase !== 'cmd') { setSecs(0); return; }
    const iv = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [phase]);

  const red = design.mode === 'redesign';
  const accent = red ? theme.accentLight : '#a78bfa';
  const cmdAccent = red ? '#7cc0fb' : '#c4b5fd';
  const liveDot = '#ef4444';
  const pillBg = red ? 'rgba(9,15,24,.94)' : 'rgba(10,10,15,.92)';
  const border = phase === 'cmd'
    ? (red ? 'rgba(124,192,251,.42)' : 'rgba(196,181,253,.42)')
    : (red ? `rgba(${theme.accentRgb},.30)` : 'rgba(139,92,246,.3)');
  const timer = `0:${String(secs % 60).padStart(2, '0')}`;
  const wave = (color) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, height: 20 }}>
      {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ width: 3, height: '100%', borderRadius: 2, background: color, transformOrigin: 'center', animation: `wzwave .8s ease-in-out ${i * 0.15}s infinite` }} />)}
    </span>
  );

  const hintText = phase === 'cmd'
    ? <>Speak a transform — it rewrites, doesn’t insert · <b style={{ color: '#fff' }}>Esc</b> to cancel</>
    : <>Press <b style={{ color: '#fff' }}>Ctrl+Shift+Space</b> to stop · <b style={{ color: '#fff' }}>Esc</b> to cancel</>;
  const showHint = hint && (phase === 'rec' || phase === 'cmd');

  let content = null;
  if (phase === 'armed') {
    content = (
      <>
        <Icon d={OVL_IC.mic} size={14} style={{ color: theme.textMuted || 'rgba(255,255,255,.55)' }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,.6)', fontFamily: FUI }}>Ctrl+Shift+Space</span>
        {offline && <OvlOnDevice color="#4ade80" />}
      </>
    );
  } else if (phase === 'rec' || phase === 'cmd') {
    const isCmd = phase === 'cmd';
    content = (
      <>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: liveDot, boxShadow: `0 0 8px ${liveDot}`, animation: 'wzpulse 1.5s ease-in-out infinite' }} />
        {isCmd && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FM, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: cmdAccent, padding: '3px 8px', borderRadius: 999, background: red ? 'rgba(124,192,251,.12)' : 'rgba(196,181,253,.12)', border: `1px solid ${red ? 'rgba(124,192,251,.32)' : 'rgba(196,181,253,.32)'}` }}>
            <Icon d={OVL_IC.bolt} size={10} /> COMMAND
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.9)', fontFamily: FUI }}>{isCmd ? 'Listening for a command' : 'MacBook Pro Microphone'}</span>
        {wave(isCmd ? cmdAccent : accent)}
        <span style={{ fontFamily: FM, fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>{timer}</span>
        {offline && !isCmd && <OvlOnDevice color="#4ade80" />}
      </>
    );
  } else if (phase === 'proc') {
    content = (
      <>
        <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${border}`, borderTopColor: accent, animation: 'wzspin .8s linear infinite' }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.9)', fontFamily: FUI }}>Transcribing…</span>
        <span style={{ position: 'relative', width: 64, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}>
          <span style={{ position: 'absolute', top: 0, bottom: 0, width: 26, borderRadius: 2, background: red ? 'linear-gradient(90deg,#1cc8b4,#3da2f7)' : 'linear-gradient(90deg,#a78bfa,#6366f1)', animation: 'wzprog 1.1s ease-in-out infinite' }} />
        </span>
        {offline && <OvlOnDevice color="#4ade80" />}
      </>
    );
  } else if (phase === 'done') {
    content = (
      <>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: theme.success || '#22c55e', color: '#04231a' }}><Icon d={OVL_IC.check} size={10} /></span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.9)', fontFamily: FUI }}>Pasted</span>
        <span style={{ fontFamily: FM, fontSize: 11, color: 'rgba(255,255,255,.5)' }}>14 words</span>
      </>
    );
  }

  const hidden = phase === 'hidden';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
      <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(10,10,15,.95)', border: '1px solid rgba(255,255,255,.1)', whiteSpace: 'nowrap', opacity: showHint ? 1 : 0, transition: 'opacity .3s' }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.72)', fontFamily: FUI }}>{hintText}</span>
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: phase === 'armed' ? '8px 14px' : '12px 20px', borderRadius: 50, background: pillBg, border: `1px solid ${border}`, boxShadow: `0 8px 32px rgba(0,0,0,.5), 0 0 0 1px ${red ? `rgba(${theme.accentRgb},.1)` : 'rgba(139,92,246,.1)'}`, opacity: hidden ? 0 : (phase === 'armed' ? 0.85 : 1), transform: hidden ? 'translateY(8px) scale(.96)' : 'none', transition: 'opacity .35s, transform .35s, padding .25s' }}>
        {content}
      </div>
    </div>
  );
}

/* ─── Second display — same overlay, mirrored (multi-monitor support) ─── */
function MiniDisplay({ theme, design, themeMode, pinned, offline }) {
  const wall = themeMode === 'dark'
    ? 'radial-gradient(120% 100% at 50% -10%, #0c1826 0%, #05090f 60%)'
    : 'radial-gradient(120% 100% at 50% -10%, #eef3f8 0%, #dbe4ec 70%)';
  return (
    <div style={{ position: 'absolute', left: 22, bottom: 22, width: 300, borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,.10)', boxShadow: '0 24px 60px -20px rgba(0,0,0,.7)', zIndex: 30 }}>
      <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(8,12,18,.92)', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <svg width="12" height="10" viewBox="0 0 24 20" fill="none" stroke="rgba(255,255,255,.6)" strokeWidth="2"><rect x="2" y="2" width="20" height="13" rx="2" /><path d="M8 19h8M12 15v4" /></svg>
        <span style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.1em', color: 'rgba(255,255,255,.6)' }}>DISPLAY 2 · MIRRORED</span>
      </div>
      <div style={{ height: 148, background: wall, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 10 }}>
        <div style={{ transform: 'scale(.6)', transformOrigin: 'bottom center' }}>
          <DictationOverlay theme={theme} design={design} pinned={pinned} offline={offline} hint={false} />
        </div>
      </div>
    </div>
  );
}

const ovlStyleEl = document.createElement('style');
ovlStyleEl.textContent = '@keyframes wzprog{0%{left:-26px}100%{left:64px}}';
document.head.appendChild(ovlStyleEl);

Object.assign(window, { DictationOverlay, MiniDisplay });
