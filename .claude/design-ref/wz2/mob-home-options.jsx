/* Whisperio — 6 home screen options for iPhone (canvas exploration).
   Reuses PhoneHome (option 1) + PhoneScratchpad (option 2); options 3–6 defined here. */

/* frame copy (same as mob-single SIPhoneFrame) */
function HOPhone({ t, children }) {
  return (
    <div style={{ width: 416, height: 870, background: '#050506', borderRadius: 56, padding: 13, boxShadow: '0 60px 120px -40px rgba(0,0,0,.7), 0 0 0 2px rgba(255,255,255,.05)' }}>
      <div style={{ position: 'relative', width: 390, height: 844, borderRadius: 44, overflow: 'hidden', background: t.bg }}>
        <div style={{ position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)', width: 118, height: 34, background: '#000', borderRadius: 20, zIndex: 20 }} />
        {children}
      </div>
    </div>
  );
}

/* ── 3 · Mic-first ── */
function HomeMicFirst({ t }) {
  const recent = M_RECS.slice(0, 3);
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Whisperio" t={t} right={<div style={{ display: 'flex', gap: 9 }}><SquareIconButton icon="book" t={t} /><SquareIconButton icon="cog" t={t} /></div>} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, padding: '0 32px' }}>
        <MiniWave t={t} color={hexA(t.accent, 0.6)} n={34} height={26} />
        <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 148, height: 148, borderRadius: '50%', border: 'none', background: t.gradient, color: '#fff', cursor: 'pointer', boxShadow: `0 0 0 14px ${hexA(t.accent, 0.08)}, 0 0 0 28px ${hexA(t.accent, 0.04)}, 0 24px 50px -12px ${hexA(t.accent, 0.55)}` }}>
          <MIcon k="micFill" size={56} />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FD, fontSize: 19, fontWeight: 600, color: t.text }}>Tap to dictate</div>
          <div style={{ fontFamily: FM, fontSize: 11.5, color: t.faint, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}><MIcon k="lock" size={12} style={{ color: t.green }} /> on-device · free · offline</div>
        </div>
      </div>
      <div style={{ padding: '0 16px 30px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        <SectionLabel text="Recent" t={t} />
        <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, overflow: 'hidden' }}>
          {recent.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderBottom: i === recent.length - 1 ? 'none' : `1px solid ${t.lineSoft}` }}>
              <MIcon k={srcIconOf(r.src)} size={15} style={{ color: t.accentLite, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontFamily: FUI, fontSize: 13.5, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
              <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint, flexShrink: 0 }}>{r.when}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── 4 · Timeline ── */
function HomeTimeline({ t }) {
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Today" t={t} right={<div style={{ display: 'flex', gap: 9 }}><SquareIconButton icon="search" t={t} /><SquareIconButton icon="cog" t={t} /></div>} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 16px 130px' }}>
        <button style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, background: t.surface, border: `1px solid ${t.line}`, marginBottom: 18 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, background: t.gradient, color: '#fff', flexShrink: 0 }}><MIcon k="spark" size={19} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: t.faint }}>Daily digest</div>
            <div style={{ fontFamily: FUI, fontSize: 13.5, color: t.text, lineHeight: 1.4, marginTop: 2 }}>4 notes so far — mostly Work & Code</div>
          </div>
          <MIcon k="chevR" size={17} style={{ color: t.faint, flexShrink: 0 }} />
        </button>
        <div style={{ position: 'relative', paddingLeft: 26 }}>
          <span style={{ position: 'absolute', left: 8, top: 6, bottom: 6, width: 2, borderRadius: 2, background: t.lineSoft }} />
          {M_RECS.filter((r) => r.today).map((r) => {
            const cat = catOf(r.category);
            return (
              <div key={r.id} style={{ position: 'relative', paddingBottom: 18 }}>
                <span style={{ position: 'absolute', left: -24, top: 5, width: 12, height: 12, borderRadius: '50%', background: t.bg, border: `3px solid ${cat.hue}` }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 600, color: t.accentLite }}>{r.when}</span>
                  <CategoryTag cat={cat} t={t} />
                  <span style={{ flex: 1 }} />
                  <MIcon k="lock" size={11} style={{ color: t.green }} />
                </div>
                <div style={{ padding: '12px 14px', borderRadius: 14, background: t.surface, border: `1px solid ${t.line}`, fontFamily: FUI, fontSize: 14, color: t.text, lineHeight: 1.45 }}>{r.title}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '24px 16px 26px', background: `linear-gradient(to top, ${t.bg} 45%, transparent)`, pointerEvents: 'none' }}>
        <button style={{ pointerEvents: 'auto', width: '100%', height: 56, borderRadius: 16, border: 'none', background: t.gradient, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: FD, fontSize: 16, fontWeight: 600, boxShadow: `0 12px 26px -8px ${hexA(t.accent, 0.6)}` }}><MIcon k="micFill" size={20} /> Dictate</button>
      </div>
    </div>
  );
}

