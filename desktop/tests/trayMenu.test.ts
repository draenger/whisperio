import { describe, it, expect, vi } from 'vitest'
import { buildTrayMenuTemplate, type TrayMenuOptions } from '../src/main/trayMenu'

function opts(over: Partial<TrayMenuOptions> = {}): TrayMenuOptions {
  return {
    platform: 'win32', hotkeyMode: 'toggle', updateReadyVersion: null,
    onInstallUpdate: vi.fn(), onOpenSettings: vi.fn(), onOpenRecordings: vi.fn(),
    onSetHotkeyMode: vi.fn(), onPinWindow: vi.fn(), onQuit: vi.fn(), ...over
  }
}
const find = (items: any[], re: RegExp) => items.find((i) => re.test(i.label ?? ''))

describe('buildTrayMenuTemplate', () => {
  it('reflects current mode in the checkbox', () => {
    expect(find(buildTrayMenuTemplate(opts({ hotkeyMode: 'hold' })), /^Hold to talk$/).checked).toBe(true)
    expect(find(buildTrayMenuTemplate(opts()), /^Hold to talk$/).checked).toBe(false)
  })
  it('click toggles mode via callback', () => {
    const o = opts()
    const item = find(buildTrayMenuTemplate(o), /^Hold to talk$/)
    item.click({ checked: true })
    expect(o.onSetHotkeyMode).toHaveBeenLastCalledWith('hold')
    item.click({ checked: false })
    expect(o.onSetHotkeyMode).toHaveBeenLastCalledWith('toggle')
  })
  it('is disabled with explanatory label on Linux', () => {
    const item = find(buildTrayMenuTemplate(opts({ platform: 'linux', hotkeyMode: 'hold' })), /Hold to talk/)
    expect(item.label).toBe('Hold to talk (not available on Linux)')
    expect(item.enabled).toBe(false)
    expect(item.checked).toBe(false)
  })
  it('adds update item first when an update is ready', () => {
    const o = opts({ updateReadyVersion: '1.2.3' })
    const items = buildTrayMenuTemplate(o)
    expect(items[0].label).toBe('Restart to update (v1.2.3)')
    ;(items[0] as any).click(); expect(o.onInstallUpdate).toHaveBeenCalled()
    expect(items.at(-1)!.label).toBe('Quit')
  })
  it('omits the continuous item when no toggle is wired', () => {
    expect(find(buildTrayMenuTemplate(opts()), /ciągły/)).toBeUndefined()
  })
  it('continuous item mirrors state and toggles via callback', () => {
    const o = opts({ continuousActive: true, onToggleContinuous: vi.fn() })
    const item = find(buildTrayMenuTemplate(o), /^Tryb ciągły \(hands-free\)$/)
    expect(item.type).toBe('checkbox')
    expect(item.checked).toBe(true)
    item.click({ checked: false })
    expect(o.onToggleContinuous).toHaveBeenCalledTimes(1)
    const off = find(buildTrayMenuTemplate(opts({ continuousActive: false, onToggleContinuous: vi.fn() })), /ciągły/)
    expect(off.checked).toBe(false)
  })
  it('has a pin-current-window item (before Quit) wired to onPinWindow', () => {
    const o = opts()
    const items = buildTrayMenuTemplate(o)
    const idx = items.findIndex((i) => /Przypnij bieżące okno/.test(i.label ?? ''))
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(items.length - 1)
    ;(items[idx] as any).click()
    expect(o.onPinWindow).toHaveBeenCalledTimes(1)
    expect(o.onQuit).not.toHaveBeenCalled()
  })
  it('settings / recordings / quit items call exactly their own callback', () => {
    const o = opts()
    const items = buildTrayMenuTemplate(o) as any[]
    find(items, /^Settings$/).click()
    expect(o.onOpenSettings).toHaveBeenCalledTimes(1)
    find(items, /^Recordings$/).click()
    expect(o.onOpenRecordings).toHaveBeenCalledTimes(1)
    find(items, /^Quit$/).click()
    expect(o.onQuit).toHaveBeenCalledTimes(1)
    expect(o.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(o.onInstallUpdate).not.toHaveBeenCalled()
  })
})
