import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true },
  net: { request: vi.fn() },
  Notification: class MockNotification {
    static isSupported = () => false
    show = vi.fn()
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

const mockHandleError = vi.fn()
vi.mock('../src/main/errorHandler', () => ({
  handleTranscriptionError: (...args: unknown[]) => mockHandleError(...args)
}))

import {
  assemblyAITranscribe,
  assemblyAITranscribeDiarized,
  DEFAULT_ASSEMBLYAI_MODEL
} from '../src/main/llm/assembly'

const KEY = 'aai-SECRET-KEY-98765'
const BASE = 'https://api.assemblyai.com/v2'

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  } as unknown as Response
}

type Call = { url: string; init: RequestInit }
let fetchMock: ReturnType<typeof vi.fn>
const calls = (): Call[] =>
  fetchMock.mock.calls.map((c) => ({ url: c[0] as string, init: c[1] as RequestInit }))

// Queue: upload ok, job created, then given poll responses.
function queueFlow(...polls: Response[]) {
  fetchMock
    .mockResolvedValueOnce(res({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }))
    .mockResolvedValueOnce(res({ id: 'job-1', status: 'queued' }))
  for (const p of polls) fetchMock.mockResolvedValueOnce(p)
}

// Await a call to completion while advancing fake poll timers.
async function run<T>(p: Promise<T>, ms = 60_000): Promise<T> {
  p.catch(() => {})
  await vi.advanceTimersByTimeAsync(ms)
  return p
}

function setup() {
  vi.clearAllMocks()
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
}
function teardown() {
  vi.useRealTimers()
  vi.unstubAllGlobals()
}

