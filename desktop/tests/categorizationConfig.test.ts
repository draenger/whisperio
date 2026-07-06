import { vi, describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockRenameSync = vi.fn()

vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
  writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
  renameSync: (...a: unknown[]) => mockRenameSync(...a)
}))

import {
  DEFAULT_CATEGORIZATION_CONFIG,
  loadCategorizationConfig,
  saveCategorizationConfig,
  resetCategorizationConfig,
  buildCategorizationMessages
} from '../src/main/categorizationConfig'

const FILE = join('/mock/userData', 'categorization.json')

describe('categorization defaults', () => {
  it('ships a non-empty default prompt and categories', () => {
    expect(DEFAULT_CATEGORIZATION_CONFIG.systemPrompt.trim().length).toBeGreaterThan(0)
    expect(DEFAULT_CATEGORIZATION_CONFIG.categories.length).toBeGreaterThan(0)
    expect(DEFAULT_CATEGORIZATION_CONFIG.categories.some((c) => c.id === 'work')).toBe(true)
  })
})

describe('buildCategorizationMessages', () => {
  it('embeds the prompt + the allowed category ids and labels', () => {
    const { system, user } = buildCategorizationMessages('  categorize me  ')
    expect(system).toContain(DEFAULT_CATEGORIZATION_CONFIG.systemPrompt.trim())
    expect(system).toContain('work (Work)')
    expect(user).toBe('categorize me')
  })

  it('yields an empty user message for a blank transcript', () => {
    expect(buildCategorizationMessages('   ').user).toBe('')
  })
})

describe('loadCategorizationConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('falls back to default when the file is missing', () => {
    mockExistsSync.mockReturnValue(false)
    expect(loadCategorizationConfig()).toEqual(DEFAULT_CATEGORIZATION_CONFIG)
  })

  it('falls back to default on a corrupt file', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('not json{{')
    expect(loadCategorizationConfig()).toEqual(DEFAULT_CATEGORIZATION_CONFIG)
  })

  it('falls back to default when shape is invalid', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ systemPrompt: 42 }))
    expect(loadCategorizationConfig()).toEqual(DEFAULT_CATEGORIZATION_CONFIG)
  })

  it('loads a valid persisted config', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ systemPrompt: 'my prompt', categories: [{ id: 'x', label: 'X' }] })
    )
    expect(loadCategorizationConfig()).toEqual({
      systemPrompt: 'my prompt',
      categories: [{ id: 'x', label: 'X' }]
    })
  })
})

describe('saveCategorizationConfig / reset', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes atomically and returns the merged config', () => {
    const config = { systemPrompt: 'p', categories: [{ id: 'a', label: 'A' }] }
    const result = saveCategorizationConfig(config)
    expect(result).toEqual(config)
    const [tmpPath, content] = mockWriteFileSync.mock.calls[0]
    expect(String(tmpPath).startsWith(`${FILE}.`)).toBe(true)
    expect(String(tmpPath).endsWith('.tmp')).toBe(true)
    expect(mockRenameSync).toHaveBeenCalledWith(tmpPath, FILE)
    expect(JSON.parse(String(content))).toEqual(config)
  })

  it('falls back to the default prompt when an empty one is saved', () => {
    const result = saveCategorizationConfig({ systemPrompt: '  ', categories: [] })
    expect(result).toEqual(DEFAULT_CATEGORIZATION_CONFIG)
  })

  it('reset persists the default', () => {
    const result = resetCategorizationConfig()
    expect(result).toEqual(DEFAULT_CATEGORIZATION_CONFIG)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
  })
})
