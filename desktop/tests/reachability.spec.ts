import { describe, expect, it } from 'vitest'
import { computeReachability } from './reachability/analyze'

/**
 * P0.3 — durable reachability sweep (desktop half).
 *
 * Gate 3 (AUTOBUILD-SPEC.md): "Any orphan is a FAILURE." A renderer
 * component that's defined but never rendered from a real entrypoint
 * (settings.tsx / recordings.tsx / dictation/overlay.tsx) is dead weight at
 * best and a wiring bug at worst (see docs/PARITY.md's "Orphan list" — the
 * 2026-07-14 wiring pass that closed 46 findings like this by hand). This
 * test automates that sweep so it can't silently regress again.
 *
 * See tests/reachability/analyze.ts for the static-analysis mechanism
 * (regex-based import + JSX call-site graph, no new deps).
 */

// Components intentionally excluded from the reachability requirement.
// Each entry needs a reason — this is a liability, not a convenience escape
// hatch. Empty today; keep it that way unless there's a real justified case
// (e.g. a component exported solely for its own unit test, never meant to be
// mounted by a window entrypoint).
const ALLOWLIST: Record<string, string> = {}

describe('renderer component reachability (defined vs. reachable)', () => {
  it('finds a non-trivial number of components (guards against the parser silently matching nothing)', () => {
    const { definedKeys } = computeReachability()
    expect(definedKeys.length).toBeGreaterThanOrEqual(10)
  })

  it('every exported component is reachable via a JSX call-site from an entrypoint — any orphan is a FAILURE', () => {
    const { definedKeys, reachableKeys } = computeReachability()

    const orphans = definedKeys.filter((k) => !reachableKeys.has(k) && !(k in ALLOWLIST))
    const staleAllowlist = Object.keys(ALLOWLIST).filter((k) => !definedKeys.includes(k))

    if (orphans.length > 0 || staleAllowlist.length > 0) {
      const lines = [
        `defined: ${definedKeys.length} · reachable: ${reachableKeys.size} · allowlisted: ${Object.keys(ALLOWLIST).length}`,
        ''
      ]
      if (orphans.length > 0) {
        lines.push('Orphan components (defined but not reachable from an entrypoint):', ...orphans.map((o) => `  - ${o}`), '')
      }
      if (staleAllowlist.length > 0) {
        lines.push(
          'Stale allowlist entries (no longer defined — remove them):',
          ...staleAllowlist.map((o) => `  - ${o}`)
        )
      }
      throw new Error(lines.join('\n'))
    }

    expect(orphans).toEqual([])
    expect(staleAllowlist).toEqual([])
  })
})
