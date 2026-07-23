import { useState, useEffect, useCallback, useRef, Fragment, type CSSProperties, type ReactElement } from 'react'
import { useTheme } from '../../ThemeContext'
import { TitleBar } from '../common/TitleBar'
import type { Theme } from '../../theme'

// Group-conversation mode (multi-speaker transcription) — mirrors
// src/main/dictation/conversation.ts's SpeakerSegment exactly. See that
// module's doc comment for the folding semantics that produced these.
interface SpeakerSegment {
  speaker: string
  start: number
  end: number
  text: string
}

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
  // ROUGH-FIRST on-demand cleanup result (v1.4 PR2) — additive, absent on
  // recordings that were never run through "Clean up". See recordingStore.ts.
  cleanedText?: string
  cleanedWith?: string
  // Group-conversation mode — additive, absent on plain recordings. See
  // recordingStore.ts's RecordingEntry.segments doc comment.
  segments?: SpeakerSegment[]
  speakerNames?: Record<string, string>
}

/** Stable speaker-id ordering + "Speaker N" fallback naming — mirrors
 * dictation/conversation.ts's speakerOrder()/displayName() (kept as a small
 * renderer-local copy per this file's existing "preload/renderer own their
 * types" convention rather than importing a main-process module). */
function speakerOrderOf(segments: SpeakerSegment[]): string[] {
  const seen: string[] = []
  for (const s of segments) {
    if (!seen.includes(s.speaker)) seen.push(s.speaker)
  }
  return seen
}

function speakerDisplayName(speaker: string, names: Record<string, string>, order: string[]): string {
  const name = names[speaker]?.trim()
  if (name) return name
  const idx = order.indexOf(speaker)
  return idx !== -1 ? `Speaker ${idx + 1}` : speaker
}

/* ─── ROUGH-FIRST on-demand cleanup (v1.4 PR2) ───
 *
 * By default (settings.cleanupAuto === false) the raw transcript pastes
 * instantly after dictation — this panel is where cleanup becomes something
 * you ask for afterward, per recording: plain full/light cleanup, one of the
 * user's "format to X" templates, or a one-off custom instruction. Fail-soft
 * mirrors the auto path's invariant, just surfaced differently: a provider
 * failure never throws or shows an error dialog, it shows a quiet inline
 * "AI unreachable — raw kept" hint next to the action instead.
 */

type CleanupMode = 'off' | 'light' | 'full'

interface CleanupTemplate {
  id: string
  name: string
  prompt: string
}

interface CleanupRequestOptions {
  mode?: CleanupMode
  templateId?: string
  customInstruction?: string
}

interface CleanupUIResult {
  text: string
  ok: boolean
  cleanedWith: string
}

const CLEANUP_UNREACHABLE_HINT = 'AI unreachable — raw kept.'

