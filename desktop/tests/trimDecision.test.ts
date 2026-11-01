// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { shouldUseTrimmed, chainUploadCap } from '../src/shared/trimDecision'
import { providerNeedsWav } from '../src/shared/providerFormat'

const MB = 1024 * 1024

describe('shouldUseTrimmed', () => {
  it('uses original when trimmed is larger', () => {
    expect(shouldUseTrimmed(100_000, 300_000, ['openai'])).toBe(false)
  })
  it('uses original when trimmed equals original', () => {
    expect(shouldUseTrimmed(100_000, 100_000, ['openai'])).toBe(false)
  })
  it('uses original when trimmed exceeds the provider cap', () => {
    expect(shouldUseTrimmed(40 * MB, 26 * MB, ['openai'])).toBe(false)
  })
  it('uses trimmed when smaller and under cap', () => {
    expect(shouldUseTrimmed(5 * MB, 2 * MB, ['openai'])).toBe(true)
  })
  it('rejects empty trimmed audio', () => {
    expect(shouldUseTrimmed(1000, 0, ['openai'])).toBe(false)
  })
  it('uses the smallest cap in the chain and a default when empty', () => {
    expect(chainUploadCap(['openai', 'selfhosted'])).toBe(25 * MB)
    expect(chainUploadCap([])).toBe(25 * MB)
    expect(chainUploadCap(undefined)).toBe(25 * MB)
  })
  it('selfhosted still needs WAV per #54 (decision does not change that)', () => {
    expect(providerNeedsWav('selfhosted')).toBe(true)
    // smaller+under cap: trimmed WAV used; otherwise original, and the
    // selfhosted path keeps its own full-recording WAV conversion.
    expect(shouldUseTrimmed(5 * MB, 2 * MB, ['selfhosted'])).toBe(true)
    expect(shouldUseTrimmed(1 * MB, 2 * MB, ['selfhosted'])).toBe(false)
  })
})
