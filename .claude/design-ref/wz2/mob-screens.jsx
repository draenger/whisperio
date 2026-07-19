/* Whisperio Apple — screens. iPhone (Home / Recording / Detail), iPad+Mac split, Watch.
   Ported from HomeView / RecordingView / DetailView / iPadView / WatchView.swift. */

/* ─── iPhone: recording row ─── */
/* RecRow — variant D (eyebrow): double-tap copies, swipe left reveals Delete */
function RecRow({ r, t, onTap, last }) {
  const [copied, setCopied] = React.useState(false);
  const [dx, setDx] = React.useState(0);
  const [removed, setRemoved] = React.useState(false);
  const drag = React.useRef(null);
  const tapTimer = React.useRef(null);
  React.useEffect(() => () => clearTimeout(tapTimer.current), []);
  const cat = catOf(r.category);
  const OPEN = -88;
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, base: dx, moved: false }; };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const ddx = e.clientX - d.x;
    if (Math.abs(ddx) > 8) d.moved = true;
    if (d.moved) setDx(Math.max(OPEN, Math.min(0, d.base + ddx)));
  };
  const onUp = () => {
    const d = drag.current; if (!d) return;
    drag.current = null;
    setDx((v) => v < OPEN / 2 ? OPEN : 0);
  };
  const onClick = () => {
    const d = drag.current;
    if (dx !== 0) { setDx(0); return; }
    if (tapTimer.current) {
      clearTimeout(tapTimer.current); tapTimer.current = null;
      setCopied(true); setTimeout(() => setCopied(false), 1300);
    } else {
      tapTimer.current = setTimeout(() => { tapTimer.current = null; onTap && onTap(); }, 270);
    }
  };
  if (removed) return null;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderBottom: last ? 'none' : `1px solid ${t.lineSoft}` }}>
      <button onClick={() => setRemoved(true)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 80, border: 'none', cursor: 'pointer', background: t.red, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontFamily: FUI, fontSize: 11, fontWeight: 600, opacity: dx < -8 ? 1 : 0 }}>
        <MIcon k="trash" size={16} /> Delete
      </button>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onClick={onClick}
        style={{ position: 'relative', padding: '11px 16px', display: 'flex', flexDirection: 'column', gap: 5, background: t.surface, transform: `translateX(${dx}px)`, transition: drag.current ? 'none' : 'transform .22s cubic-bezier(.2,.8,.3,1)', cursor: 'pointer', touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 10, color: t.faint }}>
          <MIcon k={srcIconOf(r.src)} size={12} style={{ color: t.accentLite }} />
          <span>{r.when}</span><span>·</span><span>{r.dur}</span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: cat.hue, fontWeight: 600 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: cat.hue }} /> {cat.label}</span>
          <MIcon k={r.engine === 'cloud' ? 'cloud' : 'lock'} size={11} style={{ color: r.engine === 'cloud' ? t.amber : t.green }} />
        </div>
        <div style={{ fontFamily: FUI, fontSize: 14.5, fontWeight: 500, color: t.text, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.title}</div>
        {copied && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexA(t.bg, 0.55), animation: 'msheet .18s' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FUI, fontSize: 12.5, fontWeight: 600, color: t.green, padding: '7px 14px', borderRadius: 999, background: t.elevated, border: `1px solid ${hexA(t.green, 0.4)}` }}><MIcon k="check" size={14} /> Copied</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* Manual sync — compact header icon: sync arrows → spinner → cloud (synced) */
