/* Whisperio Apple — experiment: continuous-note home ("scratchpad"). One running note per day;
   each dictation appends an entry inline. Whisperflow-style donotowywanie. */

const SCRATCH_SEED = [
  { time: '9:12 AM', text: 'Standup: shipped the export pipeline, still blocked on the staging cert — pinged infra, pairing with Mara after lunch.' },
  { time: '11:47 AM', text: 'Idea — the keyboard could show the last three notes as QuickType chips, tap to paste. Check if the 60 MB memory cap allows it.' },
  { time: '2:03 PM', text: 'Groceries on the way home: oat milk, coffee beans, basil, and something for Saturday breakfast.' },
];
const SCRATCH_LINES = [
  'Call the dentist tomorrow before nine, and move the design review to Friday.',
  'Follow up with Sam about the window table — running ten late.',
  'Note to self: the wave animation should pause when the tray is hidden.',
];

function PhoneScratchpad({ t, onBack, onSettings, onHistory, onSummarize }) {
  const [entries, setEntries] = React.useState(SCRATCH_SEED);
  const [stage, setStage] = React.useState('idle'); // idle | listening | processing
  const [prov, setProv] = React.useState('');
  const [secs, setSecs] = React.useState(0);
  const lineIdx = React.useRef(0);
  const typer = React.useRef(null); const clk = React.useRef(null); const scroller = React.useRef(null);
  const gh = useListeningGhost();
  const stopT = () => { clearInterval(typer.current); clearInterval(clk.current); };
  React.useEffect(() => () => stopT(), []);
  React.useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [entries, prov, stage]);

  const start = () => {
    const target = SCRATCH_LINES[lineIdx.current % SCRATCH_LINES.length]; lineIdx.current++;
    setProv(''); setSecs(0); setStage('listening'); stopT(); gh.react('idle', 999999);
    let i = 0;
    typer.current = setInterval(() => { i += 2; setProv(target.slice(0, i)); if (i >= target.length) clearInterval(typer.current); }, 50);
    clk.current = setInterval(() => setSecs((s) => s + 1), 1000);
  };
  const stop = () => {
    stopT();
    const txt = prov.trim();
    setProv(''); setStage('processing');
    setTimeout(() => {
      if (txt) setEntries((e) => [...e, { time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), text: txt, fresh: true }]);
      setStage('idle'); gh.react('note');
    }, 900);
  };
  const cancel = () => { stopT(); setProv(''); setStage('idle'); gh.react('wtf', 2600); };

  const wordCount = entries.reduce((n, e) => n + e.text.split(/\s+/).length, 0);
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Today’s note" t={t} onBack={onBack} right={<div style={{ display: 'flex', gap: 9 }}><SquareIconButton icon="book" t={t} onClick={onHistory} /><SquareIconButton icon="cog" t={t} onClick={onSettings} /></div>} />
      {/* note header */}
      <div style={{ padding: '2px 20px 12px', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: FD, fontSize: 22, fontWeight: 650, color: t.text }}>Today</span>
        <span style={{ fontFamily: FM, fontSize: 11.5, color: t.faint }}>Fri, Jul 18</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>{entries.length} takes · {wordCount} words</span>
      </div>
      {/* the continuous note */}
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 150px' }}>
        <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 20, padding: '6px 18px 14px' }}>
          {entries.map((e, i) => (
            <div key={i} style={{ padding: '13px 0', borderBottom: i === entries.length - 1 && stage !== 'listening' ? 'none' : `1px solid ${t.lineSoft}`, animation: e.fresh ? 'msheet .35s ease-out' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 600, color: t.accentLite }}>{e.time}</span>
                <span style={{ flex: 1, height: 1, background: t.lineSoft }} />
                <MIcon k="lock" size={11} style={{ color: t.green }} />
              </div>
              <div style={{ fontFamily: FUI, fontSize: 15, color: t.text, lineHeight: 1.55, textWrap: 'pretty' }}>{e.text}</div>
            </div>
          ))}
          {stage === 'processing' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 0' }}>
              <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${t.hair}`, borderTopColor: t.accent, animation: 'mspin .8s linear infinite' }} />
              <span style={{ fontFamily: FM, fontSize: 11.5, color: t.accentLite }}>Transcribing…</span>
            </div>
          )}
          {entries.length === 0 && stage === 'idle' && (
            <div style={{ fontFamily: FUI, fontSize: 14, color: t.muted, lineHeight: 1.55, padding: '16px 0', textWrap: 'pretty' }}>Say something — every take lands here, in one running note for the day.</div>
          )}
          {stage === 'listening' && (
            <div style={{ padding: '13px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.red, animation: 'mpulse 1.4s ease-in-out infinite' }} />
                <span style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 600, color: t.red }}>now</span>
                <span style={{ flex: 1, height: 1, background: t.lineSoft }} />
                <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span>
              </div>
              <div style={{ fontFamily: FUI, fontSize: 15, lineHeight: 1.55, minHeight: 23 }}>
                <span style={{ color: t.text, borderBottom: `2px dotted ${hexA(t.accent, 0.6)}` }}>{prov}</span>
                <span style={{ color: t.accent }}>|</span>
              </div>
            </div>
          )}
        </div>
        {stage === 'idle' && entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 14 }}>
            <span style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>At midnight this note rolls into your Journal</span>
            <button onClick={onSummarize} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: FM, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', color: t.accentLite, background: hexA(t.accent, 0.12), border: `1px solid ${t.hair}`, borderRadius: 999, padding: '7px 14px' }}><MIcon k="spark" size={13} /> Summarize the day now</button>
          </div>
        )}
      </div>
      {/* dictation control */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '26px 16px 26px', background: `linear-gradient(to top, ${t.bg} 45%, transparent)`, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {gh.phase && <div style={{ display: 'flex', justifyContent: 'center' }}><ListeningGhost phase={gh.phase} size={94} /></div>}
        {stage !== 'listening' ? (
          <button onClick={start} disabled={stage === 'processing'} style={{ pointerEvents: 'auto', width: '100%', height: 56, borderRadius: 16, border: 'none', background: t.gradient, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: FD, fontSize: 16, fontWeight: 600, boxShadow: `0 12px 26px -8px ${hexA(t.accent, 0.6)}`, opacity: stage === 'processing' ? 0.6 : 1 }}>
            <MIcon k="micFill" size={20} /> Continue note
          </button>
        ) : (
          <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 18, background: t.surface, border: `1px solid ${t.line}`, boxShadow: '0 14px 30px -10px rgba(0,0,0,.5)' }}>
            <button onClick={cancel} aria-label="Discard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: '50%', background: t.surfaceUp, border: `1px solid ${t.line}`, color: t.muted, cursor: 'pointer', flexShrink: 0 }}><MIcon k="x" size={17} /></button>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}><Waveform t={t} color={t.accentLite} bars={22} height={30} /></div>
            <button onClick={stop} aria-label="Keep" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 50, height: 50, borderRadius: '50%', border: 'none', background: t.gradient, color: '#fff', cursor: 'pointer', boxShadow: `0 8px 18px -4px ${hexA(t.accent, 0.55)}`, flexShrink: 0 }}><MIcon k="check" size={21} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { PhoneScratchpad });
