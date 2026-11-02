import { describe, it, expect } from 'vitest'
import { planAudioFormats } from '../src/renderer/audio/formatPlan'

describe('planAudioFormats', () => {
  it('always sends the original; wav only when selfhosted is in the chain', () => {
    expect(planAudioFormats(['openai', 'groq'])).toEqual({ sendOriginal: true, needsWav: false })
    expect(planAudioFormats(['openai', 'selfhosted'])).toEqual({ sendOriginal: true, needsWav: true })
    expect(planAudioFormats(undefined)).toEqual({ sendOriginal: true, needsWav: false })
    expect(planAudioFormats([])).toEqual({ sendOriginal: true, needsWav: false })
  })
})

describe('planAudioFormats with the experimental parakeet flag', () => {
  it('flag off: a stale parakeet entry does not force WAV', () => {
    expect(planAudioFormats(['openai', 'parakeet'])).toEqual({ sendOriginal: true, needsWav: false })
    expect(planAudioFormats(['openai', 'parakeet'], false)).toEqual({ sendOriginal: true, needsWav: false })
  })
  it('flag on: parakeet needs WAV', () => {
    expect(planAudioFormats(['openai', 'parakeet'], true)).toEqual({ sendOriginal: true, needsWav: true })
  })
  it('flag off: selfhosted still needs WAV', () => {
    expect(planAudioFormats(['parakeet', 'selfhosted'], false).needsWav).toBe(true)
  })
})