function HomeSyncButton({ t }) {
  const [st, setSt] = React.useState('due');
  const sync = () => { if (st === 'syncing') return; setSt('syncing'); setTimeout(() => setSt('done'), 1600); };
  if (st === 'done') return (
    <button onClick={() => setSt('due')} title="iCloud sync · synced just now" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: t.faint }}><MIcon k="cloud" size={15} /></button>
  );
  return (
    <button onClick={sync} title={st === 'syncing' ? 'Syncing…' : 'Sync now'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, padding: 0, borderRadius: 12, cursor: 'pointer', color: t.accentLite, background: hexA(t.accent, 0.12), border: `1px solid ${t.hair}` }}>
      {st === 'syncing' ? <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${hexA(t.accent, 0.3)}`, borderTopColor: t.accentLite, animation: 'mspin .8s linear infinite' }} /> : <MIcon k="sync" size={16} />}
    </button>
  );
}

function PhoneHome({ t, onOpenRec, onRecord, onConversation, onSettings, onJournal, onDigest, onRecap, onScratchpad, manualSync, initialCat }) {
  const [cat, setCat] = React.useState(initialCat || null);
  const [cur, setCur] = React.useState('usd');
  const visible = cat ? M_RECS.filter((r) => r.category === cat) : M_RECS;
  const today = visible.filter((r) => r.today);
  const earlier = visible.filter((r) => !r.today);
  const group = (label, recs) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <SectionLabel text={label} t={t} />
      <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, overflow: 'hidden' }}>
        {recs.map((r, i) => <RecRow key={r.id} r={r} t={t} last={i === recs.length - 1} onTap={() => onOpenRec(r)} />)}
      </div>
    </div>
  );
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Whisperio" logo t={t} right={<div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><button onClick={() => setCur((c) => c === 'usd' ? 'eur' : 'usd')} title="Cloud spend this week — API dollars plus ElevenLabs credits valued as their share of your subscription. Tap to switch USD/EUR." style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FM, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', color: t.accentLite, background: hexA(t.accent, 0.12), border: `1px solid ${t.hair}`, borderRadius: 999, padding: '5px 10px' }}>{cur === 'usd' ? '$0.48' : '€0.44'}</button>{manualSync ? <HomeSyncButton t={t} /> : <span title="iCloud sync · idle" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, color: t.faint }}><MIcon k="cloud" size={15} /></span>}<SquareIconButton icon="cog" t={t} onClick={onSettings} /></div>} />
      <div style={{ padding: '4px 16px 0', display: 'flex', flexDirection: 'column', gap: 13 }}>
        {t.design === 'redesign' && (
          <div style={{ display: 'flex', gap: 9 }}>
            <button onClick={onJournal} style={{ flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, background: t.surface, border: `1px solid ${t.line}` }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, background: t.primary, color: t.primaryInk, flexShrink: 0 }}><MIcon k="pencil" size={17} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: t.accentLite }}>My journal</div>
                <div style={{ fontFamily: FUI, fontSize: 13, color: t.muted, lineHeight: 1.4, marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>12 days journaled · 4 notes today · last summary yesterday</div>
              </div>
            </button>
            <button onClick={onRecap} title="Weekly recap" style={{ width: 76, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 16, background: t.surface, border: `1px solid ${t.line}`, flexShrink: 0 }}>
              <MIcon k="bolt" size={17} style={{ color: t.accentLite }} />
              <span style={{ fontFamily: FD, fontSize: 15, fontWeight: 700, color: t.text, lineHeight: 1 }}>5d</span>
              <span style={{ fontFamily: FM, fontSize: 8.5, letterSpacing: '.1em', textTransform: 'uppercase', color: t.faint }}>Recap</span>
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 13, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.faint }}>
          <MIcon k="search" size={17} /> <span style={{ fontFamily: FUI, fontSize: 14.5 }}>Search transcripts</span>
        </div>
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
          <CategoryFilterChip cat={null} selected={cat === null} onClick={() => setCat(null)} t={t} />
          {M_CATS.map((c) => <CategoryFilterChip key={c.id} cat={c} selected={cat === c.id} onClick={() => setCat(c.id)} t={t} />)}
        </div>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 30, background: `linear-gradient(to bottom, ${t.bg}, transparent)`, zIndex: 2, pointerEvents: 'none' }} />
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 16px 150px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {today.length > 0 && group('Today', today)}
          {earlier.length > 0 && group('Earlier', earlier)}
        </div>
      </div>
      {t.design === 'redesign' ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '56px 16px 26px', background: `linear-gradient(to top, ${t.bg} 40%, ${hexA(t.bg, 0.85)} 62%, transparent)`, pointerEvents: 'none', display: 'flex', gap: 9 }}>
          <button onClick={onRecord} style={{ pointerEvents: 'auto', flex: 1, height: 56, borderRadius: 16, border: 'none', background: t.primary, color: t.primaryInk, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: FD, fontSize: 16, fontWeight: 600, boxShadow: `0 12px 26px -8px ${hexA(t.accent, 0.6)}` }}>
            <MIcon k="micFill" size={20} /> Dictate
          </button>
          <button onClick={onConversation} aria-label="Record a conversation" title="Conversation mode — separates speakers" style={{ pointerEvents: 'auto', width: 56, height: 56, borderRadius: 12, border: `1px solid ${hexA(t.accent, 0.35)}`, background: t.surface, color: t.accentLite, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <MIcon k="people" size={20} />
          </button>
        </div>
      ) : (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 130, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 34, background: `linear-gradient(to top, ${t.bg} 34%, transparent)`, pointerEvents: 'none' }}>
          <button onClick={onRecord} aria-label="Record" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 68, height: 68, borderRadius: '50%', border: 'none', background: t.primary, color: t.primaryInk, cursor: 'pointer', boxShadow: `0 0 0 6px ${t.bg}, 0 12px 26px -6px ${hexA(t.accent, 0.6)}` }}>
            <MIcon k="micFill" size={26} />
          </button>
        </div>
      )}
    </div>
  );
}

function PhoneRecording({ t, onCancel, onDone, initialPhase }) {
  const [phase, setPhase] = React.useState(initialPhase || 'listening');
  const [ghPhase, setGhPhase] = React.useState('start');
  React.useEffect(() => { const id = setTimeout(() => setGhPhase((p) => p === 'start' ? 'idle' : p), 1400); return () => clearTimeout(id); }, []);
  const [secs, setSecs] = React.useState(0);
  const [live, setLive] = React.useState('');
  const full = 'Add rate limiting to the users endpoint, one hundred requests per minute.';
  React.useEffect(() => {
    const clk = setInterval(() => setSecs((s) => s + 1), 1000);
    let i = 0;
    const typ = setInterval(() => { i += 1; setLive(full.slice(0, i)); if (i >= full.length) clearInterval(typ); }, 55);
    return () => { clearInterval(clk); clearInterval(typ); };
  }, []);
  const stop = () => {
    setPhase('processing'); setGhPhase('note');
    setTimeout(() => onDone({ id: 99, title: full, src: 'app', app: 'In-app', dur: `0:${String(secs || 8).padStart(2, '0')}`, when: 'Just now', words: full.split(' ').length, engine: 'on-device', category: 'code', today: true }), 1200);
  };
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: t.bg2 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '18px 24px 0' }}>
        <EngineChip label={phase === 'processing' ? 'Transcribing…' : 'Apple Speech · on-device'} icon={phase === 'processing' ? 'spark' : 'cpu'} t={t} />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FM, fontSize: 15, color: t.text }}>{clock}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '26px 24px', justifyContent: 'flex-start' }}>
        <SectionLabel text={phase === 'processing' ? 'Transcribing…' : 'Listening…'} t={t} />
        <div style={{ fontFamily: FD, fontSize: 23, fontWeight: 500, color: live ? t.text : t.muted, lineHeight: 1.45, minHeight: 140 }}>{live || 'Speak now — tap stop when you’re done.'}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 2 }}>
        {window.ListeningGhost && <ListeningGhost phase={phase === 'processing' ? 'note' : ghPhase} size={128} />}
      </div>
      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px 8px' }}>
        {phase === 'listening' ? <Waveform t={t} color={t.accent} bars={34} height={70} />
          : <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} /><span style={{ fontFamily: FM, fontSize: 13, color: t.accentLite }}>Working…</span></div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, padding: '14px 0 42px' }}>
        <button onClick={onCancel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.muted, cursor: 'pointer' }}><MIcon k="x" size={22} /></button>
        <button onClick={stop} disabled={phase !== 'listening'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 84, height: 84, borderRadius: '50%', background: phase === 'listening' ? t.red : t.elevated, color: '#fff', border: phase === 'listening' ? `8px solid ${hexA(t.red, 0.16)}` : 'none', cursor: phase === 'listening' ? 'pointer' : 'default' }}><MIcon k="stopFill" size={30} /></button>
        <div style={{ width: 56, height: 56 }} />
      </div>
    </div>
  );
}

const SPEAKER_HUES = ['', '#f59e0b', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'];
function PhoneDetail({ t, r, onBack, openEditor, initialSheet, initialMore, initialRename, initialConfirmPlain, initialRewrite }) {
  const [rewrite, setRewrite] = React.useState(initialRewrite ? '• Launch moves to Thursday.\n• Staging cert must land by Tuesday.\n• Mara owns release notes + App Store copy.' : null);
  const [rewriteName, setRewriteName] = React.useState(initialRewrite ? 'Bullet points' : 'Rewrite');
  const [rewriting, setRewriting] = React.useState(false);
  const [retrans, setRetrans] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [catId, setCatId] = React.useState(r.category);
  const [catOpen, setCatOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(!!initialMore);
  const [sheet, setSheet] = React.useState(!!initialSheet);
  const [custom, setCustom] = React.useState('');
  const [names, setNames] = React.useState(r.speakerNames || {});
  const [naming, setNaming] = React.useState(false);
  const [renameSp, setRenameSp] = React.useState(initialRename ? 'speaker_1' : null);
  const [renameTxt, setRenameTxt] = React.useState('');
  const [confirmPlain, setConfirmPlain] = React.useState(initialConfirmPlain ? 'Apple' : null);
  const cat = catOf(catId);
  const isConvo = !!(r.segments && r.segments.length);
  const order = isConvo ? [...new Set(r.segments.map((x) => x.speaker))] : [];
  const spName = (sp) => names[sp] || 'Speaker ' + (order.indexOf(sp) + 1);
  const spColor = (sp) => order.indexOf(sp) === 0 ? t.accent : SPEAKER_HUES[order.indexOf(sp)] || t.cyan;
  const runRewrite = (name) => {
    setSheet(false); setRewriteName(name); setRewriting(true);
    setTimeout(() => { setRewriting(false); setRewrite(name === 'Bullet points'
      ? '• Launch moves to Thursday.\n• Staging cert must land by Tuesday.\n• Mara owns release notes + App Store copy.'
      : '• Add rate limiting to the /api/users endpoint.\n• Cap: 100 requests per minute per client.\n• Return 429 with a Retry-After header when exceeded.'); }, 1400);
  };
  const doRetrans = (engine) => {
    setMoreOpen(false); setConfirmPlain(null);
    if (isConvo && engine !== 'ElevenLabs') { setConfirmPlain(engine); return; }
    setRetrans(true); setTimeout(() => setRetrans(false), 1600);
  };
  const guessNames = () => { setNaming(true); setTimeout(() => { setNames((n) => ({ speaker_1: 'Daniel', ...n })); setNaming(false); }, 1500); };
  const menuItem = (icon, label, onClick, red) => (
    <button key={label} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '11px 14px', fontFamily: FUI, fontSize: 13.5, color: red ? t.red : t.text, borderBottom: `1px solid ${t.lineSoft}` }}>
      <MIcon k={icon} size={15} style={{ color: red ? t.red : t.accentLite }} /> {label}
    </button>
  );
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Transcript" t={t} onBack={onBack} right={<SquareIconButton icon="more" t={t} onClick={() => setMoreOpen((o) => !o)} />} />
      {moreOpen && <>
        <div onClick={() => setMoreOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 29 }} />
        <div style={{ position: 'absolute', top: 58, right: 16, zIndex: 30, width: 250, background: t.elevated, border: `1px solid ${t.line}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 18px 40px -10px rgba(0,0,0,.5)', animation: 'msheet .18s' }}>
        <div style={{ padding: '9px 14px 5px', fontFamily: FM, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: t.faint }}>Retranscribe audio</div>
        {menuItem('cpu', 'Apple — on-device', () => doRetrans('Apple'))}
        {menuItem('globe', 'OpenAI — cloud', () => doRetrans('OpenAI'))}
        <button onClick={() => doRetrans('ElevenLabs')} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '11px 14px', fontFamily: FUI, fontSize: 13.5, color: t.text, borderBottom: `1px solid ${t.lineSoft}` }}>
          <MIcon k="globe" size={15} style={{ color: t.accentLite }} /> {isConvo ? 'ElevenLabs — keeps speakers' : 'ElevenLabs — cloud'}
        </button>
        <button onClick={() => { setMoreOpen(false); onBack && onBack(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', background: hexA(t.red, 0.06), border: 'none', padding: '12px 14px', fontFamily: FUI, fontSize: 13.5, fontWeight: 600, color: t.red }}>
          <MIcon k="trash" size={15} /> Delete note
        </button>
        </div>
      </>}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <SourceBadge src={r.src} t={t} /><PrivacyBadge mode={r.engine === 'cloud' ? 'cloud' : 'device'} small t={t} />
          <span style={{ flex: 1 }} />
          <button onClick={() => setCatOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontFamily: FM, fontSize: 10, fontWeight: 600, color: cat.hue, background: hexA(cat.hue, t.mode === 'dark' ? 0.14 : 0.10), border: `1px solid ${hexA(cat.hue, t.mode === 'dark' ? 0.28 : 0.24)}`, borderRadius: 999, padding: '4px 9px' }}>
            <MIcon k={cat.icon} size={10.5} /> {cat.label} <MIcon k="chevD" size={9} />
          </button>
        </div>
        {catOpen && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 10, background: t.surface, border: `1px solid ${t.line}`, borderRadius: 14, animation: 'msheet .18s' }}>
            {M_CATS.map((c) => (
              <button key={c.id} onClick={() => { setCatId(c.id); setCatOpen(false); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontFamily: FM, fontSize: 10.5, fontWeight: 600, color: c.hue, background: hexA(c.hue, catId === c.id ? 0.22 : 0.1), border: `1px solid ${hexA(c.hue, catId === c.id ? 0.45 : 0.24)}`, borderRadius: 999, padding: '5px 10px' }}>
                <MIcon k={c.icon} size={11} /> {c.label} {catId === c.id && <MIcon k="check" size={11} />}
              </button>
            ))}
          </div>
        )}
        <div style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>{r.app} · {r.when} · {r.dur} · {r.words} words</div>
        {isConvo ? (
          <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SectionLabel text="Conversation" t={t} /><span style={{ flex: 1 }} />
              {naming
                ? <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} />
                : <button onClick={guessNames} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontFamily: FM, fontSize: 10, fontWeight: 600, color: t.accentLite, background: hexA(t.accent, 0.14), border: `1px solid ${hexA(t.accent, 0.28)}`, borderRadius: 999, padding: '4px 9px' }}><MIcon k="spark" size={11} /> Name with AI</button>}
            </div>
            {r.segments.map((seg, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <button onClick={() => { setRenameSp(seg.speaker); setRenameTxt(names[seg.speaker] || ''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontFamily: FM, fontSize: 11, fontWeight: 600, color: spColor(seg.speaker) }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: spColor(seg.speaker) }} /> {spName(seg.speaker)} <MIcon k="pencil" size={8.5} />
                </button>
                <div style={{ fontFamily: FUI, fontSize: 16, color: t.text, lineHeight: 1.5, textWrap: 'pretty' }}>{seg.text}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionLabel text="Transcript" t={t} />
            <div style={{ fontFamily: FUI, fontSize: 17, color: t.text, lineHeight: 1.55 }}>{r.title}</div>
          </div>
        )}
        {retrans && <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, padding: 18, display: 'flex', alignItems: 'center', gap: 11 }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} /><span style={{ fontFamily: FM, fontSize: 13, color: t.accentLite }}>Retranscribing…</span></div>}
        {rewriting && <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, padding: 18, display: 'flex', alignItems: 'center', gap: 11 }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} /><span style={{ fontFamily: FUI, fontSize: 14, color: t.muted }}>Rewriting…</span></div>}
        {rewrite && !rewriting && (
          <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SectionLabel text={rewriteName} t={t} /><span style={{ flex: 1 }} /><PrivacyBadge mode="cloud" small t={t} /></div>
            <div style={{ fontFamily: FUI, fontSize: 16, color: t.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{rewrite}</div>
            <div style={{ display: 'flex', gap: 9 }}>
              <GhostBtn title="Copy" icon="copy" t={t} style={{ flex: 1 }} />
              <GhostBtn title="Share" icon="share" t={t} style={{ flex: 1 }} />
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 9, padding: '12px 18px 30px' }}>
        <GhostBtn title={copied ? 'Copied' : 'Copy'} icon={copied ? 'check' : 'copy'} t={t} style={{ flex: 1 }} onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }} />
        <GhostBtn title="Share" icon="share" t={t} style={{ flex: 1 }} />
        <GhostBtn title="Rewrite" icon="spark" t={t} style={{ flex: 1 }} onClick={() => setSheet(true)} />
      </div>
      {renameSp && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(6,5,12,.55)' }} onClick={() => setRenameSp(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, animation: 'msheet .28s cubic-bezier(.16,.84,.44,1)' }}>
            <div style={{ fontFamily: FD, fontSize: 20, fontWeight: 600, color: t.text, marginBottom: 8 }}>Name this speaker</div>
            <div style={{ fontFamily: FUI, fontSize: 13.5, color: t.muted, lineHeight: 1.5, marginBottom: 14 }}>Shown instead of the generic label, everywhere this conversation appears.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxHeight: 180, overflowY: 'auto' }}>
              <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: t.faint }}>What they said</div>
              {r.segments.filter((s2) => s2.speaker === renameSp).slice(0, 3).map((s2, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, padding: '9px 12px', borderRadius: 12, background: t.surfaceUp, border: `1px solid ${t.lineSoft}` }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: spColor(renameSp), flexShrink: 0, marginTop: 5 }} />
                  <span style={{ fontFamily: FUI, fontSize: 13, color: t.text, lineHeight: 1.45, textWrap: 'pretty' }}>{s2.text}</span>
                </div>
              ))}
            </div>
            <input value={renameTxt} onChange={(e) => setRenameTxt(e.target.value)} placeholder="Name, nickname, role…" autoFocus style={{ width: '100%', fontFamily: FUI, fontSize: 15, color: t.text, background: t.surfaceUp, border: `1px solid ${t.line}`, borderRadius: 12, padding: '13px 14px', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {['Mara', 'Sam', 'Boss', 'Client', 'Me'].map((n) => (
                <button key={n} onClick={() => setRenameTxt(n)} style={{ fontFamily: FUI, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 12px', borderRadius: 999, background: renameTxt === n ? hexA(t.accent, 0.16) : t.surfaceUp, color: renameTxt === n ? t.accentLite : t.muted, border: `1px solid ${renameTxt === n ? t.hair : t.line}` }}>{n}</button>
              ))}
            </div>
            <button onClick={() => { setNames((n) => { const x = { ...n }; if (renameTxt.trim()) x[renameSp] = renameTxt.trim(); else delete x[renameSp]; return x; }); setRenameSp(null); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', fontFamily: FUI, fontSize: 15, fontWeight: 600, color: t.primaryInk, padding: '13px 20px', borderRadius: 14, border: 'none', cursor: 'pointer', background: t.primary, marginBottom: 10 }}><MIcon k="check" size={16} /> Save</button>
            <GhostBtn title="Cancel" t={t} onClick={() => setRenameSp(null)} style={{ width: '100%' }} />
          </div>
        </div>
      )}
      {confirmPlain && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(6,5,12,.55)' }} onClick={() => setConfirmPlain(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, animation: 'msheet .28s cubic-bezier(.16,.84,.44,1)' }}>
            <div style={{ fontFamily: FD, fontSize: 20, fontWeight: 600, color: t.text, marginBottom: 10 }}>Speakers need the cloud</div>
            <div style={{ fontFamily: FUI, fontSize: 14, color: t.muted, lineHeight: 1.55, marginBottom: 20, textWrap: 'pretty' }}>Speaker detection only works with ElevenLabs Scribe in the cloud. Retranscribing with {confirmPlain} produces plain text and removes the speaker labels.</div>
            <button onClick={() => { const e = confirmPlain; setConfirmPlain(null); setRetrans(true); setTimeout(() => setRetrans(false), 1600); }} style={{ display: 'block', width: '100%', fontFamily: FUI, fontSize: 15, fontWeight: 600, color: '#fff', padding: '13px 20px', borderRadius: 14, border: 'none', cursor: 'pointer', background: t.red, marginBottom: 10 }}>Retranscribe anyway</button>
            <GhostBtn title="Cancel" t={t} onClick={() => setConfirmPlain(null)} style={{ width: '100%' }} />
          </div>
        </div>
      )}
      {sheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(6,5,12,.55)' }} onClick={() => setSheet(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxHeight: '84%', overflowY: 'auto', background: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, animation: 'msheet .28s cubic-bezier(.16,.84,.44,1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontFamily: FD, fontSize: 20, fontWeight: 600, color: t.text }}>Rewrite with…</span><span style={{ flex: 1 }} />
              <button onClick={() => setSheet(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', background: t.surfaceUp, border: 'none', color: t.muted, cursor: 'pointer' }}><MIcon k="x" size={16} /></button>
            </div>
            <div style={{ fontFamily: FUI, fontSize: 13, color: t.muted, lineHeight: 1.5, marginBottom: 16 }}>Reformat this transcript with AI. Your text is sent to the cloud model.</div>
            <div style={{ padding: '0 16px', background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, marginBottom: 16 }}>
              {REWRITE_PRESETS.map((p, i) => (
                <button key={p.id} onClick={() => p.meta ? (setSheet(false), openEditor && openEditor()) : runRewrite(p.name)} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '13px 0', borderBottom: i === REWRITE_PRESETS.length - 1 ? 'none' : `1px solid ${t.lineSoft}` }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: t.surfaceUp, color: t.accentLite, flexShrink: 0 }}><MIcon k={p.icon} size={16} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FUI, fontSize: 14.5, fontWeight: 500, color: t.text }}>{p.name}</div>
                    {p.meta && <div style={{ fontFamily: FUI, fontSize: 12, color: t.muted }}>Build a new template from your voice</div>}
                  </div>
                  <MIcon k="chevR" size={16} style={{ color: t.faint }} />
                </button>
              ))}
            </div>
            <div style={{ paddingLeft: 4, marginBottom: 7 }}><SectionLabel text="Or write your own" t={t} /></div>
            <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={3} placeholder="Rewrite this as formal meeting minutes…" style={{ width: '100%', fontFamily: FM, fontSize: 13, color: t.text, background: t.surfaceUp, border: `1px solid ${t.line}`, borderRadius: 12, padding: '11px 13px', outline: 'none', resize: 'none', lineHeight: 1.5, boxSizing: 'border-box', marginBottom: 7 }} />
            <div style={{ fontFamily: FM, fontSize: 11, color: t.faint, lineHeight: 1.5, marginBottom: 12 }}>A one-off instruction. It isn’t saved — add a template in Settings to keep it.</div>
            <GradButton title="Rewrite with this" icon="spark" t={t} onClick={() => custom.trim() && runRewrite('Custom')} style={{ width: '100%', opacity: custom.trim() ? 1 : 0.5 }} />
          </div>
        </div>
      )}
    </div>
  );
}


