import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import type { Theme } from '../../theme'
import { ToggleRow } from './SettingsForm'
import { getHid, reportBytes, usageForReport, type HidDeviceLike, type HidInputReportEventLike } from '../../audio/webHid'

type AppSettings = Awaited<ReturnType<typeof window.api.settings.load>>
type ButtonTriggerDto = NonNullable<AppSettings['buttonTrigger']>
type LearnResultDto = Parameters<Parameters<typeof window.api.button.onLearnResult>[0]>[0]
type HidDeviceChoice = Parameters<Parameters<typeof window.api.button.onHidSelectRequest>[0]>[0][number]

const LEARN_SECONDS = 10
const JABRA_VENDOR_ID = 0x0b0e

interface PanelStyles {
  card: CSSProperties
  cardTitle: CSSProperties
  hint: CSSProperties
  select: CSSProperties
}

function describe(t: ButtonTriggerDto | null): string {
  if (!t) return 'Nie przypisano'
  if (t.kind === 'accelerator') return `Klawisz: ${t.accelerator}`
  if (t.kind === 'appcommand') return `APPCOMMAND ${t.id} (działa tylko przy aktywnym oknie Whisperio)`
  const h = (n: number): string => '0x' + n.toString(16).padStart(4, '0')
  return `HID ${h(t.vendorId)}:${h(t.productId)}, raport ${t.reportId}, bajty [${t.pattern.map((b) => b.toString(16).padStart(2, '0')).join(' ')}]`
}

