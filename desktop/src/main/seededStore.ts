import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'

// Generic soft-delete / restore layer over a read-only seed catalog — the TS
// port of the mobile RewritePresetState + RewritePresetCatalog edit algebra,
// made reusable so both the rewrite presets (F3) and any other seeded catalog
// share ONE mechanism.
//
// Defaults are NEVER mutated: user intent is layered over the seeds as
//   - removedSeedIds : tombstones for deleted seeds (the FB's `isDeleted` flag)
//   - overrides      : edited copies of seeds, keyed by (unchanged) seed id
//   - userItems      : brand-new user entries
// `resolve` folds all three into the display list; `restoreDefaults` drops the
// seed layers while keeping user items ("restore defaults").

export interface Identifiable {
  id: string
}

export interface SeedState<T extends Identifiable> {
  userItems: T[]
  removedSeedIds: string[]
  overrides: Record<string, T>
}

export function emptySeedState<T extends Identifiable>(): SeedState<T> {
  return { userItems: [], removedSeedIds: [], overrides: {} }
}

/** Surviving seeds (with any override applied), in seed order, then user items. */
export function resolve<T extends Identifiable>(seeds: T[], state: SeedState<T>): T[] {
  const removed = new Set(state.removedSeedIds)
  const out: T[] = []
  for (const seed of seeds) {
    if (removed.has(seed.id)) continue
    out.push(state.overrides[seed.id] ?? seed)
  }
  out.push(...state.userItems)
  return out
}

/** Delete: a seed is tombstoned (edit dropped); a user item is removed outright. */
export function afterDelete<T extends Identifiable>(
  seeds: T[],
  state: SeedState<T>,
  id: string
): SeedState<T> {
  const isSeed = seeds.some((s) => s.id === id)
  if (isSeed) {
    const removedSeedIds = state.removedSeedIds.includes(id)
      ? state.removedSeedIds
      : [...state.removedSeedIds, id]
    const overrides = { ...state.overrides }
    delete overrides[id]
    return { ...state, removedSeedIds, overrides }
  }
  return { ...state, userItems: state.userItems.filter((i) => i.id !== id) }
}

/**
 * Upsert: editing a seed stores an override (same id) and un-tombstones it
 * (resurrect); a user item is replaced in place or appended when new.
 */
export function afterUpsert<T extends Identifiable>(
  seeds: T[],
  state: SeedState<T>,
  item: T
): SeedState<T> {
  const isSeed = seeds.some((s) => s.id === item.id)
  if (isSeed) {
    return {
      ...state,
      overrides: { ...state.overrides, [item.id]: item },
      removedSeedIds: state.removedSeedIds.filter((x) => x !== item.id)
    }
  }
  const idx = state.userItems.findIndex((i) => i.id === item.id)
  if (idx >= 0) {
    const userItems = [...state.userItems]
    userItems[idx] = item
    return { ...state, userItems }
  }
  return { ...state, userItems: [...state.userItems, item] }
}

/** Restore seeds to factory (drop tombstones + overrides), keep user items. */
export function restoreDefaults<T extends Identifiable>(state: SeedState<T>): SeedState<T> {
  return { ...state, removedSeedIds: [], overrides: {} }
}

/** Tolerant decode of a persisted blob → a well-formed SeedState. */
export function decodeSeedState<T extends Identifiable>(raw: unknown): SeedState<T> {
  const base = emptySeedState<T>()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Partial<SeedState<T>>
  return {
    userItems: Array.isArray(obj.userItems) ? obj.userItems : base.userItems,
    removedSeedIds: Array.isArray(obj.removedSeedIds) ? obj.removedSeedIds : base.removedSeedIds,
    overrides: obj.overrides && typeof obj.overrides === 'object' ? obj.overrides : base.overrides
  }
}

/**
 * Filesystem-backed wrapper: atomic load/save of a SeedState as JSON at an
 * absolute path (the caller resolves userData). Tolerant decode on load so a
 * corrupt/legacy blob falls back to an empty state instead of losing user items.
 * The path is injected so the module stays free of the Electron runtime and is
 * unit-testable with a mocked fs.
 */
export class PersistedSeededStore<T extends Identifiable> {
  constructor(
    private readonly seeds: T[],
    private readonly filePath: string
  ) {}

  loadState(): SeedState<T> {
    if (!existsSync(this.filePath)) return emptySeedState<T>()
    try {
      return decodeSeedState<T>(JSON.parse(readFileSync(this.filePath, 'utf-8')))
    } catch {
      return emptySeedState<T>()
    }
  }

  saveState(state: SeedState<T>): void {
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmpPath, this.filePath)
  }

  list(): T[] {
    return resolve(this.seeds, this.loadState())
  }

  upsert(item: T): T[] {
    const next = afterUpsert(this.seeds, this.loadState(), item)
    this.saveState(next)
    return resolve(this.seeds, next)
  }

  delete(id: string): T[] {
    const next = afterDelete(this.seeds, this.loadState(), id)
    this.saveState(next)
    return resolve(this.seeds, next)
  }

  restoreDefaults(): T[] {
    const next = restoreDefaults(this.loadState())
    this.saveState(next)
    return resolve(this.seeds, next)
  }
}