/* ─── Journal composer: new page — blank, or from picked notes (AI-woven · raw stacked · one per page) ─── */
function PhoneJournalNew({ t, onBack, onDone, initialMode = null }) {
  const [mode, setMode] = React.useState(initialMode); // null | blank | notes
  const [layout, setLayout] = React.useState('ai'); // ai | raw | split
  const [picked, setPicked] = React.useState(() => new Set(M_RECS.filter((r) => r.today).map((r) => r.id)));
  const [srcF, setSrcF] = React.useState('all');
  const [dayF, setDayF] = React.useState('all');
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const matches = (r) => (srcF === 'all' || (srcF === 'keyboard' ? r.src === 'keyboard' : r.src !== 'keyboard')) && (dayF === 'all' || (dayF === 'today' ? r.today : !r.today));
  const pool = M_RECS.filter(matches);
  const togglePick = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOn = pool.length > 0 && pool.every((r) => picked.has(r.id));
  const toggleAll = () => setPicked((p) => { const n = new Set(p); pool.forEach((r) => allOn ? n.delete(r.id) : n.add(r.id)); return n; });
  const nSel = M_RECS.filter((r) => picked.has(r.id)).length;
  const go = (kind) => { if (kind === 'blank' || kind === 'split') { onDone(kind); return; } setBusy(true); setTimeout(() => onDone(kind), 1500); };
  const chip = (on, label, onClick, icon) => (
    <button key={label} onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FUI, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '6px 11px', borderRadius: 999, background: on ? hexA(t.accent, 0.16) : t.surfaceUp, color: on ? t.accentLite : t.muted, border: `1px solid ${on ? t.hair : t.line}` }}>{icon && <MIcon k={icon} size={12} />}{label}</button>
  );
  const bigCard = (id, icon, title, sub) => (
    <button key={id} onClick={() => setMode(id)} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', cursor: 'pointer', padding: 15, borderRadius: 16, background: t.surface, border: `${mode === id ? 2 : 1}px solid ${mode === id ? t.accent : t.line}` }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 11, background: t.surfaceUp, color: mode === id ? t.accent : t.accentLite, flexShrink: 0 }}><MIcon k={icon} size={17} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FUI, fontSize: 14.5, fontWeight: 600, color: t.text }}>{title}</div>
        <div style={{ fontFamily: FUI, fontSize: 12, color: t.muted, marginTop: 1, lineHeight: 1.45, textWrap: 'pretty' }}>{sub}</div>
      </div>
      {mode === id && <MIcon k="check" size={17} style={{ color: t.accent, flexShrink: 0 }} />}
    </button>
  );
  const layoutCard = (id, icon, title, sub) => (
    <button key={id} onClick={() => setLayout(id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', cursor: 'pointer', padding: '11px 11px', borderRadius: 13, background: layout === id ? hexA(t.accent, t.mode === 'dark' ? 0.12 : 0.08) : t.surface, border: `${layout === id ? 1.5 : 1}px solid ${layout === id ? hexA(t.accent, 0.5) : t.line}`, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <MIcon k={icon} size={15} style={{ color: layout === id ? t.accent : t.faint }} />
      <span style={{ fontFamily: FUI, fontSize: 12, fontWeight: 600, color: t.text, lineHeight: 1.2 }}>{title}</span>
      <span style={{ fontFamily: FM, fontSize: 9, color: t.faint, lineHeight: 1.4 }}>{sub}</span>
    </button>
  );
  const dayRows = (label, recs) => recs.length === 0 ? null : (
    <React.Fragment key={label}>
      <div style={{ padding: '9px 14px 4px', fontFamily: FM, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: t.faint }}>{label}</div>
      {recs.map((r) => (
        <button key={r.id} onClick={() => togglePick(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '9px 14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 7, flexShrink: 0, background: picked.has(r.id) ? t.accent : t.surfaceUp, border: `1px solid ${picked.has(r.id) ? t.accent : t.line}`, color: '#fff' }}>{picked.has(r.id) && <MIcon k="check" size={13} />}</span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: FUI, fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
          <MIcon k={srcIconOf(r.src)} size={13} style={{ color: t.faint, flexShrink: 0 }} />
          <span style={{ fontFamily: FM, fontSize: 9.5, color: t.faint, flexShrink: 0 }}>{r.when}</span>
        </button>
      ))}
    </React.Fragment>
  );
  const cta = mode === 'blank'
    ? { label: 'Open blank page', icon: 'pencil', ok: true, kind: 'blank' }
    : layout === 'ai' ? { label: busy ? 'Weaving…' : `Weave ${nSel} note${nSel === 1 ? '' : 's'} with AI`, icon: 'spark', ok: nSel > 0, kind: 'ai' }
    : layout === 'raw' ? { label: `Add ${nSel} note${nSel === 1 ? '' : 's'} to one page`, icon: 'book', ok: nSel > 0, kind: 'raw' }
    : { label: `Create ${nSel} page${nSel === 1 ? '' : 's'}`, icon: 'plus', ok: nSel > 0, kind: 'split' };
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="New page" t={t} onBack={onBack} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 30px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bigCard('blank', 'pencil', 'Blank page', 'Write or dictate straight onto the page')}
        {bigCard('notes', 'book', 'From your notes', 'Pick transcriptions — one by one, by source or by day')}
        {mode === 'notes' && <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {chip(srcF === 'all', 'All', () => setSrcF('all'))}
            {chip(srcF === 'app', 'In-app', () => setSrcF('app'), 'micFill')}
            {chip(srcF === 'keyboard', 'Keyboard', () => setSrcF('keyboard'), 'keyboard')}
            <span style={{ width: 1, height: 18, background: t.line, margin: '0 2px' }} />
            {chip(dayF === 'all', 'All days', () => setDayF('all'))}
            {chip(dayF === 'today', 'Today', () => setDayF('today'))}
            {chip(dayF === 'yesterday', 'Yesterday', () => setDayF('yesterday'))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 4 }}>
            <SectionLabel text={`${nSel} selected`} t={t} />
            <span style={{ flex: 1 }} />
            <button onClick={toggleAll} style={{ fontFamily: FM, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: t.accentLite, background: 'none', border: 'none' }}>{allOn ? 'Deselect visible' : 'Select visible'}</button>
          </div>
          <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 16, overflow: 'hidden', paddingBottom: 5 }}>
            {dayRows('Today', pool.filter((r) => r.today))}
            {dayRows('Yesterday', pool.filter((r) => !r.today))}
            {pool.length === 0 && <div style={{ padding: 14, fontFamily: FUI, fontSize: 12.5, color: t.faint }}>Nothing matches these filters.</div>}
          </div>
          <div style={{ paddingLeft: 4, marginTop: 4 }}><SectionLabel text="Onto the page as" t={t} /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            {layoutCard('ai', 'spark', 'Weave with AI', 'one page · summarized')}
            {layoutCard('raw', 'book', 'Raw, stacked', 'one page · verbatim')}
            {layoutCard('split', 'plus', 'One per page', `${nSel || 'n'} pages`)}
          </div>
          {layout === 'ai' && <>
            <div style={{ position: 'relative', marginTop: 2 }}>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="Instructions for the AI (optional) — e.g. standup update, first person, casual…" style={{ width: '100%', fontFamily: FUI, fontSize: 13, color: t.text, background: t.surfaceUp, border: `1px solid ${t.line}`, borderRadius: 12, padding: '11px 46px 11px 13px', outline: 'none', resize: 'none', lineHeight: 1.5, boxSizing: 'border-box' }} />
              <button title="Dictate the instructions" style={{ position: 'absolute', right: 9, bottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', border: 'none', cursor: 'pointer', background: t.primary, color: t.primaryInk }}><MIcon k="micFill" size={13} /></button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['Standup update', 'Bullet points', 'Dear diary', 'Client email'].map((p) => (
                <button key={p} onClick={() => setPrompt(p)} style={{ fontFamily: FUI, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '5px 11px', borderRadius: 999, background: prompt === p ? hexA(t.accent, 0.16) : t.surfaceUp, color: prompt === p ? t.accentLite : t.muted, border: `1px solid ${prompt === p ? t.hair : t.line}` }}>{p}</button>
              ))}
            </div>
            <div style={{ fontFamily: FM, fontSize: 10, color: t.faint, lineHeight: 1.5 }}>Cloud text model · the picked notes and instructions are sent to it. Raw and one-per-page never leave the device.</div>
          </>}
        </>}
      </div>
      <div style={{ padding: '12px 16px 30px' }}>
        <GradButton title={cta.label} icon={busy ? undefined : cta.icon} t={t} onClick={() => mode && cta.ok && !busy && go(cta.kind)} style={{ width: '100%', opacity: mode && cta.ok && !busy ? 1 : 0.5 }} />
      </div>
    </div>
  );
}

