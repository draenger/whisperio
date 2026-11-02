import { describe, it, expect } from 'vitest'
import { isHoldSupported, isHoldEffective, stopHint } from '../src/main/dictation/overlayHint'

describe('overlayHint', () => {
  it('supports hold on win32/darwin only', () => {
    expect(isHoldSupported('win32')).toBe(true)
    expect(isHoldSupported('darwin')).toBe(true)
    expect(isHoldSupported('linux')).toBe(false)
  })
  it('hold is effective only for hold mode on supported platforms', () => {
    expect(isHoldEffective('hold', 'win32')).toBe(true)
    expect(isHoldEffective('hold', 'linux')).toBe(false)
    expect(isHoldEffective('toggle', 'darwin')).toBe(false)
  })
  it('renders release hint in hold mode', () => {
    expect(stopHint('hold', 'Ctrl+Space', 'win32')).toBe('Release Ctrl+Space to transcribe · Escape to cancel')
  })
  it('keeps toggle wording for toggle mode and Linux fallback', () => {
    expect(stopHint('toggle', 'F9', 'win32')).toBe('Press F9 to stop · Escape to cancel')
    expect(stopHint('hold', 'F9', 'linux')).toBe('Press F9 to stop · Escape to cancel')
  })
})
