import { describe, it, expect } from 'vitest'
import { requestDeviceCode, pollForToken } from '../src/main/github/deviceFlow'
import type { HttpTransport, HttpRequest, HttpResponse } from '../src/main/github/httpTransport'

// Capturing mock transport — records requests and returns canned responses, so
// the device-flow logic is tested with no network / no Electron runtime (mirrors
// the mobile GitHubSyncTests MockTransport).
class MockTransport implements HttpTransport {
  public requests: HttpRequest[] = []
  constructor(private readonly responder: (req: HttpRequest) => HttpResponse) {}
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req)
    return this.responder(req)
  }
}

const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) })

describe('deviceFlow.requestDeviceCode', () => {
  it('POSTs client_id + scope and maps the response', async () => {
    const transport = new MockTransport(() =>
      ok({
        device_code: 'dev-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 899,
        interval: 5
      })
    )
    const code = await requestDeviceCode(transport, 'client-xyz')

    expect(code).toEqual({
      deviceCode: 'dev-123',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 899,
      interval: 5
    })
    const req = transport.requests[0]
    expect(req.method).toBe('POST')
    expect(req.url).toBe('https://github.com/login/device/code')
    const body = JSON.parse(String(req.body))
    expect(body.client_id).toBe('client-xyz')
    expect(body.scope).toBe('repo')
    expect(req.headers?.Accept).toBe('application/json')
  })

  it('defaults expires_in/interval when absent', async () => {
    const transport = new MockTransport(() =>
      ok({ device_code: 'd', user_code: 'u', verification_uri: 'https://x' })
    )
    const code = await requestDeviceCode(transport, 'c')
    expect(code.expiresIn).toBe(900)
    expect(code.interval).toBe(5)
  })

  it('throws on non-2xx', async () => {
    const transport = new MockTransport(() => ({ status: 500, body: 'boom' }))
    await expect(requestDeviceCode(transport, 'c')).rejects.toThrow(/HTTP 500/)
  })

  it('throws on missing required fields', async () => {
    const transport = new MockTransport(() => ok({ device_code: 'd' }))
    await expect(requestDeviceCode(transport, 'c')).rejects.toThrow(/missing required fields/)
  })

  it('throws on malformed JSON', async () => {
    const transport = new MockTransport(() => ({ status: 200, body: 'not-json' }))
    await expect(requestDeviceCode(transport, 'c')).rejects.toThrow(/malformed JSON/)
  })
})

describe('deviceFlow.pollForToken', () => {
  it('returns success with the token', async () => {
    const transport = new MockTransport(() =>
      ok({ access_token: 'gho_abc', token_type: 'bearer', scope: 'repo' })
    )
    const result = await pollForToken(transport, 'c', 'dev-1')
    expect(result).toEqual({ status: 'success', accessToken: 'gho_abc', tokenType: 'bearer', scope: 'repo' })

    const body = JSON.parse(String(transport.requests[0].body))
    expect(body.device_code).toBe('dev-1')
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code')
  })

  it('returns authorization_pending', async () => {
    const transport = new MockTransport(() => ok({ error: 'authorization_pending' }))
    expect(await pollForToken(transport, 'c', 'd')).toEqual({ status: 'authorization_pending' })
  })

  it('returns slow_down with the new interval', async () => {
    const transport = new MockTransport(() => ok({ error: 'slow_down', interval: 12 }))
    expect(await pollForToken(transport, 'c', 'd')).toEqual({ status: 'slow_down', interval: 12 })
  })

  it('returns expired_token', async () => {
    const transport = new MockTransport(() => ok({ error: 'expired_token' }))
    expect(await pollForToken(transport, 'c', 'd')).toEqual({ status: 'expired_token' })
  })

  it('returns access_denied', async () => {
    const transport = new MockTransport(() => ok({ error: 'access_denied' }))
    expect(await pollForToken(transport, 'c', 'd')).toEqual({ status: 'access_denied' })
  })

  it('throws on an unknown error code', async () => {
    const transport = new MockTransport(() => ok({ error: 'something_else' }))
    await expect(pollForToken(transport, 'c', 'd')).rejects.toThrow(/something_else/)
  })

  it('throws on non-2xx', async () => {
    const transport = new MockTransport(() => ({ status: 400, body: '{}' }))
    await expect(pollForToken(transport, 'c', 'd')).rejects.toThrow(/HTTP 400/)
  })
})
