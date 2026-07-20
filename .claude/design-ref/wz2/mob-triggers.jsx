/* Whisperio Apple — trigger scenes (interactive): custom keyboard, Back-Tap/Action/Lock,
   Dynamic Island / Live Activity, widgets & Control Center. Ported from KeyboardScene.swift,
   TriggerScene.swift, DynamicIslandScene.swift, WhisperioWidget.swift. Each fills a phone screen. */

/* ─── Custom keyboard — honest "bounce to app" ─── */
function KeyboardSceneClassic({ t, initialStage }) {
  const target = 'Running ten late — grab us a table by the window if you can.';
  const [stage, setStage] = React.useState(initialStage === 'explain' ? 'explain' : 'idle'); // idle | explain | recording | done
  const [seen, setSeen] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [inserted, setInserted] = React.useState(initialStage === 'done' || initialStage === 'rewrite' ? target : '');
  const [toast, setToast] = React.useState(false);
  const [rwOpen, setRwOpen] = React.useState(initialStage === 'rewrite');
  const [rewriting, setRewriting] = React.useState(false);
  const typer = React.useRef(null);
  const applyRw = (name) => {
    setRwOpen(false); setRewriting(true);
    setTimeout(() => { setRewriting(false); setInserted('• Running ten late.\n• Grab a window table if you can.'); setToast(true); setTimeout(() => setToast(false), 2000); }, 1300);
  };

  const startRec = () => {
    setSeen(true); setTyped(''); setStage('recording');
    let i = 0; clearInterval(typer.current);
    typer.current = setInterval(() => { i += 2; setTyped(target.slice(0, i)); if (i >= target.length) clearInterval(typer.current); }, 48);
  };
  const tapMic = () => { if (seen) startRec(); else setStage('explain'); };
  const finish = () => { clearInterval(typer.current); setInserted(target); setStage('idle'); setToast(true); setTimeout(() => setToast(false), 2200); };
  React.useEffect(() => () => clearInterval(typer.current), []);
  React.useEffect(() => { if (initialStage === 'recording') startRec(); }, []);

  const dim = t.mode === 'dark';
  const keyBg = dim ? 'rgba(255,255,255,0.13)' : '#fff';
  const keyFg = dim ? '#ECEBF4' : '#1b1830';
  const keyCap = (s, flex) => <span key={s} style={{ flex: flex || 1, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: keyBg, color: keyFg, fontFamily: FUI, fontSize: 17 }}>{s}</span>;
  const bubble = (txt, me) => (
    <div style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start' }}>
      <span style={{ fontFamily: FUI, fontSize: 14.5, color: me ? '#fff' : t.text, padding: '9px 14px', borderRadius: 19, background: me ? t.accent : t.surfaceUp, maxWidth: '78%' }}>{txt}</span>
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.bg }}>
      {/* messages header */}
      <div style={{ paddingTop: 48, paddingBottom: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: hexA(t.surface, 0.7), borderBottom: `1px solid ${t.lineSoft}` }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', background: t.gradient, color: '#fff', fontFamily: FD, fontSize: 16 }}>S</span>
        <span style={{ fontFamily: FUI, fontSize: 13, fontWeight: 600, color: t.text }}>Sam</span>
      </div>
      {/* thread */}
      <div style={{ flex: 1, minHeight: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bubble('Heading over now?', false)}
        {bubble('Almost — finishing one thing', true)}
        {toast && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: FM, fontSize: 11, color: t.green }}><MIcon k="check" size={13} /> {rewriting === false && inserted && inserted.startsWith('•') ? 'Rewritten in app · replaced' : 'Back in Messages · text inserted'}</div>}
        {rewriting && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: FM, fontSize: 11, color: t.accentLite }}><span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} /> Rewriting in Whisperio…</div>}
      </div>
      {/* input */}
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${t.lineSoft}` }}>
        <div style={{ padding: '8px 14px', borderRadius: 18, background: t.surface, border: `1px solid ${inserted ? t.accent : t.line}`, fontFamily: FUI, fontSize: 14.5, color: inserted ? t.text : t.faint, minHeight: 34, whiteSpace: 'pre-wrap' }}>{inserted || 'iMessage'}</div>
      </div>
      {/* keyboard */}
      <div style={{ padding: '7px 4px 8px', background: dim ? '#0b141f' : '#d4d2e2', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', position: 'relative' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.06)', color: keyFg }}><MIcon k="globe" size={15} /></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><WGhost size={16} /><span style={{ fontFamily: FUI, fontSize: 13, fontWeight: 600, color: keyFg }}>Whisperio</span></span>
          <span style={{ flex: 1 }} />
          {inserted && <button onClick={() => setRwOpen((o) => !o)} title="Rewrite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer', background: rwOpen ? hexA(t.accent, 0.2) : 'rgba(255,255,255,0.06)', color: t.accentLite }}><MIcon k="spark" size={14} /></button>}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontFamily: FM, fontSize: 10.5, fontWeight: 600, color: t.green, padding: '5px 11px', borderRadius: 999, background: hexA(t.green, 0.12), border: `1px solid ${hexA(t.green, 0.28)}` }}><MIcon k="lock" size={10} /> on-device</span>
          <button onClick={tapMic} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer', background: t.primary, color: t.primaryInk, boxShadow: `0 3px 8px ${hexA(t.accent, 0.4)}` }}><MIcon k="micFill" size={16} /></button>
          {rwOpen && (
            <div style={{ position: 'absolute', top: 42, right: 0, zIndex: 30, width: 190, background: t.elevated, border: `1px solid ${t.line}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 30px -8px rgba(0,0,0,.5)', animation: 'msheet .15s' }}>
              {['Clean up', 'Bullet points', 'Email reply', 'Action items', 'Summary'].map((n, i) => (
                <button key={n} onClick={() => applyRw(n)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none', padding: '10px 13px', fontFamily: FUI, fontSize: 13, color: t.text, borderBottom: i === 4 ? 'none' : `1px solid ${t.lineSoft}` }}>
                  <MIcon k="spark" size={12} style={{ color: t.accentLite }} /> {n}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 5 }}>{'qwertyuiop'.split('').map((c) => keyCap(c))}</div>
        <div style={{ display: 'flex', gap: 5, padding: '0 16px' }}>{'asdfghjkl'.split('').map((c) => keyCap(c))}</div>
        <div style={{ display: 'flex', gap: 5 }}>
          <span style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: 'rgba(255,255,255,0.06)', color: keyFg }}><MIcon k="chevD" size={18} style={{ transform: 'rotate(180deg)' }} /></span>
          {'zxcvbnm'.split('').map((c) => keyCap(c))}
          <span style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: 'rgba(255,255,255,0.06)', color: keyFg }}><MIcon k="x" size={16} /></span>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ width: 64, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: 'rgba(255,255,255,0.06)', color: keyFg, fontFamily: FUI, fontSize: 13 }}>123</span>
          {keyCap('space', 4)}
          <span style={{ width: 78, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, background: t.accent, color: '#fff', fontFamily: FUI, fontSize: 15, fontWeight: 600 }}>return</span>
        </div>
      </div>

      {stage === 'explain' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(6,5,12,.55)' }} onClick={() => setStage('idle')}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '14px 22px 28px', animation: 'msheet .28s cubic-bezier(.16,.84,.44,1)' }}>
            <div style={{ width: 38, height: 5, borderRadius: 3, background: t.line, margin: '0 auto 14px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, background: t.surfaceUp, color: t.accentLite }}><MIcon k="arrowUR" size={20} /></span>
              <span style={{ fontFamily: FD, fontSize: 18, fontWeight: 600, color: t.text }}>Dictation opens Whisperio</span>
            </div>
            <div style={{ fontFamily: FUI, fontSize: 14, color: t.muted, lineHeight: 1.55, marginBottom: 8, textWrap: 'pretty' }}>iOS keyboards can’t use the microphone on their own, so the mic key opens Whisperio to record — then drops you right back here with the text inserted. One tap each way.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 11.5, color: t.green, marginBottom: 18 }}><MIcon k="lock" size={13} /> Still transcribed on-device</div>
            <GradButton title="Got it — start dictating" t={t} onClick={startRec} style={{ width: '100%' }} />
          </div>
        </div>
      )}
      {stage === 'recording' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column', background: t.bg2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '52px 18px 10px' }}>
            <button onClick={finish} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', color: t.accentLite, fontFamily: FUI, fontSize: 15, fontWeight: 600 }}><MIcon k="chevL" size={20} /> Messages</button>
            <span style={{ flex: 1 }} /><EngineChip label="On-device" icon="cpu" t={t} />
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: '0 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><WGhost size={20} /><SectionLabel text="Listening…" t={t} /></div>
            <div style={{ fontFamily: FD, fontSize: 24, fontWeight: 500, color: t.text, lineHeight: 1.45 }}>{typed}<span style={{ color: t.accent }}> |</span></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 6px' }}><Waveform t={t} color={t.accent} bars={32} height={64} /></div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 40px' }}>
            <GradButton title="Insert & return to Messages" icon="check" t={t} onClick={finish} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Triggers — Action Button · Lock Screen · Back-Tap → clipboard ─── */
