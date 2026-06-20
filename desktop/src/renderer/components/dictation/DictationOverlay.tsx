import { useEffect, useState } from 'react'
import { useDictation } from '../../hooks/useDictation'

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

export function DictationOverlay(): JSX.Element {
  const [overlayState, setOverlayState] = useState<OverlayState>('idle')
  const [overlayInfo, setOverlayInfo] = useState<OverlayInfo | null>(null)
  const [hovered, setHovered] = useState(false)
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
    const unsubDeactivate = window.api.dictation.onDeactivate(() => {
      stopAndTranscribe().catch((err) => {
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
  const isOutputRecording = overlayInfo?.recordingType === 'output'

  // Color scheme based on recording type
  const accentColor = isOutputRecording ? '#3b82f6' : '#8b5cf6'
  const dotColor = isOutputRecording ? '#3b82f6' : '#ef4444'
  const dotGlow = isOutputRecording ? 'rgba(59, 130, 246, 0.6)' : 'rgba(239, 68, 68, 0.6)'
  const borderColor = isOutputRecording
    ? 'rgba(59, 130, 246, 0.3)'
    : 'rgba(139, 92, 246, 0.3)'
  const shadowColor = isOutputRecording
    ? 'rgba(59, 130, 246, 0.1)'
    : 'rgba(139, 92, 246, 0.1)'

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
            <div
              style={{
                ...styles.dot,
                background: dotColor,
                boxShadow: `0 0 8px ${dotGlow}`
              }}
            />
            <span style={styles.text}>{sourceName}</span>
            <WaveformBars accentColor={accentColor} />
          </>
        )}
        {isTranscribing && (
          <>
            <div
              style={{
                ...styles.spinner,
                border: `2px solid ${borderColor}`,
                borderTopColor: accentColor
              }}
            />
            <span style={styles.text}>Transcribing...</span>
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
    fontFamily: "'Inter', sans-serif",
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
    background: 'rgba(10, 10, 15, 0.92)',
    backdropFilter: 'blur(20px)',
    cursor: 'default'
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    animation: 'pulse-dot 1.5s ease-in-out infinite'
  },
  text: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: '13px',
    fontFamily: "'Inter', sans-serif",
    fontWeight: 500,
    letterSpacing: '0.02em'
  },
  spinner: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
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
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`
document.head.appendChild(styleEl)
