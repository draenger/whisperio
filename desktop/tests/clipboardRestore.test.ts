import { describe, it, expect } from 'vitest'
import {
  snapshotClipboard,
  restoreClipboardIfUnchanged,
  isSnapshotEmpty,
  ClipboardRestoreCoordinator,
  setSharedCoordinator,
  flushPendingClipboardRestore,
  type ClipboardLike
} from '../src/main/dictation/clipboardRestore'

const img = (empty: boolean) => ({ isEmpty: () => empty })

function fake(init: { text?: string; html?: string; rtf?: string; image?: boolean } = {}) {
  const state = { text: init.text ?? '', html: init.html ?? '', rtf: init.rtf ?? '', image: img(!init.image) }
  const writes: unknown[] = []
  const cb: ClipboardLike = {
    readText: () => state.text,
    writeText: (t) => { state.text = t; state.html = ''; state.rtf = ''; state.image = img(true) },
    readHTML: () => state.html,
    readRTF: () => state.rtf,
    readImage: () => state.image,
    availableFormats: () => [],
    write: (d) => {
      writes.push(d)
      state.text = d.text ?? ''
      state.html = d.html ?? ''
      state.rtf = d.rtf ?? ''
      state.image = (d.image as ReturnType<typeof img>) ?? img(true)
    }
  }
  return { cb, state, writes }
}

describe('snapshotClipboard', () => {
  it('captures text, html, rtf and image', () => {
    const f = fake({ text: 't', html: '<b>t</b>', rtf: '{\rtf t}', image: true })
    const s = snapshotClipboard(f.cb)
    expect(s.text).toBe('t')
    expect(s.html).toBe('<b>t</b>')
    expect(s.rtf).toBe('{\rtf t}')
    expect(s.image).toBeDefined()
  })
  it('omits empty formats', () => {
    const s = snapshotClipboard(fake({ text: 'only' }).cb)
    expect(s).toEqual({ text: 'only' })
  })
  it('image-only snapshot is non-empty', () => {
    const s = snapshotClipboard(fake({ image: true }).cb)
    expect(Object.keys(s)).toEqual(['image'])
    expect(isSnapshotEmpty(s)).toBe(false)
  })
  it('empty clipboard gives empty snapshot', () => {
    expect(isSnapshotEmpty(snapshotClipboard(fake().cb))).toBe(true)
  })
  it('does not throw when reads fail', () => {
    const f = fake({ text: 'x' })
    f.cb.readHTML = () => { throw new Error('boom') }
    f.cb.readImage = () => { throw new Error('boom') }
    expect(snapshotClipboard(f.cb)).toEqual({ text: 'x' })
  })
})

describe('restoreClipboardIfUnchanged', () => {
  it('restores all formats when clipboard still holds the pasted text', () => {
    const f = fake({ text: 'old', html: '<i>old</i>' })
    const snap = snapshotClipboard(f.cb)
    f.cb.writeText('dictated')
    expect(restoreClipboardIfUnchanged(f.cb, snap, 'dictated')).toBe('restored')
    expect(f.state.text).toBe('old')
    expect(f.state.html).toBe('<i>old</i>')
  })
  it('restores an image-only snapshot', () => {
    const f = fake({ image: true })
    const snap = snapshotClipboard(f.cb)
    f.cb.writeText('dictated')
    expect(restoreClipboardIfUnchanged(f.cb, snap, 'dictated')).toBe('restored')
    expect(f.state.image.isEmpty()).toBe(false)
  })
  it('skips when the user copied something else meanwhile', () => {
    const f = fake({ text: 'old' })
    const snap = snapshotClipboard(f.cb)
    f.cb.writeText('dictated')
    f.cb.writeText('user copied')
    expect(restoreClipboardIfUnchanged(f.cb, snap, 'dictated')).toBe('skipped-changed')
    expect(f.state.text).toBe('user copied')
    expect(f.writes).toHaveLength(0)
  })
  it('skips with an empty snapshot and leaves dictated text', () => {
    const f = fake()
    const snap = snapshotClipboard(f.cb)
    f.cb.writeText('dictated')
    expect(restoreClipboardIfUnchanged(f.cb, snap, 'dictated')).toBe('skipped-empty-snapshot')
    expect(f.state.text).toBe('dictated')
  })
  it('does not throw when the clipboard errors', () => {
    const f = fake({ text: 'old' })
    const snap = snapshotClipboard(f.cb)
    f.cb.readText = () => { throw new Error('locked') }
    expect(() => restoreClipboardIfUnchanged(f.cb, snap, 'x')).not.toThrow()
    f.cb.readText = () => 'x'
    f.cb.write = () => { throw new Error('locked') }
    expect(() => restoreClipboardIfUnchanged(f.cb, snap, 'x')).not.toThrow()
  })
})

