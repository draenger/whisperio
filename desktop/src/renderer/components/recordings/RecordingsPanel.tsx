import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import { useTheme } from '../../ThemeContext'
import { TitleBar } from '../common/TitleBar'
import type { Theme } from '../../theme'

interface RecordingEntry {
  id: string
  filename: string
  filepath: string
  timestamp: number
  duration: number
  status: 'completed' | 'failed' | 'pending'
  provider: string
  transcription?: string
  error?: string
  size: number
}

export function RecordingsView(): ReactElement {
  const { theme } = useTheme()
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const s = makeStyles(theme)

  const loadRecordings = useCallback(async () => {
    try {
      const list = await window.api.recordings.list()
      setRecordings(list.sort((a, b) => b.timestamp - a.timestamp))
    } catch {
      setRecordings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRecordings()
  }, [loadRecordings])

  const handleDelete = useCallback(async (id: string) => {
    await window.api.recordings.delete(id)
    await loadRecordings()
  }, [loadRecordings])

  const handleDeleteAll = useCallback(async () => {
    if (!deleteAllConfirm) {
      setDeleteAllConfirm(true)
      setTimeout(() => setDeleteAllConfirm(false), 3000)
      return
    }
    await window.api.recordings.deleteAll()
    setDeleteAllConfirm(false)
    await loadRecordings()
  }, [deleteAllConfirm, loadRecordings])

  const handleReprocess = useCallback(async (id: string) => {
    await window.api.recordings.reprocess(id)
    await loadRecordings()
  }, [loadRecordings])

  const handleCopy = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const formatDate = (timestamp: number): string => {
    const d = new Date(timestamp)
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
  }

  const truncateText = (text: string, maxLen: number = 80): string => {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen) + '...'
  }

  const formatSize = (bytes: number): string => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const statusIcon = (status: string): { char: string; color: string } => {
    switch (status) {
      case 'completed':
        return { char: '\u2713', color: theme.success }
      case 'failed':
        return { char: '\u2717', color: theme.danger }
      default:
        return { char: '\u25CC', color: '#eab308' }
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center', background: theme.bg }}>
        <p style={{ color: theme.textMuted, fontSize: '13px', letterSpacing: '0.02em' }}>Loading recordings…</p>
      </div>
    )
  }

  const selectedRec = selectedId ? recordings.find((r) => r.id === selectedId) ?? null : null
  if (selectedRec) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={s.scrollArea}>
        <RecordingDetail
          theme={theme}
          s={s}
          rec={selectedRec}
          onBack={() => setSelectedId(null)}
          onCopy={() => selectedRec.transcription && handleCopy(selectedRec.id, selectedRec.transcription)}
            copied={copiedId === selectedRec.id}
            onReprocess={() => handleReprocess(selectedRec.id)}
            onDelete={async () => {
              await handleDelete(selectedRec.id)
              setSelectedId(null)
            }}
            formatDate={formatDate}
            formatDuration={formatDuration}
            formatSize={formatSize}
            statusIcon={statusIcon}
          />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>{recordings.length} recording{recordings.length !== 1 ? 's' : ''}</span>
          <span style={s.recordingCount}>Latest first. Click any row for detail.</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={loadRecordings}
            style={s.toolbarButton}
            title="Refresh"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.bgTertiary
              e.currentTarget.style.borderColor = theme.borderHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = theme.bgSecondary
              e.currentTarget.style.borderColor = theme.border
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          {recordings.length > 0 && (
            <button
              onClick={handleDeleteAll}
              style={{
                ...s.toolbarButton,
                color: deleteAllConfirm ? '#ffffff' : theme.danger,
                background: deleteAllConfirm ? theme.danger : theme.bgSecondary,
                borderColor: deleteAllConfirm ? theme.danger : theme.border
              }}
              title="Delete all recordings"
              onMouseEnter={(e) => {
                if (!deleteAllConfirm) {
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
                  e.currentTarget.style.borderColor = theme.danger
                }
              }}
              onMouseLeave={(e) => {
                if (!deleteAllConfirm) {
                  e.currentTarget.style.background = theme.bgSecondary
                  e.currentTarget.style.borderColor = theme.border
                }
              }}
            >
              {deleteAllConfirm ? 'Confirm?' : 'Delete All'}
            </button>
          )}
        </div>
      </div>

      {/* Recordings list */}
      <div style={s.scrollArea}>
        <div style={s.container}>
          {recordings.length === 0 ? (
            <div style={s.emptyState}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: theme.bgTertiary,
                border: `1px solid ${theme.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.textMuted,
                marginBottom: '14px'
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 1 0 10 10" />
                  <polyline points="22 2 22 8 16 8" />
                </svg>
              </div>
              <p style={{ color: theme.text, fontSize: '14px', fontWeight: 600 }}>
                No recordings yet
              </p>
              <p style={{ color: theme.textMuted, fontSize: '12px', marginTop: '4px', maxWidth: '260px', lineHeight: 1.5 }}>
                Recordings will appear here after you dictate
              </p>
            </div>
          ) : (
            recordings.map((rec) => {
              const isHovered = hoveredId === rec.id
              const si = statusIcon(rec.status)

              return (
                <div
                  key={rec.id}
                  style={{
                    ...s.recordingRow,
                    cursor: 'pointer',
                    borderColor: isHovered ? theme.accent : theme.border
                  }}
                  onClick={() => setSelectedId(rec.id)}
                  onMouseEnter={() => setHoveredId(rec.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Status icon */}
                  <div style={{ ...s.statusIcon, color: si.color }}>
                    {si.char}
                  </div>

                  {/* Content */}
                  <div style={s.recordingContent}>
                    <div style={s.recordingHeader}>
                      <span style={s.recordingDate}>{formatDate(rec.timestamp)}</span>
                      <span style={s.recordingMeta}>{formatDuration(rec.duration)}</span>
                      <span style={s.recordingMeta}>{rec.provider}</span>
                    </div>
                    <div style={s.recordingText}>
                      {rec.status === 'completed' && rec.transcription
                        ? truncateText(rec.transcription)
                        : rec.status === 'failed' && rec.error
                          ? rec.error
                          : rec.status === 'pending'
                            ? 'Processing...'
                            : 'No transcription'
                      }
                    </div>
                  </div>

                  {/* Action buttons (visible on hover) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      ...s.actionButtons,
                      opacity: isHovered ? 1 : 0,
                      pointerEvents: isHovered ? 'auto' : 'none'
                    }}
                  >
                    {rec.status === 'completed' && rec.transcription && (
                      <button
                        onClick={() => handleCopy(rec.id, rec.transcription!)}
                        style={s.actionButton}
                        title="Copy transcription"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = theme.bgTertiary
                          e.currentTarget.style.color = theme.accent
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = theme.textMuted
                        }}
                      >
                        {copiedId === rec.id ? (
                          <span style={{ fontSize: '12px', color: theme.success }}>{'\u2713'}</span>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleReprocess(rec.id)}
                      style={s.actionButton}
                      title="Reprocess"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = theme.bgTertiary
                        e.currentTarget.style.color = theme.accent
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = theme.textMuted
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(rec.id)}
                      style={s.actionButton}
                      title="Delete"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
                        e.currentTarget.style.color = theme.danger
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = theme.textMuted
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>

                  {/* Chevron — opens detail */}
                  <span style={{ display: 'flex', flexShrink: 0, color: theme.textMuted }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

/* Standalone window wrapper (own title bar + full height). */
export function RecordingsPanel(): ReactElement {
  const { theme } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
      <TitleBar title="Whisperio Recordings" />
      <RecordingsView />
    </div>
  )
}

/* --- Recording detail sub-page --- */

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'ogg') return 'audio/ogg'
  if (ext === 'm4a') return 'audio/mp4'
  return 'audio/webm'
}

function RecordingDetail({
  theme,
  s,
  rec,
  onBack,
  onCopy,
  copied,
  onReprocess,
  onDelete,
  formatDate,
  formatDuration,
  formatSize,
  statusIcon
}: {
  theme: Theme
  s: ReturnType<typeof makeStyles>
  rec: RecordingEntry
  onBack: () => void
  onCopy: () => void
  copied: boolean
  onReprocess: () => void
  onDelete: () => void
  formatDate: (t: number) => string
  formatDuration: (s: number) => string
  formatSize: (b: number) => string
  statusIcon: (status: string) => { char: string; color: string }
}): ReactElement {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const failed = rec.status === 'failed'
  const si = statusIcon(rec.status)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    window.api.recordings.getAudio(rec.id).then((buf) => {
      if (cancelled || !buf) return
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer)
      const blob = new Blob([bytes as BlobPart], { type: mimeFromName(rec.filename) })
      url = URL.createObjectURL(blob)
      setAudioUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [rec.id, rec.filename])

  const togglePlay = (): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      a.play()
      setPlaying(true)
    } else {
      a.pause()
      setPlaying(false)
    }
  }

  // 40 deterministic waveform bars seeded from the recording id
  const bars = Array.from({ length: 40 }, (_, i) => {
    const seed = rec.id.charCodeAt(i % rec.id.length) || 12
    return 7 + ((seed * (i + 3)) % 24)
  })
  const progress = rec.duration > 0 ? current / rec.duration : 0
  const fmtTime = (s: number): string => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const ghostBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    background: 'none',
    border: `1px solid ${theme.border}`,
    borderRadius: 9,
    padding: '8px 13px',
    fontSize: 13,
    fontWeight: 500,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontFamily: 'IBM Plex Sans, sans-serif',
    transition: 'border-color .15s, color .15s, background .15s'
  }
  const meta: Array<[string, string]> = [
    ['Duration', formatDuration(rec.duration)],
    ['Provider', rec.provider],
    ['Status', rec.status.charAt(0).toUpperCase() + rec.status.slice(1)],
    ['Size', formatSize(rec.size)]
  ]

  return (
    <div style={s.detailShell}>
      <button
        onClick={onBack}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: theme.textSecondary,
          fontFamily: 'IBM Plex Sans, sans-serif',
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          marginBottom: 18
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = theme.text)}
        onMouseLeave={(e) => (e.currentTarget.style.color = theme.textSecondary)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Recordings
      </button>

      <div style={s.detailHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{
            width: '34px',
            height: '34px',
            borderRadius: '10px',
            background: `${si.color}18`,
            border: `1px solid ${si.color}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: si.color,
            flexShrink: 0
          }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{si.char}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={s.detailKicker}>Recording detail</div>
            <h2 style={s.detailTitle}>{formatDate(rec.timestamp)}</h2>
          </div>
        </div>
        <span style={{
          ...s.metaPill,
          background: `${si.color}12`,
          borderColor: `${si.color}30`,
          color: si.color
        }}>
          {rec.status}
        </span>
      </div>

      <div style={s.detailMetaGrid}>
        {meta.map(([k, v]) => (
          <div key={k} style={s.detailMetaItem}>
            <div style={s.detailMetaKey}>{k}</div>
            <div style={s.detailMetaValue}>{v}</div>
          </div>
        ))}
      </div>

      {!failed && (
        <div style={s.waveformCard}>
          <button
            onClick={togglePlay}
            disabled={!audioUrl}
            style={s.playButton}
          >
            {playing ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>
            )}
          </button>
          <div style={s.waveformTrack}>
            {bars.map((h, bi) => (
              <span
                key={bi}
                style={{
                  flex: 1,
                  height: h + 'px',
                  background: bi / bars.length <= progress ? theme.accent : theme.borderHover,
                  borderRadius: 2
                }}
              />
            ))}
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: theme.textMuted, flexShrink: 0 }}>
            {fmtTime(current)} / {formatDuration(rec.duration)}
          </span>
          {audioUrl && (
            <audio
              ref={audioRef}
              src={audioUrl}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onEnded={() => {
                setPlaying(false)
                setCurrent(0)
              }}
              style={{ display: 'none' }}
            />
          )}
        </div>
      )}

      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: theme.textMuted, margin: failed ? '24px 0 10px' : '6px 0 10px' }}>
        Transcription
      </div>
      <div style={{ fontSize: 14.5, color: failed ? theme.danger : theme.text, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
        {failed ? rec.error || 'Transcription failed.' : rec.transcription || 'No transcription available.'}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 26, flexWrap: 'wrap' }}>
        {!failed && rec.transcription && (
          <button
            onClick={onCopy}
            style={ghostBtn}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.color = theme.text }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.color = theme.textSecondary }}
          >
            {copied ? (
              <span style={{ color: theme.success }}>{'✓'} Copied</span>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                Copy
              </>
            )}
          </button>
        )}
        <button
          onClick={onReprocess}
          style={ghostBtn}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.color = theme.text }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.color = theme.textSecondary }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          Re-transcribe
        </button>
        <button
          onClick={onDelete}
          style={{ ...ghostBtn, color: theme.danger }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.danger; e.currentTarget.style.background = 'rgba(240,85,107,.08)' }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.background = 'none' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          Delete
        </button>
      </div>
    </div>
  )
}

