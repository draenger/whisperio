import { useState, useEffect, useCallback, type ReactElement } from 'react'
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

export function RecordingsPanel(): ReactElement {
  const { theme } = useTheme()
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
        <TitleBar title="Whisperio Recordings" />
        <div style={{ ...s.container, justifyContent: 'center', alignItems: 'center', flex: 1 }}>
          <p style={{ color: theme.textMuted }}>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: theme.bg }}>
      <TitleBar title="Whisperio Recordings" />

      {/* Toolbar */}
      <div style={s.toolbar}>
        <span style={s.recordingCount}>
          {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
        </span>
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
              <span style={{ fontSize: '32px', opacity: 0.3 }}>{'\u25CC'}</span>
              <p style={{ color: theme.textMuted, fontSize: '14px', marginTop: '12px' }}>
                No recordings yet
              </p>
              <p style={{ color: theme.textMuted, fontSize: '12px', marginTop: '4px', opacity: 0.6 }}>
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
                    borderColor: isHovered ? theme.accent : theme.border
                  }}
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
                  <div style={{
                    ...s.actionButtons,
                    opacity: isHovered ? 1 : 0,
                    pointerEvents: isHovered ? 'auto' : 'none'
                  }}>
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
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

/* --- Styles --- */

function makeStyles(theme: Theme) {
  return {
    container: {
      padding: '16px 20px 20px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '8px'
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
      padding: '10px 20px',
      borderBottom: `1px solid ${theme.border}`,
      background: theme.bg,
      flexShrink: 0
    },
    recordingCount: {
      fontSize: '12px',
      color: theme.textMuted,
      fontWeight: 500
    } as React.CSSProperties,
    toolbarButton: {
      background: theme.bgSecondary,
      border: `1px solid ${theme.border}`,
      borderRadius: '8px',
      padding: '6px 12px',
      fontSize: '12px',
      fontWeight: 500,
      color: theme.textSecondary,
      cursor: 'pointer',
      fontFamily: 'Inter, sans-serif',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'background 0.15s, border-color 0.15s, color 0.15s'
    } as React.CSSProperties,
    recordingRow: {
      background: theme.bgSecondary,
      border: `1px solid ${theme.border}`,
      borderRadius: '12px',
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      transition: 'border-color 0.15s',
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
      padding: '1px 6px',
      borderRadius: '4px'
    },
    recordingText: {
      fontSize: '13px',
      color: theme.textSecondary,
      lineHeight: '1.4',
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
      padding: '60px 20px',
      textAlign: 'center' as const
    }
  }
}
