import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { scriptedNetRequest } from './helpers/scriptedNetRequest'

// Fail-soft / error-path coverage for the two fixed-endpoint multipart STT
// clients (llm/groq.ts, llm/mistral.ts). Their happy path and request shape
// are covered by groq.test.ts / mistral.test.ts; this file covers what those
// cannot reach with a happy-path-only mock: the 45s timeout, request- and
// response-level 'error' events, a blocked cross-host redirect, the
// settle-once guard, and isDev() in packaged / throwing-app states.

const mockNetRequest = vi.fn()
const appState = { packaged: false, throwOnRead: false }
vi.mock('electron', () => ({
  net: { request: (...args: unknown[]) => mockNetRequest(...args) },
  app: {
    get isPackaged() {
      if (appState.throwOnRead) throw new Error('app not ready')
      return appState.packaged
    }
  }
}))

const mockRecordError = vi.fn()
vi.mock('../src/main/errorHandler', () => ({
  recordTranscriptionError: (...args: unknown[]) => mockRecordError(...args)
}))

import { groqTranscribe } from '../src/main/llm/groq'
import { mistralTranscribe } from '../src/main/llm/mistral'

const PROVIDERS = [
  { id: 'groq', label: 'Groq', fn: groqTranscribe, url: 'https://api.groq.com/openai/v1/audio/transcriptions' },
  { id: 'mistral', label: 'Mistral', fn: mistralTranscribe, url: 'https://api.mistral.ai/v1/audio/transcriptions' }
] as const

const call = (fn: (typeof PROVIDERS)[number]['fn']) =>
  fn('key', Buffer.from('audio'), 'a.webm', '', '', 'auto')

describe.each(PROVIDERS)('$id STT client fail-soft paths', ({ id, label, fn, url }) => {
  beforeEach(() => {
    vi.clearAllMocks()
    appState.packaged = false
    appState.throwOnRead = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects, aborts and records the error when the request never answers within 45s', async () => {
    vi.useFakeTimers()
    const req = scriptedNetRequest() // never responds
    mockNetRequest.mockReturnValue(req)

    const p = call(fn)
    const assertion = expect(p).rejects.toThrow(`${label} transcription request timed out after 45s`)
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion

    expect(req.abort).toHaveBeenCalledTimes(1)
    expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), id)
  })

  it('does not time out early (just under 45s it is still pending)', async () => {
    vi.useFakeTimers()
    const req = scriptedNetRequest()
    mockNetRequest.mockReturnValue(req)
    let settled = false
    const p = call(fn).then(
      () => (settled = true),
      () => (settled = true)
    )
    await vi.advanceTimersByTimeAsync(44_999)
    expect(settled).toBe(false)
    expect(req.abort).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(settled).toBe(true)
  })

  it('rejects with the network error on a request-level error (offline)', async () => {
    const netErr = new Error('net::ERR_INTERNET_DISCONNECTED')
    mockNetRequest.mockReturnValue(scriptedNetRequest((ctl) => ctl.emitRequest('error', netErr)))

    await expect(call(fn)).rejects.toBe(netErr)
    expect(mockRecordError).toHaveBeenCalledWith(netErr, id)
  })

  it('rejects with the stream error on a response-level error', async () => {
    const streamErr = new Error('stream reset')
    mockNetRequest.mockReturnValue(
      scriptedNetRequest((ctl) => ctl.response(200).emit('error', streamErr))
    )

    await expect(call(fn)).rejects.toBe(streamErr)
    expect(mockRecordError).toHaveBeenCalledWith(streamErr, id)
  })

  it('blocks a redirect to another host, aborts, and never follows it', async () => {
    const req = scriptedNetRequest((ctl) =>
      ctl.emitRequest('redirect', 302, 'POST', 'https://evil.example.com/steal')
    )
    mockNetRequest.mockReturnValue(req)

    await expect(call(fn)).rejects.toThrow(/Blocked redirect: redirect to a different host/)
    expect(req.abort).toHaveBeenCalled()
    expect(req.followRedirect).not.toHaveBeenCalled()
    expect(mockRecordError).toHaveBeenCalledWith(expect.any(Error), id)
  })

  it('follows a same-host https redirect and then resolves normally', async () => {
    const req = scriptedNetRequest((ctl) => {
      ctl.emitRequest('redirect', 307, 'POST', url + '?v=2')
      ctl.respond(200, JSON.stringify({ text: 'after redirect' }))
    })
    mockNetRequest.mockReturnValue(req)

    await expect(call(fn)).resolves.toBe('after redirect')
    expect(req.followRedirect).toHaveBeenCalledTimes(1)
  })

  it('settles only once: a late request error after an HTTP error is ignored', async () => {
    const lateErr = new Error('late socket error')
    mockNetRequest.mockReturnValue(
      scriptedNetRequest((ctl) => {
        ctl.respond(500, 'boom')
        ctl.emitRequest('error', lateErr)
      })
    )

    await expect(call(fn)).rejects.toThrow(`${label} API error 500`)
    // Both events are recorded, but the promise keeps the FIRST outcome.
    expect(mockRecordError).toHaveBeenCalledTimes(2)
  })

  it('settles only once: a late error after a successful response is ignored', async () => {
    mockNetRequest.mockReturnValue(
      scriptedNetRequest((ctl) => {
        ctl.respond(200, JSON.stringify({ text: 'ok' }))
        ctl.emitRequest('error', new Error('late'))
      })
    )
    await expect(call(fn)).resolves.toBe('ok')
  })

  it('does not log the provider error body in packaged (production) builds', async () => {
    appState.packaged = true
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockNetRequest.mockReturnValue(scriptedNetRequest((ctl) => ctl.respond(401, 'secret-body')))

    await expect(call(fn)).rejects.toThrow(`${label} API error 401`)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('treats an unreadable app.isPackaged as production (no body logged)', async () => {
    appState.throwOnRead = true
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockNetRequest.mockReturnValue(scriptedNetRequest((ctl) => ctl.respond(403, 'secret-body')))

    await expect(call(fn)).rejects.toThrow(`${label} API error 403`)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('logs the provider error body in dev builds without leaking it into the Error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockNetRequest.mockReturnValue(scriptedNetRequest((ctl) => ctl.respond(429, 'rate-limited-body')))

    const err = await call(fn).catch((e: Error) => e)
    expect((err as Error).message).toBe(`${label} API error 429`)
    expect((err as Error).message).not.toContain('rate-limited-body')
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('rate-limited-body'))
  })

  it('assembles a multi-chunk response body before parsing', async () => {
    mockNetRequest.mockReturnValue(
      scriptedNetRequest((ctl) => {
        const res = ctl.response(200)
        res.emit('data', Buffer.from('{"text":"hel'))
        res.emit('data', Buffer.from('lo"}'))
        res.emit('end')
      })
    )
    await expect(call(fn)).resolves.toBe('hello')
  })
})
