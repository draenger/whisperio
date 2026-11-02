import { useRef, useCallback, useState } from 'react'
import { analyzeSpeech, mixToMono, clampThresholdDbfs, shouldApplySilenceGate } from '../audio/silenceGate'
import { trimToWav } from '../audio/silenceTrim'
import { shouldUseTrimmed } from '../../shared/trimDecision'

import { planAudioFormats } from '../audio/formatPlan'
import { StartGuard, decideAfterGetUserMediaFailure } from '../audio/startGuard'

/** Decode a recording and report whether it contains speech. Fails OPEN:
 * any decode problem returns true so the audio is sent as before. */
async function recordingHasSpeech(buffer: ArrayBuffer, thresholdDbfs?: number): Promise<boolean> {
  try {
    const ctx = new AudioContext({ sampleRate: 16000 })
    try {
      const decoded = await ctx.decodeAudioData(buffer.slice(0))
      const channels: Float32Array[] = []
      for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c))
      const result = analyzeSpeech(mixToMono(channels), decoded.sampleRate, { thresholdDbfs: clampThresholdDbfs(thresholdDbfs) })
      console.log(`[Whisperio] Silence gate: peak ${result.peakDbfs.toFixed(1)} dBFS, voiced ${Math.round(result.voicedMs)} ms`)
      return result.hasSpeech
    } finally {
      ctx.close().catch(() => {})
    }
  } catch (err) {
    console.warn('[Whisperio] Silence gate decode failed, sending anyway:', err)
    return true
  }
}
/** Decode a recording and, if >= 1 s of leading/trailing silence can be cut,
 * return the trimmed audio as 16 kHz mono WAV. Returns null when nothing is
 * worth trimming. Fails OPEN: any error returns null so the original is sent. */
async function trimmedWavOrNull(buffer: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const ctx = new AudioContext({ sampleRate: 16000 })
    try {
      const decoded = await ctx.decodeAudioData(buffer.slice(0))
      const channels: Float32Array[] = []
      for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c))
      return trimToWav(mixToMono(channels), decoded.sampleRate)
    } finally {
      ctx.close().catch(() => {})
    }
  } catch (err) {
    console.warn('[Whisperio] Silence trim failed, sending original:', err)
    return null
  }
}

async function webmToWav(webmBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const audioCtx = new AudioContext({ sampleRate: 16000 })
  try {
    const decoded = await audioCtx.decodeAudioData(webmBuffer.slice(0))
    const pcm = decoded.getChannelData(0)
    const wavBuffer = new ArrayBuffer(44 + pcm.length * 2)
    const view = new DataView(wavBuffer)
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + pcm.length * 2, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true)
    view.setUint32(28, 32000, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeStr(36, 'data')
    view.setUint32(40, pcm.length * 2, true)
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]))
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    }
    return wavBuffer
  } finally {
    await audioCtx.close()
  }
}

interface UseDictationReturn {
  isRecording: boolean
  /** Word count of the most recently transcribed (non-empty) result — real
   * data from the actual transcript, used by DictationOverlay to render the
   * post-paste "done" confirmation. Null once no transcript is available. */
  lastWordCount: number | null
  startRecording: (sessionId?: number) => Promise<void>
  startOutputRecording: (sessionId?: number) => Promise<void>
  stopAndTranscribe: (sessionId?: number) => Promise<void>
  cancelRecording: () => void
}