function TriggerScene({ t, initialStage }) {
  const target = 'Pick up the dry cleaning and book a table for four on Friday.';
  const [stage, setStage] = React.useState(initialStage || 'idle'); // idle | listening | done
  const [via, setVia] = React.useState('action');
  const [typed, setTyped] = React.useState(initialStage === 'listening' ? target.slice(0, 38) : '');
  const typer = React.useRef(null);
  const viaLabel = { action: 'Action Button', backtap: 'Back-Tap', lock: 'Lock Screen' }[via];
  const viaIcon = { action: 'bolt', backtap: 'more', lock: 'lock' }[via];
  const fire = (src) => {
    setVia(src); setTyped(''); setStage('listening');
    let i = 0; clearInterval(typer.current);
    typer.current = setInterval(() => { i += 2; setTyped(target.slice(0, i)); if (i >= target.length) { clearInterval(typer.current); setTimeout(() => setStage('done'), 400); } }, 46);
  };
  const reset = () => { clearInterval(typer.current); setStage('idle'); setTyped(''); };
  React.useEffect(() => () => clearInterval(typer.current), []);
  const acc = t.accentLite;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'linear-gradient(to bottom, #1a1430, #0a0911)', overflow: 'hidden' }}>
      {/* Action Button nub */}
      <button onClick={() => fire('action')} style={{ position: 'absolute', left: 0, top: 196, width: 5, height: 38, borderRadius: '0 3px 3px 0', border: 'none', cursor: 'pointer', background: stage === 'listening' && via === 'action' ? acc : '#3a3550' }} title="Action Button" />
      {/* lock screen */}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 92 }}>
        <MIcon k="lock" size={16} style={{ color: 'rgba(255,255,255,0.6)' }} />
        <div style={{ fontFamily: FUI, fontSize: 22, fontWeight: 500, color: 'rgba(255,255,255,0.85)', marginTop: 14 }}>Tuesday, 17 June</div>
        <div style={{ fontSize: 84, fontWeight: 600, color: '#fff', lineHeight: 1 }}>9:41</div>
        <button onClick={() => fire('lock')} style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 26, padding: '12px 16px', borderRadius: 16, cursor: 'pointer', background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)' }}>
          <WGhost size={22} />
          <div style={{ textAlign: 'left' }}><div style={{ fontFamily: FD, fontSize: 14, fontWeight: 600, color: '#fff' }}>Whisperio</div><div style={{ fontFamily: FM, fontSize: 10.5, color: 'rgba(255,255,255,0.6)' }}>Tap to capture</div></div>
        </button>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 9, paddingBottom: 18 }}>
          {['×2', '×3'].map((x) => (
            <button key={x} onClick={() => fire('backtap')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 999, cursor: 'pointer', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', fontFamily: FM, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}><MIcon k="more" size={13} style={{ color: acc }} /> Back-Tap {x}</button>
          ))}
        </div>
      </div>

      {stage !== 'idle' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,5,12,.62)', padding: 26 }} onClick={() => stage === 'done' && reset()}>
          {stage === 'listening' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <EngineChip label={`Via ${viaLabel}`} icon={viaIcon} t={t} />
              <div style={{ padding: '20px 0' }}><Waveform t={t} color={acc} bars={30} height={64} /></div>
              <div style={{ fontFamily: FD, fontSize: 21, fontWeight: 500, color: '#fff', textAlign: 'center', minHeight: 84 }}>{typed}<span style={{ color: acc }}> |</span></div>
              <button onClick={reset} style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: '50%', background: t.red, color: '#fff', border: `7px solid ${hexA(t.red, 0.18)}`, cursor: 'pointer' }}><MIcon k="stopFill" size={24} /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: t.green, color: '#04231a' }}><MIcon k="copy" size={16} /></span>
                <span style={{ fontFamily: FD, fontSize: 17, fontWeight: 600, color: '#fff' }}>Copied to clipboard</span>
              </div>
              <div style={{ fontFamily: FUI, fontSize: 15, color: '#fff', lineHeight: 1.5, padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)' }}>{target}</div>
              <div style={{ display: 'flex', gap: 9, marginTop: 14, width: '100%' }}>
                {[['folder', 'Save to Whisperio'], ['share', 'Share']].map(([ic, lb]) => (
                  <span key={lb} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 11, borderRadius: 13, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', fontFamily: FUI, fontSize: 13.5, fontWeight: 600, color: '#fff' }}><MIcon k={ic === 'folder' ? 'book' : ic} size={16} style={{ color: acc }} /> {lb}</span>
                ))}
              </div>
              <div style={{ fontFamily: FM, fontSize: 11, color: 'rgba(255,255,255,0.55)', textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>Open any app and paste — iOS won’t let an app paste for you</div>
              <div style={{ fontFamily: FM, fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 12 }}>Tap anywhere to dismiss</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Dynamic Island / Live Activity ─── */
function DynamicIslandScene({ t, initialRec = true }) {
  const [rec, setRec] = React.useState(initialRec);
  const [secs, setSecs] = React.useState(7);
  React.useEffect(() => { if (!rec) return; const iv = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(iv); }, [rec]);
  const apps = ['Messages', 'Mail', 'Notes', 'Safari', 'Calendar', 'Maps', 'Photos', 'Music'];
  const cols = ['#34c759', '#1f9bf5', '#ffd60a', '#0a84ff', '#ff453a', '#30d158', '#ff375f', '#fa2d6e'];
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'linear-gradient(to bottom, #2a1d4d, #0a0911)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* island */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8, zIndex: 20 }}>
        {rec ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderRadius: 34, background: '#000', width: 348 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', background: t.gradient }}><WGhost size={22} /></span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: t.red }} /><span style={{ fontFamily: FD, fontSize: 13.5, fontWeight: 600, color: '#fff' }}>Recording</span><span style={{ fontFamily: FM, fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>on-device</span></div>
              <Waveform t={t} color={t.accentLite} bars={20} height={18} />
            </div>
            <span style={{ fontFamily: FM, fontSize: 14, color: '#fff' }}>{`0:${String(secs % 60).padStart(2, '0')}`}</span>
            <button onClick={() => setRec(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', background: t.red, color: '#fff', border: 'none', cursor: 'pointer' }}><MIcon k="stopFill" size={16} /></button>
          </div>
        ) : (
          <button onClick={() => { setRec(true); setSecs(0); }} style={{ display: 'flex', alignItems: 'center', gap: 9, height: 37, padding: '0 16px', borderRadius: 999, background: '#000', border: 'none', cursor: 'pointer' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: t.green, color: '#04231a' }}><MIcon k="check" size={14} /></span>
            <span style={{ fontFamily: FM, fontSize: 12, color: '#fff' }}>Saved · tap to record</span>
          </button>
        )}
      </div>
      {/* home grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 22, padding: '90px 30px 0' }}>
        {apps.map((a, i) => (
          <div key={a} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 58, height: 58, borderRadius: 15, background: cols[i], opacity: 0.92 }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>{a}</span>
          </div>
        ))}
      </div>
      <span style={{ flex: 1 }} />
      {/* dock */}
      <div style={{ display: 'flex', gap: 0, margin: '0 16px 34px', padding: '0 18px', height: 86, alignItems: 'center', borderRadius: 32, background: 'rgba(255,255,255,0.12)' }}>
        {['#1f9bf5', '#34c759', '#ff9f0a'].map((c) => <div key={c} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}><span style={{ width: 56, height: 56, borderRadius: 14, background: c }} /></div>)}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}><span style={{ width: 56, height: 56, borderRadius: 14, background: t.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><WGhost size={30} /></span></div>
      </div>
    </div>
  );
}

/* ─── Widgets & Control Center (WhisperioWidget.swift) ─── */
function WidgetScene({ t }) {
  const [toast, setToast] = React.useState('');
  const ping = (msg) => { setToast(msg); setTimeout(() => setToast(''), 1800); };
  const rec = (msg) => ping(msg || 'Opening Whisperio → recording…');
  const recents = M_RECS.slice(0, 2);

  const Sect = ({ title, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}><SectionLabel text={title} t={t} />{children}</div>
  );
  const Small = ({ children, onClick, grad }) => (
    <button onClick={onClick} style={{ width: 150, height: 150, borderRadius: 22, background: grad ? t.gradient : t.surface, border: grad ? 'none' : `1px solid ${t.line}`, cursor: 'pointer', padding: 15, display: 'flex', flexDirection: 'column', textAlign: 'left', boxShadow: t.mode === 'dark' ? 'none' : '0 6px 16px rgba(20,40,60,.05)' }}>{children}</button>
  );
  const Medium = ({ children, onClick }) => (
    <button onClick={onClick} style={{ width: '100%', borderRadius: 22, background: t.surface, border: `1px solid ${t.line}`, cursor: 'pointer', padding: 16, display: 'flex', flexDirection: 'column', textAlign: 'left', gap: 11, boxShadow: t.mode === 'dark' ? 'none' : '0 6px 16px rgba(20,40,60,.05)' }}>{children}</button>
  );
  const trunc = (s, n) => (s.length <= n ? s : s.slice(0, n) + '…');

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: t.bg, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ paddingTop: 52 }}><WHeader title="Widgets" t={t} /></div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 20px 30px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Sect title="Shipped · WhisperioWidget.swift">
          <div style={{ display: 'flex', gap: 14 }}>
            <Small onClick={() => rec()}>
              <span style={{ flex: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, alignSelf: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: '50%', background: '#1cc8b4', color: '#fff' }}><MIcon k="micFill" size={30} /></span>
                <span style={{ fontFamily: FUI, fontSize: 14, fontWeight: 600, color: t.text }}>Dictate</span>
              </div>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: FM, fontSize: 9.5, color: t.faint, alignSelf: 'center' }}>systemSmall</span>
            </Small>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: t.surface, border: `1px solid ${t.line}` }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', border: '2px solid rgba(255,255,255,.4)', color: t.text, flexShrink: 0 }}><MIcon k="micFill" size={15} /></span>
                <span style={{ fontFamily: FM, fontSize: 9.5, color: t.faint }}>accessoryCircular</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: t.surface, border: `1px solid ${t.line}` }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: t.text }}><MIcon k="micFill" size={15} /><span style={{ fontFamily: FUI, fontSize: 14, fontWeight: 600 }}>Dictate</span></span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: FM, fontSize: 9.5, color: t.faint }}>accessoryRectangular</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, background: t.surface, border: `1px solid ${t.line}` }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: hexA(t.accent, 0.16), color: t.accentLite, flexShrink: 0 }}><MIcon k="micFill" size={15} /></span>
                <span style={{ fontFamily: FUI, fontSize: 12.5, color: t.text }}>Control Center · Dictate</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: FM, fontSize: 9.5, color: t.faint }}>iOS 18</span>
              </div>
            </div>
          </div>
        </Sect>

        <Sect title="Concepts · Home Screen">
          <div style={{ display: 'flex', gap: 14 }}>
            <Small grad onClick={() => rec()}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', color: '#fff' }}><MIcon k="micFill" size={22} /></span>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: FD, fontSize: 17, fontWeight: 600, color: '#fff' }}>Quick dictate</span>
              <span style={{ fontFamily: FM, fontSize: 11, color: 'rgba(255,255,255,0.8)' }}>Gradient concept</span>
            </Small>
            <Small onClick={() => ping('Opening Whisperio')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MIcon k="spark" size={15} style={{ color: t.accentLite }} /><span style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: t.faint }}>This week</span></div>
              <span style={{ flex: 1 }} />
              <span style={{ fontFamily: FD, fontSize: 30, fontWeight: 700, color: t.text, lineHeight: 1 }}>1,240</span>
              <span style={{ fontFamily: FUI, fontSize: 12, color: t.muted, marginTop: 2 }}>words · 5-day streak</span>
              <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>{[5, 8, 4, 9, 7, 3, 6].map((h, i) => <span key={i} style={{ flex: 1, height: h + 8, borderRadius: 2, background: i === 3 ? t.accent : hexA(t.accent, 0.35) }} />)}</div>
            </Small>
          </div>
          <Medium onClick={() => ping('Opening Whisperio')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><MIcon k="book" size={14} style={{ color: t.accentLite }} /><span style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: t.faint }}>Recent</span><span style={{ flex: 1 }} /><span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>{M_RECS.length} notes</span></div>
            {recents.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.accentLite, flexShrink: 0 }}><MIcon k={srcIconOf(r.src)} size={13} /></span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: FUI, fontSize: 12.5, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trunc(r.title, 42)}</span>
                <span style={{ fontFamily: FM, fontSize: 10, color: t.faint, flexShrink: 0 }}>{r.when}</span>
              </div>
            ))}
          </Medium>
          <Medium onClick={() => ping('Opening Whisperio')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><MIcon k="spark" size={14} style={{ color: t.accentLite }} /><span style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: t.faint }}>Today’s digest</span><span style={{ flex: 1 }} /><PrivacyBadge mode="cloud" small t={t} /></div>
            <div style={{ fontFamily: FUI, fontSize: 13.5, color: t.text, lineHeight: 1.5 }}>You scoped API rate limiting, pushed the launch to Thursday, and captured a product idea and a grocery run.</div>
            <div style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>4 notes · 3 categories</div>
          </Medium>
        </Sect>

        <Sect title="Concepts · Lock Screen">
          <div style={{ borderRadius: 22, padding: 18, background: 'linear-gradient(140deg, #2a2350, #0c1020)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={() => rec()} style={{ width: 58, height: 58, borderRadius: '50%', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MIcon k="micFill" size={24} /></button>
              <button onClick={() => ping('Opening Whisperio')} style={{ flex: 1, height: 58, borderRadius: 16, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11, padding: '0 15px', textAlign: 'left' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, background: t.primary, color: t.primaryInk, flexShrink: 0 }}><MIcon k="book" size={16} /></span>
                <div><div style={{ fontFamily: FUI, fontSize: 13.5, fontWeight: 600, color: '#fff' }}>3 notes today</div><div style={{ fontFamily: FM, fontSize: 10.5, color: 'rgba(255,255,255,0.6)' }}>Tap to review</div></div>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MIcon k="micFill" size={13} style={{ color: '#fff' }} />
              <span style={{ fontFamily: FUI, fontSize: 12.5, color: 'rgba(255,255,255,0.82)' }}>Whisperio · Dictate</span>
              <span style={{ flex: 1 }} /><MiniWave t={t} color="rgba(255,255,255,0.6)" n={16} height={12} />
            </div>
          </div>
        </Sect>

        <Sect title="Concepts · StandBy">
          <button onClick={() => rec()} style={{ width: '100%', borderRadius: 22, padding: 20, background: '#000', border: `1px solid ${t.line}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FD, fontSize: 44, fontWeight: 600, color: '#fff', lineHeight: 1 }}>9:41</div>
              <div style={{ fontFamily: FUI, fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Tuesday, 17 June</div>
            </div>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: t.primary, color: t.primaryInk }}><MIcon k="micFill" size={24} /></span>
              <span style={{ fontFamily: FM, fontSize: 10, color: t.accentLite }}>Dictate</span>
            </span>
          </button>
        </Sect>

        <Sect title="Control Center">
          <button onClick={() => rec()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, background: t.surface, border: `1px solid ${t.line}`, cursor: 'pointer', width: '100%' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: t.primary, color: t.primaryInk }}><MIcon k="micFill" size={22} /></span>
            <div style={{ textAlign: 'left' }}><div style={{ fontFamily: FUI, fontSize: 14.5, fontWeight: 600, color: t.text }}>Whisperio Dictate</div><div style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>Control · one tap to record</div></div>
          </button>
        </Sect>
      </div>
      {toast && (
        <div style={{ position: 'absolute', left: '50%', bottom: 34, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 999, background: t.mode === 'dark' ? '#221d33' : '#1b1830', color: '#fff', fontFamily: FUI, fontSize: 13.5, fontWeight: 500, boxShadow: '0 12px 30px rgba(0,0,0,.4)', animation: 'msheet .28s ease-out', whiteSpace: 'nowrap' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.green }} /> {toast}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { KeyboardSceneClassic, TriggerScene, DynamicIslandScene, WidgetScene });
