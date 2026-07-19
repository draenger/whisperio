/* Whisperio Apple — Pro keyboard: dictation happens inline in the keyboard (Full Access),
   with live text into the field. Fully interactive mock: type on the keys, QuickType bar,
   shift/backspace, send — plus inline dictation with provisional text. No style presets —
   Whisperio types what you say, cleaned up on-device. Classic bounce version stays a Tweak. */

function KeyboardScenePro({ t }) {
  const target = 'Running ten late — grab us a table by the window if you can.';
  const [stage, setStage] = React.useState('idle'); // idle | listening
  const [msgs, setMsgs] = React.useState([{ txt: 'Heading over now?', me: false }, { txt: 'Almost — finishing one thing', me: true }]);
  const [field, setField] = React.useState('');
  const [prov, setProv] = React.useState(''); // provisional dictation text
  const [shift, setShift] = React.useState(true);
  const [secs, setSecs] = React.useState(0);
  const [toast, setToast] = React.useState('');
  const [rw, setRw] = React.useState(false);
  const typer = React.useRef(null); const clk = React.useRef(null); const threadRef = React.useRef(null);
  const stopT = () => { clearInterval(typer.current); clearInterval(clk.current); };
  React.useEffect(() => () => stopT(), []);
  React.useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, toast]);

  /* native iOS keyboard colors (Apple UIKit values) */
  const dim = t.mode === 'dark';
  const kbBg = dim ? '#2b2b2d' : '#d1d3d9';
  const keyBg = dim ? '#6b6b6d' : '#ffffff';
  const spcBg = dim ? '#464648' : '#abb0bc';
  const keyFg = dim ? '#ffffff' : '#000000';
  const keyShadow = dim ? '0 1px 0 rgba(0,0,0,0.35)' : '0 1px 0 #898a8d';
  const hair = dim ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';

  const start = () => { setProv(''); setSecs(0); setStage('listening'); let i = 0; stopT();
    typer.current = setInterval(() => { i += 2; setProv(target.slice(0, i)); if (i >= target.length) clearInterval(typer.current); }, 48);
    clk.current = setInterval(() => setSecs((s) => s + 1), 1000);
  };
  const cancel = () => { stopT(); setProv(''); setStage('idle'); };
  const confirm = () => { stopT(); setField((f) => (f ? f + ' ' : '') + prov); setProv(''); setStage('idle'); flash('Inserted · on-device'); };
  const flash = (txt) => { setToast(txt); setTimeout(() => setToast(''), 2200); };
  const rwText = (id, f) => {
    const s = f.trim();
    if (id === 'bullets') return '• ' + s.split(/[,.]| — /).map((x) => x.trim()).filter(Boolean).join('\n• ');
    if (id === 'shorter') return s.split(' ').slice(0, 7).join(' ').replace(/[,—\s]+$/, '') + '.';
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/\s+/g, ' ') + (/[.!?]$/.test(s) ? '' : '.');
  };
  const applyRw = (id) => { setRw(false); setField((f) => rwText(id, f)); flash('Rewritten · on-device'); };
  const tap = (c) => { setField((f) => f + (shift ? c.toUpperCase() : c)); setShift(false); };
  const back = () => setField((f) => f.slice(0, -1));
  const send = () => { const txt = field.trim(); if (!txt) return; setMsgs((m) => [...m, { txt, me: true }]); setField(''); setShift(true); };
  const suggest = (w) => { setField((f) => (f && !f.endsWith(' ') ? f + ' ' : f) + w + ' '); setShift(false); };

  const sugg = field ? ['and', 'the', 'you'] : ['Omw!', 'Almost there', 'Be right there'];
  const keyCap = (c) => (
    <span key={c} className="wkb-key" onClick={() => tap(c)} style={{ flex: 1, height: 43, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5.5, background: keyBg, color: keyFg, fontFamily: FUI, fontSize: 22, fontWeight: 400, boxShadow: keyShadow }}>{shift ? c.toUpperCase() : c}</span>
  );
  const spcKey = (label, w, onClick, on) => (
    <span className="wkb-key" onClick={onClick} style={{ width: w, height: 43, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5.5, background: on ? '#ffffff' : spcBg, color: on ? '#000' : keyFg, fontFamily: FUI, fontSize: label.length > 2 ? 15 : 18, boxShadow: keyShadow, flexShrink: 0 }}>{label}</span>
  );
  const deviceChip = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', fontFamily: FM, fontSize: 10.5, fontWeight: 600, color: t.green, padding: '5px 11px', borderRadius: 999, background: hexA(t.green, dim ? 0.12 : 0.09), border: `1px solid ${hexA(t.green, 0.28)}` }}>
      <MIcon k="lock" size={11} /> on-device
    </span>
  );
  const bubble = (m, i) => (
    <div key={i} style={{ display: 'flex', justifyContent: m.me ? 'flex-end' : 'flex-start' }}>
      <span style={{ fontFamily: FUI, fontSize: 14.5, color: m.me ? '#fff' : t.text, padding: '9px 14px', borderRadius: 19, background: m.me ? t.accent : t.surfaceUp, maxWidth: '78%', lineHeight: 1.35 }}>{m.txt}</span>
    </div>
  );
  const shown = stage === 'listening' ? (field ? field + ' ' : '') : field;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.bg }}>
      {/* messages header */}
      <div style={{ paddingTop: 56, paddingBottom: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: hexA(t.surface, 0.7), borderBottom: `1px solid ${t.lineSoft}` }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', background: t.gradient, color: '#fff', fontFamily: FD, fontSize: 16 }}>S</span>
        <span style={{ fontFamily: FUI, fontSize: 13, fontWeight: 600, color: t.text }}>Sam</span>
      </div>
      {/* thread */}
      <div ref={threadRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.map(bubble)}
        {toast && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: FM, fontSize: 11, color: t.green, animation: 'msheet .3s' }}><MIcon k="check" size={13} /> {toast}</div>}
      </div>
      {/* input field */}
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${t.lineSoft}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ flex: 1, padding: '8px 14px', borderRadius: 18, background: t.surface, border: `1px solid ${shown || prov ? t.accent : t.line}`, fontFamily: FUI, fontSize: 14.5, color: shown || prov ? t.text : t.faint, minHeight: 34, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
            {shown || prov ? <>
              {shown}
              {stage === 'listening' && prov && <span style={{ borderBottom: `2px dotted ${hexA(t.accent, 0.75)}` }}>{prov}</span>}
              {stage === 'listening' && <span style={{ color: t.accent }}>|</span>}
            </> : 'iMessage'}
          </div>
          {field.trim() && stage === 'idle' && (
            <button className="wkb-key" onClick={send} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', border: 'none', background: t.accent, color: '#fff', fontSize: 17, fontWeight: 700, flexShrink: 0, marginBottom: 1 }}>↑</button>
          )}
        </div>
      </div>
      {/* keyboard — fixed height so the dictation panel never resizes it */}
      <div style={{ background: kbBg, height: 336, display: 'flex', flexDirection: 'column', paddingBottom: 20 }}>
        {stage === 'idle' ? (
          <div key="idle" style={{ display: 'flex', flexDirection: 'column', animation: 'mkbin .22s ease-out' }}>
            {/* Whisperio bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}><WGhost size={15} /><span style={{ fontFamily: FUI, fontSize: 12.5, fontWeight: 600, color: dim ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.6)' }}>Whisperio</span></span>
              <span style={{ flex: 1 }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontFamily: FM, fontSize: 10, fontWeight: 600, color: t.green }}><MIcon k="lock" size={10} /> on-device</span>
              <button className="wkb-key" onClick={() => field.trim() && setRw((v) => !v)} title="Rewrite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: 'none', background: rw ? t.accent : spcBg, color: rw ? '#fff' : keyFg, boxShadow: keyShadow, opacity: field.trim() ? 1 : 0.45 }}><MIcon k="spark" size={16} /></button>
              <button className="wkb-key" onClick={start} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, border: 'none', background: t.accent, color: '#fff', boxShadow: keyShadow }}><MIcon k="micFill" size={17} /></button>
            </div>
            {/* QuickType / rewrite strip */}
            <div style={{ display: 'flex', alignItems: 'stretch', height: 42, margin: '2px 0' }}>
              {rw ? <>
                {[['cleanup', 'Clean up'], ['bullets', 'Bullet points'], ['shorter', 'Shorter']].map(([id, name], i) => (
                  <React.Fragment key={id}>
                    {i > 0 && <span style={{ width: 1, background: hair, margin: '8px 0' }} />}
                    <span className="wkb-key" onClick={() => applyRw(id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 5, color: t.accent, fontFamily: FUI, fontSize: 14.5 }}><MIcon k="spark" size={13} /> {name}</span>
                  </React.Fragment>
                ))}
              </> : sugg.map((w, i) => (
                <React.Fragment key={w}>
                  {i > 0 && <span style={{ width: 1, background: hair, margin: '8px 0' }} />}
                  <span className="wkb-key" onClick={() => suggest(w)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, color: keyFg, fontFamily: FUI, fontSize: 16 }}>{field ? w : `“${w}”`}</span>
                </React.Fragment>
              ))}
            </div>
            {/* rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: '4px 3px 0' }}>
              <div style={{ display: 'flex', gap: 6 }}>{'qwertyuiop'.split('').map(keyCap)}</div>
              <div style={{ display: 'flex', gap: 6, padding: '0 19px' }}>{'asdfghjkl'.split('').map(keyCap)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {spcKey('⇧', 46, () => setShift((s) => !s), shift)}
                {'zxcvbnm'.split('').map(keyCap)}
                {spcKey('⌫', 46, back)}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {spcKey('123', 48, () => {})}
                {spcKey('🌐', 42, () => {})}
                <span className="wkb-key" onClick={() => tap(' ')} style={{ flex: 1, height: 43, borderRadius: 5.5, background: keyBg, boxShadow: keyShadow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: keyFg, fontFamily: FUI, fontSize: 15 }}>space</span>
                <span className="wkb-key" onClick={send} style={{ width: 88, height: 43, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5.5, background: field.trim() ? t.accent : spcBg, color: field.trim() ? '#fff' : keyFg, fontFamily: FUI, fontSize: 15, boxShadow: keyShadow, flexShrink: 0, transition: 'background .15s' }}>return</span>
              </div>
            </div>
          </div>
        ) : (
          <div key="listen" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: '10px 12px 0', animation: 'mkbin .22s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="wkb-key" onClick={cancel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: '50%', background: spcBg, border: 'none', boxShadow: keyShadow, color: keyFg }}><MIcon k="x" size={18} /></button>
              <span style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>{deviceChip}</span>
              <button className="wkb-key" onClick={confirm} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: '50%', border: 'none', background: t.accent, color: '#fff', boxShadow: keyShadow }}><MIcon k="check" size={22} /></button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}><Waveform t={t} color={t.accent} bars={30} height={54} /></div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: FM, fontSize: 11.5, color: dim ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.red, animation: 'mpulse 1.4s ease-in-out infinite' }} />
              Listening · on-device
              <span style={{ color: t.faint }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span>
            </div>
            <div style={{ textAlign: 'center', fontFamily: FUI, fontSize: 11.5, color: dim ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.4)' }}>Speak naturally — tap ✓ to keep the text, ✕ to discard</div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { KeyboardScenePro });