describe('assemblyAITranscribe', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('runs upload -> submit -> poll and returns the transcript', async () => {
    queueFlow(res({ status: 'processing' }), res({ status: 'completed', text: 'hello world' }))
    const out = await run(assemblyAITranscribe(KEY, Buffer.from('audio'), 'universal', 'en'))
    expect(out).toBe('hello world')
    expect(calls().map((x) => `${x.init.method} ${x.url}`)).toEqual([
      `POST ${BASE}/upload`,
      `POST ${BASE}/transcript`,
      `GET ${BASE}/transcript/job-1`,
      `GET ${BASE}/transcript/job-1`
    ])
  })

  it('uploads the raw audio buffer as octet-stream', async () => {
    queueFlow(res({ status: 'completed', text: 'x' }))
    const audio = Buffer.from('raw-bytes')
    await run(assemblyAITranscribe(KEY, audio, 'universal'))
    const up = calls()[0]
    expect(up.init.body).toBe(audio)
    expect(up.init.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' })
  })

  it('sends the raw API key in the authorization header on every step, never in a URL', async () => {
    queueFlow(res({ status: 'completed', text: 'x' }))
    await run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))
    expect(calls()).toHaveLength(3)
    for (const c of calls()) {
      expect((c.init.headers as Record<string, string>).authorization).toBe(KEY)
      expect(c.url).not.toContain(KEY)
    }
  })

  it('submits the uploaded URL, model and explicit language code as JSON', async () => {
    queueFlow(res({ status: 'completed', text: 'x' }))
    await run(assemblyAITranscribe(KEY, Buffer.from('a'), 'slam-1', 'pl'))
    const submit = calls()[1]
    expect((submit.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(submit.init.body as string)).toEqual({
      audio_url: 'https://cdn.assemblyai.com/upload/abc',
      speech_model: 'slam-1',
      language_code: 'pl'
    })
  })

  it('uses language detection (no language_code) for auto/empty language', async () => {
    queueFlow(res({ status: 'completed', text: 'x' }))
    await run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal', 'auto'))
    const body = JSON.parse(calls()[1].init.body as string)
    expect(body.language_detection).toBe(true)
    expect(body).not.toHaveProperty('language_code')
    expect(body).not.toHaveProperty('speaker_labels')

    fetchMock.mockReset()
    queueFlow(res({ status: 'completed', text: 'x' }))
    await run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal', ''))
    expect(JSON.parse(calls()[1].init.body as string).language_detection).toBe(true)
  })

  it('falls back to the default model for blank input', async () => {
    queueFlow(res({ status: 'completed', text: 'x' }))
    await run(assemblyAITranscribe(KEY, Buffer.from('a'), '   '))
    expect(JSON.parse(calls()[1].init.body as string).speech_model).toBe(DEFAULT_ASSEMBLYAI_MODEL)
  })

  it('never follows redirects and sets an abort signal on every request', async () => {
    queueFlow(res({ status: 'completed', text: 'x' }))
    await run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))
    for (const c of calls()) {
      expect(c.init.redirect).toBe('error')
      expect(c.init.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('waits 2s between polls', async () => {
    queueFlow(res({ status: 'queued' }), res({ status: 'completed', text: 'ok' }))
    const p = assemblyAITranscribe(KEY, Buffer.from('a'), 'universal')
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(2) // upload + submit only, no poll yet
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(p).resolves.toBe('ok')
  })

  it('returns an empty string for a completed job with empty text', async () => {
    queueFlow(res({ status: 'completed', text: '' }))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).resolves.toBe('')
  })

  it('throws when a completed job carries no text', async () => {
    queueFlow(res({ status: 'completed' }))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI returned no transcript.'
    )
  })

  it('surfaces a job status=error with the provider message', async () => {
    queueFlow(res({ status: 'error', error: 'Audio file is corrupt' }))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI failed: Audio file is corrupt'
    )
    expect(mockHandleError).toHaveBeenCalledWith(expect.any(Error), 'assemblyai')
  })

  it('uses "unknown error" when status=error has no message', async () => {
    queueFlow(res({ status: 'error' }))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI failed: unknown error'
    )
  })

  it('times out after 150 polls (~5 min) of a job that never settles', async () => {
    fetchMock
      .mockResolvedValueOnce(res({ upload_url: 'https://cdn/u' }))
      .mockResolvedValueOnce(res({ id: 'job-1' }))
      .mockResolvedValue(res({ status: 'processing' }))
    const p = assemblyAITranscribe(KEY, Buffer.from('a'), 'universal')
    const assertion = expect(p).rejects.toThrow('AssemblyAI timed out waiting for the transcript.')
    await vi.advanceTimersByTimeAsync(150 * 2_000 + 1_000)
    await assertion
    expect(calls().filter((c) => c.init.method === 'GET')).toHaveLength(150)
    expect(mockHandleError).toHaveBeenCalledWith(expect.any(Error), 'assemblyai')
  })

  it('throws when upload returns no upload_url, without submitting a job', async () => {
    fetchMock.mockResolvedValueOnce(res({}))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI upload did not return an upload_url.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when the job response has no id, without polling', async () => {
    fetchMock.mockResolvedValueOnce(res({ upload_url: 'https://cdn/u' })).mockResolvedValueOnce(res({}))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI did not return a transcript job id.'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([401, 429, 500, 503])('maps upload HTTP %i to "AssemblyAI upload error <status>"', async (status) => {
    fetchMock.mockResolvedValueOnce(res({ error: 'x' }, status))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      `AssemblyAI upload error ${status}`
    )
    expect(mockHandleError).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('labels HTTP errors with the failing step (transcript, status)', async () => {
    fetchMock.mockResolvedValueOnce(res({ upload_url: 'https://cdn/u' })).mockResolvedValueOnce(res({}, 429))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI transcript error 429'
    )

    fetchMock.mockReset()
    queueFlow(res({}, 500))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI status error 500'
    )
  })

  it('rejects with a parse error on a non-JSON 200 response', async () => {
    fetchMock.mockResolvedValueOnce(res('<html>nope</html>'))
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'Failed to parse AssemblyAI upload response (HTTP 200)'
    )
  })

  it('propagates and reports network errors unchanged', async () => {
    const netErr = new TypeError('fetch failed')
    fetchMock.mockRejectedValueOnce(netErr)
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toBe(netErr)
    expect(mockHandleError).toHaveBeenCalledWith(netErr, 'assemblyai')
  })

  it('wraps a non-Error rejection in an Error', async () => {
    fetchMock.mockRejectedValueOnce('boom')
    await expect(run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow('boom')
  })

  it('aborts a request that hangs past the 30s request timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_u: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const p = assemblyAITranscribe(KEY, Buffer.from('a'), 'universal')
    const assertion = expect(p).rejects.toThrow('aborted')
    await vi.advanceTimersByTimeAsync(29_999)
    expect((calls()[0].init.signal as AbortSignal).aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await assertion
    expect((calls()[0].init.signal as AbortSignal).aborted).toBe(true)
  })

  it('keeps the API key out of every error message and log', async () => {
    const logs: string[] = []
    const spies = (['log', 'error', 'warn', 'info'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logs.push(a.map(String).join(' '))
      })
    )
    const messages: string[] = []
    const scenarios: Array<() => void> = [
      () => fetchMock.mockResolvedValueOnce(res({ error: 'bad key' }, 401)),
      () => fetchMock.mockResolvedValueOnce(res('garbage')),
      () => fetchMock.mockRejectedValueOnce(new Error('socket hang up')),
      () => fetchMock.mockResolvedValueOnce(res({})),
      () => queueFlow(res({ status: 'error', error: 'decode failed' })),
      () => queueFlow(res({ status: 'completed' }))
    ]
    for (const prime of scenarios) {
      fetchMock.mockReset()
      prime()
      try {
        await run(assemblyAITranscribe(KEY, Buffer.from('a'), 'universal', 'en'))
      } catch (e) {
        messages.push((e as Error).message)
      }
    }
    spies.forEach((s) => s.mockRestore())
    expect(messages).toHaveLength(scenarios.length)
    for (const m of messages) expect(m).not.toContain(KEY)
    for (const c of mockHandleError.mock.calls) expect((c[0] as Error).message).not.toContain(KEY)
    for (const l of logs) expect(l).not.toContain(KEY)
  })
})

