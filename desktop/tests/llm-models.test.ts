import { describe, it, expect } from 'vitest'
import {
  LLM_MODEL_CATALOG,
  listModelsForProvider,
  getDefaultModel,
  findCatalogModel,
  estimateCostUsd
} from '../src/main/llm/models'

describe('LLM_MODEL_CATALOG', () => {
  it('has at least one model for each built-in provider', () => {
    expect(listModelsForProvider('openai').length).toBeGreaterThan(0)
    expect(listModelsForProvider('anthropic').length).toBeGreaterThan(0)
    expect(listModelsForProvider('replicate').length).toBeGreaterThan(0)
  })

  it('exposes exactly one default model per provider', () => {
    for (const provider of ['openai', 'anthropic', 'replicate'] as const) {
      const defaults = listModelsForProvider(provider).filter((m) => m.default)
      expect(defaults).toHaveLength(1)
    }
  })

  it('gives every model a non-empty id and label', () => {
    for (const model of LLM_MODEL_CATALOG) {
      expect(model.id.length).toBeGreaterThan(0)
      expect(model.label.length).toBeGreaterThan(0)
    }
  })

  it('never has a negative price', () => {
    for (const model of LLM_MODEL_CATALOG) {
      if (model.pricePerMTokIn !== undefined) expect(model.pricePerMTokIn).toBeGreaterThanOrEqual(0)
      if (model.pricePerMTokOut !== undefined) expect(model.pricePerMTokOut).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('listModelsForProvider', () => {
  it('returns only that provider’s models', () => {
    for (const model of listModelsForProvider('anthropic')) {
      expect(model.provider).toBe('anthropic')
    }
  })

  it('returns an empty array for an unknown provider', () => {
    // @ts-expect-error deliberately passing a provider id outside the union
    expect(listModelsForProvider('mistral-direct')).toEqual([])
  })
})

describe('getDefaultModel', () => {
  it('returns the OpenAI default (gpt-4o-mini)', () => {
    expect(getDefaultModel('openai')?.id).toBe('gpt-4o-mini')
  })

  it('returns the Anthropic default (claude-haiku-4-5)', () => {
    expect(getDefaultModel('anthropic')?.id).toBe('claude-haiku-4-5')
  })

  it('returns a Replicate default', () => {
    expect(getDefaultModel('replicate')?.default).toBe(true)
  })
})

describe('findCatalogModel', () => {
  it('finds a known model by provider + id', () => {
    const model = findCatalogModel('anthropic', 'claude-opus-4-8')
    expect(model?.label).toContain('Opus')
  })

  it('returns undefined for a model not in the catalog (custom/private endpoint)', () => {
    expect(findCatalogModel('openai', 'my-fine-tuned-model')).toBeUndefined()
  })
})

describe('estimateCostUsd', () => {
  it('computes cost from per-million-token prices', () => {
    const cost = estimateCostUsd({ pricePerMTokIn: 1, pricePerMTokOut: 5 }, 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(6, 6)
  })

  it('scales down for small token counts', () => {
    const cost = estimateCostUsd({ pricePerMTokIn: 10, pricePerMTokOut: 30 }, 1000, 500)
    expect(cost).toBeCloseTo(10 * (1000 / 1_000_000) + 30 * (500 / 1_000_000), 9)
  })

  it('returns undefined when pricing is unknown (e.g. a custom endpoint)', () => {
    expect(estimateCostUsd({}, 1000, 1000)).toBeUndefined()
    expect(estimateCostUsd({ pricePerMTokIn: 1 }, 1000, 1000)).toBeUndefined()
    expect(estimateCostUsd({ pricePerMTokOut: 1 }, 1000, 1000)).toBeUndefined()
  })

  it('returns undefined for Replicate models with no verified per-token price', () => {
    const model = findCatalogModel('replicate', 'meta/meta-llama-3-70b-instruct')
    expect(model).toBeDefined()
    expect(estimateCostUsd(model!, 1000, 1000)).toBeUndefined()
  })
})
