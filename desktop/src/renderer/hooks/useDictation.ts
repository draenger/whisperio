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
  startRecording: () => Promise<void>
  startOutputRecording: () => Promise<void>
  stopAndTranscribe: () => Promise<void>
  cancelRecording: () => void
}

export function useDictation(): UseDictationReturn {
  const [isRecording, setIsRecording] = useState(false)
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

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
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
      // Notify main process so it can restore focus to the target window
      window.api.dictation.notifyRecordingStarted()
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
      window.api.dictation.notifyRecordingStarted()
    } catch (err) {
      console.error('[Whisperio] Failed to start output recording:', err)
    }
  }, [])

  const stopAndTranscribe = useCallback(async () => {
    console.log('[Whisperio] stopAndTranscribe called')
    try {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        console.warn('[Whisperio] No active recorder — sending empty result to reset state')
        await window.api.dictation.sendResult('')
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
        await window.api.dictation.sendResult('')
        return
      }

      console.log('[Whisperio] Sending to transcription via IPC...')
      const arrayBuffer = await audioBlob.arrayBuffer()

      // Save recording to disk before transcription
      let savedRecordingId: string | null = null
      try {
        const settings = await window.api.settings.load()
        const savedRecording = await window.api.recordings.save(
          arrayBuffer,
          { duration: durationSec, provider: settings.sttProvider }
        )
        savedRecordingId = savedRecording.id
        console.log(`[Whisperio] Recording saved: ${savedRecordingId}`)
      } catch (saveErr) {
        console.error('[Whisperio] Failed to save recording:', saveErr)
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

      await window.api.dictation.sendResult(text || '')
    } catch (err) {
      console.error('[Whisperio] stopAndTranscribe error:', err)
      try {
        await window.api.dictation.sendResult('')
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
  }, [stopTracks])

  return { isRecording, startRecording, startOutputRecording, stopAndTranscribe, cancelRecording }
}
