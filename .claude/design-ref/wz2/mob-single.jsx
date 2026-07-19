/* Whisperio Apple — single-device entry. One HTML per device (iPhone / Mac+iPad /
   Keyboard / Widgets / Watch) sharing all scenes from mob-*.jsx. Frames are duplicated
   from the board file so mob-app.jsx (which mounts the board) isn't loaded here. */

/* ─── Frames (copies of the board frames) ─── */
function SRecPill({ t, position = 'bottom' }) {
  const [secs, setSecs] = React.useState(8);
  React.useEffect(() => { const iv = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(iv); }, []);
  const pos = position === 'top' ? { top: 16, left: '50%', transform: 'translateX(-50%)' } : { bottom: 20, left: '50%', transform: 'translateX(-50%)' };
  return (
    <div style={{ position: 'absolute', zIndex: 30, ...pos, display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px 9px 11px', borderRadius: 999, background: 'rgba(8,8,12,.93)', border: `1px solid ${t.hair}`, boxShadow: '0 14px 36px rgba(0,0,0,.5)', pointerEvents: 'none' }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: t.gradient }}><WGhost size={17} /></span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: t.red, animation: 'mpulse 1.4s ease-in-out infinite' }} /><span style={{ fontFamily: FD, fontSize: 13, fontWeight: 600, color: '#fff' }}>Recording</span><span style={{ fontFamily: FM, fontSize: 10.5, color: 'rgba(255,255,255,.55)' }}>on-device</span></span>
      <Waveform t={t} color={t.accentLite} bars={16} height={16} />
      <span style={{ fontFamily: FM, fontSize: 12.5, color: 'rgba(255,255,255,.85)' }}>{`0:${String(secs % 60).padStart(2, '0')}`}</span>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: t.red, color: '#fff' }}><MIcon k="stopFill" size={12} /></span>
    </div>
  );
}
function SIPhoneFrame({ t, children, island = true }) {
  return (
    <div style={{ width: 416, height: 870, background: '#050506', borderRadius: 56, padding: 13, boxShadow: '0 60px 120px -40px rgba(0,0,0,.7), 0 0 0 2px rgba(255,255,255,.05)' }}>
      <div style={{ position: 'relative', width: 390, height: 844, borderRadius: 44, overflow: 'hidden', background: t.bg }}>
        {island && <div style={{ position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)', width: 118, height: 34, background: '#000', borderRadius: 20, zIndex: 20 }} />}
        {children}
      </div>
    </div>
  );
}
function SIPadFrame({ t, children, recPill }) {
  return (
    <div style={{ width: 1116, height: 846, background: '#08080a', borderRadius: 36, padding: 18, boxShadow: '0 70px 140px -50px rgba(0,0,0,.7), 0 0 0 2px rgba(255,255,255,.04)' }}>
      <div style={{ position: 'relative', width: 1080, height: 810, borderRadius: 20, overflow: 'hidden', background: t.bg }}>
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 7, height: 7, borderRadius: '50%', background: '#1a1a20', zIndex: 20 }} />
        {children}
        {recPill && <SRecPill t={t} position="top" />}
      </div>
    </div>
  );
}
function SWatchFrame({ t, children }) {
  return (
    <div style={{ position: 'relative', width: 236, height: 288, background: 'linear-gradient(160deg, #26262b, #0a0a0c)', borderRadius: 58, padding: '23px 19px', boxShadow: '0 50px 90px -34px rgba(0,0,0,.7)' }}>
      <div style={{ position: 'absolute', right: -5, top: '40%', width: 9, height: 34, borderRadius: 5, background: 'linear-gradient(90deg,#3a3a40,#17171a)' }} />
      <div style={{ width: 198, height: 242, borderRadius: 42, overflow: 'hidden', background: '#000' }}>{children}</div>
    </div>
  );
}
function SMacWindow({ t, title = 'Whisperio', children, w = 920, h = 600, recPill }) {
  return (
    <div style={{ position: 'relative', width: w, background: t.bg, borderRadius: 12, overflow: 'hidden', boxShadow: '0 70px 130px -46px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 36, padding: '0 14px', background: t.surface, borderBottom: `1px solid ${t.line}`, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 8 }}>{['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />)}</div>
        <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: FUI, fontSize: 12.5, fontWeight: 500, color: t.muted, pointerEvents: 'none' }}>{title}</span>
      </div>
      <div style={{ height: h }}>{children}</div>
      {recPill && <SRecPill t={t} position="bottom" />}
    </div>
  );
}

