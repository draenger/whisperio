import { describe, it, expect } from 'vitest'
import { chainWithoutParakeet } from '../src/shared/providerFormat'

describe('chainWithoutParakeet', () => {
  it('removes parakeet and keeps the order of the rest', () => {
    expect(chainWithoutParakeet(['parakeet', 'groq', 'openai'])).toEqual(['groq', 'openai'])
  })
  it('falls back to openai when nothing else is left', () => {
    expect(chainWithoutParakeet(['parakeet'])).toEqual(['openai'])
    expect(chainWithoutParakeet(undefined)).toEqual(['openai'])
  })
  it('leaves a chain without parakeet untouched', () => {
    expect(chainWithoutParakeet(['openai', 'selfhosted'])).toEqual(['openai', 'selfhosted'])
  })
})
