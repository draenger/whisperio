/* Whisperio — Recordings tab (list + detail). Ported 1:1 from RecordingsPanel.tsx.
   Rows are already bordered cards in the real app; theme tokens carry the redesign restyle. */

function fmtDate(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtDur(sec) {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}
function fmtSize(b) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function statusIcon(status, theme) {
  if (status === 'completed') return { char: '✓', color: theme.success };
  if (status === 'failed') return { char: '✗', color: theme.danger };
  return { char: '◌', color: theme.warning || '#eab308' };
}

function RecordingDetail({ rec, theme, s, design, onBack }) {
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const failed = rec.status === 'failed';
  const si = statusIcon(rec.status, theme);

  React.useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      setCurrent((c) => {
        const n = c + 0.1;
        if (n >= rec.duration) { setPlaying(false); return 0; }
        return n;
      });
    }, 100);
    return () => clearInterval(iv);
  }, [playing, rec.duration]);

  const bars = Array.from({ length: 40 }, (_, i) => {
    const seed = rec.id.charCodeAt(i % rec.id.length) || 12;
    return 7 + ((seed * (i + 3)) % 24);
  });
  const progress = rec.duration > 0 ? current / rec.duration : 0;
  const fmtTime = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  const meta = [['Duration', fmtDur(rec.duration)], ['Provider', rec.provider], ['Status', rec.status[0].toUpperCase() + rec.status.slice(1)], ['Size', fmtSize(rec.size)]];

  return (
    <div style={{ padding: '20px 26px 28px' }} className="rz-fade">
      <button onClick={onBack} onMouseEnter={(e) => (e.currentTarget.style.color = theme.text)} onMouseLeave={(e) => (e.currentTarget.style.color = theme.textSecondary)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', color: theme.textSecondary, fontFamily: FUI, fontSize: 13, fontWeight: 500, padding: 0, marginBottom: 18 }}>
        <Icon d={IC.arrowLeft} size={15} /> Recordings
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: si.color, flexShrink: 0 }}>{si.char}</span>
        <h2 style={{ fontFamily: FD, fontSize: 18, fontWeight: 600, color: theme.text, letterSpacing: '-.01em' }}>{fmtDate(rec.timestamp)}</h2>
      </div>

      <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', paddingBottom: 20, borderBottom: `1px solid ${theme.border}` }}>
        {meta.map(([k, v]) => (
          <div key={k}>
            <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: theme.textMuted, marginBottom: 5 }}>{k}</div>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: theme.text }}>{v}</div>
          </div>
        ))}
      </div>

      {!failed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderRadius: 12, border: `1px solid ${theme.border}`, margin: '22px 0' }}>
          <button onClick={() => setPlaying((p) => !p)} style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: theme.accent, color: theme.accentInk, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {playing ? <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>}
          </button>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, height: 34 }}>
            {bars.map((h, i) => <span key={i} style={{ flex: 1, height: h, background: i / bars.length <= progress ? theme.accent : theme.borderHover, borderRadius: 2 }} />)}
          </div>
          <span style={{ fontFamily: FM, fontSize: 12, color: theme.textMuted, flexShrink: 0 }}>{fmtTime(current)} / {fmtDur(rec.duration)}</span>
        </div>
      )}

      <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: theme.textMuted, margin: failed ? '24px 0 10px' : '4px 0 10px' }}>Transcription</div>
      <div style={{ fontSize: 14.5, color: failed ? theme.danger : theme.text, lineHeight: 1.7, whiteSpace: 'pre-wrap', textWrap: 'pretty' }}>{failed ? (rec.error || 'Transcription failed.') : (rec.transcription || 'No transcription available.')}</div>

      <div style={{ display: 'flex', gap: 8, marginTop: 26, flexWrap: 'wrap' }}>
        {!failed && rec.transcription && (
          <GhostButton theme={theme} onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <span style={{ color: theme.success }}>✓ Copied</span> : <><Icon d={IC.copy} size={14} /> Copy</>}
          </GhostButton>
        )}
        <GhostButton theme={theme}><Icon d={IC.refresh} size={14} /> Re-transcribe</GhostButton>
        <GhostButton theme={theme} danger><Icon d={IC.trash} size={14} /> Delete</GhostButton>
      </div>
    </div>
  );
}