export function HeadsetButtonPanel({ s, theme }: { s: PanelStyles; theme: Theme }): ReactElement {
  const [cfg, setCfg] = useState<Pick<AppSettings, 'buttonTrigger' | 'buttonTriggerSwallow' | 'buttonAction' | 'buttonAutoPin' | 'soundCues'> | null>(null)
  const [learning, setLearning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [choices, setChoices] = useState<HidDeviceChoice[] | null>(null)
  const [log, setLog] = useState<string[] | null>(null)
  const learningRef = useRef(false)
  const deviceListeners = useRef(new Map<HidDeviceLike, (e: HidInputReportEventLike) => void>())

  const reload = (): void => {
    void window.api.settings.load().then((st) =>
      setCfg({
        buttonTrigger: st.buttonTrigger ?? null,
        buttonTriggerSwallow: st.buttonTriggerSwallow === true,
        buttonAction: st.buttonAction ?? 'dictate-and-send',
        buttonAutoPin: st.buttonAutoPin !== false,
        soundCues: st.soundCues !== false
      })
    )
  }
  useEffect(reload, [])

  useEffect(() => {
    const offResult = window.api.button.onLearnResult((r: LearnResultDto) => {
      learningRef.current = false
      setLearning(false)
      setMessage(r.ok ? `Zapisano: ${r.description}` : r.message)
      reload()
    })
    const offPick = window.api.button.onHidSelectRequest((d) => setChoices(d))
    const listeners = deviceListeners.current
    return () => {
      offResult()
      offPick()
      for (const [d, l] of listeners) d.removeEventListener('inputreport', l)
      listeners.clear()
    }
  }, [])

  // Keyboard / media keys seen by this (focused) window while learning.
  useEffect(() => {
    if (!learning) return undefined
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      window.api.button.sendLearnEvent({ source: 'keyboard', key: e.key, code: e.code, keyCode: e.keyCode })
    }
    window.addEventListener('keydown', onKey, true)
    const timer = setInterval(() => setSecondsLeft((n) => Math.max(0, n - 1)), 1000)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      clearInterval(timer)
    }
  }, [learning])

  const save = (patch: Partial<AppSettings>): void => {
    void window.api.settings.save(patch).then(reload)
  }

  const startLearn = async (): Promise<void> => {
    setMessage(null)
    const started = await window.api.button.learnStart()
    if (!started) return
    learningRef.current = true
    setSecondsLeft(LEARN_SECONDS)
    setLearning(true)
  }

  const pickHid = async (all: boolean): Promise<void> => {
    const hid = getHid()
    if (!hid) {
      setMessage('WebHID jest niedostępne w tym oknie.')
      return
    }
    try {
      const devices = await hid.requestDevice({ filters: all ? [] : [{ vendorId: JABRA_VENDOR_ID }] })
      for (const d of devices) {
        if (!d.opened) await d.open()
        if (deviceListeners.current.has(d)) continue
        const listener = (e: HidInputReportEventLike): void => {
          if (!learningRef.current) return
          const u = usageForReport(d, e.reportId)
          window.api.button.sendLearnEvent({
            source: 'hid',
            vendorId: d.vendorId,
            productId: d.productId,
            reportId: e.reportId,
            usagePage: u.usagePage,
            usage: u.usage,
            data: reportBytes(e)
          })
        }
        d.addEventListener('inputreport', listener)
        deviceListeners.current.set(d, listener)
      }
      setMessage(devices.length ? `Wybrano urządzenia HID: ${devices.map((d) => d.productName || d.productId).join(', ')}. Kliknij „Naucz przycisk” i naciśnij przycisk na słuchawkach.` : 'Nie wybrano urządzenia.')
    } catch (err) {
      setMessage(`Wybór urządzenia HID nie powiódł się: ${(err as Error)?.message ?? err}`)
    }
  }

  const btn: CSSProperties = {
    padding: '7px 14px',
    borderRadius: '8px',
    border: `1px solid ${theme.border}`,
    background: 'transparent',
    color: theme.text,
    cursor: 'pointer',
    fontSize: '12px'
  }

  if (!cfg) return <div style={s.card} />

  return (
    <div style={{ ...s.card, marginTop: '16px' }}>
      <h3 style={s.cardTitle}>Przycisk słuchawek</h3>
      <span style={s.hint}>
        Pierwsze naciśnięcie: nagrywanie. Drugie: zatrzymanie, transkrypcja, wklejenie do przypiętego okna i Enter.
      </span>
      <div style={{ margin: '10px 0', fontSize: '13px', color: theme.text }}>{describe(cfg.buttonTrigger)}</div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <button style={btn} disabled={learning} onClick={() => void startLearn()}>
          {learning ? `Czekam na przycisk… ${secondsLeft} s` : 'Naucz przycisk'}
        </button>
        {learning && (
          <button style={btn} onClick={() => window.api.button.learnCancel()}>
            Anuluj
          </button>
        )}
        <button style={btn} onClick={() => void pickHid(false)}>
          Wybierz urządzenie HID Jabra
        </button>
        <button style={btn} onClick={() => void pickHid(true)}>
          Wszystkie urządzenia HID
        </button>
        <button style={btn} onClick={() => void window.api.button.clear().then(reload)}>
          Wyczyść
        </button>
      </div>
      {message && <div role="status" style={{ ...s.hint, color: theme.text }}>{message}</div>}
      <span style={s.hint}>
        Przyciski systemowe (np. APPCOMMAND) docierają do Whisperio tylko gdy jego okno jest aktywne — to ograniczenie Windows.
      </span>

      {choices && (
        <div style={{ margin: '10px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={s.hint}>Wybierz urządzenie HID:</span>
          {choices.map((c) => (
            <button
              key={c.deviceId}
              style={btn}
              onClick={() => {
                window.api.button.hidSelectReply(c.deviceId)
                setChoices(null)
              }}
            >
              {c.name || 'Urządzenie'} ({c.vendorId.toString(16)}:{c.productId.toString(16)})
            </button>
          ))}
          <button
            style={btn}
            onClick={() => {
              window.api.button.hidSelectReply(null)
              setChoices(null)
            }}
          >
            Anuluj
          </button>
        </div>
      )}

      <ToggleRow
        label="Przechwytuj klawisz (blokuj dla innych aplikacji)"
        description="Wymagane dla klawiszy z klawiatury / multimedialnych (np. Play/Pauza) — Whisperio nie ma niskopoziomowego podsłuchu klawiszy, więc bez przechwytywania taki klawisz nie zadziała. Raporty HID są zawsze tylko obserwowane."
        checked={cfg.buttonTriggerSwallow}
        onChange={(v) => save({ buttonTriggerSwallow: v })}
        theme={theme}
      />
      <ToggleRow
        label="Automatycznie przypinaj aktywne okno przy pierwszym naciśnięciu"
        description="Wyłączone: wklejam do okna przypiętego z menu w zasobniku („Przypnij bieżące okno”)."
        checked={cfg.buttonAutoPin}
        onChange={(v) => save({ buttonAutoPin: v })}
        theme={theme}
      />
      <ToggleRow
        label="Dźwięki potwierdzeń"
        description="Krótkie tony: start, wysłano, błąd."
        checked={cfg.soundCues}
        onChange={(v) => save({ soundCues: v })}
        theme={theme}
      />
      <div style={{ margin: '8px 0' }}>
        <label style={s.hint}>Akcja przycisku </label>
        <select
          style={s.select}
          value={cfg.buttonAction}
          onChange={(e) => save({ buttonAction: e.target.value === 'continuous-toggle' ? 'continuous-toggle' : 'dictate-and-send' })}
        >
          <option value="dictate-and-send">Dyktuj i wyślij (start / stop + Enter)</option>
          <option value="continuous-toggle">Tryb ciągły (włącz / wyłącz)</option>
        </select>
      </div>
      <button
        style={btn}
        onClick={() => void window.api.button.getLog().then((l) => setLog(l.filter((x) => x.includes('[button-learn]') || x.includes('[headset-button]'))))}
      >
        Pokaż log
      </button>
      {log && (
        <pre style={{ ...s.hint, maxHeight: '180px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>{log.join('\n') || '(pusto)'}</pre>
      )}
    </div>
  )
}
