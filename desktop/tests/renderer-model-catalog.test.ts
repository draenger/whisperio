import { describe, it, expect } from 'vitest'
import {
  LLM_MODEL_CATALOG,
  listModelsForProvider,
  getDefaultModel,
  findCatalogModel
} from '../src/renderer/modelCatalog'

/**
 * PACZKA UI: unit coverage for the renderer's duplicate of
 * src/main/llm/models.ts's catalog (electron-vite can't share code between
 * the renderer and main bundles — see this file's header comment). Mirrors
 * tests/llm-models.test.ts's assertions so both copies are held to the same
 * shape/invariants.
 */

describe('renderer LLM_MODEL_CATALOG', () => {
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

describe('renderer listModelsForProvider', () => {
  it('returns only that provider’s models', () => {
    for (const model of listModelsForProvider('anthropic')) {
      expect(model.provider).toBe('anthropic')
    }
  })
})

describe('renderer getDefaultModel', () => {
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

describe('renderer findCatalogModel', () => {
  it('finds a known model by provider + id', () => {
    const model = findCatalogModel('anthropic', 'claude-opus-4-8')
    expect(model?.label).toContain('Opus')
  })

  it('returns undefined for a model not in the catalog (custom/private endpoint)', () => {
    expect(findCatalogModel('openai', 'my-fine-tuned-model')).toBeUndefined()
  })
})
