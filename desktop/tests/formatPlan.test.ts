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