/* ─── iPhone Journal index + readable Digest (JournalView + DigestDayView) ─── */
const PHONE_JOURNAL_DAYS = {
  today: { title: 'Today', recs: M_RECS.filter((r) => r.today) },
  yesterday: { title: 'Yesterday', recs: M_RECS.filter((r) => !r.today) },
};
const PHONE_JOURNAL_SUMM = {
  today: 'Four notes today. You scoped rate limiting for the /api/users endpoint (100 req/min) and drafted a reply pushing the launch to Thursday so QA gets a full cycle. One product idea — a weekly digest that turns each voice note into three bullets — plus a short grocery run.',
  yesterday: 'Two notes. Standup: shipped the export pipeline, blocked on the staging cert, pairing with Mara after lunch. Also a quick heads-up to Sam about running ten late.',
};
const SRC_SCOPES = [['all', 'All sources'], ['app', 'In-app'], ['keyboard', 'Keyboard']];
const inScope = (r, scope) => scope === 'all' ? true : scope === 'keyboard' ? r.src === 'keyboard' : r.src !== 'keyboard';
const JOURNAL_BOOKS = [
  { id: 'week', title: 'This week', sub: '2 days · 10 notes', spine: '#1cc8b4', chapters: [{ title: 'Days', pages: ['today', 'yesterday'] }] },
  { id: 'july', title: 'July', sub: '12 days', spine: '#3da2f7', chapters: [{ title: 'Week 29', pages: ['today', 'yesterday'] }, { title: 'Week 28', pages: [] }] },
  { id: 'june', title: 'June', sub: '22 days', spine: '#8a9bb0', chapters: [{ title: 'Archive', pages: [] }] },
  { id: 'work', title: 'Work', sub: 'auto-book · 12 notes', spine: '#4a8cf7', cat: 'work', chapters: [{ title: 'Sprint 24', pages: ['today'] }, { title: 'Sprint 23', pages: ['yesterday'] }] },
  { id: 'ideas', title: 'Ideas', sub: 'auto-book · 6 notes', spine: '#fbbf24', cat: 'ideas', chapters: [{ title: 'Someday', pages: ['today', 'yesterday'] }] },
];
function PhoneJournal({ t, onBack, onOpenDay, onToday, onAdd, onOpenRecap, initialBook, initialAdd }) {
  const catsIn = (recs) => M_CATS.filter((c) => recs.some((r) => r.category === c.id));
  const ready = { yesterday: 'Generated 20 hr. ago' };
  const [books, setBooks] = React.useState(JOURNAL_BOOKS);
  const [bookId, setBookId] = React.useState(initialBook || null); // null → library
  const [addOpen, setAddOpen] = React.useState(!!initialAdd);
  const book = books.find((b) => b.id === bookId);
  const addBook = () => {
    const n = books.filter((b) => b.custom).length + 1;
    const nb = { id: 'nb' + n, title: 'Notebook ' + n, sub: 'empty', spine: '#5ee0d0', custom: true, chapters: [{ title: 'Chapter 1', pages: [] }] };
    setBooks((bs) => [...bs, nb]); setBookId(nb.id);
  };
  const addChapter = () => {
    setAddOpen(false);
    setBooks((bs) => bs.map((b) => b.id === bookId ? { ...b, chapters: [...b.chapters, { title: 'Chapter ' + (b.chapters.length + 1), pages: [] }] } : b));
  };
  const pageCard = (key) => {
    const d0 = PHONE_JOURNAL_DAYS[key];
    if (!d0) return null;
    const d = { ...d0, recs: book && book.cat ? d0.recs.filter((r) => r.category === book.cat) : d0.recs };
    if (!d.recs.length) return null;
    if (key === 'today') return (
      <button key={key} onClick={onToday} style={{ textAlign: 'left', cursor: 'pointer', padding: 14, borderRadius: 16, background: t.surface, border: `1px solid ${t.hair}`, display: 'flex', alignItems: 'center', gap: 11, width: '100%' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, background: t.primary, color: t.primaryInk, flexShrink: 0 }}><MIcon k="pencil" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FM, fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: t.accentLite }}>Today · running note</div>
          <div style={{ fontFamily: FUI, fontSize: 13, color: t.text, marginTop: 2 }}>{d.recs.length} takes so far — open to continue</div>
        </div>
        <MIcon k="chevR" size={15} style={{ color: t.faint, flexShrink: 0 }} />
      </button>
    );
    return (
      <button key={key} onClick={() => onOpenDay(key)} style={{ textAlign: 'left', cursor: 'pointer', padding: 14, borderRadius: 16, background: t.surface, border: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', gap: 9, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <SectionLabel text={d.title} t={t} /><span style={{ flex: 1 }} />
          <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>{d.recs.length} notes</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{catsIn(d.recs).map((c) => <CategoryTag key={c.id} cat={c} t={t} />)}</div>
        {ready[key]
          ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%' }}>
              <MIcon k="check" size={13} style={{ color: t.green }} />
              <span style={{ fontFamily: FM, fontSize: 11, fontWeight: 600, color: t.green }}>Summary ready</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>{ready[key]}</span>
            </div>
          : <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FM, fontSize: 11, fontWeight: 600, color: t.accentLite }}><MIcon k="spark" size={13} /> Generate summary <MIcon k="chevR" size={13} /></div>}
      </button>
    );
  };
  /* ── Book view ── */
  if (book) return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title={book.title} t={t} onBack={() => setBookId(null)} right={<SquareIconButton icon="plus" t={t} onClick={() => setAddOpen((o) => !o)} />} />
      {addOpen && <>
        <div onClick={() => setAddOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 29 }} />
        <div style={{ position: 'absolute', top: 58, right: 16, zIndex: 30, width: 210, background: t.elevated, border: `1px solid ${t.line}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 18px 40px -10px rgba(0,0,0,.5)', animation: 'msheet .18s' }}>
          <button onClick={() => { setAddOpen(false); onAdd(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '12px 14px', fontFamily: FUI, fontSize: 13.5, color: t.text, borderBottom: `1px solid ${t.lineSoft}` }}><MIcon k="pencil" size={15} style={{ color: t.accentLite }} /> New page</button>
          <button onClick={addChapter} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '12px 14px', fontFamily: FUI, fontSize: 13.5, color: t.text }}><MIcon k="book" size={15} style={{ color: t.accentLite }} /> New chapter</button>
        </div>
      </>}
      <div style={{ padding: '0 20px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 26, height: 5, borderRadius: 3, background: book.spine }} />
        <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>{book.sub}{book.cat ? ' · auto-collects #' + book.cat : ''}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px 30px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {book.chapters.map((ch, ci) => {
          const cards = ch.pages.map(pageCard).filter(Boolean);
          return (
            <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
                <span style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: t.muted }}>{ch.title}</span>
                <span style={{ flex: 1, height: 1, background: t.lineSoft }} />
                <span style={{ fontFamily: FM, fontSize: 9.5, color: t.faint }}>{cards.length} page{cards.length === 1 ? '' : 's'}</span>
              </div>
              {cards.length ? cards : (
                <button onClick={onAdd} style={{ cursor: 'pointer', padding: '18px 14px', borderRadius: 14, background: 'none', border: `1.5px dashed ${t.line}`, color: t.faint, fontFamily: FUI, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><MIcon k="plus" size={14} /> Add the first page</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
  /* ── Library: books only ── */
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Journal" t={t} onBack={onBack} />
      <div style={{ padding: '0 20px 8px', fontFamily: FM, fontSize: 10.5, color: t.faint }}>Your notes, bound into books — by week, month or topic.</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px 30px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {[['Automatic journals', books.filter((b) => !b.custom), 'Bound for you — by week, month and topic'], ['Manual journals', books.filter((b) => b.custom), 'Your own notebooks — pages, chapters, whatever you need']].map(([gl, list, hint]) => (
        <div key={gl} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingLeft: 4 }}>
          <SectionLabel text={gl} t={t} />
          <span style={{ fontFamily: FM, fontSize: 9.5, color: t.faint }}>{hint}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {list.map((b) => {
            const noteCount = b.cat ? M_RECS.filter((r) => r.category === b.cat).length : Object.values(PHONE_JOURNAL_DAYS).reduce((n, d) => n + d.recs.length, 0);
            return (
              <button key={b.id} onClick={() => setBookId(b.id)} style={{ position: 'relative', height: 170, textAlign: 'left', cursor: 'pointer', padding: '16px 14px 14px 20px', borderRadius: 16, background: t.surface, border: `1px solid ${t.line}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: b.spine }} />
                <span style={{ position: 'absolute', left: 7, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,.14)' }} />
                <MIcon k="book" size={17} style={{ color: b.spine }} />
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: FD, fontSize: 17, fontWeight: 650, color: t.text, lineHeight: 1.15 }}>{b.title}</span>
                <span style={{ fontFamily: FM, fontSize: 10, color: t.faint, marginTop: 4 }}>{b.sub}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9 }}>
                  <span style={{ fontFamily: FM, fontSize: 9.5, color: t.muted }}>{b.chapters.length} chapter{b.chapters.length === 1 ? '' : 's'}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontFamily: FM, fontSize: 9.5, color: b.spine, fontWeight: 700 }}>{noteCount} notes</span>
                </div>
              </button>
            );
          })}
          {gl === 'Manual journals' && (
            <button onClick={addBook} style={{ height: 170, cursor: 'pointer', borderRadius: 16, background: 'none', border: `1.5px dashed ${t.line}`, color: t.faint, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <MIcon k="plus" size={20} />
              <span style={{ fontFamily: FUI, fontSize: 12.5, fontWeight: 600 }}>New book</span>
            </button>
          )}
        </div>
        </div>
        ))}
      </div>
    </div>
  );
}
function PhoneDigest({ t, dayKey, onBack, onOpenRec, initialManual, seed }) {
  const day = PHONE_JOURNAL_DAYS[dayKey];
  const [summary, setSummary] = React.useState(() => seed === 'ai' ? PHONE_JOURNAL_SUMM[dayKey] : seed === 'raw' ? day.recs.map((r) => '• ' + r.title).join('\n') : null);
  const [generating, setGenerating] = React.useState(false);
  const [manual, setManual] = React.useState(!!initialManual);
  const [manualTxt, setManualTxt] = React.useState('');
  const groups = M_CATS.map((c) => ({ cat: c, items: day.recs.filter((r) => r.category === c.id) })).filter((g) => g.items.length);
  const generate = () => { setGenerating(true); setTimeout(() => { setSummary(PHONE_JOURNAL_SUMM[dayKey]); setGenerating(false); }, 1400); };
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title={day.title} t={t} onBack={onBack} right={<span style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>{day.recs.length} notes</span>} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px 30px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ padding: 18, background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SectionLabel text={seed === 'raw' ? 'Notes · raw' : 'Daily summary'} t={t} /><span style={{ flex: 1 }} /><PrivacyBadge mode={seed === 'raw' ? 'device' : 'cloud'} small t={t} /></div>
          {generating
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} /><span style={{ fontFamily: FUI, fontSize: 14, color: t.muted }}>Summarizing your day…</span></div>
            : summary
              ? <>
                  <div style={{ fontFamily: FUI, fontSize: 15.5, color: t.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{summary}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>{seed === 'raw' ? 'Stacked verbatim · nothing sent to the cloud' : 'Generated just now'}</span><span style={{ flex: 1 }} /><GhostBtn title="Regenerate" icon="sync" t={t} onClick={generate} /></div>
                </>
              : manual
                ? <>
                    <textarea value={manualTxt} onChange={(e) => setManualTxt(e.target.value)} rows={5} autoFocus placeholder="Write the day in your own words — or dictate straight into it…" style={{ width: '100%', fontFamily: FUI, fontSize: 14.5, color: t.text, background: t.surfaceUp, border: `1px solid ${t.line}`, borderRadius: 12, padding: '12px 13px', outline: 'none', resize: 'none', lineHeight: 1.55, boxSizing: 'border-box' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer', background: t.primary, color: t.primaryInk, flexShrink: 0 }}><MIcon k="micFill" size={17} /></button>
                      <span style={{ flex: 1 }} />
                      <GhostBtn title="AI instead" icon="spark" t={t} onClick={() => { setManual(false); generate(); }} style={{ whiteSpace: 'nowrap' }} />
                      <GradButton title="Save" icon="check" t={t} onClick={() => manualTxt.trim() && setSummary(manualTxt.trim())} style={{ opacity: manualTxt.trim() ? 1 : 0.5 }} />
                    </div>
                    <div style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>Dictate into the summary · on-device</div>
                  </>
                : <>
                    <div style={{ fontFamily: FUI, fontSize: 14, color: t.muted, lineHeight: 1.55 }}>Start with an AI summary of the day’s notes — or write it yourself from scratch.</div>
                    <div style={{ display: 'flex', gap: 9 }}>
                      <GradButton title="Generate summary" icon="spark" t={t} onClick={generate} />
                      <GhostBtn title="Start from scratch" icon="pencil" t={t} onClick={() => setManual(true)} />
                    </div>
                  </>}
        </div>
        {groups.map((g) => (
          <div key={g.cat.id} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SectionLabel text={g.cat.label} t={t} /><CategoryTag cat={g.cat} t={t} /></div>
            <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, overflow: 'hidden' }}>
              {g.items.map((r, i) => <RecRow key={r.id} r={r} t={t} last={i === g.items.length - 1} onTap={() => onOpenRec(r)} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhoneApp({ t, setDark, manualSync, initialScreen, convoRec }) {
  const [screen, setScreen] = React.useState(initialScreen || 'home');
  const [rec, setRec] = React.useState(convoRec ? (M_RECS.find((x) => x.segments) || M_RECS[0]) : M_RECS[0]);
  const [dayKey, setDayKey] = React.useState('today');
  const [digestManual, setDigestManual] = React.useState(false);
  const [digestSeed, setDigestSeed] = React.useState(null);
  return (
    <ScreenScaffold t={t}>
      {screen === 'home' && <PhoneHome t={t} manualSync={manualSync} onOpenRec={(r) => { setRec(r); setScreen('detail'); }} onRecord={() => setScreen('recording')} onConversation={() => setScreen('conversation')} onScratchpad={() => setScreen('scratchpad')} onSettings={() => setScreen('settings')} onJournal={() => setScreen('journal')} onDigest={() => { setDayKey('today'); setDigestSeed(null); setScreen('digest'); }} onRecap={() => setScreen('recap')} />}
      {screen === 'conversation' && <PhoneConversation t={t} onCancel={() => setScreen('home')} onDone={() => { setRec(M_RECS.find((x) => x.segments) || M_RECS[0]); setScreen('detail'); }} />}
      {screen === 'journalNew' && <PhoneJournalNew t={t} onBack={() => setScreen('journal')} onDone={(kind) => { setDigestSeed(null); if (kind === 'blank') { setDayKey('today'); setDigestManual(true); setScreen('digest'); } else if (kind === 'split') { setScreen('journal'); } else { setDayKey('today'); setDigestManual(false); setDigestSeed(kind); setScreen('digest'); } }} />}
      {screen === 'scratchpad' && window.PhoneScratchpad && <PhoneScratchpad t={t} onBack={() => setScreen('journal')} onHistory={() => setScreen('journal')} onSummarize={() => { setDayKey('today'); setDigestManual(false); setDigestSeed(null); setScreen('digest'); }} onSettings={() => setScreen('settings')} />}
      {screen === 'recap' && window.RecapScene && <RecapScene t={t} bare onBack={() => setScreen('home')} />}
      {screen === 'recording' && <PhoneRecording t={t} onCancel={() => setScreen('home')} onDone={(r) => { setRec(r); setScreen('detail'); }} />}
      {screen === 'detail' && <PhoneDetail t={t} r={rec} onBack={() => setScreen('home')} />}
      {screen === 'journal' && <PhoneJournal t={t} onBack={() => setScreen('home')} onOpenDay={(k) => { setDayKey(k); setDigestManual(false); setDigestSeed(null); setScreen('digest'); }} onToday={() => setScreen('scratchpad')} onAdd={() => setScreen('journalNew')} onOpenRecap={() => setScreen('recap')} />}
      {screen === 'digest' && <PhoneDigest t={t} dayKey={dayKey} initialManual={digestManual} seed={digestSeed} onBack={() => { setDigestSeed(null); setScreen('journal'); }} onOpenRec={(r) => { setRec(r); setScreen('detail'); }} />}
      {screen === 'settings' && <PhoneSettings t={t} dark={t.mode === 'dark'} setDark={(v) => setDark && setDark(v)} onBack={() => setScreen('home')} />}
    </ScreenScaffold>
  );
}

/* ─── iPad / Mac: Journal + Digest (JournalView.swift + DigestDayView.swift) ─── */
function AppleJournal({ t }) {
  const days = [
    { key: 'today', title: 'Today', recs: M_RECS.filter((r) => r.today) },
    { key: 'yesterday', title: 'Yesterday', recs: M_RECS.filter((r) => !r.today) },
  ];
  const SUMMARIES = {
    today: 'Four notes today. You scoped rate limiting for the /api/users endpoint (100 req/min) and drafted a reply pushing the launch to Thursday so QA gets a full cycle. One product idea — a weekly digest that turns each voice note into three bullets — plus a short grocery run.',
    yesterday: 'Two notes. Standup: shipped the export pipeline, blocked on the staging cert, pairing with Mara after lunch. Also a quick heads-up to Sam about running ten late.',
  };
  const [dayKey, setDayKey] = React.useState('today');
  const [digestManual, setDigestManual] = React.useState(false);
  const [digestSeed, setDigestSeed] = React.useState(null);
  const [summ, setSumm] = React.useState({});
  const [generating, setGenerating] = React.useState(false);
  const day = days.find((d) => d.key === dayKey);
  const catsIn = (recs) => M_CATS.filter((c) => recs.some((r) => r.category === c.id));
  const groups = (recs) => M_CATS.map((c) => ({ cat: c, items: recs.filter((r) => r.category === c.id) })).filter((g) => g.items.length);
  const generate = () => { setGenerating(true); setTimeout(() => { setSumm((s) => ({ ...s, [dayKey]: SUMMARIES[dayKey] })); setGenerating(false); }, 1400); };
  const ready = !!summ[dayKey];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* day index */}
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', background: t.bg2, borderRight: `1px solid ${t.line}` }}>
        <div style={{ padding: '16px 18px 10px', display: 'flex', alignItems: 'center' }}><SectionLabel text="Journal" t={t} /><span style={{ flex: 1 }} /><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FM, fontSize: 10.5, fontWeight: 600, color: t.accentLite, cursor: 'pointer' }}><MIcon k="plus" size={12} /> New page</span></div>
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', padding: '0 14px 10px' }}>
          {[['This week', '#1cc8b4', true], ['July', '#3da2f7'], ['Work', '#4a8cf7'], ['Ideas', '#fbbf24']].map(([bn, bc, on]) => (
            <span key={bn} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FUI, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', padding: '6px 11px', borderRadius: 999, cursor: 'pointer', background: on ? hexA(bc, 0.16) : t.surface, color: on ? bc : t.muted, border: `1px solid ${on ? hexA(bc, 0.45) : t.line}` }}><span style={{ width: 10, height: 3, borderRadius: 2, background: bc }} /> {bn}</span>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {days.map((d) => {
            const on = d.key === dayKey; const done = !!summ[d.key];
            return (
              <button key={d.key} onClick={() => setDayKey(d.key)} style={{ textAlign: 'left', cursor: 'pointer', padding: 16, borderRadius: 16, background: t.surface, border: `1px solid ${on ? t.hair : t.line}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <SectionLabel text={d.title} t={t} /><span style={{ flex: 1 }} />
                  <span style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>{d.recs.length} note{d.recs.length === 1 ? '' : 's'}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{catsIn(d.recs).map((c) => <CategoryTag key={c.id} cat={c} t={t} />)}</div>
                {done
                  ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 11, fontWeight: 600, color: t.green }}><MIcon k="check" size={13} /> Summary ready</div>
                  : <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 11, fontWeight: 600, color: t.accentLite }}><MIcon k="spark" size={13} /> Generate summary</div>}
              </button>
            );
          })}
        </div>
      </div>
      {/* digest */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 32px', borderBottom: `1px solid ${t.lineSoft}` }}>
          <span style={{ fontFamily: FD, fontSize: 20, fontWeight: 600, color: t.text }}>{day.title}</span>
          <span style={{ fontFamily: FM, fontSize: 12, color: t.faint }}>{day.recs.length} notes</span>
          <span style={{ flex: 1 }} /><PrivacyBadge mode="cloud" small t={t} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 40px' }}>
          <div style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ padding: 22, background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SectionLabel text={digestSeed === 'raw' ? 'Notes · raw' : 'Daily summary'} t={t} /><span style={{ flex: 1 }} /><PrivacyBadge mode={digestSeed === 'raw' ? 'device' : 'cloud'} small t={t} /></div>
              {generating
                ? <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} /><span style={{ fontFamily: FUI, fontSize: 14, color: t.muted }}>Summarizing your day…</span></div>
                : ready
                  ? <>
                      <div style={{ fontFamily: FUI, fontSize: 15.5, color: t.text, lineHeight: 1.6 }}>{summ[dayKey]}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>{digestSeed === 'raw' ? 'Stacked verbatim · nothing sent to the cloud' : 'Generated just now'}</span><span style={{ flex: 1 }} /><GhostBtn title="Regenerate" icon="sync" t={t} onClick={generate} /></div>
                    </>
                  : <>
                      <div style={{ fontFamily: FUI, fontSize: 14, color: t.muted, lineHeight: 1.55 }}>Group this day’s notes by category and write a short digest with AI.</div>
                      <GradButton title="Generate summary" icon="spark" t={t} onClick={generate} style={{ alignSelf: 'flex-start' }} />
                    </>}
            </div>
            {groups(day.recs).map((g) => (
              <div key={g.cat.id} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><SectionLabel text={g.cat.label} t={t} /><CategoryTag cat={g.cat} t={t} /></div>
                <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, overflow: 'hidden' }}>
                  {g.items.map((r, i) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 16px', borderBottom: i === g.items.length - 1 ? 'none' : `1px solid ${t.lineSoft}` }}>
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.accentLite, flexShrink: 0 }}><MIcon k={srcIconOf(r.src)} size={14} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FUI, fontSize: 14, color: t.text, lineHeight: 1.4 }}>{r.title}</div>
                        <div style={{ fontFamily: FM, fontSize: 10.5, color: t.faint, marginTop: 3 }}>{r.app} · {r.when} · {r.dur}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── iPad / Mac: Obsidian-style split (iPadView.swift) ─── */
function AppleSplit({ t, engineBar, journal = true, initialMode }) {
  const [sel, setSel] = React.useState(M_RECS[0].id);
  const [mode, setMode] = React.useState(initialMode || 'library');
  const cur = M_RECS.find((r) => r.id === sel) || M_RECS[0];
  const tabs = ['All', 'Keyboard', 'Watch'];
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.bg }}>
      {engineBar && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: t.surface, borderBottom: `1px solid ${t.line}`, flexShrink: 0 }}>
          <MIcon k="cog" size={15} style={{ color: t.faint }} />
          <span style={{ fontFamily: FUI, fontSize: 13, color: t.muted }}>Model order:</span>
          <span style={{ fontFamily: FM, fontSize: 12.5, color: t.text }}>Apple on-device <span style={{ color: t.faint }}>→</span> Groq · v3 turbo <span style={{ color: t.faint }}>→</span> OpenAI · whisper-1</span>
          <span style={{ flex: 1 }} /><PrivacyBadge mode="device" small t={t} />
        </div>
      )}
      {journal && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', background: t.bg2, borderBottom: `1px solid ${t.line}`, flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 10, background: t.surfaceUp, border: `1px solid ${t.line}` }}>
            {[['library', 'Library', 'list'], ['journal', 'Journal', 'book']].map(([v, l, ic]) => {
              const on = mode === v;
              return <button key={v} onClick={() => setMode(v)} style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FUI, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 8, padding: '6px 13px', background: on ? t.accent : 'transparent', color: on ? '#fff' : t.muted }}><MIcon k={ic} size={14} /> {l}</button>;
            })}
          </div>
        </div>
      )}
      {mode === 'journal' ? <AppleJournal t={t} /> : (
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* sidebar */}
        <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', background: t.bg2, borderRight: `1px solid ${t.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 18px 12px' }}>
            <WGhost size={24} /><span style={{ fontFamily: FD, fontSize: 20, fontWeight: 600, color: t.text, flex: 1 }}>Whisperio</span><PrivacyBadge mode="device" small t={t} />
          </div>
          <div style={{ margin: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 11, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.faint }}>
            <MIcon k="search" size={16} /> <span style={{ fontFamily: FUI, fontSize: 14 }}>Search</span>
          </div>
          <div style={{ display: 'flex', gap: 16, padding: '0 18px 8px', fontFamily: FM, fontSize: 11, fontWeight: 600 }}>
            {tabs.map((x, i) => <span key={x} style={{ color: i === 0 ? t.accentLite : t.faint }}>{x}</span>)}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px' }}>
            {M_RECS.map((r) => {
              const on = sel === r.id;
              return (
                <button key={r.id} onClick={() => setSel(r.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, width: '100%', textAlign: 'left', padding: 12, borderRadius: 13, marginBottom: 2, cursor: 'pointer', background: on ? hexA(t.accent, t.mode === 'dark' ? 0.14 : 0.08) : 'transparent', border: `1px solid ${on ? t.hair : 'transparent'}` }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.accentLite, flexShrink: 0 }}><MIcon k={srcIconOf(r.src)} size={15} /></span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ fontFamily: FUI, fontSize: 13.5, fontWeight: 500, color: t.text, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FM, fontSize: 10, color: t.faint }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: catOf(r.category).hue, fontWeight: 600 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: catOf(r.category).hue }} /> {catOf(r.category).label}</span>
                      <span>·</span><span>{r.when}</span><span>·</span><span>{r.dur}</span>
                      <span style={{ flex: 1 }} />
                      <MIcon k={r.engine === 'cloud' ? 'cloud' : 'lock'} size={10} style={{ color: r.engine === 'cloud' ? t.amber : t.green }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        {/* detail */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 32px', borderBottom: `1px solid ${t.lineSoft}` }}>
            <SourceBadge src={cur.src} t={t} /><PrivacyBadge mode={cur.engine === 'cloud' ? 'cloud' : 'device'} small t={t} />
            <span style={{ fontFamily: FM, fontSize: 12, color: t.faint }}>{cur.app} · {cur.when} · {cur.dur} · {cur.words} words</span>
            <span style={{ flex: 1 }} />
            <GhostBtn title="Copy" icon="copy" t={t} /><GradButton title="Insert" icon="arrowUR" t={t} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px 40px' }}>
            <div style={{ maxWidth: 640 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 11, fontWeight: 600, letterSpacing: '.11em', color: t.accentLite, marginBottom: 14 }}><MIcon k="spark" size={13} /> {cur.segments ? 'CONVERSATION · SPEAKERS DETECTED' : 'CLEANED UP ON-DEVICE'}</div>
              {cur.segments ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {cur.segments.map((seg, i) => {
                    const order = [...new Set(cur.segments.map((x) => x.speaker))];
                    const c = order.indexOf(seg.speaker) === 0 ? t.accent : '#3da2f7';
                    const nm = (cur.speakerNames || {})[seg.speaker] || 'Speaker ' + (order.indexOf(seg.speaker) + 1);
                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FM, fontSize: 11.5, fontWeight: 600, color: c }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} /> {nm}</span>
                        <div style={{ fontFamily: FD, fontSize: 20, fontWeight: 500, color: t.text, lineHeight: 1.5 }}>{seg.text}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontFamily: FD, fontSize: 28, fontWeight: 500, color: t.text, lineHeight: 1.5 }}>{cur.title}</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 30, padding: '18px 22px', background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: t.primary, color: t.primaryInk, flexShrink: 0 }}><MIcon k="bolt" size={20} /></span>
                <div style={{ flex: 1 }}><MiniWave t={t} color={t.accent} n={64} height={32} /></div>
                <span style={{ fontFamily: FM, fontSize: 13, color: t.faint }}>{cur.dur}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/* ─── Apple Watch (WhisperioWatchApp.swift) — record on wrist, iPhone transcribes ─── */
function WatchApp({ t, initialStage }) {
  const target = 'Pick up the dry cleaning and book a table for four on Friday.';
  const [stage, setStage] = React.useState(initialStage || 'idle'); // idle | recording | sending | done
  const [text, setText] = React.useState(initialStage === 'done' ? target : '');
  const tm = React.useRef(null);
  React.useEffect(() => () => clearTimeout(tm.current), []);
  const toggle = () => {
    if (stage === 'recording') {
      setStage('sending');
      tm.current = setTimeout(() => { setText(target); setStage('done'); }, 1800);
    } else {
      setText(''); setStage('recording');
    }
  };
  const status = stage === 'idle' ? 'Tap to dictate' : stage === 'recording' ? 'Listening… tap to stop' : stage === 'sending' ? 'Transcribing on iPhone…' : 'Done · sent to iPhone';
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, background: '#000', padding: '12px 12px 10px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><WGhost size={14} /><span style={{ fontFamily: FUI, fontSize: 13, fontWeight: 600, color: '#fff' }}>Whisperio</span></div>
      <button onClick={toggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 78, height: 78, borderRadius: '50%', border: 'none', cursor: 'pointer', background: stage === 'recording' ? t.red : '#1cc8b4', color: '#fff', flexShrink: 0 }}>
      <MIcon k={stage === 'recording' ? 'stopFill' : 'micFill'} size={30} />
      </button>
      {stage === 'recording' && <MiniWave t={t} color="#1cc8b4" n={16} height={14} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: FUI, fontSize: 11, color: 'rgba(255,255,255,.55)', textAlign: 'center' }}>
        {stage === 'sending' && <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.3)', borderTopColor: '#1cc8b4', animation: 'mspin .8s linear infinite', flexShrink: 0 }} />}
        {status}
      </div>
      {text && (
        <div style={{ width: '100%', padding: 8, borderRadius: 10, background: 'rgba(255,255,255,.2)' }}>
          <div style={{ fontSize: 11.5, color: '#fff', lineHeight: 1.4 }}>{text}</div>
        </div>
      )}
    </div>
  );
}

/* ─── iPhone: conversation mode (ConversationView.swift) — cloud ElevenLabs diarization ─── */
function PhoneConversation({ t, onCancel, onDone, needsSetup, initialPhase }) {
  const [phase, setPhase] = React.useState(initialPhase || (needsSetup ? 'setup' : 'listening')); // starting|setup|listening|paused|processing|error
  const [secs, setSecs] = React.useState(0);
  React.useEffect(() => {
    const clk = setInterval(() => setPhase((p) => { if (p === 'listening') setSecs((x) => x + 1); return p; }), 1000);
    return () => clearInterval(clk);
  }, []);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const STATUS = { starting: 'Starting…', setup: 'Setup needed', listening: 'Recording conversation…', paused: 'Paused', processing: 'Transcribing speakers…', error: 'Couldn’t transcribe' };
  const HINT = {
    setup: 'Conversations are transcribed in the cloud with speaker detection (ElevenLabs Scribe) — this mode doesn’t work with the on-device models. Grant cloud consent and add an ElevenLabs API key in Settings to use it.',
    listening: 'Recording everyone near the microphone. Pause anytime — tap stop when the conversation is over.',
    paused: 'Recording is paused — nothing is being captured. Resume to continue the same conversation.',
    processing: 'Detecting who said what…',
  };
  const stop = () => { if (phase !== 'listening' && phase !== 'paused') return; setPhase('processing'); setTimeout(onDone, 1900); };
  const [activeSp, setActiveSp] = React.useState(0);
  React.useEffect(() => {
    if (phase !== 'listening') return;
    const id = setInterval(() => setActiveSp((a) => (a + 1) % 2), 2600);
    return () => clearInterval(id);
  }, [phase]);
  const spChip = (i, name) => {
    const on = phase === 'listening' && activeSp === i;
    const c = i === 0 ? t.accent : '#3da2f7';
    return (
      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 11, fontWeight: 600, color: on ? c : t.faint, padding: '6px 12px', borderRadius: 999, background: on ? hexA(c, 0.14) : t.surfaceUp, border: `1px solid ${on ? hexA(c, 0.4) : t.line}`, transition: 'all .4s' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? c : t.faint, animation: on ? 'mpulse 1.2s ease-in-out infinite' : 'none' }} /> {name}
      </span>
    );
  };
  const capturing = phase === 'listening' || phase === 'paused';
  const circle = (icon, onClick) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.muted, cursor: 'pointer' }}><MIcon k={icon} size={22} /></button>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: t.bg2 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '18px 24px 0' }}>
        <EngineChip label={phase === 'processing' ? 'Transcribing…' : 'ElevenLabs · speakers'} icon={phase === 'processing' ? 'spark' : 'people'} t={t} />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FM, fontSize: 15, color: t.text }}>{clock}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '26px 24px' }}>
        <SectionLabel text={STATUS[phase]} t={t} />
        <div style={{ fontFamily: FD, fontSize: 23, fontWeight: 500, color: t.muted, lineHeight: 1.5, minHeight: 110, textWrap: 'pretty' }}>{HINT[phase] || ''}</div>
        {(phase === 'listening' || phase === 'paused' || phase === 'processing') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {spChip(0, 'Speaker 1')}{spChip(1, 'Speaker 2')}
              <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>2 voices</span>
            </div>
            <div style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>Names are matched after you stop — rename or “Name with AI” in the transcript.</div>
          </div>
        )}
        {phase === 'setup' && <GradButton title="Open Settings" icon="cog" t={t} style={{ alignSelf: 'flex-start' }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 2 }}>
        {window.ListeningGhost && (phase === 'listening' || phase === 'processing') && <ListeningGhost phase={phase === 'processing' ? 'note' : 'group'} size={128} />}
      </div>
      <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px 8px' }}>
        {phase === 'listening' && <Waveform t={t} color={t.accent} bars={34} height={70} />}
        {phase === 'paused' && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><MIcon k="pause" size={16} style={{ color: t.accentLite }} /><span style={{ fontFamily: FM, fontSize: 13, color: t.accentLite }}>Paused</span></div>}
        {phase === 'processing' && <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} /><span style={{ fontFamily: FM, fontSize: 13, color: t.accentLite }}>Working…</span></div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, padding: '14px 0 42px' }}>
        {circle('x', onCancel)}
        <button onClick={stop} disabled={!capturing} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 84, height: 84, borderRadius: '50%', background: capturing ? t.red : t.elevated, color: '#fff', border: capturing ? `8px solid ${hexA(t.red, 0.16)}` : 'none', cursor: capturing ? 'pointer' : 'default' }}><MIcon k="stopFill" size={30} /></button>
        {capturing ? circle(phase === 'paused' ? 'play' : 'pause', () => setPhase((p) => p === 'paused' ? 'listening' : 'paused')) : <div style={{ width: 56, height: 56 }} />}
      </div>
    </div>
  );
}


