import { vi, describe, it, expect, beforeEach } from 'vitest'

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
  resolve,
  afterDelete,
  afterUpsert,
  restoreDefaults,
  emptySeedState,
  decodeSeedState,
  PersistedSeededStore,
  type SeedState
} from '../src/main/seededStore'

interface Item {
  id: string
  name: string
}

const SEEDS: Item[] = [
  { id: 's1', name: 'Seed One' },
  { id: 's2', name: 'Seed Two' }
]

describe('seededStore pure algebra', () => {
  it('resolve returns seeds untouched with an empty state', () => {
    expect(resolve(SEEDS, emptySeedState<Item>())).toEqual(SEEDS)
  })

  it('afterDelete tombstones a seed (hidden by resolve, restorable)', () => {
    const state = afterDelete(SEEDS, emptySeedState<Item>(), 's1')
    expect(state.removedSeedIds).toContain('s1')
    expect(resolve(SEEDS, state)).toEqual([{ id: 's2', name: 'Seed Two' }])
    // never mutates the seed array
    expect(SEEDS[0]).toEqual({ id: 's1', name: 'Seed One' })
  })

  it('afterUpsert on a seed stores an override and resurrects a tombstone', () => {
    let state = afterDelete(SEEDS, emptySeedState<Item>(), 's1')
    state = afterUpsert(SEEDS, state, { id: 's1', name: 'Edited One' })
    expect(state.removedSeedIds).not.toContain('s1')
    expect(state.overrides['s1']).toEqual({ id: 's1', name: 'Edited One' })
    expect(resolve(SEEDS, state)).toEqual([
      { id: 's1', name: 'Edited One' },
      { id: 's2', name: 'Seed Two' }
    ])
  })

  it('afterUpsert appends a new user item, then replaces it in place', () => {
    let state = afterUpsert(SEEDS, emptySeedState<Item>(), { id: 'u1', name: 'User One' })
    expect(resolve(SEEDS, state).at(-1)).toEqual({ id: 'u1', name: 'User One' })
    state = afterUpsert(SEEDS, state, { id: 'u1', name: 'User One Edited' })
    expect(state.userItems).toEqual([{ id: 'u1', name: 'User One Edited' }])
  })

  it('afterDelete removes a user item outright (no tombstone)', () => {
    let state = afterUpsert(SEEDS, emptySeedState<Item>(), { id: 'u1', name: 'User One' })
    state = afterDelete(SEEDS, state, 'u1')
    expect(state.userItems).toEqual([])
    expect(state.removedSeedIds).not.toContain('u1')
  })

  it('restoreDefaults clears seed layers but keeps user items', () => {
    let state = afterDelete(SEEDS, emptySeedState<Item>(), 's1')
    state = afterUpsert(SEEDS, state, { id: 's2', name: 'Edited Two' })
    state = afterUpsert(SEEDS, state, { id: 'u1', name: 'User One' })
    const restored = restoreDefaults(state)
    expect(restored.removedSeedIds).toEqual([])
    expect(restored.overrides).toEqual({})
    expect(resolve(SEEDS, restored)).toEqual([...SEEDS, { id: 'u1', name: 'User One' }])
  })

  it('decodeSeedState tolerates a malformed blob', () => {
    expect(decodeSeedState<Item>(null)).toEqual(emptySeedState<Item>())
    expect(decodeSeedState<Item>({ userItems: 'nope' })).toEqual(emptySeedState<Item>())
    const good: SeedState<Item> = { userItems: [{ id: 'u', name: 'n' }], removedSeedIds: ['s1'], overrides: {} }
    expect(decodeSeedState<Item>(good)).toEqual(good)
  })
})

describe('PersistedSeededStore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('list returns seeds when no file exists', () => {
    mockExistsSync.mockReturnValue(false)
    const store = new PersistedSeededStore<Item>(SEEDS, '/mock/seed.json')
    expect(store.list()).toEqual(SEEDS)
  })

  it('upsert persists atomically and the saved state resolves back', () => {
    mockExistsSync.mockReturnValue(false)
    const store = new PersistedSeededStore<Item>(SEEDS, '/mock/seed.json')
    const listed = store.upsert({ id: 'u1', name: 'User One' })
    expect(listed.at(-1)).toEqual({ id: 'u1', name: 'User One' })

    const [tmpPath, content] = mockWriteFileSync.mock.calls[0]
    expect(String(tmpPath).endsWith('.tmp')).toBe(true)
    expect(mockRenameSync).toHaveBeenCalledWith(tmpPath, '/mock/seed.json')

    // Feed the written state back through load → same resolved list.
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(content)
    expect(store.list()).toEqual([...SEEDS, { id: 'u1', name: 'User One' }])
  })

  it('delete then restoreDefaults brings a seed back', () => {
    mockExistsSync.mockReturnValue(false)
    const store = new PersistedSeededStore<Item>(SEEDS, '/mock/seed.json')
    const afterDel = store.delete('s1')
    expect(afterDel.find((i) => i.id === 's1')).toBeUndefined()

    // load reflects the tombstone we just saved
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(mockWriteFileSync.mock.calls[0][1])
    const restored = store.restoreDefaults()
    expect(restored).toEqual(SEEDS)
  })
})