/* ── 5 · Hybrid: today-note + library ── */
function HomeHybrid({ t }) {
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <WHeader title="Whisperio" t={t} right={<div style={{ display: 'flex', gap: 9 }}><SquareIconButton icon="book" t={t} /><SquareIconButton icon="cog" t={t} /></div>} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 16px 130px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ background: t.surface, border: `1px solid ${t.hair}`, borderRadius: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SectionLabel text="Today’s note" t={t} /><span style={{ flex: 1 }} />
            <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint }}>3 takes · 9:12 AM – 2:03 PM</span>
          </div>
          <div style={{ fontFamily: FUI, fontSize: 14.5, color: t.text, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>Standup: shipped the export pipeline, still blocked on the staging cert… Idea — the keyboard could show the last three notes as QuickType chips… Groceries on the way home: oat milk, coffee beans, basil…</div>
          <div style={{ display: 'flex', gap: 9 }}>
            <GradButton title="Continue note" icon="micFill" t={t} style={{ flex: 1, padding: '11px 14px', fontSize: 14 }} />
            <GhostBtn title="Open" t={t} style={{ padding: '11px 16px' }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <SectionLabel text="Library" t={t} />
          <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 18, overflow: 'hidden' }}>
            {M_RECS.slice(0, 4).map((r, i) => <RecRow key={r.id} r={r} t={t} last={i === 3} onTap={() => {}} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 6 · Focus / zero-UI ── */
function HomeFocus({ t }) {
  const last = M_RECS[0];
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: `radial-gradient(120% 70% at 50% 30%, ${hexA(t.accent, 0.10)} 0%, transparent 60%)` }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px' }}>
        <WGhost size={26} /><span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 9 }}><SquareIconButton icon="clock" t={t} /><SquareIconButton icon="cog" t={t} /></div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30, padding: '0 34px', textAlign: 'center' }}>
        <div style={{ fontFamily: FD, fontSize: 30, fontWeight: 650, color: t.text, lineHeight: 1.25, letterSpacing: '-.015em' }}>What’s on your mind?</div>
        <Waveform t={t} color={hexA(t.accent, 0.5)} bars={26} height={40} active={false} />
        <div style={{ fontFamily: FM, fontSize: 11.5, color: t.faint, display: 'flex', alignItems: 'center', gap: 6 }}><MIcon k="lock" size={12} style={{ color: t.green }} /> Nothing leaves this iPhone</div>
      </div>
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 16, background: t.surface, border: `1px solid ${t.line}` }}>
          <MIcon k={srcIconOf(last.src)} size={15} style={{ color: t.accentLite, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontFamily: FUI, fontSize: 13, color: t.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last.title}</span>
          <span style={{ fontFamily: FM, fontSize: 10.5, color: t.faint, flexShrink: 0 }}>{last.when}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 34 }}>
        <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 76, height: 76, borderRadius: '50%', border: 'none', background: t.gradient, color: '#fff', cursor: 'pointer', boxShadow: `0 0 0 8px ${hexA(t.accent, 0.08)}, 0 14px 30px -8px ${hexA(t.accent, 0.6)}` }}><MIcon k="micFill" size={30} /></button>
      </div>
    </div>
  );
}

/* ── Canvas layout ── */
function HomeOptionsBoard() {
  const t = buildMobTheme('redesign', 'dark', 'teal');
  const opts = [
    ['1 · Library (obecny)', 'Lista transkryptów + filtry kategorii + digest. Nagrania są osobnymi notatkami.', <PhoneHome t={t} onOpenRec={() => {}} onRecord={() => {}} onSettings={() => {}} onJournal={() => {}} />],
    ['2 · Scratchpad', 'Jedna ciągła notatka dnia — każde dyktowanie dopisuje wpis z timestampem.', <PhoneScratchpad t={t} />],
    ['3 · Mic-first', 'Wielki mikrofon w centrum, minimalna lista Recent. Aplikacja = przycisk.', <HomeMicFirst t={t} />],
    ['4 · Timeline', 'Dzień jako oś czasu z kropkami kategorii; digest na górze.', <HomeTimeline t={t} />],
    ['5 · Hybryda', 'Karta „Today’s note” (continue) nad klasyczną biblioteką — scratchpad + archiwum razem.', <HomeHybrid t={t} />],
    ['6 · Focus', 'Zero-UI: pytanie, wyciszony waveform, jeden mic i podgląd ostatniej notatki.', <HomeFocus t={t} />],
  ];
  return (
    <div>
      {opts.map(([label, desc, node], i) => (
        <section key={label} data-screen-label={label} style={{ position: 'absolute', left: 60 + (i % 3) * 520, top: 60 + Math.floor(i / 3) * 1040, width: 416 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: FD, fontSize: 17, fontWeight: 650, color: '#eafffb' }}>{label}</div>
            <div style={{ fontFamily: FUI, fontSize: 12.5, color: '#8fb5ac', marginTop: 4, lineHeight: 1.5, textWrap: 'pretty' }}>{desc}</div>
          </div>
          <HOPhone t={t}><ScreenScaffold t={t}>{node}</ScreenScaffold></HOPhone>
        </section>
      ))}
    </div>
  );
}

Object.assign(window, { HomeOptionsBoard });
