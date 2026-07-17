import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useDictation } from '../../hooks/useDictation'
import { Ghost } from '../common/Ghost'

type OverlayState = 'idle' | 'recording' | 'transcribing' | 'pasting'

interface OverlayInfo {
  sourceName: string
  stopHotkey: string
  recordingType: 'input' | 'output'
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

export function DictationOverlay(): JSX.Element {
  const [overlayState, setOverlayState] = useState<OverlayState>('idle')
  const [overlayInfo, setOverlayInfo] = useState<OverlayInfo | null>(null)
  const [hovered, setHovered] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const { startRecording, startOutputRecording, stopAndTranscribe, cancelRecording } = useDictation()

  // Listen for state changes from main process
  useEffect(() => {
    const unsub = window.api.dictation.onStateChanged((state: string) => {
      setOverlayState(state as OverlayState)
      if (state === 'idle') {
        setOverlayInfo(null)
        setHovered(false)
      }
    })
    return unsub
  }, [])

  // Local mono timer while listening — display-only, ticks from 0 each time
  // recording starts. No IPC involved: the real recording duration used for
  // transcription bookkeeping is computed separately in useDictation.ts.
  useEffect(() => {
    if (overlayState !== 'recording') {
      setElapsedSec(0)
      return
    }
    const iv = setInterval(() => setElapsedSec((s) => s + 1), 1000)
    return () => clearInterval(iv)
  }, [overlayState])

  // Listen for overlay info from main process
  useEffect(() => {
    const unsub = window.api.dictation.onOverlayInfo((info: OverlayInfo) => {
      setOverlayInfo(info)
    })
    return unsub
  }, [])

  // Listen for activate/deactivate/cancel from main process
  useEffect(() => {
    const unsubActivate = window.api.dictation.onActivate(() => {
      startRecording()
    })
    const unsubActivateOutput = window.api.dictation.onActivateOutput(() => {
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

  if (overlayState === 'idle') {
    return <div />
  }

  const isListening = overlayState === 'recording'
  const isTranscribing = overlayState === 'transcribing'
  const isPasting = overlayState === 'pasting'
  const isOutputRecording = overlayInfo?.recordingType === 'output'

  // Color scheme based on recording type (Rezme teal for input dictation)
  const accentColor = isOutputRecording ? '#3b82f6' : '#1cc8b4'
  const dotColor = isOutputRecording ? '#3b82f6' : '#ef4444'
  const dotGlow = isOutputRecording ? 'rgba(59, 130, 246, 0.6)' : 'rgba(239, 68, 68, 0.6)'
  const borderColor = isOutputRecording
    ? 'rgba(59, 130, 246, 0.3)'
    : 'rgba(28, 200, 180, 0.3)'
  const shadowColor = isOutputRecording
    ? 'rgba(59, 130, 246, 0.1)'
    : 'rgba(28, 200, 180, 0.1)'

  const sourceName = overlayInfo
    ? truncate(overlayInfo.sourceName, 20)
    : 'System Default'

  const stopHotkey = overlayInfo?.stopHotkey || 'hotkey'

  return (
    <div style={styles.container}>
      {/* Tooltip shown on hover — positioned above the pill */}
      {hovered && isListening && (
        <div style={styles.tooltip}>
          <span style={styles.tooltipText}>
            Press {stopHotkey} to stop &middot; Escape to cancel
          </span>
        </div>
      )}
      <div
        style={{
          ...styles.pill,
          border: `1px solid ${borderColor}`,
          boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px ${shadowColor}`
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isListening && (
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
          </>
        )}
        {isTranscribing && (
          <>
            <Ghost mode="thinking" size={28} bodyColor={accentColor} />
            <span style={styles.text}>Transcribing...</span>
            <span style={styles.progressTrack}>
              <span style={styles.progressSweep} />
            </span>
          </>
        )}
        {isPasting && (
          <>
            <Ghost mode="wave" size={28} bodyColor={accentColor} />
            <span style={styles.text}>Pasting...</span>
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
    padding: '12px 20px',
    borderRadius: '50px',
    // --wsp-pill-bg (docs/design/tokens.css) — cool-dark pill, theme-invariant.
    background: 'rgba(9, 15, 24, 0.94)',
    backdropFilter: 'blur(20px)',
    cursor: 'default'
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