function RecordingsTab({ theme, s, design }) {
  const [recs, setRecs] = React.useState(RECS);
  const [hov, setHov] = React.useState(null);
  const [sel, setSel] = React.useState(null);
  const [copiedId, setCopiedId] = React.useState(null);
  const [confirmAll, setConfirmAll] = React.useState(false);

  const selected = sel != null ? recs.find((r) => r.id === sel) : null;
  if (selected) return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <RecordingDetail rec={selected} theme={theme} s={s} design={design} onBack={() => setSel(null)} />
      </div>
    </div>
  );

  const trunc = (t, n = 80) => (t.length <= n ? t : t.slice(0, n) + '...');
  const del = (id) => setRecs((r) => r.filter((x) => x.id !== id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 500 }}>{recs.length} recording{recs.length !== 1 ? 's' : ''}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button title="Refresh" onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgTertiary; e.currentTarget.style.borderColor = theme.borderHover; }} onMouseLeave={(e) => { e.currentTarget.style.background = theme.bgSecondary; e.currentTarget.style.borderColor = theme.border; }}
            style={{ background: theme.bgSecondary, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '6px 10px', color: theme.textSecondary, cursor: 'pointer', display: 'flex', transition: 'background .15s, border-color .15s' }}>
            <Icon d={IC.refresh} size={14} />
          </button>
          {recs.length > 0 && (
            <button onClick={() => { if (!confirmAll) { setConfirmAll(true); setTimeout(() => setConfirmAll(false), 3000); } else { setRecs([]); setConfirmAll(false); } }}
              style={{ background: confirmAll ? theme.danger : theme.bgSecondary, border: `1px solid ${confirmAll ? theme.danger : theme.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 500, color: confirmAll ? '#fff' : theme.danger, cursor: 'pointer', fontFamily: FUI }}>
              {confirmAll ? 'Confirm?' : 'Delete All'}
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center' }}>
              <span style={{ fontSize: 32, opacity: 0.3 }}>{'◌'}</span>
              <p style={{ color: theme.textMuted, fontSize: 14, marginTop: 12 }}>No recordings yet</p>
              <p style={{ color: theme.textMuted, fontSize: 12, marginTop: 4, opacity: 0.6 }}>Recordings will appear here after you dictate</p>
            </div>
          ) : recs.map((rec) => {
            const isHov = hov === rec.id;
            const si = statusIcon(rec.status, theme);
            return (
              <div key={rec.id} onClick={() => setSel(rec.id)} onMouseEnter={() => setHov(rec.id)} onMouseLeave={() => setHov(null)}
                style={{ background: theme.bgSecondary, border: `1px solid ${isHov ? theme.accent : theme.border}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, transition: 'border-color .15s', cursor: 'pointer', boxShadow: design.mode === 'redesign' ? theme.e1 : 'none' }}>
                <div style={{ fontSize: 16, fontWeight: 700, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: si.color }}>{si.char}</div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: theme.text, fontFamily: FM }}>{fmtDate(rec.timestamp)}</span>
                    <span style={{ fontSize: 11, color: theme.textMuted, background: theme.bgTertiary, padding: '1px 6px', borderRadius: 4 }}>{fmtDur(rec.duration)}</span>
                    <span style={{ fontSize: 11, color: theme.textMuted, background: theme.bgTertiary, padding: '1px 6px', borderRadius: 4 }}>{rec.provider}</span>
                  </div>
                  <div style={{ fontSize: 13, color: rec.status === 'failed' ? theme.danger : theme.textSecondary, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rec.status === 'completed' && rec.transcription ? trunc(rec.transcription) : rec.status === 'failed' && rec.error ? rec.error : 'No transcription'}
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, opacity: isHov ? 1 : 0, pointerEvents: isHov ? 'auto' : 'none', transition: 'opacity .15s' }}>
                  {rec.status === 'completed' && rec.transcription && (
                    <RowAction theme={theme} title="Copy" onClick={() => { setCopiedId(rec.id); setTimeout(() => setCopiedId(null), 1500); }}>
                      {copiedId === rec.id ? <span style={{ fontSize: 12, color: theme.success }}>✓</span> : <Icon d={IC.copy} size={13} />}
                    </RowAction>
                  )}
                  <RowAction theme={theme} title="Reprocess"><Icon d={IC.refresh} size={13} /></RowAction>
                  <RowAction theme={theme} title="Delete" danger onClick={() => del(rec.id)}><Icon d={IC.trash} size={13} /></RowAction>
                </div>
                <span style={{ display: 'flex', flexShrink: 0, color: theme.textMuted }}><Icon d={IC.chevRight} size={15} /></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RowAction({ children, theme, title, onClick, danger }) {
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.15)' : theme.bgTertiary; e.currentTarget.style.color = danger ? theme.danger : theme.accent; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textMuted; }}
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, color: theme.textMuted, transition: 'background .15s, color .15s' }}>
      {children}
    </button>
  );
}

Object.assign(window, { RecordingsTab });
