import { vi } from 'vitest'

// A controllable stand-in for Electron's `net.request` ClientRequest.
//
// The existing per-file `createMockNetRequest(status, body)` helpers only ever
// play the happy "response -> data -> end" sequence. The fail-soft paths in the
// STT providers (request 'error', response 'error', a blocked 'redirect', the
// 45s timeout, and the "late second event after settle" guard) need a request
// whose event sequence the test scripts. `script` runs in a microtask right
// after the code under test calls `request.end()`; leave it empty to simulate a
// request that never answers (timeout tests, with fake timers).

type Listener = (...args: unknown[]) => void

export interface ScriptedResponse {
  statusCode: number
  emit(event: string, ...args: unknown[]): void
}

export interface ScriptController {
  /** Emit an event on the request itself ('error', 'redirect', ...). */
  emitRequest(event: string, ...args: unknown[]): void
  /** Deliver a response object (no data/end yet); returns it for manual events. */
  response(statusCode: number): ScriptedResponse
  /** Deliver a full response: 'response', then one 'data' chunk, then 'end'. */
  respond(statusCode: number, body: string): ScriptedResponse
}

export function scriptedNetRequest(script: (ctl: ScriptController) => void = () => {}) {
  const requestListeners: Record<string, Listener[]> = {}

  const emitRequest = (event: string, ...args: unknown[]): void => {
    for (const h of requestListeners[event] || []) h(...args)
  }

  const response = (statusCode: number): ScriptedResponse => {
    const responseListeners: Record<string, Listener[]> = {}
    const res = {
      statusCode,
      on(event: string, handler: Listener) {
        ;(responseListeners[event] ||= []).push(handler)
        return res
      },
      emit(event: string, ...args: unknown[]) {
        for (const h of responseListeners[event] || []) h(...args)
      }
    }
    emitRequest('response', res)
    return res
  }

  const respond = (statusCode: number, body: string): ScriptedResponse => {
    const res = response(statusCode)
    res.emit('data', Buffer.from(body))
    res.emit('end')
    return res
  }

  const request = {
    setHeader: vi.fn(),
    write: vi.fn(),
    abort: vi.fn(),
    followRedirect: vi.fn(),
    end: vi.fn(() => {
      queueMicrotask(() => script({ emitRequest, response, respond }))
    }),
    on(event: string, handler: Listener) {
      ;(requestListeners[event] ||= []).push(handler)
      return request
    }
  }
  return request
}
