// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { useDictation } from '../src/renderer/hooks/useDictation'

/**
 * PACZKA 2 (parity fix): useDictation's on-disk persistence must actually be
 * gated by settings.saveRecordings — before this fix, recordings.save() was
 * called unconditionally regardless of the toggle. Also covers removal of the
 * dead 'dictation:recording-started' notify call (no main-process handler
 * ever existed for it).
 *
 * Same convention as tests/RecordingsPanel.test.ts: a minimal `window.api`
 * test double, no JSX (plain function calls), real MediaRecorder/getUserMedia
 * fakes so the hook's actual start->stop->save/transcribe flow is exercised.
 */

class FakeMediaRecorder {
  static isTypeSupported(_type: string): boolean {
    return true
  }
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onstop: (() => void) | null = null

  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm'
  }

  start(_timeslice?: number): void {
    this.state = 'recording'
    // Simulate a data chunk large enough to pass the >=1000-byte size gate.
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)]) })
  }

  stop(): void {
    this.state = 'inactive'
    this.onstop?.()
  }
}

function fakeAudioStream(): MediaStream {
  const track = { stop: vi.fn() }
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => []
  } as unknown as MediaStream
}

function mockApi(overrides: { saveRecordings: boolean; inputDeviceId?: string; silenceGate?: boolean }): {
  save: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  transcribe: ReturnType<typeof vi.fn>
  sendResult: ReturnType<typeof vi.fn>
} {
  const save = vi.fn().mockResolvedValue({ id: 'rec-1' })
  const update = vi.fn().mockResolvedValue(null)
  const transcribe = vi.fn().mockResolvedValue('hello world')
  const sendResult = vi.fn().mockResolvedValue(undefined)

  const api = {
    dictation: {
      transcribe,
      sendResult
    },
    settings: {
      load: vi.fn().mockResolvedValue({
        saveRecordings: overrides.saveRecordings,
        silenceGate: overrides.silenceGate,
        sttProvider: 'openai',
        providerChain: [],
        inputDeviceId: overrides.inputDeviceId ?? ''
      })
    },
    recordings: {
      save,
      update
    }
  }
  // @ts-expect-error minimal test double — only the methods this hook calls are exercised
  window.api = api
  return { save, update, transcribe, sendResult }
}

beforeEach(() => {
  // @ts-expect-error jsdom doesn't implement MediaRecorder — fake it
  global.MediaRecorder = FakeMediaRecorder
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(fakeAudioStream()) },
    configurable: true
  })
})

afterEach(() => {
  cleanup()
  // @ts-expect-error test cleanup of the global test double
  delete window.api
})

describe('useDictation — saveRecordings gate', () => {
  it('does not call recordings.save when settings.saveRecordings is false', async () => {
    const { save, update, transcribe, sendResult } = mockApi({ saveRecordings: false })
    const { result } = renderHook(() => useDictation())

    await act(async () => {
      await result.current.startRecording()
    })
    await act(async () => {
      await result.current.stopAndTranscribe(7)
    })

    expect(save).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(transcribe).toHaveBeenCalled()
    expect(sendResult).toHaveBeenCalledWith('hello world', 7)
  })

  it('calls recordings.save with the expected args when settings.saveRecordings is true', async () => {
    const { save, update, sendResult } = mockApi({ saveRecordings: true })
    const { result } = renderHook(() => useDictation())

    await act(async () => {
      await result.current.startRecording()
    })
    await act(async () => {
      await result.current.stopAndTranscribe(9)
    })

    expect(save).toHaveBeenCalledTimes(1)
    const [audioData, metadata] = save.mock.calls[0]
    expect(audioData).toBeInstanceOf(ArrayBuffer)
    expect(metadata).toEqual({ duration: expect.any(Number), provider: 'openai' })
    expect(update).toHaveBeenCalledWith('rec-1', { status: 'completed', transcription: 'hello world' })
    expect(sendResult).toHaveBeenCalledWith('hello world', 9)
  })
})

/**
 * P0.5 (settings-loop guard) — settings.inputDeviceId used to be saved/loaded
 * by SettingsForm but never actually passed to getUserMedia, so picking a
 * non-default microphone silently had no effect. startRecording() now reads
 * it and forwards it as a `deviceId: { exact }` constraint when set.
 */
describe('useDictation — inputDeviceId constraint', () => {
  it('passes deviceId: { exact } to getUserMedia when settings.inputDeviceId is set', async () => {
    mockApi({ saveRecordings: false, inputDeviceId: 'mic-42' })
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useDictation())

    await act(async () => {
      await result.current.startRecording()
    })

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'mic-42' } })
    })
  })

  it('omits the deviceId constraint (System Default) when settings.inputDeviceId is empty', async () => {
    mockApi({ saveRecordings: false, inputDeviceId: '' })
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useDictation())

    await act(async () => {
      await result.current.startRecording()
    })

    const [{ audio }] = getUserMedia.mock.calls[0]
    expect(audio).not.toHaveProperty('deviceId')
  })
})

