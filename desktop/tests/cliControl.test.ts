import { describe, it, expect, vi } from 'vitest'
import { parseCliCommand, dispatchCliCommand } from '../src/main/cliControl'

describe('parseCliCommand', () => {
  it('parses packaged argv shape', () => {
    expect(parseCliCommand(['C:\App\Whisperio.exe', '--toggle'])).toBe('toggle')
  })
  it('parses dev argv shape', () => {
    expect(parseCliCommand(['electron.exe', '.', '--stop'])).toBe('stop')
  })
  it.each(['toggle', 'start', 'stop', 'cancel', 'send'])('recognizes --%s', (c) => {
    expect(parseCliCommand(['x', `--${c}`])).toBe(c)
  })
  it('is case-insensitive', () => {
    expect(parseCliCommand(['x', '--TOGGLE'])).toBe('toggle')
  })
  it('ignores Chromium/Electron switches', () => {
    expect(parseCliCommand(['x', '--enable-features=x', '--no-sandbox', '--start'])).toBe('start')
    expect(parseCliCommand(['x', '--enable-features=toggle', '--toggle=1'])).toBeNull()
  })
  it('ignores unknown flags and paths that merely contain a flag', () => {
    expect(parseCliCommand(['x', '--foo', '/opt/--toggle/app'])).toBeNull()
  })
  it('first recognized flag wins', () => {
    expect(parseCliCommand(['x', '--cancel', '--toggle'])).toBe('cancel')
  })
  it('returns null for empty argv', () => {
    expect(parseCliCommand([])).toBeNull()
  })
})

describe('dispatchCliCommand', () => {
  it.each(['toggle', 'start', 'stop', 'cancel', 'send'] as const)('maps %s to api.%s only', (c) => {
    const api = { toggle: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), send: vi.fn() }
    dispatchCliCommand(c, api)
    for (const k of Object.keys(api) as (keyof typeof api)[]) {
      expect(api[k]).toHaveBeenCalledTimes(k === c ? 1 : 0)
    }
  })
})