function fakeTimers() {
  const q = new Map<number, () => void>()
  let n = 0
  return {
    timers: {
      set: (fn: () => void) => { q.set(++n, fn); return n },
      clear: (h: unknown) => { q.delete(h as number) }
    },
    pending: () => q.size,
    fireAll: () => { const fns = [...q.values()]; q.clear(); fns.forEach((f) => f()) }
  }
}

describe('ClipboardRestoreCoordinator', () => {
  function paste(c: ClipboardRestoreCoordinator, f: ReturnType<typeof fake>, text: string) {
    const h = c.begin(text)
    f.cb.writeText(text)
    c.schedule(h, 400)
    return h
  }

  it('non-overlapping pastes each restore their own previous clipboard', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    paste(c, f, 'first')
    t.fireAll()
    expect(f.state.text).toBe('orig')
    f.cb.writeText('later')
    paste(c, f, 'second')
    t.fireAll()
    expect(f.state.text).toBe('later')
  })

  it('overlapping pastes restore the ORIGINAL clipboard', () => {
    const f = fake({ text: 'orig', html: '<i>orig</i>' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    paste(c, f, 'first')
    paste(c, f, 'second') // within the restore window
    expect(t.pending()).toBe(1) // first timer cancelled
    t.fireAll()
    expect(f.state.text).toBe('orig')
    expect(f.state.html).toBe('<i>orig</i>')
  })

  it('overlap while the first paste is not yet armed still keeps the original', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    const h1 = c.begin('first')
    f.cb.writeText('first')
    paste(c, f, 'second')
    c.schedule(h1, 400) // stale, ignored
    expect(t.pending()).toBe(1)
    t.fireAll()
    expect(f.state.text).toBe('orig')
  })

  it('user copied something in between -> no restore, and fresh snapshot is used next', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    paste(c, f, 'first')
    f.cb.writeText('user copy')
    t.fireAll()
    expect(f.state.text).toBe('user copy')

    paste(c, f, 'a')
    f.cb.writeText('user copy 2')
    paste(c, f, 'b') // pending clipboard != 'a' -> fresh snapshot
    t.fireAll()
    expect(f.state.text).toBe('user copy 2')
  })

  it('flush on quit restores immediately if clipboard still equals pasted text', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    paste(c, f, 'first')
    expect(c.flush()).toBe('restored')
    expect(f.state.text).toBe('orig')
    expect(t.pending()).toBe(0)
    expect(c.flush()).toBeNull()
  })

  it('flush does not restore when the user changed the clipboard, or when unarmed', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    paste(c, f, 'first')
    f.cb.writeText('user')
    expect(c.flush()).toBe('skipped-changed')
    expect(f.state.text).toBe('user')

    c.begin('x')
    f.cb.writeText('x')
    expect(c.flush()).toBeNull()
    expect(f.state.text).toBe('x')
  })

  it('cancel drops the pending restore', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    const h = c.begin('x')
    f.cb.writeText('x')
    c.cancel(h)
    expect(c.flush()).toBeNull()
  })

  it('flushPendingClipboardRestore uses the shared coordinator', () => {
    const f = fake({ text: 'orig' })
    const c = new ClipboardRestoreCoordinator(f.cb, fakeTimers().timers)
    setSharedCoordinator(c)
    paste(c, f, 'first')
    expect(flushPendingClipboardRestore()).toBe('restored')
    expect(f.state.text).toBe('orig')
  })
})

