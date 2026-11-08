import { useEffect } from 'react'
import { UtteranceSegmenter, type Utterance } from '../../shared/continuous/utteranceSegmenter'
import { encodeWavMono16 } from '../audio/silenceTrim'

interface ContinuousConfig {
  continuousSilenceMs: number
  continuousMinUtteranceMs: number
  continuousThresholdDbfs: number
}

interface Session {
  stream: MediaStream
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  segmenter: UtteranceSegmenter
  /** performance.now() until which mic chunks are dropped (echo guard). */
  ignoreUntil: number
  closed: boolean
}

/**
 * Hands-free mic capture. Mounted in the overlay window (the window that owns the
 * mic). Main sends 'continuous:start' / 'continuous:stop'; while running, mono
 * chunks feed an UtteranceSegmenter and each finished utterance is sent as a
 * 16-bit WAV to main for transcription + paste. The stream is kept open for the
 * whole session (Bluetooth HFP headsets stay in headset mode, by design).
 */
export function useContinuousDictation(): void {
  useEffect(() => {
    let session: Session | null = null
    let startToken = 0

    const sendUtterance = (u: Utterance, sampleRate: number): void => {
      const wav = encodeWavMono16(u.samples, sampleRate)
      void window.api.continuous.transcribe(wav, u.durationMs).catch((err) => {
        console.warn('[Whisperio] continuous transcribe failed:', err instanceof Error ? err.message : err)
      })
    }

    const stopSession = (): void => {
      startToken++
      const s = session
      session = null
      if (!s) return
      s.closed = true
      try { s.processor.onaudioprocess = null } catch { /* ignore */ }
      try { s.source.disconnect() } catch { /* ignore */ }
      try { s.processor.disconnect() } catch { /* ignore */ }
      s.stream.getTracks().forEach((t) => t.stop())
      s.ctx.close().catch(() => {})
    }

    const startSession = async (cfg: ContinuousConfig): Promise<void> => {
      stopSession()
      const token = ++startToken
      try {
        const settings = await window.api.settings.load()
        const base: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true }
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: settings.inputDeviceId ? { ...base, deviceId: { exact: settings.inputDeviceId } } : base
          })
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: base })
        }
        if (token !== startToken) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        // ScriptProcessor rather than AudioWorklet: no extra worklet module/CSP
        // plumbing, and chunk handling here is trivially cheap.
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        const segmenter = new UtteranceSegmenter({
          sampleRate: ctx.sampleRate,
          thresholdDbfs: cfg.continuousThresholdDbfs,
          silenceMs: cfg.continuousSilenceMs,
          minUtteranceMs: cfg.continuousMinUtteranceMs
        })
        const s: Session = { stream, ctx, source, processor, segmenter, ignoreUntil: 0, closed: false }
        processor.onaudioprocess = (ev): void => {
          if (s.closed) return
          if (performance.now() < s.ignoreUntil) {
            // Echo guard: drop the chunk and any half-built utterance so our own
            // paste / TTS output never becomes speech.
            s.segmenter.reset()
            return
          }
          const chunk = new Float32Array(ev.inputBuffer.getChannelData(0)) // copy: the buffer is reused
          for (const u of s.segmenter.push(chunk)) sendUtterance(u, ctx.sampleRate)
        }
        source.connect(processor)
        // A ScriptProcessor only runs when connected to a destination; its output is silent.
        processor.connect(ctx.destination)
        session = s
      } catch (err) {
        console.error('[Whisperio] continuous start failed:', err)
        try {
          await window.api.dictation.reportError?.(
            'Tryb ciągły: mikrofon niedostępny',
            err instanceof Error ? err.message : String(err)
          )
        } catch { /* best effort */ }
      }
    }

    const offStart = window.api.continuous.onStart((cfg) => void startSession(cfg))
    const offStop = window.api.continuous.onStop(stopSession)
    const offState = window.api.continuous.onState((st) => {
      if (session && st.echoGuardMs && st.echoGuardMs > 0) {
        session.ignoreUntil = performance.now() + st.echoGuardMs
        session.segmenter.reset()
      }
    })
    return () => {
      offStart()
      offStop()
      offState()
      stopSession()
    }
  }, [])
}
