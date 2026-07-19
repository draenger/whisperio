/* Whisperio Apple — first-run onboarding. Privacy choice → languages → default style →
   keyboard setup → guided first dictation → streak. Interactive stepper; loops for demo.
   Steps: 0 welcome (ghost rock, "Speak it. / Whisperio types.", PrivacyBadge, "Get started")
   1 privacy ("Your words stay yours", On-device only card ALWAYS, shield note: no analytics)
   2 languages ("Confirm your languages", chips from keyboards, auto-detect note)
   3 keyboard ("Turn on the Whisperio keyboard", Keyboards row, Whisperio + Allow Full Access toggles,
     "Go to Settings" → busy → ready → "Keyboard ready — let's try it", ghost sway→giggle)
   4 first note ("Try whispering a note", Notes mock field, mini keyboard, mic → listening
     (ghost idle + waveform + "Listening · on-device") → done "Inserted · on-device" ghost note; Next disabled until done)
   5 streak (ghost jelly, "You're ready", 1-day streak card, 5 day circles, "Start Whispering")
   Progress bar: 5 segments, back chevron, Skip on steps 3-4. */

const ONB_NOTE = 'Things to do today: pick up the dry cleaning, book a table for four on Friday.';
const ONB_LANGS = [['pl', 'Polski'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'], ['uk', 'Українська']];

function OnbCard({ t, on, onClick, children, style }) {
  return (
    <button onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', width: '100%', padding: 16, borderRadius: 18, background: t.surface, border: `${on ? 2 : 1}px solid ${on ? t.accent : t.line}`, display: 'flex', flexDirection: 'column', gap: 8, ...style }}>{children}</button>
  );
}

function OnboardingScene({ t, initialStep = 0 }) {
  const [step, setStep] = React.useState(initialStep);
  const [privacy, setPrivacy] = React.useState('device');
  const [langs, setLangs] = React.useState(['pl', 'en']);
  const [kb, setKb] = React.useState({ on: false, fa: false, busy: false });
  const [tryS, setTryS] = React.useState('idle'); // idle | listening | done
  const [typed, setTyped] = React.useState('');
  const typer = React.useRef(null);
  React.useEffect(() => () => clearInterval(typer.current), []);

  const kbReady = kb.on && kb.fa;
  const goSettings = () => {
    if (kb.busy || kbReady) return;
    setKb((s) => ({ ...s, busy: true }));
    setTimeout(() => setKb((s) => ({ ...s, on: true })), 550);
    setTimeout(() => setKb((s) => ({ ...s, fa: true, busy: false })), 1250);
  };
  const startTry = () => {
    if (tryS === 'listening') return;
    setTryS('listening'); setTyped('');
    let i = 0; clearInterval(typer.current);
    typer.current = setInterval(() => { i += 2; setTyped(ONB_NOTE.slice(0, i)); if (i >= ONB_NOTE.length) { clearInterval(typer.current); setTimeout(() => setTryS('done'), 500); } }, 46);
  };
  const restart = () => { clearInterval(typer.current); setStep(0); setKb({ on: false, fa: false, busy: false }); setTryS('idle'); setTyped(''); };

  const dim = t.mode === 'dark';
  const next = () => setStep((s) => Math.min(s + 1, 5));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const keyBg = dim ? 'rgba(255,255,255,0.13)' : '#fff';
  const keyFg = dim ? '#ECEBF4' : '#1b1830';

  const progress = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px 4px', flexShrink: 0 }}>
      <button onClick={back} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: 'none', border: 'none', color: t.text, cursor: 'pointer', padding: 0 }}><MIcon k="chevL" size={19} /></button>
      <div style={{ flex: 1, display: 'flex', gap: 7 }}>
        {[1, 2, 3, 4, 5].map((i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? t.accent : t.surfaceUp, transition: 'background .3s' }} />)}
      </div>
      {step >= 3 && step < 5
        ? <button onClick={next} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: FUI, fontSize: 14, color: t.muted, padding: 0 }}>Skip</button>
        : <span style={{ width: 28 }} />}
    </div>
  );
  const H = ({ children, sub }) => (
    <div style={{ padding: '16px 26px 6px', textAlign: 'center', flexShrink: 0 }}>
      <div style={{ fontFamily: FD, fontSize: 26, fontWeight: 600, color: t.text, lineHeight: 1.25, letterSpacing: '-.01em', textWrap: 'balance' }}>{children}</div>
      {sub && <div style={{ fontFamily: FUI, fontSize: 13.5, color: t.muted, lineHeight: 1.5, marginTop: 9, textWrap: 'pretty' }}>{sub}</div>}
    </div>
  );
  const Foot = ({ label, onClick, disabled }) => (
    <div style={{ padding: '14px 22px 30px', flexShrink: 0 }}>
      <GradButton title={label} t={t} onClick={onClick} style={{ width: '100%', opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }} />
    </div>
  );

  let body = null, foot = null;

  if (step === 0) {
    body = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '0 32px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 148, height: 148, borderRadius: 38, background: t.mode === 'dark' ? '#0c1822' : '#0e2231', border: `1px solid ${hexA(t.accent, 0.45)}`, boxShadow: `0 20px 44px -10px ${hexA(t.accent, 0.55)}` }}>{window.ListeningGhost ? <ListeningGhost phase="rock" size={104} clickFun /> : <WGhost size={52} />}</span>
        <div style={{ fontFamily: FD, fontSize: 34, fontWeight: 600, color: t.text, textAlign: 'center', lineHeight: 1.15, letterSpacing: '-.02em' }}>Speak it.<br />Whisperio types.</div>
        <div style={{ fontFamily: FUI, fontSize: 15, color: t.muted, textAlign: 'center', lineHeight: 1.55, textWrap: 'pretty' }}>Dictate into any app — transcribed on this iPhone, never uploaded.</div>
        <PrivacyBadge mode="device" t={t} />
      </div>
    );
    foot = <Foot label="Get started" onClick={next} />;
  }

  const gStrip = (ph) => window.ListeningGhost ? <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14 }}><ListeningGhost phase={ph} size={64} clickFun /></div> : null;

  if (step === 1) {
    body = (
      <>
        {gStrip('phasefx')}
        <H sub="Everything is transcribed on this iPhone. There’s nothing to opt out of.">Your words stay yours</H>
        <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          <OnbCard t={t} on={true} onClick={() => setPrivacy('device')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, background: hexA(t.green, 0.13), color: t.green }}><MIcon k="lock" size={17} /></span>
              <span style={{ fontFamily: FD, fontSize: 16.5, fontWeight: 600, color: t.text, flex: 1 }}>On-device only</span>
              <span style={{ fontFamily: FM, fontSize: 9.5, fontWeight: 600, letterSpacing: '.08em', color: t.accentLite, background: hexA(t.accent, 0.13), border: `1px solid ${t.hair}`, borderRadius: 999, padding: '3px 8px' }}>ALWAYS</span>
            </div>
            <div style={{ fontFamily: FUI, fontSize: 13, color: t.muted, lineHeight: 1.5, textWrap: 'pretty' }}>Audio is transcribed by the neural engine and never leaves this iPhone. Works in airplane mode.</div>
          </OnbCard>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 18, background: t.surfaceUp, border: `1px solid ${t.line}` }}>
            <MIcon k="shield" size={16} style={{ color: t.green, flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontFamily: FUI, fontSize: 13, color: t.muted, lineHeight: 1.55, textWrap: 'pretty' }}>No analytics, no audio clips, no “help improve” switch — Whisperio has nothing to collect.</div>
          </div>
        </div>
      </>
    );
    foot = <Foot label="Next" onClick={next} />;
  }

  if (step === 2) {
    const toggle = (c) => setLangs((l) => (l.includes(c) ? (l.length > 1 ? l.filter((x) => x !== c) : l) : [...l, c]));
    body = (
      <>
        {gStrip('tilt')}
        <H sub="Picked from your keyboards — tap to add or remove. Whisperio auto-detects which one you’re speaking.">Confirm your languages</H>
        <div style={{ padding: '16px 22px', display: 'flex', flexWrap: 'wrap', gap: 9 }}>
          {ONB_LANGS.map(([c, n]) => {
            const on = langs.includes(c);
            return (
              <button key={c} onClick={() => toggle(c)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FUI, fontSize: 14.5, fontWeight: 600, cursor: 'pointer', padding: '11px 16px', borderRadius: 14, background: on ? hexA(t.accent, dim ? 0.16 : 0.10) : t.surface, color: on ? t.accentLite : t.muted, border: `${on ? 2 : 1}px solid ${on ? t.accent : t.line}` }}>
                {on && <MIcon k="check" size={14} />} {n}
              </button>
            );
          })}
        </div>
      </>
    );
    foot = <Foot label="Next" onClick={next} />;
  }

  if (step === 3) {
    const settRow = (label, on, last, icon) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderBottom: last ? 'none' : `1px solid ${t.lineSoft}` }}>
        {icon && <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: t.surfaceUp, color: t.muted }}><MIcon k={icon} size={16} /></span>}
        <span style={{ flex: 1, fontFamily: FUI, fontSize: 15, color: t.text }}>{label}</span>
        <MToggle on={on} onChange={() => {}} t={t} />
      </div>
    );
    body = (
      <>
        {gStrip(kbReady ? 'giggle' : 'sway')}
        <H sub="One switch in Settings — we’ll take you straight there and back.">Turn on the Whisperio keyboard</H>
        <div style={{ padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px' }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, background: t.surfaceUp, color: t.muted }}><MIcon k="keyboard" size={16} /></span>
              <span style={{ flex: 1, fontFamily: FUI, fontSize: 15, color: t.text }}>Keyboards</span>
              <MIcon k="chevR" size={16} style={{ color: t.faint }} />
            </div>
          </div>
          <div style={{ background: t.surface, border: `1px solid ${kbReady ? t.hair : t.line}`, borderRadius: 16, transition: 'border .3s' }}>
            {settRow('Whisperio', kb.on, false)}
            {settRow('Allow Full Access', kb.fa, true, 'lock')}
          </div>
          {kbReady
            ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: FM, fontSize: 12, fontWeight: 600, color: t.green, paddingTop: 4 }}><MIcon k="check" size={14} /> Keyboard ready — let’s try it</div>
            : <div style={{ fontFamily: FUI, fontSize: 12.5, color: t.faint, lineHeight: 1.55, textAlign: 'center', padding: '4px 8px 0', textWrap: 'pretty' }}>We never store or sell what you say. Full Access only lets Whisperio insert text across apps.</div>}
        </div>
      </>
    );
    foot = kbReady
      ? <Foot label="Next" onClick={next} />
      : <Foot label={kb.busy ? 'Opening Settings…' : 'Go to Settings'} onClick={goSettings} disabled={kb.busy} />;
  }

  if (step === 4) {
    const KRow = ({ s, pad }) => (
      <div style={{ display: 'flex', gap: 4, padding: pad ? '0 16px' : 0 }}>
        {s.split('').map((c) => <span key={c} style={{ flex: 1, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, background: keyBg, color: keyFg, fontFamily: FUI, fontSize: 13 }}>{c}</span>)}
      </div>
    );
    body = (
      <>
        <H sub="Bring the phone close and speak quietly — whispering works.">Try whispering a note</H>
        <div style={{ padding: '12px 22px 0', flex: 1, minHeight: 0 }}>
          <div style={{ background: t.surface, border: `1px solid ${tryS === 'done' ? t.hair : t.line}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '9px 13px', borderBottom: `1px solid ${t.lineSoft}` }}>
              <MIcon k="chevL" size={14} style={{ color: t.faint }} />
              <span style={{ flex: 1, textAlign: 'center', fontFamily: FUI, fontSize: 12, fontWeight: 600, color: t.muted }}>Notes</span>
              <MIcon k="more" size={14} style={{ color: t.faint }} />
            </div>
            <div style={{ padding: '13px 14px', minHeight: 108, fontFamily: FUI, fontSize: 14.5, lineHeight: 1.55, color: typed ? t.text : t.faint }}>
              {typed ? <>{typed}{tryS === 'listening' && <span style={{ color: t.accent }}>|</span>}</> : 'Things to do today…'}
            </div>
          </div>
          {tryS === 'done' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 12 }}>
              {window.ListeningGhost && <ListeningGhost phase="note" size={54} />}
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 12, fontWeight: 600, color: t.green }}><MIcon k="check" size={14} /> Inserted · on-device</span>
            </div>
          )}
        </div>
        <div style={{ padding: '10px 6px 8px', background: dim ? '#0d0b16' : '#d4d2e2', display: 'flex', flexDirection: 'column', gap: 7, flexShrink: 0 }}>
          {tryS === 'listening' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '4px 0 10px' }}>
              {window.ListeningGhost && <ListeningGhost phase="idle" size={58} />}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Waveform t={t} color={t.accentLite} bars={22} height={40} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 11.5, color: t.muted }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.red, animation: 'mpulse 1.4s ease-in-out infinite' }} /> Listening · on-device
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 10px' }}>
                <span style={{ flex: 1, textAlign: 'right', fontFamily: FUI, fontSize: 13.5, color: t.muted }}>Tap the mic to start speaking →</span>
                <button onClick={startTry} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer', background: t.gradient, color: '#fff', boxShadow: `0 8px 18px -4px ${hexA(t.accent, 0.55)}`, flexShrink: 0 }}><MIcon k="micFill" size={20} /></button>
              </div>
              <KRow s="qwertyuiop" />
              <KRow s="asdfghjkl" pad />
              <KRow s="zxcvbnm" pad />
            </>
          )}
        </div>
      </>
    );
    foot = <Foot label="Next" onClick={next} disabled={tryS !== 'done'} />;
  }

  if (step === 5) {
    body = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '0 26px' }}>
        {window.ListeningGhost && <ListeningGhost phase="jelly" size={110} clickFun />}
        <div style={{ fontFamily: FD, fontSize: 32, fontWeight: 600, color: t.text, textAlign: 'center', letterSpacing: '-.02em' }}>You’re ready</div>
        <div style={{ fontFamily: FUI, fontSize: 14.5, color: t.muted, textAlign: 'center', lineHeight: 1.55, textWrap: 'pretty' }}>Whisperio works in every app — keyboard, Action Button, Lock Screen and Watch.</div>
        <div style={{ width: '100%', padding: 18, borderRadius: 18, background: t.surface, border: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ fontFamily: FD, fontSize: 19, fontWeight: 600, color: t.text }}>1-day streak</div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[1, 2, 3, 4, 5].map((d) => (
              <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', background: d === 1 ? t.gradient : t.surfaceUp, color: d === 1 ? '#fff' : t.faint, border: d === 1 ? 'none' : `1px solid ${t.line}` }}><MIcon k="check" size={16} /></span>
                <span style={{ fontFamily: FM, fontSize: 9.5, color: d === 1 ? t.accentLite : t.faint }}>Day {d}</span>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: FUI, fontSize: 12.5, color: t.muted, textAlign: 'center', lineHeight: 1.5 }}>Dictate 5 days in a row so Whisperio adapts to you.</div>
        </div>
      </div>
    );
    foot = <Foot label="Start Whispering" onClick={restart} />;
  }

  return (
    <ScreenScaffold t={t}>
      {step > 0 && progress}
      <div key={step} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', animation: 'mkbin .32s cubic-bezier(.16,.84,.44,1)' }}>{body}</div>
      {foot}
    </ScreenScaffold>
  );
}

Object.assign(window, { OnboardingScene });
