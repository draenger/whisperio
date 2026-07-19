import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useDictation } from '../../hooks/useDictation'
import { Ghost } from '../common/Ghost'

/**
 * State as broadcast by the main process (hotkeyManager.ts's DictationState).
 * 'command' is not emitted by hotkeyManager today — it is reserved for a
 * future COMMAND-mode main-process state machine (see wz-overlay.jsx's 'cmd'
 * phase). Rendered defensively below so the overlay still compiles/works
 * unchanged if that state never arrives.
 */
type MainState = 'idle' | 'recording' | 'transcribing' | 'pasting' | 'command'

/** Local render phase — adds 'armed' (mic granted, recorder not yet live) and
 * 'done' (transient post-paste confirmation) on top of the main-process state,
 * matching docs/design/wz-overlay.jsx's phase set (armed/rec/cmd/proc/done). */
type Phase = 'armed' | 'recording' | 'command' | 'transcribing' | 'pasting' | 'done'

interface OverlayInfo {
  sourceName: string
  stopHotkey: string
  recordingType: 'input' | 'output'
}

const OVL_ICONS = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  check: 'M20 6L9 17l-5-5'
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

/** "0:07" mono timer text — mirrors docs/design/wz-overlay.jsx's timer, purely
 * a renderer-local display value (no IPC): counts seconds while `active`. */
function formatTimer(totalSeconds: number): string {
  return `0:${String(totalSeconds % 60).padStart(2, '0')}`
}

function Icon({ d, size = 12, style }: { d: string; size?: number; style?: React.CSSProperties }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={d} />
    </svg>
  )
}

/** Green "on-device" pill — shown in armed/recording/transcribing whenever the
 * resolved primary STT provider (settings.providerChain[0], falling back to
 * settings.sttProvider, same resolution transcribe.ts uses) is the local/
 * selfhosted engine. Real data, no fabrication. */
function OnDeviceBadge(): JSX.Element {
  return (
    <span style={styles.onDeviceBadge}>
      <Icon d={OVL_ICONS.lock} size={10} />
      on-device
    </span>
  )
}