describe('clipboardRestore gap coverage', () => {
  function paste(c: ClipboardRestoreCoordinator, f: ReturnType<typeof fake>, text: string) {
    const h = c.begin(text)
    f.cb.writeText(text)
    c.schedule(h, 400)
    return h
  }

  it('snapshot survives every individual read throwing and an image whose isEmpty throws', () => {
    const f = fake({ text: 't', html: 'h', rtf: 'r', image: true })
    f.cb.readText = () => { throw new Error('x') }
    f.cb.readRTF = () => { throw new Error('x') }
    f.cb.readImage = () => ({ isEmpty: () => { throw new Error('x') } })
    expect(snapshotClipboard(f.cb)).toEqual({ html: 'h' })
  })

  it('write failure during restore reports skipped-changed and leaves the clipboard untouched', () => {
    const f = fake({ text: 'old' })
    const snap = snapshotClipboard(f.cb)
    f.cb.writeText('dictated')
    f.cb.write = () => { throw new Error('locked') }
    expect(restoreClipboardIfUnchanged(f.cb, snap, 'dictated')).toBe('skipped-changed')
    expect(f.state.text).toBe('dictated')
  })

  it('onDone receives the restore status, and "skipped-changed" when the user copied', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    const statuses: string[] = []
    let h = c.begin('a'); f.cb.writeText('a'); c.schedule(h, 400, (s) => statuses.push(s))
    t.fireAll()
    h = c.begin('b'); f.cb.writeText('b'); c.schedule(h, 400, (s) => statuses.push(s))
    f.cb.writeText('user')
    t.fireAll()
    expect(statuses).toEqual(['restored', 'skipped-changed'])
  })

  it('cancel after schedule: the already-armed timer fires but must not restore or call onDone', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    const done: string[] = []
    const h = c.begin('x'); f.cb.writeText('x'); c.schedule(h, 400, (s) => done.push(s))
    c.cancel(h)
    t.fireAll()
    expect(f.state.text).toBe('x')
    expect(done).toEqual([])
    expect(f.writes).toHaveLength(0)
  })

  it('cancel with a stale handle does not drop the newer pending restore', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    const h1 = paste(c, f, 'first')
    paste(c, f, 'second')
    c.cancel(h1)
    t.fireAll()
    expect(f.state.text).toBe('orig')
  })

  it('begin takes a fresh snapshot when reading the current text throws', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    paste(c, f, 'first')
    const realRead = f.cb.readText
    f.cb.readText = () => { throw new Error('locked') }
    const h2 = c.begin('second')
    expect(h2.snapshot).toEqual({}) // every read failed -> empty, original not reused
    f.cb.readText = realRead
  })

  it('begin ids are monotonically increasing and flush clears a timer set by schedule', () => {
    const f = fake({ text: 'orig' })
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    const h1 = paste(c, f, 'a')
    expect(t.pending()).toBe(1)
    c.flush()
    expect(t.pending()).toBe(0)
    const h2 = c.begin('b')
    expect(h2.id).toBeGreaterThan(h1.id)
  })

  it('an empty original clipboard is preserved across overlap: dictated text stays, no write', () => {
    const f = fake()
    const t = fakeTimers()
    const c = new ClipboardRestoreCoordinator(f.cb, t.timers)
    paste(c, f, 'first')
    paste(c, f, 'second')
    t.fireAll()
    expect(f.state.text).toBe('second')
    expect(f.writes).toHaveLength(0)
  })
})
