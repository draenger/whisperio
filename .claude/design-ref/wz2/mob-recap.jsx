/* Whisperio Apple — Weekly recap: shareable summary of the week (words, time saved,
   streak, per-day chart, categories, note of the week). */

const RECAP_DAYS = [['M', 520], ['T', 880], ['W', 610], ['T', 1040], ['F', 790], ['S', 430], ['S', 550]];
const RECAP_CATS = [['work', 12], ['code', 8], ['ideas', 6], ['messages', 4], ['todo', 2]];

function RecapScene({ t, onBack, bare }) {
  const [toast, setToast] = React.useState('');
  const share = () => { setToast('Recap card saved to Photos'); setTimeout(() => setToast(''), 2000); };
  const max = Math.max(...RECAP_DAYS.map((d) => d[1]));
  const statCard = (big, sub, icon) => (
    <div key={icon} style={{ flex: 1, padding: 15, borderRadius: 18, background: t.surface, border: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <MIcon k={icon} size={16} style={{ color: t.accentLite }} />
      <div style={{ fontFamily: FD, fontSize: 22, fontWeight: 700, color: t.text, marginTop: 6 }}>{big}</div>
      <div style={{ fontFamily: FUI, fontSize: 12, color: t.muted }}>{sub}</div>
    </div>
  );
  const body = (
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <WHeader title="Recap" t={t} onBack={onBack} right={<SquareIconButton icon="share" t={t} onClick={share} />} />
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 16px 30px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: '22px 20px', borderRadius: 22, background: t.gradient, color: '#fff' }}>
            <div style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 600, letterSpacing: '.14em', opacity: 0.85 }}>WEEK 25 · JUN 16–22</div>
            <div style={{ fontFamily: FD, fontSize: 46, fontWeight: 700, lineHeight: 1.05, marginTop: 10, letterSpacing: '-.02em' }}>4,820</div>
            <div style={{ fontFamily: FUI, fontSize: 14, opacity: 0.92, marginTop: 3 }}>words spoken · 32 notes</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '10px 13px', borderRadius: 13, background: 'rgba(255,255,255,0.16)' }}>
              <MIcon k="bolt" size={15} />
              <span style={{ fontFamily: FUI, fontSize: 13, fontWeight: 600 }}>~42 minutes saved vs typing</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {statCard('96 wpm', 'speaking · you type ~38', 'zap')}
            {statCard('5 days', 'streak · best is 11', 'spark')}
          </div>
          <div style={{ padding: 16, borderRadius: 18, background: t.surface, border: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <SectionLabel text="Words per day" t={t} /><span style={{ flex: 1 }} />
              <span style={{ fontFamily: FM, fontSize: 11, color: t.faint }}>peak Thu · 1,040</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 92 }}>
              {RECAP_DAYS.map(([d, v], i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                  <span style={{ width: '100%', height: `${Math.round((v / max) * 72)}px`, borderRadius: 6, background: v === max ? t.accent : hexA(t.accent, 0.3) }} />
                  <span style={{ fontFamily: FM, fontSize: 10, color: v === max ? t.accentLite : t.faint }}>{d}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: 16, borderRadius: 18, background: t.surface, border: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SectionLabel text="Where your words went" t={t} />
            {RECAP_CATS.map(([id, n]) => {
              const c = catOf(id);
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 96, flexShrink: 0 }}><CategoryTag cat={c} t={t} /></span>
                  <div style={{ flex: 1, height: 7, borderRadius: 4, background: t.surfaceUp, overflow: 'hidden' }}>
                    <span style={{ display: 'block', width: `${(n / RECAP_CATS[0][1]) * 100}%`, height: '100%', borderRadius: 4, background: hexA(c.hue, 0.75) }} />
                  </div>
                  <span style={{ width: 22, textAlign: 'right', fontFamily: FM, fontSize: 11, color: t.muted }}>{n}</span>
                </div>
              );
            })}
          </div>
          <div style={{ padding: 16, borderRadius: 18, background: t.surface, border: `1px solid ${t.line}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SectionLabel text="Note of the week" t={t} /><span style={{ flex: 1 }} /><CategoryTag cat={catOf('ideas')} t={t} />
            </div>
            <div style={{ fontFamily: FD, fontSize: 16.5, fontWeight: 500, color: t.text, lineHeight: 1.45 }}>“A weekly digest that summarizes every voice note into three bullet points.”</div>
            <div style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>Captured from Watch · Tuesday</div>
          </div>
          <GradButton title="Share recap" icon="share" t={t} onClick={share} style={{ width: '100%' }} />
        </div>
        {toast && (
          <div style={{ position: 'absolute', left: '50%', bottom: 26, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 999, background: t.mode === 'dark' ? '#221d33' : '#1b1830', color: '#fff', fontFamily: FUI, fontSize: 13.5, fontWeight: 500, boxShadow: '0 12px 30px rgba(0,0,0,.4)', whiteSpace: 'nowrap', animation: 'msheet .28s ease-out' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.green }} /> {toast}
          </div>
        )}
      </div>
  );
  return bare ? body : <ScreenScaffold t={t}>{body}</ScreenScaffold>;
}

Object.assign(window, { RecapScene });
