import { describe, it, expect } from 'vitest'
import { isIndexUnavailable } from '../src/renderer/recordings/historyError'
import { IndexUnavailableError } from '../src/main/recordingStore'

describe('isIndexUnavailable', () => {
  it('detects the error class and its IPC-wrapped message', () => {
    const e = new IndexUnavailableError('boom')
    expect(isIndexUnavailable(e)).toBe(true)
    // Electron wraps: "Error invoking remote method 'recordings:list': Error: [INDEX_UNAVAILABLE] ..."
    expect(isIndexUnavailable(new Error(`Error invoking remote method 'recordings:list': Error: ${e.message}`))).toBe(true)
    expect(isIndexUnavailable({ code: 'INDEX_UNAVAILABLE' })).toBe(true)
  })
  it('rejects unrelated values', () => {
    expect(isIndexUnavailable(new Error('ENOENT'))).toBe(false)
    expect(isIndexUnavailable(null)).toBe(false)
    expect(isIndexUnavailable(undefined)).toBe(false)
    expect(isIndexUnavailable('x')).toBe(false)
  })
})