/* ─── Edge states (EdgeStates.swift) ─── */
function StateBanner({ tone, icon, title, sub, action, t }) {
  const c = tone === 'warn' ? t.amber : tone === 'bad' ? t.red : t.green;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 14, background: hexA(c, t.mode === 'dark' ? 0.10 : 0.08), border: `1px solid ${hexA(c, t.mode === 'dark' ? 0.26 : 0.24)}` }}>
      <MIcon k={icon} size={18} style={{ color: c, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FUI, fontSize: 13.5, fontWeight: 600, color: t.text }}>{title}</div>
        {sub && <div style={{ fontFamily: FUI, fontSize: 12, color: t.muted, marginTop: 1, lineHeight: 1.45, textWrap: 'pretty' }}>{sub}</div>}
      </div>
      {action && <span style={{ fontFamily: FUI, fontSize: 12.5, fontWeight: 600, color: c, padding: '6px 11px', borderRadius: 9, border: `1px solid ${hexA(c, 0.5)}`, flexShrink: 0 }}>{action}</span>}
    </div>
  );
}
function StateHome({ t, empty, banner }) {
  const rows = empty ? [] : M_RECS.filter((r) => !r.segments).slice(0, 4);
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Whisperio" logo t={t} right={<SquareIconButton icon="cog" t={t} />} />
      <div style={{ padding: '4px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 13, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.faint }}>
          <MIcon k="search" size={17} /> <span style={{ fontFamily: FUI, fontSize: 14.5 }}>Search transcripts</span>
        </div>
        {banner}
      </div>
      {empty ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px', marginTop: -40, textAlign: 'center' }}>
          <div style={{ position: 'relative', marginBottom: 22 }}>
            <span style={{ position: 'absolute', inset: -24, borderRadius: '50%', background: t.gradient, filter: 'blur(34px)', opacity: 0.3 }} />
            {window.ListeningGhost ? <ListeningGhost phase="sway" size={92} clickFun /> : <WGhost size={92} />}
          </div>
          <div style={{ fontFamily: FD, fontSize: 23, fontWeight: 600, color: t.text }}>Nothing captured yet</div>
          <div style={{ fontFamily: FUI, fontSize: 14.5, color: t.muted, lineHeight: 1.5, marginTop: 10, textWrap: 'pretty' }}>Tap the mic, hold the Action Button, or use the Whisperio keyboard. Everything you say lands here.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <EngineChip label="Action Button" icon="bolt" t={t} />
            <EngineChip label="Keyboard" icon="keyboard" t={t} />
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 16px 130px', display: 'flex', flexDirection: 'column', gap: 9 }}>
          <SectionLabel text="Recent" t={t} />
          <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, overflow: 'hidden' }}>
            {rows.map((r, i) => <RecRow key={r.id} r={r} t={t} last={i === rows.length - 1} onTap={() => {}} />)}
          </div>
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 130, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 34, background: `linear-gradient(to top, ${t.bg} 34%, transparent)`, pointerEvents: 'none' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: '50%', background: t.primary, color: t.primaryInk, boxShadow: `0 12px 24px -8px ${hexA(t.accent, 0.5)}` }}><MIcon k="micFill" size={28} /></span>
      </div>
    </div>
  );
}
function OldDeviceView({ t }) {
  const row = (icon, iconColor, title, sub, right, last, dimmed) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 0', opacity: dimmed ? 0.55 : 1, borderBottom: last ? 'none' : `1px solid ${t.lineSoft}` }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 11, background: t.surfaceUp, color: iconColor, flexShrink: 0 }}><MIcon k={icon} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FUI, fontSize: 14.5, fontWeight: 600, color: t.text }}>{title}</div>
        <div style={{ fontFamily: FUI, fontSize: 12, color: t.muted, marginTop: 1 }}>{sub}</div>
      </div>
      {right}
    </div>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Engine & privacy" t={t} onBack={() => {}} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 16px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <StateBanner tone="warn" icon="cpu" title="This iPhone transcribes in the cloud" sub="On-device speech needs an A17 Pro or newer. Your device uses the cloud engine instead." t={t} />
        <div style={{ padding: '0 16px', background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18 }}>
          {row('cloud', t.amber, 'Cloud transcription', 'OpenAI / ElevenLabs · required on this device', <MToggle on={true} onChange={() => {}} t={t} />)}
          {row('lock', t.faint, 'On-device engine', 'Not available on this iPhone', <span style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>A17+</span>, true, true)}
        </div>
        <div style={{ fontFamily: FUI, fontSize: 13, color: t.muted, lineHeight: 1.5, textWrap: 'pretty' }}>You can still review, edit and export transcripts normally. Upgrade to an Apple-Intelligence iPhone for fully-offline capture.</div>
      </div>
    </div>
  );
}

Object.assign(window, { PhoneApp, AppleSplit, AppleJournal, WatchApp, RecRow, PhoneConversation, StateBanner, StateHome, OldDeviceView, HomeSyncButton, PhoneRecording, PhoneDetail, PhoneJournal, PhoneDigest, PhoneJournalNew, PhoneHome });