/* --- Styles --- */

function makeStyles(theme: Theme) {
  return {
    container: {
      padding: '16px 20px 22px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '10px'
    },
    scrollArea: {
      flex: 1,
      overflowY: 'auto' as const,
      overflowX: 'hidden' as const
    },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      padding: '12px 20px',
      borderBottom: `1px solid ${theme.border}`,
      background: theme.bg,
      flexShrink: 0
    },
    recordingCount: {
      fontSize: '11px',
      color: theme.textMuted,
      fontWeight: 500
    } as React.CSSProperties,
    toolbarButton: {
      background: theme.bgSecondary,
      border: `1px solid ${theme.border}`,
      borderRadius: '10px',
      padding: '7px 12px',
      fontSize: '12px',
      fontWeight: 500,
      color: theme.textSecondary,
      cursor: 'pointer',
      fontFamily: 'IBM Plex Sans, sans-serif',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'background 0.15s, border-color 0.15s, color 0.15s'
    } as React.CSSProperties,
    recordingRow: {
      background: theme.bgSecondary,
      border: `1px solid ${theme.border}`,
      borderRadius: '14px',
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
      position: 'relative' as const
    },
    statusIcon: {
      fontSize: '16px',
      fontWeight: 700,
      width: '24px',
      height: '24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    },
    recordingContent: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '4px'
    },
    recordingHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    },
    recordingDate: {
      fontSize: '12px',
      fontWeight: 500,
      color: theme.text
    },
    recordingMeta: {
      fontSize: '11px',
      color: theme.textMuted,
      background: theme.bgTertiary,
      padding: '2px 7px',
      borderRadius: '999px'
    },
    recordingText: {
      fontSize: '13px',
      color: theme.textSecondary,
      lineHeight: '1.45',
      overflow: 'hidden' as const,
      textOverflow: 'ellipsis' as const,
      whiteSpace: 'nowrap' as const
    },
    actionButtons: {
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      flexShrink: 0,
      transition: 'opacity 0.15s'
    },
    actionButton: {
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      color: theme.textMuted,
      transition: 'background 0.15s, color 0.15s'
    } as React.CSSProperties,
    emptyState: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '76px 20px',
      textAlign: 'center' as const
    },
    detailShell: {
      padding: '20px 26px 28px',
      maxWidth: '1060px',
      margin: '0 auto'
    },
    detailHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '16px'
    },
    detailKicker: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px',
      letterSpacing: '0.18em',
      textTransform: 'uppercase' as const,
      color: theme.textMuted,
      marginBottom: '4px'
    },
    detailTitle: {
      fontFamily: "'Space Grotesk', sans-serif",
      fontSize: '18px',
      fontWeight: 600,
      color: theme.text,
      letterSpacing: '-.01em',
      lineHeight: 1.2,
      margin: 0
    },
    detailMetaGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
      gap: '12px',
      paddingBottom: '20px',
      borderBottom: `1px solid ${theme.border}`
    },
    detailMetaItem: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '4px'
    },
    detailMetaKey: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '10px',
      letterSpacing: '.14em',
      textTransform: 'uppercase' as const,
      color: theme.textMuted
    },
    detailMetaValue: {
      fontSize: '13.5px',
      fontWeight: 500,
      color: theme.text
    },
    metaPill: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '5px 10px',
      borderRadius: '999px',
      border: `1px solid ${theme.border}`,
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'capitalize' as const,
      flexShrink: 0
    },
    waveformCard: {
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      padding: '14px 16px',
      borderRadius: '14px',
      border: `1px solid ${theme.border}`,
      background: `linear-gradient(180deg, ${theme.bgSecondary} 0%, ${theme.bg} 100%)`,
      margin: '22px 0'
    },
    playButton: {
      width: 38,
      height: 38,
      borderRadius: '50%',
      border: 'none',
      background: theme.accent,
      color: theme.accentInk,
      cursor: 'pointer',
      opacity: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      boxShadow: `0 10px 24px -14px ${theme.accentGlow}`
    } as React.CSSProperties,
    waveformTrack: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      height: 34
    }
  }
}