/** Silence gate: silent recordings are not uploaded; decode failure fails open. */
describe('useDictation — silenceGate', () => {
  function fakeAudioContext(samples: Float32Array | Error): void {
    class FakeCtx {
      decodeAudioData(): Promise<unknown> {
        if (samples instanceof Error) return Promise.reject(samples)
        return Promise.resolve({
          numberOfChannels: 1,
          sampleRate: 16000,
          getChannelData: () => samples
        })
      }
      close(): Promise<void> {
        return Promise.resolve()
      }
    }
    // @ts-expect-error test double
    global.AudioContext = FakeCtx
  }

  afterEach(() => {
    // @ts-expect-error cleanup of test double
    delete global.AudioContext
  })

  it('skips transcribe and sends an empty "silent" result for silent audio', async () => {
    fakeAudioContext(new Float32Array(16000))
    const { transcribe, sendResult } = mockApi({ saveRecordings: true, silenceGate: true })
    const { result } = renderHook(() => useDictation())
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopAndTranscribe(3) })
    expect(transcribe).not.toHaveBeenCalled()
    expect(sendResult).toHaveBeenCalledWith('', 3, 'silent')
  })

  it('still saves the recording before gating a silent clip', async () => {
    fakeAudioContext(new Float32Array(16000))
    const { save, update, transcribe } = mockApi({ saveRecordings: true, silenceGate: true })
    const { result } = renderHook(() => useDictation())
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopAndTranscribe(6) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(transcribe).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('rec-1', expect.objectContaining({ status: 'completed', transcription: '', error: 'Silent — not transcribed' }))
  })

  it('fails open (still transcribes) when decoding throws', async () => {
    fakeAudioContext(new Error('decode failed'))
    const { transcribe, sendResult } = mockApi({ saveRecordings: true, silenceGate: true })
    const { result } = renderHook(() => useDictation())
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopAndTranscribe(4) })
    expect(transcribe).toHaveBeenCalled()
    expect(sendResult).toHaveBeenCalledWith('hello world', 4)
  })

  it('does not gate (sends anyway) when recordings are not saved', async () => {
    fakeAudioContext(new Float32Array(16000))
    const { transcribe } = mockApi({ saveRecordings: false, silenceGate: true })
    const { result } = renderHook(() => useDictation())
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopAndTranscribe(7) })
    expect(transcribe).toHaveBeenCalled()
  })

  it('does not gate when silenceGate is off', async () => {
    fakeAudioContext(new Float32Array(16000))
    const { transcribe } = mockApi({ saveRecordings: false, silenceGate: false })
    const { result } = renderHook(() => useDictation())
    await act(async () => { await result.current.startRecording() })
    await act(async () => { await result.current.stopAndTranscribe(5) })
    expect(transcribe).toHaveBeenCalled()
  })
})

describe('useDictation — start race and device fallback', () => {
  it('releases the stream when stop arrives while getUserMedia is pending', async () => {
    const { sendResult } = mockApi({ saveRecordings: false })
    const stream = fakeAudioStream()
    let resolveGum!: (s: MediaStream) => void
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<MediaStream>((r) => { resolveGum = r })
    )
    const { result } = renderHook(() => useDictation())
    let startP!: Promise<void>
    await act(async () => { startP = result.current.startRecording() })
    await act(async () => { await result.current.stopAndTranscribe(3) })
    expect(sendResult).toHaveBeenCalledWith('', 3)
    await act(async () => { resolveGum(stream); await startP })
    expect(stream.getTracks()[0].stop).toHaveBeenCalled()
    expect(result.current.isRecording).toBe(false)
  })

  it('falls back to the default device when the selected one is gone', async () => {
    mockApi({ saveRecordings: false, inputDeviceId: 'gone' })
    const gum = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
    gum.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OverconstrainedError' }))
    const { result } = renderHook(() => useDictation())
    await act(async () => { await result.current.startRecording() })
    expect(gum).toHaveBeenCalledTimes(2)
    expect(gum.mock.calls[1][0].audio.deviceId).toBeUndefined()
    expect(result.current.isRecording).toBe(true)
  })

  it('reports an error and resets main when no mic can be opened', async () => {
    const { sendResult } = mockApi({ saveRecordings: false })
    const reportError = vi.fn().mockResolvedValue(undefined)
    ;(window.api.dictation as unknown as Record<string, unknown>).reportError = reportError
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    )
    const { result } = renderHook(() => useDictation())
    await act(async () => { await result.current.startRecording(9) })
    expect(reportError).toHaveBeenCalled()
    expect(sendResult).toHaveBeenCalledWith('', 9)
    expect(sendResult.mock.invocationCallOrder[0]).toBeLessThan(reportError.mock.invocationCallOrder[0])
  })

  it('releases the system-audio stream when stop arrives while getDisplayMedia is pending', async () => {
    mockApi({ saveRecordings: false })
    const stream = fakeAudioStream()
    let resolveGdm!: (s: MediaStream) => void
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      value: vi.fn().mockReturnValue(new Promise<MediaStream>((r) => { resolveGdm = r })),
      configurable: true
    })
    const { result } = renderHook(() => useDictation())
    let startP!: Promise<void>
    await act(async () => { startP = result.current.startOutputRecording(4) })
    await act(async () => { result.current.cancelRecording() })
    await act(async () => { resolveGdm(stream); await startP })
    expect(stream.getTracks()[0].stop).toHaveBeenCalled()
    expect(result.current.isRecording).toBe(false)
  })
})
