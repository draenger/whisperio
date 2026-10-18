import { describe, it, expect, vi } from 'vitest'
import { checkRedirect, guardRedirects } from '../src/main/llm/redirectGuard'

describe('checkRedirect', () => {
  it('allows same-host https', () => {
    expect(checkRedirect('https://api.example.com/a', 'https://api.example.com/b')).toBeNull()
  })
  it('allows same-host http -> https upgrade', () => {
    expect(checkRedirect('http://192.168.1.5/a', 'https://192.168.1.5/a')).toBeNull()
  })
  it('allows local http -> local http on the same host', () => {
    expect(checkRedirect('http://localhost:8080/a', 'http://localhost:8080/b')).toBeNull()
  })
  it('refuses https -> http downgrade on a public host', () => {
    expect(checkRedirect('https://api.example.com/a', 'http://api.example.com/a')).toMatch(/insecure/)
  })
  it('refuses a downgrade to a public http host from a private https one', () => {
    expect(checkRedirect('https://nas.local/a', 'http://public.example.com/a')).toMatch(/insecure/)
  })
  it('refuses a cross-host https redirect (credentials would follow)', () => {
    expect(checkRedirect('https://api.example.com/a', 'https://evil.example.org/a')).toMatch(/different host/)
  })
  it('refuses non-http protocols and garbage', () => {
    expect(checkRedirect('https://a.com/', 'file:///etc/passwd')).not.toBeNull()
    expect(checkRedirect('https://a.com/', 'not a url')).toMatch(/invalid/)
  })
})

describe('guardRedirects', () => {
  function fakeRequest() {
    let handler: ((s: number, m: string, u: string) => void) | undefined
    return {
      on: vi.fn((_e: 'redirect', h: (s: number, m: string, u: string) => void) => { handler = h }),
      abort: vi.fn(),
      followRedirect: vi.fn(),
      fire: (u: string) => handler!(302, 'GET', u)
    }
  }
  it('aborts and reports a blocked redirect', () => {
    const req = fakeRequest()
    const onBlocked = vi.fn()
    guardRedirects(req, 'https://api.example.com/x', onBlocked)
    req.fire('http://api.example.com/x')
    expect(req.abort).toHaveBeenCalledTimes(1)
    expect(req.followRedirect).not.toHaveBeenCalled()
    expect(onBlocked).toHaveBeenCalledTimes(1)
    expect(onBlocked.mock.calls[0][0].message).toMatch(/Blocked redirect/)
  })
  it('lets a safe redirect through and tracks the new location', () => {
    const req = fakeRequest()
    const onBlocked = vi.fn()
    guardRedirects(req, 'https://api.example.com/x', onBlocked)
    req.fire('https://api.example.com/y')
    expect(req.abort).not.toHaveBeenCalled()
    expect(req.followRedirect).toHaveBeenCalledTimes(1)
    // second hop is checked against the new URL, still same host
    req.fire('https://api.example.com/z')
    expect(req.abort).not.toHaveBeenCalled()
    expect(req.followRedirect).toHaveBeenCalledTimes(2)
    expect(onBlocked).not.toHaveBeenCalled()
  })
})