export function RecordingsView(): ReactElement {
  const { theme } = useTheme()
  const [recordings, setRecordings] = useState<RecordingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false)
  // Per-day "Delete this day" confirm state (recordings:deleteByDate) — keyed
  // by the YYYY-MM-DD group key so each day's confirm toggle is independent,
  // mirroring the single-boolean deleteAllConfirm pattern above.
  const [deleteDayConfirm, setDeleteDayConfirm] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // On-demand cleanup UI state (v1.4 PR2). `cleanupResults` holds the
  // in-memory result of the most recent "Clean up" call per recording id —
  // it's seeded from rec.cleanedText/cleanedWith (persisted on the entry by
  // the main process) the first time a recording is looked at, and updated
  // in place after a fresh on-demand call so the panel doesn't need a full
  // reload to show a new result.
  const [cleanupResults, setCleanupResults] = useState<Record<string, CleanupUIResult>>({})
  const [cleanupBusyId, setCleanupBusyId] = useState<string | null>(null)
  // IPC/transport-level failure (e.g. no handler registered) is distinct
  // from a fail-soft `ok: false` result — both render the same quiet inline
  // hint, but this one means the call never got a structured answer back.
  const [cleanupIpcError, setCleanupIpcError] = useState<Record<string, string | undefined>>({})
  const [cleanedCopiedId, setCleanedCopiedId] = useState<string | null>(null)
  const [cleanupDefaults, setCleanupDefaults] = useState<{ cleanupEnabled: boolean; mode: CleanupMode; templates: CleanupTemplate[] }>({
    // Default true (matches settingsManager.ts's DEFAULT_SETTINGS.cleanupEnabled)
    // until settings.load() resolves, so the button doesn't flash hidden then
    // shown on the common case where cleanup is enabled.
    cleanupEnabled: true,
    mode: 'full',
    templates: []
  })

  // Group-conversation mode capture (multi-speaker recording) — an in-app
  // record button, NOT a global hotkey (mirrors the mobile app's own
  // Conversation screen). `conversationAvailable` gates the button on
  // whether a diarizing provider (ElevenLabs/Deepgram/AssemblyAI) is
  // configured, same guard as SettingsStore.makeConversationTranscriber().
  const [conversationAvailable, setConversationAvailable] = useState(true)
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureElapsed, setCaptureElapsed] = useState(0)
  const [captureBusy, setCaptureBusy] = useState(false)
  const captureRecorderRef = useRef<MediaRecorder | null>(null)
  const captureStreamRef = useRef<MediaStream | null>(null)
  const captureChunksRef = useRef<Blob[]>([])
  const captureStartRef = useRef(0)
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.conversation
      .available()
      .then((available) => {
        if (!cancelled) setConversationAvailable(available)
      })
      .catch(() => {
        // Fail-soft: leave the button enabled rather than hiding a feature
        // because the availability check itself failed to answer.
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .load()
      .then((settings) => {
        if (cancelled) return
        setCleanupDefaults({
          cleanupEnabled: (settings.cleanupEnabled as boolean | undefined) ?? true,
          mode: (settings.cleanupMode as CleanupMode | undefined) ?? 'full',
          templates: settings.cleanupTemplates ?? []
        })
      })
      .catch(() => {
        // Fail-soft: keep the built-in 'full' / no-templates default rather
        // than blocking the recordings list on a settings load error.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCleanup = useCallback(async (id: string, options: CleanupRequestOptions) => {
    setCleanupBusyId(id)
    setCleanupIpcError((prev) => ({ ...prev, [id]: undefined }))
    try {
      const result = await window.api.recordings.cleanup(id, options)
      setCleanupResults((prev) => ({ ...prev, [id]: result }))
    } catch {
      // Fail-soft: never a dialog, just the same quiet inline hint a
      // provider-level failure would show.
      setCleanupIpcError((prev) => ({ ...prev, [id]: CLEANUP_UNREACHABLE_HINT }))
    } finally {
      setCleanupBusyId(null)
    }
  }, [])

  const handleCopyCleaned = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCleanedCopiedId(id)
    setTimeout(() => setCleanedCopiedId(null), 1500)
  }, [])

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

  const handleDeleteDay = useCallback(async (dateKey: string) => {
    if (!deleteDayConfirm[dateKey]) {
      setDeleteDayConfirm((prev) => ({ ...prev, [dateKey]: true }))
      setTimeout(() => {
        setDeleteDayConfirm((prev) => ({ ...prev, [dateKey]: false }))
      }, 3000)
      return
    }
    await window.api.recordings.deleteByDate(dateKey)
    setDeleteDayConfirm((prev) => ({ ...prev, [dateKey]: false }))
    await loadRecordings()
  }, [deleteDayConfirm, loadRecordings])

  const handleReprocess = useCallback(async (id: string) => {
    await window.api.recordings.reprocess(id)
    await loadRecordings()
  }, [loadRecordings])

  const handleCopy = useCallback(async (id: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const stopCaptureTimer = (): void => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current)
      captureTimerRef.current = null
    }
  }

  const startConversationCapture = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      })
      captureStreamRef.current = stream
      captureChunksRef.current = []
      captureStartRef.current = Date.now()
      setCaptureElapsed(0)

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      captureRecorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) captureChunksRef.current.push(e.data)
      }
      recorder.start(250)
      setIsCapturing(true)
      captureTimerRef.current = setInterval(() => {
        setCaptureElapsed((Date.now() - captureStartRef.current) / 1000)
      }, 250)
    } catch (err) {
      console.error('[Whisperio] Conversation capture failed to start:', err)
    }
  }, [])

  const stopConversationCapture = useCallback(async () => {
    const recorder = captureRecorderRef.current
    if (!recorder) return
    const duration = (Date.now() - captureStartRef.current) / 1000
    stopCaptureTimer()

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })
    recorder.stop()
    captureStreamRef.current?.getTracks().forEach((t) => t.stop())
    captureStreamRef.current = null
    captureRecorderRef.current = null
    setIsCapturing(false)
    await stopped

    setCaptureBusy(true)
    try {
      const blob = new Blob(captureChunksRef.current, { type: 'audio/webm' })
      const buffer = await blob.arrayBuffer()
      await window.api.conversation.save(buffer, { duration, filename: 'conversation.webm' })
      await loadRecordings()
    } finally {
      setCaptureBusy(false)
    }
  }, [loadRecordings])

  const formatDate = (timestamp: number): string => {
    const d = new Date(timestamp)
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  // Group key for recordings:deleteByDate — deliberately independent of
  // formatDate's display string above. Must match recordingStore.ts's
  // deleteRecordingsByDate grouping exactly (local time, zero-padded,
  // YYYY-MM-DD) or a day header's "Delete this day" would delete the wrong
  // set of recordings.
  const dayKeyOf = (timestamp: number): string => {
    const d = new Date(timestamp)
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
    // Seed from the persisted cleanedText/cleanedWith (main process) until a
    // fresh on-demand call in this session produces a newer in-memory result.
    const cleaned: CleanupUIResult | null =
      cleanupResults[selectedRec.id] ??
      (selectedRec.cleanedText ? { text: selectedRec.cleanedText, ok: true, cleanedWith: selectedRec.cleanedWith ?? '' } : null)
    const cleanupHint = cleanupIpcError[selectedRec.id] ?? (cleaned && !cleaned.ok ? CLEANUP_UNREACHABLE_HINT : undefined)

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
            cleanupEnabled={cleanupDefaults.cleanupEnabled}
            cleanupMode={cleanupDefaults.mode}
            cleanupTemplates={cleanupDefaults.templates}
            cleanupBusy={cleanupBusyId === selectedRec.id}
            cleanupResult={cleaned}
            cleanupHint={cleanupHint}
            cleanedCopied={cleanedCopiedId === selectedRec.id}
            onCleanup={(options) => handleCleanup(selectedRec.id, options)}
            onCopyCleaned={() => cleaned?.text && handleCopyCleaned(selectedRec.id, cleaned.text)}
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!conversationAvailable && !isCapturing && (
            <span style={{ fontSize: 11, color: theme.textMuted, maxWidth: 220, lineHeight: 1.4 }}>
              Add an ElevenLabs, OpenAI, Deepgram or AssemblyAI key to transcribe conversations
            </span>
          )}
          <button
            onClick={isCapturing ? stopConversationCapture : startConversationCapture}
            disabled={(!conversationAvailable && !isCapturing) || captureBusy}
            data-testid="conversation-record-button"
            title={
              conversationAvailable || isCapturing
                ? isCapturing
                  ? 'Stop conversation recording'
                  : 'Start a new conversation recording'
                : 'Add an ElevenLabs, OpenAI, Deepgram or AssemblyAI key to transcribe conversations'
            }
            style={{
              ...s.toolbarButton,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 12px',
              color: isCapturing ? '#ffffff' : theme.text,
              background: isCapturing ? theme.danger : theme.bgSecondary,
              borderColor: isCapturing ? theme.danger : theme.border,
              opacity: !conversationAvailable && !isCapturing ? 0.5 : 1,
              cursor: !conversationAvailable && !isCapturing ? 'not-allowed' : 'pointer'
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: isCapturing ? 2 : 999,
                background: isCapturing ? '#ffffff' : theme.danger
              }}
            />
            {captureBusy
              ? 'Transcribing…'
              : isCapturing
                ? `Stop · ${Math.floor(captureElapsed / 60)}:${Math.floor(captureElapsed % 60).toString().padStart(2, '0')}`
                : 'New Conversation'}
          </button>
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
            // Recordings are already sorted latest-first (loadRecordings),
            // so a day header only needs to fire when the group key changes
            // relative to the previous row — no extra sort/grouping pass.
            (() => {
              const dayCounts = recordings.reduce<Record<string, number>>((acc, r) => {
                const k = dayKeyOf(r.timestamp)
                acc[k] = (acc[k] ?? 0) + 1
                return acc
              }, {})
              let lastDayKey: string | null = null

              return recordings.map((rec) => {
                const isHovered = hoveredId === rec.id
                const si = statusIcon(rec.status)
                const dayKey = dayKeyOf(rec.timestamp)
                const showDayHeader = dayKey !== lastDayKey
                lastDayKey = dayKey
                const dayConfirming = deleteDayConfirm[dayKey] ?? false

                return (
                  <Fragment key={rec.id}>
                    {showDayHeader && (
                      <div style={s.dayHeader} data-testid={`day-header-${dayKey}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={s.dayHeaderDate}>{dayKey}</span>
                          <span style={s.recordingMeta}>{dayCounts[dayKey]} recording{dayCounts[dayKey] !== 1 ? 's' : ''}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteDay(dayKey)}
                          style={{
                            ...s.toolbarButton,
                            padding: '4px 10px',
                            fontSize: '11px',
                            color: dayConfirming ? '#ffffff' : theme.danger,
                            background: dayConfirming ? theme.danger : theme.bgSecondary,
                            borderColor: dayConfirming ? theme.danger : theme.border
                          }}
                          title="Delete all recordings from this day"
                          onMouseEnter={(e) => {
                            if (!dayConfirming) {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
                              e.currentTarget.style.borderColor = theme.danger
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!dayConfirming) {
                              e.currentTarget.style.background = theme.bgSecondary
                              e.currentTarget.style.borderColor = theme.border
                            }
                          }}
                        >
                          {dayConfirming ? 'Confirm?' : 'Delete this day'}
                        </button>
                      </div>
                    )}
                    <div
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
                      {rec.segments && rec.segments.length > 0 && (
                        <span
                          style={{
                            ...s.recordingMeta,
                            color: theme.accent,
                            border: `1px solid ${theme.accent}40`,
                            borderRadius: 999,
                            padding: '1px 8px'
                          }}
                          data-testid={`conversation-badge-${rec.id}`}
                        >
                          Conversation · {speakerOrderOf(rec.segments).length} speaker{speakerOrderOf(rec.segments).length !== 1 ? 's' : ''}
                        </span>
                      )}
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
                  </Fragment>
                )
              })
            })()
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

/**
 * Group-conversation mode's "WHAT THEY SAID" section (see DetailView.swift on
 * the mobile app for the reference) — one row per SpeakerSegment with a
 * clickable speaker chip. Clicking a chip opens an inline rename input;
 * submitting persists the new name via recordings.renameSpeaker (main
 * process recomputes rec.transcription from the untouched segments), and the
 * local speakerNames override is applied immediately so the rename doesn't
 * wait on a full recordings reload.
 */
function ConversationSegments({ theme, rec }: { theme: Theme; rec: RecordingEntry }): ReactElement {
  const segments = rec.segments ?? []
  const [names, setNames] = useState<Record<string, string>>(rec.speakerNames ?? {})
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    setNames(rec.speakerNames ?? {})
  }, [rec.id, rec.speakerNames])

  const order = speakerOrderOf(segments)

  const startEdit = (speaker: string): void => {
    setEditingSpeaker(speaker)
    setDraftName(names[speaker] ?? '')
  }

  const commitEdit = async (speaker: string): Promise<void> => {
    const trimmed = draftName.trim()
    setEditingSpeaker(null)
    if (!trimmed || trimmed === names[speaker]) return
    setNames((prev) => ({ ...prev, [speaker]: trimmed }))
    await window.api.recordings.renameSpeaker(rec.id, speaker, trimmed)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="conversation-segments">
      {segments.map((seg, i) => {
        const label = speakerDisplayName(seg.speaker, names, order)
        const isEditing = editingSpeaker === seg.speaker
        return (
          <div key={`${seg.speaker}-${i}-${seg.start}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {isEditing ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitEdit(seg.speaker)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(seg.speaker)
                  if (e.key === 'Escape') setEditingSpeaker(null)
                }}
                style={{
                  width: 140,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  color: theme.accentInk,
                  background: theme.accent,
                  border: 'none',
                  borderRadius: 999,
                  padding: '3px 10px'
                }}
              />
            ) : (
              <button
                onClick={() => startEdit(seg.speaker)}
                title="Rename speaker"
                style={{
                  alignSelf: 'flex-start',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  color: theme.accentInk,
                  background: theme.accent,
                  border: 'none',
                  borderRadius: 999,
                  padding: '3px 10px',
                  cursor: 'pointer',
                  fontFamily: 'IBM Plex Sans, sans-serif'
                }}
                data-testid={`speaker-chip-${seg.speaker}`}
              >
                {label}
              </button>
            )}
            <div style={{ fontSize: 14.5, color: theme.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {seg.text}
            </div>
          </div>
        )
      })}
    </div>
  )
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
  statusIcon,
  cleanupEnabled,
  cleanupMode,
  cleanupTemplates,
  cleanupBusy,
  cleanupResult,
  cleanupHint,
  cleanedCopied,
  onCleanup,
  onCopyCleaned
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
  cleanupEnabled: boolean
  cleanupMode: CleanupMode
  cleanupTemplates: CleanupTemplate[]
  cleanupBusy: boolean
  cleanupResult: CleanupUIResult | null
  cleanupHint?: string
  cleanedCopied: boolean
  onCleanup: (options: CleanupRequestOptions) => void
  onCopyCleaned: () => void
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
        {rec.segments && rec.segments.length > 0 ? 'What They Said' : 'Transcription'}
      </div>
      {!failed && rec.segments && rec.segments.length > 0 ? (
        <ConversationSegments theme={theme} rec={rec} />
      ) : (
        <div style={{ fontSize: 14.5, color: failed ? theme.danger : theme.text, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
          {failed ? rec.error || 'Transcription failed.' : rec.transcription || 'No transcription available.'}
        </div>
      )}

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
        {!failed && rec.transcription && (
          <CleanupMenu
            theme={theme}
            ghostBtn={ghostBtn}
            busy={cleanupBusy}
            enabled={cleanupEnabled}
            mode={cleanupMode}
            templates={cleanupTemplates}
            onSelect={onCleanup}
          />
        )}
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

      {!failed && rec.transcription && (cleanupResult || cleanupHint || cleanupBusy) && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 14px',
            borderRadius: 12,
            border: `1px solid ${theme.border}`,
            background: theme.bgSecondary,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
          data-testid="cleanup-result"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: theme.textMuted }}>
              {cleanupBusy ? 'Cleaning up…' : cleanupResult ? `Cleaned (${cleanupResult.cleanedWith})` : 'Clean up'}
            </span>
            {cleanupResult && cleanupResult.ok && (
              <button
                onClick={onCopyCleaned}
                style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.color = theme.text }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.color = theme.textSecondary }}
              >
                {cleanedCopied ? (
                  <span style={{ color: theme.success }}>{'✓'} Copied</span>
                ) : (
                  'Copy'
                )}
              </button>
            )}
          </div>
          {cleanupResult && cleanupResult.ok && (
            <div style={{ fontSize: 14, color: theme.text, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {cleanupResult.text}
            </div>
          )}
          {cleanupHint && (
            <span style={{ fontSize: 11.5, color: theme.textMuted, fontStyle: 'italic', lineHeight: 1.4 }} data-testid="cleanup-hint">
              {cleanupHint}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * "Clean up" trigger + menu: plain full/light cleanup, the user's format-to-X
 * templates (settings.cleanupTemplates), and a one-off custom instruction.
 * Self-contained (no portal/positioning library) — a simple absolutely-
 * positioned panel anchored to the trigger button, matching the rest of this
 * file's "plain inline React, no extra deps" style.
 */
function CleanupMenu({
  theme, ghostBtn, busy, enabled, mode, templates, onSelect
}: {
  theme: Theme
  ghostBtn: CSSProperties
  busy: boolean
  /** Mirrors CleanupPanel.tsx's "Enable AI cleanup" toggle (settings.cleanupEnabled)
   * — when off, the trigger is disabled rather than hidden, so the action stays
   * discoverable with a tooltip pointing at the settings toggle. */
  enabled: boolean
  mode: CleanupMode
  templates: CleanupTemplate[]
  onSelect: (options: CleanupRequestOptions) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')
  const defaultMode: 'light' | 'full' = mode === 'off' ? 'full' : mode

  const closeMenu = (): void => {
    setOpen(false)
    setCustomOpen(false)
    setCustomText('')
  }

  const menuItemStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 13,
    color: theme.text,
    cursor: 'pointer',
    fontFamily: 'inherit'
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => { if (enabled) setOpen((v) => !v) }}
        disabled={busy || !enabled}
        title={enabled ? undefined : 'Enable AI cleanup in Settings to use this.'}
        style={{ ...ghostBtn, opacity: busy || !enabled ? 0.6 : 1, cursor: busy || !enabled ? 'default' : 'pointer' }}
        onMouseEnter={(e) => { if (!busy && enabled) { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.color = theme.text } }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.color = theme.textSecondary }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M5 5l2.5 2.5M16.5 16.5L19 19M3 12h4M17 12h4M5 19l2.5-2.5M16.5 7.5L19 5" /></svg>
        {busy ? 'Cleaning up…' : 'Clean up'}
      </button>

      {open && !busy && enabled && (
        <div
          data-testid="cleanup-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 20,
            minWidth: 220,
            background: theme.bgSecondary,
            border: `1px solid ${theme.border}`,
            borderRadius: 10,
            boxShadow: '0 12px 28px -12px rgba(0,0,0,.4)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}
        >
          <button
            style={menuItemStyle}
            onClick={() => {
              closeMenu()
              onSelect({ mode: defaultMode })
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.bgTertiary)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Clean up ({defaultMode})
          </button>

          {templates.map((t) => (
            <button
              key={t.id}
              style={menuItemStyle}
              onClick={() => {
                closeMenu()
                onSelect({ templateId: t.id })
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = theme.bgTertiary)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {t.name || 'Untitled template'}
            </button>
          ))}

          {!customOpen ? (
            <button
              style={menuItemStyle}
              onClick={() => setCustomOpen(true)}
              onMouseEnter={(e) => (e.currentTarget.style.background = theme.bgTertiary)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Custom instruction…
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 4px 2px' }}>
              <textarea
                autoFocus
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="e.g. Summarize in two sentences"
                rows={2}
                style={{
                  fontSize: 13,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: `1px solid ${theme.inputBorder}`,
                  background: theme.inputBg,
                  color: theme.text,
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
              <button
                disabled={!customText.trim()}
                onClick={() => {
                  const instruction = customText.trim()
                  closeMenu()
                  onSelect({ customInstruction: instruction })
                }}
                style={{
                  alignSelf: 'flex-end',
                  background: theme.accent,
                  color: theme.accentInk,
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: customText.trim() ? 'pointer' : 'default',
                  opacity: customText.trim() ? 1 : 0.5,
                  fontFamily: 'inherit'
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
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
    dayHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      padding: '6px 2px 2px'
    } as React.CSSProperties,
    dayHeaderDate: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
      fontWeight: 600,
      letterSpacing: '.04em',
      color: theme.textSecondary
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
