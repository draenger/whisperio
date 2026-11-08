import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ send: vi.fn(), load: vi.fn(() => ({}) as Record<string, unknown>) }))
vi.mock('../src/main/dictation/overlayWindow', () => ({ sendToPrimaryOverlay: h.send }))
vi.mock('../src/main/settingsManager', () => ({ loadSettings: h.load }))

import { playCue } from '../src/main/dictation/buttonCues'

describe('playCue', () => {
  beforeEach(() => { h.send.mockReset(); h.load.mockReset(); h.load.mockReturnValue({}) })

  it.each(['start', 'sent', 'error', 'held'] as const)('sends cue:play with kind %s', (k) => {
    playCue(k)
    expect(h.send).toHaveBeenCalledWith('cue:play', k)
  })

  it('is silent when soundCues is false, still on when true', () => {
    h.load.mockReturnValue({ soundCues: false })
    playCue('sent')
    expect(h.send).not.toHaveBeenCalled()
    h.load.mockReturnValue({ soundCues: true })
    playCue('sent')
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('never throws when settings or IPC fail', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.load.mockImplementation(() => { throw new Error('disk') })
    expect(() => playCue('error')).not.toThrow()
    h.load.mockReturnValue({})
    h.send.mockImplementation(() => { throw new Error('gone') })
    expect(() => playCue('error')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