/* ─── Fit-to-viewport scale ─── */
function useFitScale(w, h, pad = 56, max = 1.15) {
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const fit = () => setScale(Math.min(max, (window.innerWidth - pad) / w, (window.innerHeight - pad) / h));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [w, h, pad, max]);
  return scale;
}

/* ─── Pan/zoom canvas for the Screens gallery ─── */
function ScreenPanZoom({ t, themeMode, cols, children }) {
  const wrapRef = React.useRef(null);
  const contentRef = React.useRef(null);
  const [v, setV] = React.useState(null);
  const drag = React.useRef(null);
  const fit = React.useCallback(() => {
    const el = wrapRef.current, ct = contentRef.current;
    if (!el || !ct) return;
    const w = el.clientWidth, h = el.clientHeight;
    const cw = ct.scrollWidth || 1, ch = ct.scrollHeight || 1;
    const scale = Math.min(1, (w - 60) / cw, (h - 130) / ch);
    setV({ scale, tx: (w - cw * scale) / 2, ty: Math.max(64, (h - ch * scale) / 2) });
  }, []);
  React.useEffect(() => { fit(); const onR = () => fit(); window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR); }, [fit]);
  const cur = v || { scale: 0.7, tx: 40, ty: 70 };
  const onWheel = (e) => {
    e.preventDefault();
    const el = wrapRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    setV((s0) => {
      const s = s0 || cur;
      const f = Math.exp(-e.deltaY * 0.0016);
      const scale = Math.min(3, Math.max(0.25, s.scale * f));
      const k = scale / s.scale;
      return { scale, tx: px - (px - s.tx) * k, ty: py - (py - s.ty) * k };
    });
  };
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, tx: cur.tx, ty: cur.ty }; };
  const onMove = (e) => { const d = drag.current; if (!d) return; const nx = d.tx + e.clientX - d.x, ny = d.ty + e.clientY - d.y; setV((s0) => ({ ...(s0 || cur), tx: nx, ty: ny })); };
  const onUp = () => { drag.current = null; };
  return (
    <div ref={wrapRef} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', cursor: 'grab', touchAction: 'none' }}>
      <div style={{ transform: `translate(${cur.tx}px, ${cur.ty}px) scale(${cur.scale})`, transformOrigin: '0 0', visibility: v ? 'visible' : 'hidden' }}>
        <div ref={contentRef} style={{ width: 'max-content', display: 'grid', gridTemplateColumns: `repeat(${cols}, max-content)`, gap: 36, padding: 8 }}>
          {children}
        </div>
      </div>
      <div style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 14px', borderRadius: 999, background: themeMode === 'dark' ? 'rgba(16,24,36,.78)' : 'rgba(255,255,255,.8)', border: `1px solid ${t.line}`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', fontFamily: FM, fontSize: 11, color: t.muted, pointerEvents: 'none' }}>
        <span>Scroll to zoom · drag to pan</span>
        <button onClick={fit} style={{ pointerEvents: 'auto', fontFamily: FM, fontSize: 11, fontWeight: 600, color: t.accentLite, background: hexA(t.accent, 0.14), border: `1px solid ${t.hair}`, borderRadius: 999, padding: '4px 10px', cursor: 'pointer' }}>Reset view</button>
      </div>
    </div>
  );
}

const SINGLE_DEFAULTS = {
  iphone: { version: 'Redesign', dark: true, redesignAccent: '#1cc8b4', screen: 'App' },
  keyboard: { version: 'Redesign', dark: true, redesignAccent: '#1cc8b4', keyboard: 'Pro' },
  widgets: { version: 'Redesign', dark: true, redesignAccent: '#1cc8b4' },
  watch: { version: 'Redesign', dark: true, redesignAccent: '#1cc8b4' },
  mac: { version: 'Redesign', dark: true, redesignAccent: '#1cc8b4', device: 'Mac' },
};