export function DictationOverlay(): JSX.Element {
  const [mainState, setMainState] = useState<MainState>('idle')
  const [overlayInfo, setOverlayInfo] = useState<OverlayInfo | null>(null)
  const [hovered, setHovered] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [isLocalProvider, setIsLocalProvider] = useState(false)
  const [doneWordCount, setDoneWordCount] = useState<number | null>(null)
  const prevMainStateRef = useRef<MainState>('idle')
  const { startRecording, startOutputRecording, stopAndTranscribe, cancelRecording, isRecording, lastWordCount } =
    useDictation()

  // Listen for state changes from main process
  useEffect(() => {
    const unsub = window.api.dictation.onStateChanged((state: string) => {
      setMainState(state as MainState)
      if (state === 'idle') {
        setOverlayInfo(null)
        setHovered(false)
      }
    })
    return unsub
  }, [])

  // Transient 'done' confirmation: right after the main process finishes a
  // pasting phase and drops back to idle, hold a green check + real word
  // count on screen for ~1.2s instead of disappearing instantly.
  useEffect(() => {
    const prev = prevMainStateRef.current
    prevMainStateRef.current = mainState
    if (prev === 'pasting' && mainState === 'idle' && lastWordCount !== null) {
      setDoneWordCount(lastWordCount)
      const t = setTimeout(() => setDoneWordCount(null), 1200)
      return () => clearTimeout(t)
    }
    return undefined
  }, [mainState, lastWordCount])

  // Local mono timer while listening — display-only, ticks from 0 each time
  // recording (or command listening) starts. No IPC involved: the real
  // recording duration used for transcription bookkeeping is computed
  // separately in useDictation.ts.
  useEffect(() => {
    if (mainState !== 'recording' && mainState !== 'command') {
      setElapsedSec(0)
      return undefined
    }
    const iv = setInterval(() => setElapsedSec((s) => s + 1), 1000)
    return () => clearInterval(iv)
  }, [mainState])

  // Listen for overlay info from main process
  useEffect(() => {
    const unsub = window.api.dictation.onOverlayInfo((info: OverlayInfo) => {
      setOverlayInfo(info)
    })
    return unsub
  }, [])

  // Resolve whether the primary provider in the chain is the local/selfhosted
  // engine — same precedence transcribe.ts uses (providerChain[0], else
  // sttProvider). Refreshed at the start of every session.
  useEffect(() => {
    const resolveLocalProvider = async (): Promise<void> => {
      try {
        const settings = await window.api.settings.load()
        const chain =
          settings.providerChain && settings.providerChain.length > 0
            ? settings.providerChain
            : [settings.sttProvider || 'openai']
        setIsLocalProvider(chain[0] === 'selfhosted')
      } catch (err) {
        console.error('[Whisperio] Failed to resolve primary provider for overlay badge:', err)
      }
    }

    const unsubActivate = window.api.dictation.onActivate(() => {
      resolveLocalProvider()
      startRecording()
    })
    const unsubActivateOutput = window.api.dictation.onActivateOutput(() => {
      resolveLocalProvider()
      startOutputRecording()
    })
    const unsubDeactivate = window.api.dictation.onDeactivate((sessionId) => {
      stopAndTranscribe(sessionId).catch((err) => {
        console.error('[Whisperio] onDeactivate error:', err)
      })
    })
    const unsubCancel = window.api.dictation.onCancel(() => {
      cancelRecording()
    })
    return () => {
      unsubActivate()
      unsubActivateOutput()
      unsubDeactivate()
      unsubCancel()
    }
  }, [startRecording, startOutputRecording, stopAndTranscribe, cancelRecording])

  if (mainState === 'idle' && doneWordCount === null) {
    return <div />
  }

  // 'armed' = hotkey session started (overlay shown, main state 'recording')
  // but the mic isn't live yet — a real, brief window (getUserMedia/recorder
  // startup), not a fabricated delay.
  const phase: Phase =
    doneWordCount !== null
      ? 'done'
      : mainState === 'command'
        ? 'command'
        : mainState === 'recording'
          ? isRecording
            ? 'recording'
            : 'armed'
          : mainState === 'transcribing'
            ? 'transcribing'
            : 'pasting'

  const isCommand = phase === 'command'
  const isOutputRecording = overlayInfo?.recordingType === 'output'

  // Color scheme based on recording type (Rezme teal for input dictation);
  // command mode gets its own sky accent, distinct from input/output colors.
  const cmdAccent = '#7cc0fb'
  const cmdBorder = 'rgba(124, 192, 251, 0.42)'
  const accentColor = isCommand ? cmdAccent : isOutputRecording ? '#3b82f6' : '#1cc8b4'
  const dotColor = isOutputRecording ? '#3b82f6' : '#ef4444'
  const dotGlow = isOutputRecording ? 'rgba(59, 130, 246, 0.6)' : 'rgba(239, 68, 68, 0.6)'
  const borderColor = isCommand
    ? cmdBorder
    : isOutputRecording
      ? 'rgba(59, 130, 246, 0.3)'
      : 'rgba(28, 200, 180, 0.3)'
  const shadowColor = isCommand
    ? 'rgba(124, 192, 251, 0.1)'
    : isOutputRecording
      ? 'rgba(59, 130, 246, 0.1)'
      : 'rgba(28, 200, 180, 0.1)'

  const sourceName = overlayInfo ? truncate(overlayInfo.sourceName, 20) : 'System Default'
  const stopHotkey = overlayInfo?.stopHotkey || 'hotkey'

  const showHint = phase === 'recording' || phase === 'command'
  const hintText = isCommand ? (
    <>Speak a transform — it rewrites, doesn&rsquo;t insert &middot; Esc to cancel</>
  ) : (
    <>Press {stopHotkey} to stop &middot; Escape to cancel</>
  )

  return (
    <div style={styles.container}>
      {/* Tooltip shown on hover — positioned above the pill */}
      {hovered && showHint && (
        <div style={styles.tooltip}>
          <span style={styles.tooltipText}>{hintText}</span>
        </div>
      )}
      <div
        style={{
          ...styles.pill,
          padding: phase === 'armed' ? '8px 14px' : '12px 20px',
          border: `1px solid ${borderColor}`,
          boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px ${shadowColor}`,
          opacity: phase === 'armed' ? 0.85 : 1
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {phase === 'armed' && (
          <>
            <Icon d={OVL_ICONS.mic} size={14} style={{ color: 'rgba(255, 255, 255, 0.55)' }} />
            <span style={styles.armedHotkey}>{stopHotkey}</span>
            {isLocalProvider && <OnDeviceBadge />}
          </>
        )}
        {phase === 'recording' && (
          <>
            <Ghost mode="listening" size={28} bodyColor={accentColor} />
            <div
              style={{
                ...styles.dot,
                background: dotColor,
                boxShadow: `0 0 8px ${dotGlow}`
              }}
            />
            <span style={styles.text}>{sourceName}</span>
            <WaveformBars accentColor={accentColor} />
            <span style={styles.timer}>{formatTimer(elapsedSec)}</span>
            {isLocalProvider && <OnDeviceBadge />}
          </>
        )}
        {phase === 'command' && (
          <>
            <div
              style={{
                ...styles.dot,
                background: dotColor,
                boxShadow: `0 0 8px ${dotGlow}`
              }}
            />
            <span style={styles.commandBadge}>
              <Icon d={OVL_ICONS.bolt} size={10} />
              COMMAND
            </span>
            <span style={styles.text}>Listening for a command</span>
            <WaveformBars accentColor={accentColor} />
            <span style={styles.timer}>{formatTimer(elapsedSec)}</span>
          </>
        )}
        {phase === 'transcribing' && (
          <>
            <Ghost mode="thinking" size={28} bodyColor={accentColor} />
            <span style={styles.text}>Transcribing...</span>
            <span style={styles.progressTrack}>
              <span style={styles.progressSweep} />
            </span>
            {isLocalProvider && <OnDeviceBadge />}
          </>
        )}
        {phase === 'pasting' && (
          <>
            <Ghost mode="wave" size={28} bodyColor={accentColor} />
            <span style={styles.text}>Pasting...</span>
          </>
        )}
        {phase === 'done' && (
          <>
            <span style={styles.doneCheck}>
              <Icon d={OVL_ICONS.check} size={10} />
            </span>
            <span style={styles.text}>Pasted</span>
            <span style={styles.doneWordCount}>
              {doneWordCount} word{doneWordCount === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function WaveformBars({ accentColor }: { accentColor: string }): JSX.Element {
  return (
    <div style={styles.waveform}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            ...styles.bar,
            background: accentColor,
            animationDelay: `${i * 0.15}s`
          }}
        />
      ))}
      <style>{`
        @keyframes waveform-bounce {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-end',
    background: 'transparent'
  },
  tooltip: {
    marginBottom: '6px',
    padding: '6px 12px',
    borderRadius: '8px',
    background: 'rgba(10, 10, 15, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)'
  },
  tooltipText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '11px',
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontWeight: 400,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap'
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    borderRadius: '50px',
    // --wsp-pill-bg (docs/design/tokens.css) — cool-dark pill, theme-invariant.
    background: 'rgba(9, 15, 24, 0.94)',
    backdropFilter: 'blur(20px)',
    cursor: 'default',
    transition: 'opacity 0.2s, padding 0.2s'
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    animation: 'wzpulse 1.5s ease-in-out infinite'
  },
  text: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '13px',
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontWeight: 500,
    letterSpacing: '0.02em'
  },
  timer: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '11.5px',
    fontFamily: "'JetBrains Mono', monospace"
  },
  armedHotkey: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: "'IBM Plex Sans', sans-serif"
  },
  onDeviceBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: '#4ade80',
    padding: '3px 8px',
    borderRadius: '999px',
    background: 'rgba(34, 197, 94, 0.10)',
    border: '1px solid rgba(34, 197, 94, 0.26)'
  },
  commandBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: '#7cc0fb',
    padding: '3px 8px',
    borderRadius: '999px',
    background: 'rgba(124, 192, 251, 0.12)',
    border: '1px solid rgba(124, 192, 251, 0.32)'
  },
  doneCheck: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: '#22c55e',
    color: '#04231a'
  },
  doneWordCount: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.5)'
  },
  progressTrack: {
    position: 'relative',
    width: '64px',
    height: '4px',
    borderRadius: '2px',
    background: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden'
  },
  progressSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '26px',
    borderRadius: '2px',
    // --wsp-progress-gradient: teal -> sky, distinct from the recording red dot.
    background: 'linear-gradient(90deg, #1cc8b4, #3da2f7)',
    animation: 'wzprog 1.1s ease-in-out infinite'
  },
  waveform: {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    height: '20px'
  },
  bar: {
    width: '3px',
    height: '100%',
    borderRadius: '2px',
    animation: 'waveform-bounce 0.8s ease-in-out infinite',
    transformOrigin: 'center'
  }
}

// Inject global keyframe animations
const styleEl = document.createElement('style')
styleEl.textContent = `
  @keyframes wzpulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }
  @keyframes wzprog {
    0% { left: -26px; }
    100% { left: 64px; }
  }
`
document.head.appendChild(styleEl)
