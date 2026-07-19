import { useRef, useCallback, useState } from 'react'

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
  startRecording: () => Promise<void>
  startOutputRecording: () => Promise<void>
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

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    setIsRecording(false)
  }, [])

  const startRecording = useCallback(async () => {
    console.log('[Whisperio] startRecording called')
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('[Whisperio] getUserMedia not available in this context')
        return
      }

      // Honor the user's selected input device (Settings > Audio > Input
      // Device). Previously this setting was saved/loaded by SettingsForm but
      // never actually consumed anywhere — picking a non-default mic silently
      // had no effect (caught by tests/settings-loop.spec.ts's P0.5 guard).
      // Empty string means "System Default": omit the constraint so
      // getUserMedia falls back to the OS default, matching prior behavior.
      const settings = await window.api.settings.load()
      const audioConstraints: MediaTrackConstraints = {
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
      if (settings.inputDeviceId) {
        audioConstraints.deviceId = { exact: settings.inputDeviceId }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      })
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
    }
  }, [])

  const startOutputRecording = useCallback(async () => {
    console.log('[Whisperio] startOutputRecording called (system audio)')
    try {
      // Use getDisplayMedia to capture system audio (loopback)
      // The main process setDisplayMediaRequestHandler auto-selects the source
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: false
      } as MediaStreamConstraints)

      // We only need the audio tracks — drop any video tracks
      stream.getVideoTracks().forEach((t) => t.stop())

      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length === 0) {
        console.error('[Whisperio] No audio tracks in display media stream')
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
    }
  }, [])

  const stopAndTranscribe = useCallback(async (sessionId?: number) => {
    console.log('[Whisperio] stopAndTranscribe called')
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

      // Convert webm to wav for selfhosted whisper.cpp (doesn't support webm)
      const settings2 = await window.api.settings.load()
      const chain = settings2.providerChain || []
      const needsWav = chain.includes('selfhosted')
      let sendBuffer = arrayBuffer
      let sendFilename = 'audio.webm'
      if (needsWav) {
        try {
          sendBuffer = await webmToWav(arrayBuffer)
          sendFilename = 'audio.wav'
          console.log(`[Whisperio] Converted to wav: ${sendBuffer.byteLength} bytes`)
        } catch (convErr) {
          console.error('[Whisperio] webm→wav conversion failed, sending webm:', convErr)
        }
      }
      const text = await window.api.dictation.transcribe(sendBuffer, sendFilename)
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
