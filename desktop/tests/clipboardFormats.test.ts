import { describe, it, expect, vi } from 'vitest'
import {
  transientFormats,
  markClipboardTransient,
  writeTransientText,
  type TransientClipboardLike
} from '../src/main/dictation/clipboardFormats'
import {
  ClipboardRestoreCoordinator,
  clampRestoreDelay,
  DEFAULT_RESTORE_DELAY_MS,
  type ClipboardLike
} from '../src/main/dictation/clipboardRestore'

function fakeCb(opts: { clobber?: boolean; failFormats?: string[] } = {}) {
  const state = { text: '' }
  const buffers: Array<[string, Buffer]> = []
  const cb: TransientClipboardLike = {
    readText: () => state.text,
    writeText: (t) => { state.text = t },
    writeBuffer: (f, b) => {
      if (opts.failFormats?.includes(f)) throw new Error('nope')
      buffers.push([f, b])
      if (opts.clobber) state.text = ''
    }
  }
  return { cb, state, buffers }
}

describe('clipboardFormats', () => {
  it('win32 writes the three history/cloud exclusion formats', () => {
    const f = fakeCb()
    writeTransientText(f.cb, 'hello', 'win32')
    expect(f.buffers.map(([n]) => n)).toEqual([
      'ExcludeClipboardContentFromMonitorProcessing',
      'CanIncludeInClipboardHistory',
      'CanUploadToCloudClipboard'
    ])
    expect(f.buffers[1][1].readUInt32LE(0)).toBe(0)
    expect(f.buffers[2][1].readUInt32LE(0)).toBe(0)
    expect(f.state.text).toBe('hello')
  })
  it('darwin writes the nspasteboard transient + concealed types', () => {
    const f = fakeCb()
    writeTransientText(f.cb, 'x', 'darwin')
    expect(f.buffers.map(([n]) => n)).toEqual([
      'org.nspasteboard.TransientType',
      'org.nspasteboard.ConcealedType'
    ])
  })
  it('linux writes no formats', () => {
    const f = fakeCb()
    writeTransientText(f.cb, 'x', 'linux')
    expect(f.buffers).toEqual([])
    expect(transientFormats('linux')).toEqual([])
    expect(f.state.text).toBe('x')
  })
  it('a failing format does not throw and the others are still tried', () => {
    const f = fakeCb({ failFormats: ['CanIncludeInClipboardHistory'] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(markClipboardTransient(f.cb, 'win32', undefined)).toBe(2)
    const throwing: TransientClipboardLike = {
      readText: () => { throw new Error('x') },
      writeText: () => { throw new Error('x') },
      writeBuffer: () => { throw new Error('x') }
    }
    expect(() => writeTransientText(throwing, 't', 'win32')).toThrow() // plain writeText failing is a real error
    expect(markClipboardTransient(throwing, 'darwin', 't')).toBe(0)
  })
  it('rewrites the text when a marker write clobbered it', () => {
    const f = fakeCb({ clobber: true })
    writeTransientText(f.cb, 'dictated', 'win32')
    expect(f.state.text).toBe('dictated')
  })
  it('uses the repair callback when given', () => {
    const f = fakeCb({ clobber: true })
    const repair = vi.fn()
    markClipboardTransient(f.cb, 'darwin', 'a', repair)
    expect(repair).toHaveBeenCalledOnce()
  })
})

describe('restore delay + timing', () => {
  it('clamps the setting to 300..3000, default 700', () => {
    expect(DEFAULT_RESTORE_DELAY_MS).toBe(700)
    expect(clampRestoreDelay(10)).toBe(300)
    expect(clampRestoreDelay(99999)).toBe(3000)
    expect(clampRestoreDelay(1200.4)).toBe(1200)
    expect(clampRestoreDelay(undefined)).toBe(700)
    expect(clampRestoreDelay(NaN)).toBe(700)
  })

  function setup() {
    vi.useFakeTimers()
    const state = { text: 'orig' }
    const cb = {
      readText: () => state.text,
      writeText: (t: string) => { state.text = t },
      readHTML: () => '', readRTF: () => '', readImage: () => ({ isEmpty: () => true }),
      availableFormats: () => [],
      write: (d: { text?: string }) => { state.text = d.text ?? '' }
    } as unknown as ClipboardLike
    const timers = {
      set: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)
    }
    const after = vi.fn()
    return { state, cb, c: new ClipboardRestoreCoordinator(cb, timers, after), after }
  }

  it('does not restore before the delay, restores after (and marks)', () => {
    const { state, cb, c, after } = setup()
    const h = c.begin('dict'); cb.writeText('dict')
    const done = vi.fn()
    c.schedule(h, 700, done)
    vi.advanceTimersByTime(699)
    expect(state.text).toBe('dict'); expect(done).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(state.text).toBe('orig'); expect(done).toHaveBeenCalledWith('restored')
    expect(after).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
  it('skips if the clipboard changed', () => {
    const { state, cb, c, after } = setup()
    const h = c.begin('dict'); cb.writeText('dict')
    const done = vi.fn()
    c.schedule(h, 700, done)
    state.text = 'user copied'
    vi.advanceTimersByTime(700)
    expect(state.text).toBe('user copied'); expect(done).toHaveBeenCalledWith('skipped-changed')
    expect(after).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
  it('polls canRestore, restores once true, gives up after the window', () => {
    const { state, cb, c } = setup()
    let ok = false
    let h = c.begin('dict'); cb.writeText('dict')
    const done = vi.fn()
    c.schedule(h, 700, done, () => ok)
    vi.advanceTimersByTime(1000)
    expect(done).not.toHaveBeenCalled()
    ok = true
    vi.advanceTimersByTime(100)
    expect(done).toHaveBeenCalledWith('restored'); expect(state.text).toBe('orig')

    ok = false
    h = c.begin('d2'); cb.writeText('d2')
    const done2 = vi.fn()
    c.schedule(h, 700, done2, () => ok)
    vi.advanceTimersByTime(700 + 1500 + 100)
    expect(done2).toHaveBeenCalledWith('skipped-timeout'); expect(state.text).toBe('d2')
    vi.useRealTimers()
  })
})