describe('assemblyAITranscribeDiarized', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('requests speaker_labels and maps utterances (ms -> s, lowercased speaker)', async () => {
    queueFlow(
      res({
        status: 'completed',
        text: 'fallback',
        utterances: [
          { speaker: 'A', text: ' Hello ', start: 0, end: 1500 },
          { speaker: 'B', text: '  ', start: 1500, end: 2000 },
          { speaker: 'B', text: 'Hi', start: 2000, end: 3000 }
        ]
      })
    )
    const r = await run(assemblyAITranscribeDiarized(KEY, Buffer.from('a'), 'universal', 'en'))
    expect(JSON.parse(calls()[1].init.body as string).speaker_labels).toBe(true)
    expect(r.segments).toEqual([
      { speaker: 'speaker_a', start: 0, end: 1.5, text: 'Hello' },
      { speaker: 'speaker_b', start: 2, end: 3, text: 'Hi' }
    ])
    expect(r.text).toBe('Hello Hi')
  })

  it('falls back to the plain transcript when utterances are missing', async () => {
    queueFlow(res({ status: 'completed', text: 'plain' }))
    await expect(run(assemblyAITranscribeDiarized(KEY, Buffer.from('a'), 'universal'))).resolves.toEqual({
      segments: [],
      text: 'plain'
    })
  })

  it('propagates job errors', async () => {
    queueFlow(res({ status: 'error', error: 'nope' }))
    await expect(run(assemblyAITranscribeDiarized(KEY, Buffer.from('a'), 'universal'))).rejects.toThrow(
      'AssemblyAI failed: nope'
    )
  })
})
