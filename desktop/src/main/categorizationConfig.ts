import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'

// Config-driven categorization. Desktop has no categorization today, so rather
// than introduce a hardcoded const we add it as editable config from day one
// (PT-db-seeded-runtime-editable-config): a seed default that is loaded from a
// file at runtime, falls back to the default on a missing/corrupt file, and is
// resettable. Categories are ported from the mobile WZCategories taxonomy.
//
// This only resolves "hardcoded prompt -> runtime config" + a pure prompt
// builder. Wiring an auto-categorize LLM call into the recording pipeline is
// left out (desktop recordings have no category surface yet).

export interface CategorizationCategory {
  id: string
  label: string
}

export interface CategorizationConfig {
  systemPrompt: string
  categories: CategorizationCategory[]
}

const DEFAULT_CATEGORIES: CategorizationCategory[] = [
  { id: 'work', label: 'Work' },
  { id: 'personal', label: 'Personal' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'messages', label: 'Messages' },
  { id: 'code', label: 'Code' },
  { id: 'todo', label: 'To-do' }
]

const DEFAULT_SYSTEM_PROMPT =
  'You categorize a short voice-note transcript into exactly one of the provided categories. ' +
  'Consider the content and intent of the note. Respond with ONLY the category id, in lowercase, ' +
  'and nothing else. If none clearly fits, choose the closest one.'

export const DEFAULT_CATEGORIZATION_CONFIG: CategorizationConfig = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  categories: DEFAULT_CATEGORIES
}

const FILE = 'categorization.json'

function configPath(): string {
  return join(app.getPath('userData'), FILE)
}

function isValidConfig(value: unknown): value is CategorizationConfig {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<CategorizationConfig>
  return typeof c.systemPrompt === 'string' && Array.isArray(c.categories)
}

/** Load the config, falling back to the default on a missing or corrupt file. */
export function loadCategorizationConfig(): CategorizationConfig {
  const filePath = configPath()
  if (!existsSync(filePath)) return { ...DEFAULT_CATEGORIZATION_CONFIG }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    if (!isValidConfig(parsed)) return { ...DEFAULT_CATEGORIZATION_CONFIG }
    return {
      systemPrompt: parsed.systemPrompt,
      categories: parsed.categories
        .filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string')
        .map((c) => ({ id: c.id, label: c.label }))
    }
  } catch {
    return { ...DEFAULT_CATEGORIZATION_CONFIG }
  }
}

/** Atomically persist an edited config (temp + rename), mirroring settingsManager. */
export function saveCategorizationConfig(config: CategorizationConfig): CategorizationConfig {
  const merged: CategorizationConfig = {
    systemPrompt:
      typeof config.systemPrompt === 'string' && config.systemPrompt.trim().length > 0
        ? config.systemPrompt
        : DEFAULT_CATEGORIZATION_CONFIG.systemPrompt,
    categories:
      Array.isArray(config.categories) && config.categories.length > 0
        ? config.categories
        : DEFAULT_CATEGORIZATION_CONFIG.categories
  }
  const filePath = configPath()
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
  return merged
}

/** Reset back to the seeded default (persists it). */
export function resetCategorizationConfig(): CategorizationConfig {
  return saveCategorizationConfig({ ...DEFAULT_CATEGORIZATION_CONFIG })
}

/**
 * Build the (system, user) pair to categorize a transcript. The category list is
 * appended to the configured prompt so the model knows the exact allowed ids; an
 * empty transcript yields an empty user message so callers can guard.
 */
export function buildCategorizationMessages(
  transcript: string,
  config: CategorizationConfig = DEFAULT_CATEGORIZATION_CONFIG
): { system: string; user: string } {
  const list = config.categories.map((c) => `${c.id} (${c.label})`).join(', ')
  const system = `${config.systemPrompt.trim()}\n\nCategories: ${list}`
  const user = (transcript ?? '').trim()
  return { system, user }
}
