import { describe, it, expect } from 'vitest'
import {
  snapshotClipboard,
  restoreClipboardIfUnchanged,
  isSnapshotEmpty,
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
