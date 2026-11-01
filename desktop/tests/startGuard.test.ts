import { describe, it, expect } from 'vitest'
import {
  StartGuard,
  isDeviceGoneError,
  decideAfterGetUserMediaFailure
} from '../src/renderer/audio/startGuard'

describe('StartGuard', () => {
  it('a fresh token is current', () => {
    const g = new StartGuard()
    expect(g.isCurrent(g.begin())).toBe(true)
  })
  it('invalidate() supersedes an in-flight start (stop/cancel while starting)', () => {
    const g = new StartGuard()
    const t = g.begin()
    g.invalidate()
    expect(g.isCurrent(t)).toBe(false)
  })
  it('a newer begin() supersedes the older start', () => {
    const g = new StartGuard()
    const a = g.begin()
    const b = g.begin()
    expect(g.isCurrent(a)).toBe(false)
    expect(g.isCurrent(b)).toBe(true)
  })
  it('a start after invalidate gets a current token', () => {
    const g = new StartGuard()
    g.begin()
    g.invalidate()
    expect(g.isCurrent(g.begin())).toBe(true)
  })
})

describe('device fallback decision', () => {
  const err = (name: string) => Object.assign(new Error(name), { name })
  it('detects gone-device errors', () => {
    expect(isDeviceGoneError(err('OverconstrainedError'))).toBe(true)
    expect(isDeviceGoneError(err('NotFoundError'))).toBe(true)
    expect(isDeviceGoneError(err('NotAllowedError'))).toBe(false)
    expect(isDeviceGoneError(null)).toBe(false)
    expect(isDeviceGoneError(undefined)).toBe(false)
  })
  it('retries with default only when a specific device was used and is gone', () => {
    expect(decideAfterGetUserMediaFailure(err('OverconstrainedError'), true)).toBe('retry-default')
    expect(decideAfterGetUserMediaFailure(err('NotFoundError'), true)).toBe('retry-default')
  })
  it('reports when default device already used or error is unrelated', () => {
    expect(decideAfterGetUserMediaFailure(err('NotFoundError'), false)).toBe('report')
    expect(decideAfterGetUserMediaFailure(err('NotAllowedError'), true)).toBe('report')
  })
})