export function useDictation(): UseDictationReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [lastWordCount, setLastWordCount] = useState<number | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recordingStartTimeRef = useRef<number>(0)
  const startGuardRef = useRef(new StartGuard())

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    setIsRecording(false)
  }, [])

  const startRecording = useCallback(async (sessionId?: number) => {
    console.log('[Whisperio] startRecording called')
    // Supersede any earlier in-flight start and release a stream/recorder left
    // from a previous session so a second press never leaks the first mic.
    const token = startGuardRef.current.begin()
    const prevRecorder = mediaRecorderRef.current
    if (prevRecorder && prevRecorder.state !== 'inactive') {
      try { prevRecorder.stop() } catch { /* already stopped */ }
    }
    stopTracks()
    // Main is waiting in 'recording'; on a failed start reset it to idle FIRST
    // (tagged with this session so a later session is never reset), then tell
    // the user via the error toast.
    const failStart = async (message: string): Promise<void> => {
      try { await window.api.dictation.sendResult('', sessionId) } catch { /* best effort */ }
      try { await window.api.dictation.reportError?.('Microphone unavailable', message) } catch { /* best effort */ }
    }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[Whisperio] getUserMedia not available in this context')
        await failStart('Audio capture is not available.')
        return
      }

      // Honor the user's selected input device (Settings > Audio > Input
      // Device). Empty string means "System Default": omit the constraint.
      const settings = await window.api.settings.load()
      if (!startGuardRef.current.isCurrent(token)) return
      const baseConstraints: MediaTrackConstraints = {
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
      const usedSpecificDevice = !!settings.inputDeviceId
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: usedSpecificDevice
            ? { ...baseConstraints, deviceId: { exact: settings.inputDeviceId } }
            : baseConstraints
        })
      } catch (err) {
        if (decideAfterGetUserMediaFailure(err, usedSpecificDevice) !== 'retry-default') throw err
        console.warn('[Whisperio] Selected input device unavailable, falling back to system default:', err)
        if (!startGuardRef.current.isCurrent(token)) return
        stream = await navigator.mediaDevices.getUserMedia({ audio: baseConstraints })
      }
      // Stopped/cancelled/superseded while getUserMedia was pending: release
      // the mic immediately instead of recording with nobody listening.
      if (!startGuardRef.current.isCurrent(token)) {
        stream.getTracks().forEach((t) => t.stop())
        console.log('[Whisperio] Start superseded — released freshly acquired stream')
        return
      }
      console.log('[Whisperio] Got audio stream:', stream.getAudioTracks().length, 'tracks')
      streamRef.current = stream
      chunksRef.current = []
      recordingStartTimeRef.current = Date.now()

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      console.log('[Whisperio] Using mimeType:', mimeType)

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      recorder.onerror = (e) => {
        console.error('[Whisperio] MediaRecorder error:', e)
      }

      recorder.start(250)
      setIsRecording(true)
      console.log('[Whisperio] Recording started')
    } catch (err) {
      console.error('[Whisperio] Failed to start recording:', err)
      if (startGuardRef.current.isCurrent(token)) {
        stopTracks()
        await failStart(err instanceof Error ? err.message : String(err))
      }
    }
  }, [stopTracks])

  const startOutputRecording = useCallback(async (sessionId?: number) => {
    console.log('[Whisperio] startOutputRecording called (system audio)')
    const token = startGuardRef.current.begin()
    const prevRecorder = mediaRecorderRef.current
    if (prevRecorder && prevRecorder.state !== 'inactive') {
      try { prevRecorder.stop() } catch { /* already stopped */ }
    }
    stopTracks()
    const failStart = async (message: string): Promise<void> => {
      try { await window.api.dictation.sendResult('', sessionId) } catch { /* best effort */ }
      try { await window.api.dictation.reportError?.('System audio unavailable', message) } catch { /* best effort */ }
    }
    try {
      // Use getDisplayMedia to capture system audio (loopback)
      // The main process setDisplayMediaRequestHandler auto-selects the source
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: false
      } as MediaStreamConstraints)

      // Stopped/cancelled/superseded while the request was pending: release now.
      if (!startGuardRef.current.isCurrent(token)) {
        stream.getTracks().forEach((t) => t.stop())
        console.log('[Whisperio] Output start superseded — released freshly acquired stream')
        return
      }

      // We only need the audio tracks — drop any video tracks
      stream.getVideoTracks().forEach((t) => t.stop())

      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length === 0) {
        console.error('[Whisperio] No audio tracks in display media stream')
        await failStart('No system audio track was available.')
        return
      }
      console.log('[Whisperio] Got system audio stream:', audioTracks.length, 'tracks')

      // Create a new stream with only audio
      const audioStream = new MediaStream(audioTracks)
      streamRef.current = audioStream
      chunksRef.current = []
      recordingStartTimeRef.current = Date.now()

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const recorder = new MediaRecorder(audioStream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      recorder.onerror = (e) => {
        console.error('[Whisperio] MediaRecorder error (output):', e)
      }

      recorder.start(250)
      setIsRecording(true)
      console.log('[Whisperio] Output recording started')
    } catch (err) {
      console.error('[Whisperio] Failed to start output recording:', err)
      if (startGuardRef.current.isCurrent(token)) {
        stopTracks()
        await failStart(err instanceof Error ? err.message : String(err))
      }
    }
  }, [])

  const stopAndTranscribe = useCallback(async (sessionId?: number) => {
    console.log('[Whisperio] stopAndTranscribe called')
    // A start still awaiting getUserMedia must not begin recording after this.
    startGuardRef.current.invalidate()
    // Hoisted so the catch can mark a saved recording as failed instead of
    // leaving it stuck on 'pending' (rendered forever as "Processing...").
    let savedRecordingId: string | null = null
    try {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        console.warn('[Whisperio] No active recorder — sending empty result to reset state')
        setLastWordCount(null)
        await window.api.dictation.sendResult('', sessionId)
        return
      }

      const durationSec = Math.round((Date.now() - recordingStartTimeRef.current) / 1000)

      const audioBlob = await new Promise<Blob>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('[Whisperio] recorder.onstop timed out after 5s')
          stopTracks()
          reject(new Error('recorder.onstop timeout'))
        }, 5000)
        recorder.onstop = () => {
          clearTimeout(timeout)
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
          console.log(`[Whisperio] Audio blob: ${blob.size} bytes, type: ${blob.type}`)
          resolve(blob)
        }
        try {
          recorder.stop()
        } catch (err) {
          clearTimeout(timeout)
          reject(err)
        }
      })

      stopTracks()

      if (audioBlob.size < 1000) {
        console.warn('[Whisperio] Audio too short, sending empty result')
        setLastWordCount(null)
        await window.api.dictation.sendResult('', sessionId)
        return
      }

      console.log('[Whisperio] Sending to transcription via IPC...')
      const arrayBuffer = await audioBlob.arrayBuffer()

      // Save recording to disk before transcription — gated on the
      // 'Save recordings to disk' setting; transcription still happens either way.
      const settings = await window.api.settings.load()

      if (settings.saveRecordings) {
        try {
          const savedRecording = await window.api.recordings.save(
            arrayBuffer,
            { duration: durationSec, provider: settings.sttProvider }
          )
          savedRecordingId = savedRecording.id
          console.log(`[Whisperio] Recording saved: ${savedRecordingId}`)
        } catch (saveErr) {
          console.error('[Whisperio] Failed to save recording:', saveErr)
        }
      }

      // Silence gate runs AFTER the save above so a misjudged clip is never lost;
      // it only skips the upload/transcription. Opt-in, and only acts when the clip is
      // saved (otherwise a drop would lose the audio). Fails open on decode errors.
      if (
        shouldApplySilenceGate(settings.silenceGate, savedRecordingId !== null && savedRecordingId !== undefined) &&
        !(await recordingHasSpeech(arrayBuffer, settings.silenceGateThresholdDbfs))
      ) {
        console.warn('[Whisperio] Recording is silent — skipping transcription')
        setLastWordCount(null)
        if (savedRecordingId) {
          try {
            await window.api.recordings.update(savedRecordingId, {
              status: 'completed' as const,
              transcription: '',
              error: 'Silent — not transcribed'
            })
          } catch (updateErr) {
            console.error('[Whisperio] Failed to update recording:', updateErr)
          }
        }
        await window.api.dictation.sendResult('', sessionId, 'silent')
        return
      }

      // whisper.cpp (selfhosted) can't read webm, cloud providers want the small
      // original: always send the webm, plus a WAV only when selfhosted is in
      // the chain. Main picks the right one per provider (main/audioFormat.ts).
      const settings2 = await window.api.settings.load()
      const plan = planAudioFormats(settings2.providerChain)
      let wavBuffer: ArrayBuffer | null = null
      if (plan.needsWav) {
        try {
          wavBuffer = await webmToWav(arrayBuffer)
          console.log(`[Whisperio] Converted to wav: ${wavBuffer.byteLength} bytes`)
        } catch (convErr) {
          console.error('[Whisperio] webm→wav conversion failed, local model will be skipped:', convErr)
        }
      }
      // Optional trim of long leading/trailing silence (opt-in). Only replaces the
      // upload; the recording saved above stays the untrimmed original. The trimmed
      // 16 kHz WAV is uncompressed, so it is used only when it is smaller than the
      // original upload AND under the provider size cap; otherwise the original goes.
      let sendBuffer = arrayBuffer
      let sendFilename = 'audio.webm'
      if (settings.trimSilence === true) {
        const trimmedWav = await trimmedWavOrNull(arrayBuffer)
        if (trimmedWav && shouldUseTrimmed(arrayBuffer.byteLength, trimmedWav.byteLength, settings2.providerChain)) {
          console.log(`[Whisperio] Silence trimmed: ${arrayBuffer.byteLength} -> ${trimmedWav.byteLength} bytes (wav)`)
          sendBuffer = trimmedWav
          sendFilename = 'audio.wav'
          // The trimmed WAV also satisfies WAV-only providers (selfhosted).
          if (plan.needsWav) wavBuffer = trimmedWav
        } else if (trimmedWav) {
          console.log(`[Whisperio] Silence trim skipped: trimmed wav ${trimmedWav.byteLength} B not smaller than original ${arrayBuffer.byteLength} B or over provider cap`)
        }
      }
      const text = await window.api.dictation.transcribe(sendBuffer, sendFilename, wavBuffer)
      console.log(`[Whisperio] Transcription result: "${text}"`)

      // Real word count of the actual transcript — consumed by the overlay's
      // post-paste "done" confirmation (docs/design/wz-overlay.jsx phase 'done').
      const trimmed = text ? text.trim() : ''
      setLastWordCount(trimmed ? trimmed.split(/\s+/).filter(Boolean).length : null)

      // Update recording with successful transcription
      if (savedRecordingId) {
        try {
          await window.api.recordings.update(savedRecordingId, {
            status: 'completed' as const,
            transcription: text || ''
          })
        } catch (updateErr) {
          console.error('[Whisperio] Failed to update recording:', updateErr)
        }
      }

      await window.api.dictation.sendResult(text || '', sessionId)
    } catch (err) {
      console.error('[Whisperio] stopAndTranscribe error:', err)
      setLastWordCount(null)
      // Mark the saved recording as failed so the Recordings UI stops showing
      // it as "Processing..." forever, and surface the error text.
      if (savedRecordingId) {
        const message = err instanceof Error ? err.message : String(err)
        try {
          await window.api.recordings.update(savedRecordingId, {
            status: 'failed' as const,
            error: message
          })
        } catch (updateErr) {
          console.error('[Whisperio] Failed to mark recording as failed:', updateErr)
        }
      }
      try {
        await window.api.dictation.sendResult('', sessionId)
      } catch (sendErr) {
        console.error('[Whisperio] Failed to send empty result:', sendErr)
      }
    }
  }, [stopTracks])

  const cancelRecording = useCallback(() => {
    startGuardRef.current.invalidate()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    stopTracks()
    chunksRef.current = []
    setLastWordCount(null)
  }, [stopTracks])

  return { isRecording, lastWordCount, startRecording, startOutputRecording, stopAndTranscribe, cancelRecording }
}
