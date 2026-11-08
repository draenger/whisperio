import { describe, it, expect } from 'vitest'
import { TargetGate } from '../src/shared/continuous/targetGate'

const A = { id: 1, title: 'A' }
const B = { id: 2, title: 'B' }

describe('TargetGate', () => {
  it('always pastes when nothing is pinned', () => {
    const g = new TargetGate()
    expect(g.pinned).toBeNull()
    expect(g.submit('x', B)).toEqual({ action: 'paste', text: 'x' })
    expect(g.submit('y', null)).toEqual({ action: 'paste', text: 'y' })
    expect(g.queue).toEqual([])
    expect(g.drain(null)).toEqual([])
  })

  it('pastes when the active window is the pinned one (matched by id, not object)', () => {
    const g = new TargetGate()
    g.pin(A)
    expect(g.pinned).toBe(A)
    expect(g.submit('x', { id: 1, title: 'renamed' })).toEqual({ action: 'paste', text: 'x' })
  })

  it('holds on mismatch and on no active window, with the right reason', () => {
    const g = new TargetGate()
    g.pin(A)
    expect(g.submit('x', B)).toEqual({ action: 'hold', reason: 'target-mismatch' })
    expect(g.submit('y', null)).toEqual({ action: 'hold', reason: 'no-active-window' })
    expect(g.queue).toEqual(['x', 'y'])
  })

  it('distinguishes string and number ids', () => {
    const g = new TargetGate()
    g.pin({ id: 1 })
    expect(g.submit('x', { id: '1' }).action).toBe('hold')
  })

  it('drains FIFO only when the pinned window is active, then clears', () => {
    const g = new TargetGate()
    g.pin(A)
    g.submit('one', B)
    g.submit('two', B)
    expect(g.drain(B)).toEqual([])
    expect(g.drain(null)).toEqual([])
    expect(g.queue).toEqual(['one', 'two'])
    expect(g.drain(A)).toEqual(['one', 'two'])
    expect(g.queue).toEqual([])
    expect(g.drain(A)).toEqual([])
  })

  it('drains everything once pinning is removed', () => {
    const g = new TargetGate()
    g.pin(A)
    g.submit('one', B)
    g.pin(null)
    expect(g.drain(B)).toEqual(['one'])
  })

  it('cancelLast removes the most recent queued text', () => {
    const g = new TargetGate()
    expect(g.cancelLast()).toBeNull()
    g.pin(A)
    g.submit('one', B)
    g.submit('two', B)
    expect(g.cancelLast()).toBe('two')
    expect(g.queue).toEqual(['one'])
    expect(g.cancelLast()).toBe('one')
    expect(g.cancelLast()).toBeNull()
  })

  it('drops the oldest beyond maxQueue (default 20, custom, invalid)', () => {
    const g = new TargetGate({ maxQueue: 3 })
    g.pin(A)
    for (const t of ['1', '2', '3', '4', '5']) g.submit(t, B)
    expect(g.queue).toEqual(['3', '4', '5'])

    const d = new TargetGate()
    d.pin(A)
    for (let i = 0; i < 25; i++) d.submit(String(i), B)
    expect(d.queue).toHaveLength(20)
    expect(d.queue[0]).toBe('5')

    const bad = new TargetGate({ maxQueue: 0 })
    bad.pin(A)
    for (let i = 0; i < 25; i++) bad.submit(String(i), B)
    expect(bad.queue).toHaveLength(20)
  })

  it('clear empties the queue', () => {
    const g = new TargetGate()
    g.pin(A)
    g.submit('x', B)
    g.clear()
    expect(g.queue).toEqual([])
  })
})
