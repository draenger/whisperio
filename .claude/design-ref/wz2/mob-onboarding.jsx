/* Whisperio Apple — first-run onboarding. Privacy choice → languages → default style →
   keyboard setup → guided first dictation → streak. Interactive stepper; loops for demo. */

const ONB_NOTE = 'Things to do today: pick up the dry cleaning, book a table for four on Friday.';
const ONB_LANGS = [['pl', 'Polski'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'], ['uk', 'Українська']];

function OnbCard({ t, on, onClick, children, style }) {
  return (
    <button onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', width: '100%', padding: 16, borderRadius: 18, background: t.surface, border: `${on ? 2 : 1}px solid ${on ? t.accent : t.line}`, display: 'flex', flexDirection: 'column', gap: 8, ...style }}>{children}</button>
  );
}

function OnboardingScene({ t, initialStep = 0, initialProvSheet, initialKbReady, initialTryDone }) {
  const [step, setStep] = React.useState(initialStep);
  const [privacy, setPrivacy] = React.useState('device');
  const [provSheet, setProvSheet] = React.useState(!!initialProvSheet);
  const [prov, setProv] = React.useState(null); // connected provider name
  const [provPick, setProvPick] = React.useState('ElevenLabs');
  const [provKey, setProvKey] = React.useState(false); // key "pasted"
  const [provBusy, setProvBusy] = React.useState(false);
  const connectProv = () => {
    if (!provKey || provBusy) return;
    setProvBusy(true);
    setTimeout(() => { setProvBusy(false); setProv(provPick); setPrivacy('cloud'); setProvSheet(false); }, 900);
  };
  const [langs, setLangs] = React.useState(['pl', 'en']);
  const [kb, setKb] = React.useState({ on: !!initialKbReady, fa: !!initialKbReady, busy: false });
  const [bt, setBt] = React.useState({ on: false, busy: false });
  const goBackTap = () => {
    if (bt.busy || bt.on) return;
    setBt({ on: false, busy: true });
    setTimeout(() => setBt({ on: true, busy: false }), 900);
  };
  const [tryS, setTryS] = React.useState(initialTryDone ? 'done' : 'idle'); // idle | listening | done
  const [typed, setTyped] = React.useState(initialTryDone ? ONB_NOTE : '');
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
  const restart = () => { clearInterval(typer.current); setStep(0); setKb({ on: false, fa: false, busy: false }); setBt({ on: false, busy: false }); setTryS('idle'); setTyped(''); };

  const dim = t.mode === 'dark';
  const next = () => setStep((s) => Math.min(s + 1, 8));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const keyBg = dim ? 'rgba(255,255,255,0.13)' : '#fff';
  const keyFg = dim ? '#ECEBF4' : '#1b1830';

  const progress = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 18px 4px', flexShrink: 0 }}>
      <button onClick={back} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: 'none', border: 'none', color: t.text, cursor: 'pointer', padding: 0 }}><MIcon k="chevL" size={19} /></button>
      <div style={{ flex: 1, display: 'flex', gap: 7 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? t.accent : t.surfaceUp, transition: 'background .3s' }} />)}
      </div>
      {step >= 3 && step < 8
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
      </div>
    );
    foot = <Foot label="Get started" onClick={next} />;
  }

  const gStrip = (ph) => window.ListeningGhost ? <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 14 }}><ListeningGhost phase={ph} size={64} clickFun /></div> : null;

  if (step === 1) {
    body = (
      <>
        {gStrip('phasefx')}
        <H sub="Everything is transcribed on this iPhone — unless you choose a third-party model provider.">Your words stay yours</H>
        <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          <OnbCard t={t} on={privacy === 'device'} onClick={() => setPrivacy('device')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, background: hexA(t.green, 0.13), color: t.green }}><MIcon k="lock" size={17} /></span>
              <span style={{ fontFamily: FD, fontSize: 16.5, fontWeight: 600, color: t.text, flex: 1 }}>On-device</span>
              <span style={{ fontFamily: FM, fontSize: 9.5, fontWeight: 600, letterSpacing: '.08em', color: t.accentLite, background: hexA(t.accent, 0.13), border: `1px solid ${t.hair}`, borderRadius: 999, padding: '3px 8px' }}>DEFAULT</span>
            </div>
            <div style={{ fontFamily: FUI, fontSize: 13, color: t.muted, lineHeight: 1.5, textWrap: 'pretty' }}>Audio is transcribed by the neural engine and never leaves this iPhone. Works in airplane mode.</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontFamily: FUI, fontSize: 12, color: t.faint, lineHeight: 1.45 }}><MIcon k="people" size={13} style={{ flexShrink: 0, marginTop: 1 }} /> Doesn’t support group (multi-speaker) transcription yet.</div>
          </OnbCard>
          <OnbCard t={t} on={privacy === 'cloud'} onClick={() => { setProvKey(false); setProvSheet(true); }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, background: hexA(t.accent, 0.12), color: t.accentLite }}><MIcon k="cloud" size={17} /></span>
              <span style={{ fontFamily: FD, fontSize: 16.5, fontWeight: 600, color: t.text, flex: 1 }}>Your model provider</span>
              <span style={{ fontFamily: FM, fontSize: 9.5, fontWeight: 600, letterSpacing: '.08em', color: t.muted, background: t.surfaceUp, border: `1px solid ${t.line}`, borderRadius: 999, padding: '3px 8px' }}>OPTIONAL</span>
            </div>
            <div style={{ fontFamily: FUI, fontSize: 13, color: t.muted, lineHeight: 1.5, textWrap: 'pretty' }}>Plug in your own key — unlocks group transcription with speaker labels. Audio goes only to your provider, only while you dictate.</div>
            {prov
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: FM, fontSize: 11.5, fontWeight: 600, color: t.green }}><MIcon k="check" size={13} /> {prov} connected</div>
              : <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FUI, fontSize: 12.5, fontWeight: 600, color: t.accentLite }}>Choose a provider <MIcon k="chevR" size={13} /></div>}
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
    const path = [['1', 'Settings → Accessibility → Touch'], ['2', 'Back Tap → Double Tap'], ['3', 'Choose “Whisperio”']];
    body = (
      <>
        {gStrip('sway')}
        <H sub="Double-tap the back of your iPhone to start dictating — in any app, even from the Home Screen.">Set up Back-Tap</H>
        <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 11 }}>
          {path.map(([n, l]) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 16, background: t.surface, border: `1px solid ${t.line}` }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: hexA(t.accent, 0.13), color: t.accentLite, fontFamily: FM, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{n}</span>
              <span style={{ fontFamily: FUI, fontSize: 13.5, fontWeight: 600, color: t.text }}>{l}</span>
            </div>
          ))}
          {bt.on
            ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: FM, fontSize: 12, fontWeight: 600, color: t.green, paddingTop: 4 }}><MIcon k="check" size={14} /> Back-Tap → Whisperio is on</div>
            : <div style={{ fontFamily: FUI, fontSize: 12.5, color: t.faint, lineHeight: 1.55, textAlign: 'center', padding: '2px 8px 0', textWrap: 'pretty' }}>We’ll take you straight there and back.</div>}
        </div>
      </>
    );
    foot = bt.on
      ? <Foot label="Next" onClick={next} />
      : <Foot label={bt.busy ? 'Opening Settings…' : 'Go to Settings'} onClick={goBackTap} disabled={bt.busy} />;
  }

  if (step === 5) {
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
          {tryS === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12, padding: '12px 14px', borderRadius: 14, background: t.surface, border: `1px solid ${t.line}` }}>
              <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: t.faint }}>Good to know</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: FUI, fontSize: 12.5, color: t.muted }}><MIcon k="copy" size={14} style={{ color: t.accentLite }} /> Double-tap any note to copy it</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: FUI, fontSize: 12.5, color: t.muted }}><MIcon k="chevL" size={14} style={{ color: t.accentLite }} /> Swipe a note left to delete it</div>
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
                <button onClick={startTry} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer', background: t.primary, color: t.primaryInk, boxShadow: `0 8px 18px -6px ${hexA(t.accent, 0.45)}`, flexShrink: 0 }}><MIcon k="micFill" size={20} /></button>
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

  if (step === 6) {
    const trig = [['bolt', 'Action Button'], ['lock', 'Lock Screen'], ['keyboard', 'Keyboard'], ['watch', 'Apple Watch'], ['mic', 'Control Center'], ['more', 'Back-Tap']];
    body = (
      <>
        {gStrip('note')}
        <H sub="Set them up anytime in Settings → Triggers — every capture lands in the same library.">Capture from anywhere</H>
        <div style={{ padding: '14px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {trig.map(([ic, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16, background: t.surface, border: `1px solid ${t.line}` }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: hexA(t.accent, 0.12), color: t.accentLite, flexShrink: 0 }}><MIcon k={ic} size={16} /></span>
              <span style={{ fontFamily: FUI, fontSize: 13.5, fontWeight: 600, color: t.text }}>{l}</span>
            </div>
          ))}
        </div>
      </>
    );
    foot = <Foot label="Next" onClick={next} />;
  }

  if (step === 7) {
    const feat = [
      ['people', 'Group transcription', 'Records the whole room and separates speakers. Requires ElevenLabs (up to 32 speakers) or OpenAI (up to 4).'],
      ['book', 'Journal & daily digest', 'Notes bind themselves into days, weeks and topic books.'],
      ['spark', 'Rewrite templates', 'Turn a rambling take into a standup update, email or list.'],
      ['list', 'Custom vocabulary', 'Teach it your project names, tools and shorthand.'],
    ];
    body = (
      <>
        {gStrip('tilt')}
        <H sub="All of it lives in the app — nothing to set up right now.">More than a transcript</H>
        <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {feat.map(([ic, l, s]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 14px', borderRadius: 16, background: t.surface, border: `1px solid ${t.line}` }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, background: hexA(t.accent, 0.12), color: t.accentLite, flexShrink: 0 }}><MIcon k={ic} size={17} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FD, fontSize: 15, fontWeight: 600, color: t.text }}>{l}</div>
                <div style={{ fontFamily: FUI, fontSize: 12.5, color: t.muted, lineHeight: 1.5, marginTop: 3, textWrap: 'pretty' }}>{s}</div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
    foot = <Foot label="Next" onClick={next} />;
  }

  if (step === 8) {
    body = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '0 26px' }}>
        {window.ListeningGhost && <ListeningGhost phase="jelly" size={110} clickFun />}
        <div style={{ fontFamily: FD, fontSize: 32, fontWeight: 600, color: t.text, textAlign: 'center', letterSpacing: '-.02em' }}>You’re ready</div>
        <div style={{ fontFamily: FUI, fontSize: 14.5, color: t.muted, textAlign: 'center', lineHeight: 1.55, textWrap: 'pretty' }}>Whisperio works in every app — keyboard, Action Button, Lock Screen and Watch.</div>
        <PrivacyBadge mode={privacy === 'cloud' ? 'cloud' : 'device'} t={t} />
      </div>
    );
    foot = <Foot label="Start Whispering" onClick={restart} />;
  }

  const PROVS = [['ElevenLabs', 'Scribe · group up to 32 speakers'], ['OpenAI', 'Transcribe · group up to 4 speakers'], ['Deepgram', 'Nova · fast streaming']];
  const provSheetEl = provSheet && (
    <div onClick={() => setProvSheet(false)} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(4,8,12,0.55)', backdropFilter: 'blur(3px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: t.surface, borderRadius: '24px 24px 0 0', border: `1px solid ${t.line}`, borderBottom: 'none', padding: '10px 18px 26px', display: 'flex', flexDirection: 'column', gap: 12, animation: 'mkbin .32s cubic-bezier(.16,.84,.44,1)' }}>
      <span style={{ width: 38, height: 5, borderRadius: 3, background: t.line, alignSelf: 'center' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FD, fontSize: 18, fontWeight: 600, color: t.text }}>Choose your provider</div>
        <div style={{ fontFamily: FUI, fontSize: 12.5, color: t.muted, marginTop: 4, lineHeight: 1.5, textWrap: 'pretty' }}>You bring the key — Whisperio never proxies your audio.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {PROVS.map(([n, s]) => (
          <button key={n} onClick={() => { setProvPick(n); setProvKey(false); }} style={{ textAlign: 'left', cursor: 'pointer', width: '100%', padding: '12px 14px', borderRadius: 15, background: t.surfaceUp, border: `${provPick === n ? 2 : 1}px solid ${provPick === n ? t.accent : t.line}`, display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 10, background: hexA(t.accent, 0.12), color: t.accentLite, fontFamily: FD, fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{n[0]}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontFamily: FD, fontSize: 14.5, fontWeight: 600, color: t.text }}>{n}</span>
              <span style={{ display: 'block', fontFamily: FUI, fontSize: 11.5, color: t.muted, marginTop: 2 }}>{s}</span>
            </span>
            {provPick === n && <MIcon k="check" size={16} style={{ color: t.accentLite }} />}
          </button>
        ))}
      </div>
      <button onClick={() => setProvKey(true)} style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 15, background: t.surfaceUp, border: `1px dashed ${provKey ? t.green : t.line}` }}>
        <MIcon k="lock" size={15} style={{ color: provKey ? t.green : t.faint, flexShrink: 0 }} />
        <span style={{ flex: 1, fontFamily: FM, fontSize: 12.5, color: provKey ? t.text : t.faint }}>{provKey ? 'sk_••••••••••••7f2a' : 'Paste your API key…'}</span>
        {provKey && <MIcon k="check" size={15} style={{ color: t.green }} />}
      </button>
      <GradButton title={provBusy ? 'Verifying key…' : `Connect ${provPick}`} t={t} onClick={connectProv} style={{ width: '100%', opacity: provKey && !provBusy ? 1 : 0.4, pointerEvents: provKey && !provBusy ? 'auto' : 'none' }} />
      </div>
    </div>
  );

  return (
    <ScreenScaffold t={t}>
      {step > 0 && progress}
      <div key={step} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', animation: 'mkbin .32s cubic-bezier(.16,.84,.44,1)' }}>{body}</div>
      {foot}
      {provSheetEl}
    </ScreenScaffold>
  );
}

Object.assign(window, { OnboardingScene });
