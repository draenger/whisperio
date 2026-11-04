import { beforeEach, afterEach } from 'vitest'
import { getAvailableModels } from '../../src/main/modelManager'

/**
 * Built-in models carry a pinned SHA-256 of the real file. Tests that exercise
 * the download mechanics feed a few fake bytes, so for those tests every
 * catalog pin is cleared (the TOFU path) and restored afterwards. The pinned
 * path itself is covered in serverIntegrity.test.ts.
 */
export function unpinCatalogModelsForEachTest(): void {
  const saved = new Map<string, string | null>()
  beforeEach(() => {
    for (const m of getAvailableModels()) {
      saved.set(m.id, m.sha256)
      m.sha256 = null
    }
  })
  afterEach(() => {
    for (const m of getAvailableModels()) m.sha256 = saved.get(m.id) ?? m.sha256
    saved.clear()
  })
}