function SingleDeviceApp({ kind }) {
  const [tweaks, setTweak] = useTweaks(SINGLE_DEFAULTS[kind] || SINGLE_DEFAULTS.iphone);
  const isRedesign = true;
  const themeView = tweaks.themeView || (tweaks.dark === false ? 'light' : 'dark');
  const themeMode = themeView === 'light' ? 'light' : 'dark';
  const accentKey = tweaks.redesignAccent === '#3da2f7' ? 'sky' : 'teal';
  const t = buildMobTheme(isRedesign ? 'redesign' : 'original', themeMode, accentKey);
  const tLight = buildMobTheme(isRedesign ? 'redesign' : 'original', 'light', accentKey);
  const setThemeView = (v) => { setTweak('themeView', v); setTweak('dark', v !== 'light'); };
  const setDark = (v) => setThemeView(v ? 'dark' : 'light');
  const duo = themeView === 'both';

  let w = 416, h = 870, maxScale = 1.15;
  if (kind === 'watch') { w = 236; h = 288; maxScale = 2.2; }
  else if (kind === 'mac') { if ((tweaks.device || 'Mac') === 'iPad') { w = 1116; h = 846; } else { w = 920; h = 636; } }
  const buildDevice = (T) => {
    if (kind === 'iphone') {
      const screen = tweaks.screen || 'App';
      const inner =
        screen === 'Onboarding' ? <OnboardingScene t={T} /> :
        screen === 'Recap' ? <RecapScene t={T} /> :
        screen === 'Scratchpad' ? <ScreenScaffold t={T}><PhoneScratchpad t={T} /></ScreenScaffold> :
        screen === 'Settings' ? <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={setDark} /></ScreenScaffold> :
        screen === 'Data & storage' ? <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={setDark} initial="storage" /></ScreenScaffold> :
        screen === 'Triggers' ? <TriggerScene t={T} /> :
        screen === 'Dynamic Island' ? <DynamicIslandScene t={T} /> :
        <PhoneApp t={T} setDark={setDark} manualSync={!!tweaks.manualSync} />;
      return <SIPhoneFrame t={T} island={screen !== 'Dynamic Island'}>{inner}</SIPhoneFrame>;
    }
    if (kind === 'keyboard') return <SIPhoneFrame t={T}>{(tweaks.keyboard || 'Pro') === 'Classic' ? <KeyboardSceneClassic t={T} /> : <KeyboardScenePro t={T} />}</SIPhoneFrame>;
    if (kind === 'widgets') return <SIPhoneFrame t={T}><WidgetScene t={T} /></SIPhoneFrame>;
    if (kind === 'watch') return <SWatchFrame t={T}><WatchApp t={T} /></SWatchFrame>;
    return (tweaks.device || 'Mac') === 'iPad'
      ? <SIPadFrame t={T} recPill><AppleSplit t={T} /></SIPadFrame>
      : <SMacWindow t={T} w={920} h={600} recPill><AppleSplit t={T} engineBar /></SMacWindow>;
  };

  const scale = useFitScale(duo ? w * 2 + 44 : w, h, 56, maxScale);
  const wall = isRedesign
    ? (themeMode === 'dark' ? 'radial-gradient(120% 100% at 50% -10%, #0c1826 0%, #05090f 60%)' : 'radial-gradient(120% 100% at 50% -10%, #eef3f8 0%, #dbe4ec 70%)')
    : (themeMode === 'dark' ? 'radial-gradient(130% 110% at 50% 0%, #121722 0%, #080a10 55%, #05070b 100%)' : 'radial-gradient(130% 110% at 50% 0%, #eef2f7 0%, #dee5ee 60%, #d3dbe6 100%)');

  const view = tweaks.view === 'Screens' ? 'Screens' : 'Mock';
  const labCol = themeMode === 'dark' ? 'rgba(236,242,249,.85)' : 'rgba(20,30,44,.8)';
  const Group = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontFamily: FD, fontSize: 17, fontWeight: 650, letterSpacing: '.02em', color: labCol }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: themeMode === 'dark' ? 'rgba(255,255,255,.09)' : 'rgba(20,30,44,.12)' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>{children}</div>
    </div>
  );
  const Row = ({ children }) => <div style={{ display: 'flex', gap: 36, alignItems: 'flex-start' }}>{children}</div>;
  const Item = ({ label, w: iw, h: ih, scale: isc, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      <span style={{ fontFamily: FM, fontSize: 11.5, fontWeight: 600, letterSpacing: '.13em', textTransform: 'uppercase', color: labCol }}>{label}</span>
      <div style={{ width: iw * isc, height: ih * isc }}>
        <div style={{ transform: `scale(${isc})`, transformOrigin: 'top left', width: iw, height: ih }}>{children}</div>
      </div>
    </div>
  );

  let gallery = null;
  if (view === 'Screens') {
    const tL = tLight;
    if (kind === 'iphone') {
      const SHOTS = {
        'App': [
          ['Home', (T) => <PhoneApp t={T} setDark={() => {}} />],
          ['Home · manual sync', (T) => <PhoneApp t={T} setDark={() => {}} manualSync />],
          ['Recording · live', (T) => <PhoneApp t={T} setDark={() => {}} initialScreen="recording" />],
          ['Conversation · recording', (T) => <PhoneApp t={T} setDark={() => {}} initialScreen="conversation" />],
          ['Conversation · needs provider', (T) => <ScreenScaffold t={T}><PhoneConversation t={T} needsSetup onCancel={() => {}} onDone={() => {}} /></ScreenScaffold>],
          ['Detail · note', (T) => <PhoneApp t={T} setDark={() => {}} initialScreen="detail" />],
          ['Detail · conversation', (T) => <PhoneApp t={T} setDark={() => {}} initialScreen="detail" convoRec />],
          ['Detail · rewrite sheet', (T) => <ScreenScaffold t={T}><PhoneDetail t={T} r={M_RECS[0]} onBack={() => {}} initialSheet /></ScreenScaffold>],
          ['Scratchpad', (T) => <ScreenScaffold t={T}><PhoneScratchpad t={T} /></ScreenScaffold>],
        ],
        'Journal': [
          ['Journal', (T) => <PhoneApp t={T} setDark={() => {}} initialScreen="journal" />],
          ['New page · chooser', (T) => <PhoneApp t={T} setDark={() => {}} initialScreen="journalNew" />],
          ['New page · from notes', (T) => <ScreenScaffold t={T}><PhoneJournalNew t={T} onBack={() => {}} onDone={() => {}} initialMode="notes" /></ScreenScaffold>],
          ['Digest · today', (T) => <PhoneApp t={T} setDark={() => {}} initialScreen="digest" />],
          ['Digest · manual page', (T) => <ScreenScaffold t={T}><PhoneDigest t={T} dayKey="today" initialManual onBack={() => {}} onOpenRec={() => {}} /></ScreenScaffold>],
          ['Weekly recap', (T) => <RecapScene t={T} />],
        ],
        'Onboarding': [
          ['Welcome', (T) => <OnboardingScene t={T} initialStep={0} />],
          ['Privacy · engine choice', (T) => <OnboardingScene t={T} initialStep={1} />],
          ['Languages', (T) => <OnboardingScene t={T} initialStep={2} />],
          ['Keyboard', (T) => <OnboardingScene t={T} initialStep={3} />],
          ['Back-Tap', (T) => <OnboardingScene t={T} initialStep={4} />],
          ['First note', (T) => <OnboardingScene t={T} initialStep={5} />],
          ['Capture anywhere', (T) => <OnboardingScene t={T} initialStep={6} />],
          ['Beyond dictation', (T) => <OnboardingScene t={T} initialStep={7} />],
          ['Ready', (T) => <OnboardingScene t={T} initialStep={8} />],
        ],
        'Settings': [
          ['Hub', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} /></ScreenScaffold>],
          ['Models', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="models" /></ScreenScaffold>],
          ['Transcription', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="transcription" /></ScreenScaffold>],
          ['Integrations', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="integrations" /></ScreenScaffold>],
          ['Content', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="content" /></ScreenScaffold>],
          ['Sync', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="sync" /></ScreenScaffold>],
          ['Developer', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="developer" /></ScreenScaffold>],
          ['System', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="system" /></ScreenScaffold>],
        ],
        'Settings · deep pages': [
          ['On-device models', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="modelsList" /></ScreenScaffold>],
          ['Dictation triggers', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="triggers" /></ScreenScaffold>],
          ['Storage & data', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="storage" /></ScreenScaffold>],
          ['Template editor', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="presetEditor" /></ScreenScaffold>],
          ['GitHub sync', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="github" /></ScreenScaffold>],
          ['Keyboard setup', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="keyboard" /></ScreenScaffold>],
          ['Categorization', (T) => <ScreenScaffold t={T}><PhoneSettings t={T} dark={T.mode === 'dark'} setDark={() => {}} initial="categorize" /></ScreenScaffold>],
        ],
        'Edge states': [
          ['Empty · first run', (T) => <ScreenScaffold t={T}><StateHome t={T} empty /></ScreenScaffold>],
          ['Offline · feature', (T) => <ScreenScaffold t={T}><StateHome t={T} banner={<StateBanner tone="ok" icon="lock" title="You’re offline — and that’s fine" sub="On-device engine running at full speed. Nothing is waiting to upload." t={T} />} /></ScreenScaffold>],
          ['Cloud error · fallback', (T) => <ScreenScaffold t={T}><StateHome t={T} banner={<StateBanner tone="warn" icon="cloud" title="Couldn’t reach the cloud" sub="Transcribed on-device instead — your note is saved." action="Retry" t={T} />} /></ScreenScaffold>],
          ['Older iPhone · cloud engine', (T) => <ScreenScaffold t={T}><OldDeviceView t={T} /></ScreenScaffold>],
        ],
        'Triggers': [
          ['Triggers', (T) => <TriggerScene t={T} />],
          ['Dynamic Island', (T) => <DynamicIslandScene t={T} />],
        ],
      };
      gallery = <>
        {Object.entries(SHOTS).map(([gl, shots]) => (
          <Group key={gl} label={gl}>
            {themeView !== 'light' && <Row>{shots.map(([l, f]) => <Item key={l} label={l} w={416} h={870} scale={0.5}><SIPhoneFrame t={t} island={l !== 'Dynamic Island'}>{f(t)}</SIPhoneFrame></Item>)}</Row>}
            {themeView !== 'dark' && <Row>{shots.map(([l, f]) => <Item key={l} label={l + ' · light'} w={416} h={870} scale={0.5}><SIPhoneFrame t={tL} island={l !== 'Dynamic Island'}>{f(tL)}</SIPhoneFrame></Item>)}</Row>}
          </Group>
        ))}
      </>;
    }
    else if (kind === 'keyboard') gallery = <>
      <Group label="Keyboard">
        {themeView !== 'light' && <Row>
          <Item label="Pro · inline dictation" w={416} h={870} scale={0.5}><SIPhoneFrame t={t}><KeyboardScenePro t={t} /></SIPhoneFrame></Item>
          <Item label="Classic · bounce to app" w={416} h={870} scale={0.5}><SIPhoneFrame t={t}><KeyboardSceneClassic t={t} /></SIPhoneFrame></Item>
        </Row>}
        {themeView !== 'dark' && <Row>
          <Item label="Pro · light" w={416} h={870} scale={0.5}><SIPhoneFrame t={tL}><KeyboardScenePro t={tL} /></SIPhoneFrame></Item>
          <Item label="Classic · light" w={416} h={870} scale={0.5}><SIPhoneFrame t={tL}><KeyboardSceneClassic t={tL} /></SIPhoneFrame></Item>
        </Row>}
      </Group>
    </>;
    else if (kind === 'widgets') gallery = <>
      <Group label="Widgets">
        {themeView !== 'light' && <Row><Item label="Widgets · dark" w={416} h={870} scale={0.5}><SIPhoneFrame t={t}><WidgetScene t={t} /></SIPhoneFrame></Item></Row>}
        {themeView !== 'dark' && <Row><Item label="Widgets · light" w={416} h={870} scale={0.5}><SIPhoneFrame t={tL}><WidgetScene t={tL} /></SIPhoneFrame></Item></Row>}
      </Group>
    </>;
    else if (kind === 'watch') gallery = <>
      <Group label="Watch">
        <Row>
      <Item label="Watch · idle" w={236} h={288} scale={1.2}><SWatchFrame t={t}><WatchApp t={t} /></SWatchFrame></Item>
      <Item label="Watch · listening" w={236} h={288} scale={1.2}><SWatchFrame t={t}><WatchApp t={t} initialStage="recording" /></SWatchFrame></Item>
      <Item label="Watch · done · synced to iPhone" w={236} h={288} scale={1.2}><SWatchFrame t={t}><WatchApp t={t} initialStage="done" /></SWatchFrame></Item>
        </Row>
      </Group>
    </>;
    else gallery = <>
      <Group label="Mac">
        {themeView !== 'light' && <Row><Item label="Mac · dark" w={920} h={636} scale={0.52}><SMacWindow t={t} w={920} h={600} recPill><AppleSplit t={t} engineBar /></SMacWindow></Item></Row>}
        {themeView !== 'dark' && <Row><Item label="Mac · light" w={920} h={636} scale={0.52}><SMacWindow t={tL} w={920} h={600}><AppleSplit t={tL} engineBar /></SMacWindow></Item></Row>}
      </Group>
      <Group label="iPad">
        {themeView !== 'light' && <Row><Item label="iPad · dark" w={1116} h={846} scale={0.44}><SIPadFrame t={t} recPill><AppleSplit t={t} /></SIPadFrame></Item></Row>}
        {themeView !== 'dark' && <Row><Item label="iPad · light" w={1116} h={846} scale={0.44}><SIPadFrame t={tL}><AppleSplit t={tL} /></SIPadFrame></Item></Row>}
      </Group>
    </>;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: wall }}>
      {view === 'Mock' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ transform: `scale(${scale})`, display: 'flex', gap: 44, alignItems: 'center' }}>{buildDevice(t)}{duo && buildDevice(tLight)}</div>
        </div>
      ) : (
        <ScreenPanZoom t={t} themeMode={themeMode} cols={1}>{gallery}</ScreenPanZoom>
      )}
      <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, zIndex: 50 }}>
        <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 999, background: themeMode === 'dark' ? 'rgba(16,24,36,.82)' : 'rgba(255,255,255,.85)', border: `1px solid ${t.line}`, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
        {['Mock', 'Screens'].map((v) => (
          <button key={v} onClick={() => setTweak('view', v)} style={{ fontFamily: FUI, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 999, padding: '7px 18px', background: view === v ? t.accent : 'transparent', color: view === v ? '#fff' : t.muted }}>{v}</button>
        ))}
        </div>
        <button onClick={() => setThemeView(themeView === 'dark' ? 'light' : themeView === 'light' ? 'both' : 'dark')} title={themeView === 'dark' ? 'Dark — tap for Light' : themeView === 'light' ? 'Light — tap for Both (2 versions at once)' : 'Both — tap for Dark'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', cursor: 'pointer', background: themeMode === 'dark' ? 'rgba(16,24,36,.82)' : 'rgba(255,255,255,.85)', border: `1px solid ${t.line}`, color: t.muted, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
          {duo ? <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="2"></circle><path d="M12 3.75a8.25 8.25 0 0 1 0 16.5z" fill="currentColor"></path></svg> : <MIcon k={themeMode === 'dark' ? 'sun' : 'moon'} size={16} />}
        </button>
      </div>
      <TweaksPanel title="Tweaks">
        <TweakSection label="Design" />
        <TweakRadio label="Theme" value={themeView === 'both' ? 'Both' : themeView === 'light' ? 'Light' : 'Dark'} options={['Dark', 'Light', 'Both']} onChange={(v) => setThemeView(v.toLowerCase())} />
        {kind === 'iphone' && <>
          <TweakSection label="Screen" />
          <TweakSelect label="Screen" value={tweaks.screen || 'App'} options={['App', 'Scratchpad', 'Onboarding', 'Recap', 'Settings', 'Data & storage', 'Triggers', 'Dynamic Island']} onChange={(v) => setTweak('screen', v)} />
          {(tweaks.screen || 'App') === 'App' && <TweakToggle label="Manual sync (Sync now button)" value={!!tweaks.manualSync} onChange={(v) => setTweak('manualSync', v)} />}
        </>}
        {kind === 'keyboard' && <>
          <TweakSection label="Keyboard" />
          <TweakRadio label="Dictation UX" value={tweaks.keyboard || 'Pro'} options={['Pro', 'Classic']} onChange={(v) => setTweak('keyboard', v)} />
        </>}
        {kind === 'mac' && <>
          <TweakSection label="Device" />
          <TweakRadio label="Device" value={tweaks.device || 'Mac'} options={['Mac', 'iPad']} onChange={(v) => setTweak('device', v)} />
        </>}
      </TweaksPanel>
    </div>
  );
}

const singleStyleEl = document.createElement('style');
singleStyleEl.textContent = '@keyframes mwave{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}@keyframes mspin{to{transform:rotate(360deg)}}@keyframes msheet{from{opacity:0}to{opacity:1}}@keyframes mpulse{0%,100%{opacity:1}50%{opacity:.35}}@keyframes mkbin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes mring{0%{box-shadow:0 0 0 0 rgba(28,200,180,.45)}70%,100%{box-shadow:0 0 0 12px rgba(28,200,180,0)}}.wkb-key{transition:filter .06s,transform .06s;cursor:pointer;user-select:none;-webkit-user-select:none}.wkb-key:active{filter:brightness(1.4);transform:translateY(1px)}';
document.head.appendChild(singleStyleEl);

Object.assign(window, { SingleDeviceApp });
