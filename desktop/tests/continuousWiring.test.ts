import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  register: vi.fn(() => true),
  unregister: vi.fn(),
  beep: vi.fn(),
  settings: {} as Record<string, unknown>,
  send: vi.fn(),
  cue: vi.fn(),
  autoPaste: vi.fn(async () => {}),
  sendEnter: vi.fn(),
  winRef: vi.fn(async () => ({ id: '1:2' }))
}))
vi.mock('electron', () => ({ globalShortcut: { register: h.register, unregister: h.unregister }, shell: { beep: h.beep } }))
vi.mock('../src/main/settingsManager', () => ({ loadSettings: () => h.settings }))
vi.mock('../src/main/context', () => ({ getActiveWindowRef: h.winRef }))
vi.mock('../src/main/dictation/autoPaste', () => ({ autoPaste: h.autoPaste, sendEnter: h.sendEnter }))
vi.mock('../src/main/dictation/overlayWindow', () => ({ sendToPrimaryOverlay: h.send }))
vi.mock('../src/main/dictation/buttonCues', () => ({ playCue: h.cue }))

describe('continuousWiring', () => {
  let w: typeof import('../src/main/dictation/continuousWiring')
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    h.register.mockReturnValue(true)
    h.settings = { continuousHotkey: 'F9', continuousAutoSend: false, continuousSilenceMs: 1000,
      continuousMinUtteranceMs: 500, continuousPinTarget: false, continuousThresholdDbfs: -40, continuousEchoGuardMs: 0 }
    w = await import('../src/main/dictation/continuousWiring')
  })

  it('controller is a singleton', () => {
    expect(w.getContinuousController()).toBe(w.getContinuousController())
  })

  it('start tells the overlay to start with settings from the store and reports state', async () => {
    const listener = vi.fn()
    w.setContinuousStateListener(listener)
    await w.getContinuousController().start()
    expect(h.send).toHaveBeenCalledWith('continuous:start', expect.objectContaining({ continuousThresholdDbfs: -40, continuousSilenceMs: 1000 }))
    expect(h.send).toHaveBeenCalledWith('continuous:state', { active: true })
    expect(listener).toHaveBeenCalledWith(true)
    w.getContinuousController().stop()
    expect(h.send).toHaveBeenCalledWith('continuous:stop')
    expect(listener).toHaveBeenLastCalledWith(false)
  })

  it('transcript pastes then plays the sent cue; held cue + system beep on mismatch', async () => {
    const c = w.getContinuousController()
    await c.start()
    await c.onTranscript('hello wiring world', 2000)
    expect(h.autoPaste).toHaveBeenCalledWith('hello wiring world')
    expect(h.cue).toHaveBeenCalledWith('sent')
    await c.onTranscript('anuluj', 800) // nothing queued -> beep
    expect(h.beep).toHaveBeenCalled()
    expect(h.cue).toHaveBeenCalledWith('held')
  })

  it('registers the hotkey, re-registering unregisters the previous one; toggle runs on press', async () => {
    w.registerContinuousHotkey()
    expect(h.register).toHaveBeenCalledWith('F9', expect.any(Function))
    h.settings.continuousHotkey = 'F10'
    w.registerContinuousHotkey()
    expect(h.unregister).toHaveBeenCalledWith('F9')
    const cb = (h.register.mock.calls.at(-1) as unknown as [string, () => void])[1]
    cb()
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledWith('continuous:start', expect.anything()))
  })

  it('does nothing without a hotkey; warns when registration is refused or throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.settings.continuousHotkey = ''
    w.registerContinuousHotkey()
    expect(h.register).not.toHaveBeenCalled()
    h.settings.continuousHotkey = 'F9'
    h.register.mockReturnValue(false)
    w.registerContinuousHotkey()
    h.register.mockImplementation(() => { throw new Error('bad accelerator') })
    w.registerContinuousHotkey()
    expect(warn).toHaveBeenCalledTimes(2)
    // refused registration must not be remembered as registered
    w.unregisterContinuousHotkey()
    expect(h.unregister).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('unregister releases the shortcut and stops an active session', async () => {
    w.registerContinuousHotkey()
    await w.getContinuousController().start()
    w.unregisterContinuousHotkey()
    expect(h.unregister).toHaveBeenCalledWith('F9')
    expect(h.send).toHaveBeenCalledWith('continuous:stop')
  })
})
