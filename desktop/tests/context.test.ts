import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// --- active-win mock (configurable per test) ---
const mockActiveWindow = vi.fn()
vi.mock('active-win', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockActiveWindow(...args)
}))

import { getActiveContext, resolveToneProfile, type DictationContext } from '../src/main/context'
import type { ToneProfileId } from '../src/main/llm/prompts'

describe('context.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getActiveContext', () => {
    it('maps owner.name/title from active-win into a DictationContext', async () => {
      mockActiveWindow.mockResolvedValue({ owner: { name: 'Slack' }, title: '#general' })
      const ctx = await getActiveContext()
      expect(ctx).toEqual({ processName: 'Slack', windowTitle: '#general' })
    })

    it('never requests accessibilityPermission (url is never read)', async () => {
      mockActiveWindow.mockResolvedValue({ owner: { name: 'Chrome' }, title: 'tab' })
      await getActiveContext()
      const opts = mockActiveWindow.mock.calls[0][0]
      expect(opts.accessibilityPermission).toBe(false)
    })

    it('defaults screenRecordingPermission to false (no title permission prompt by default)', async () => {
      mockActiveWindow.mockResolvedValue({ owner: { name: 'Chrome' }, title: 'tab' })
      await getActiveContext()
      const opts = mockActiveWindow.mock.calls[0][0]
      expect(opts.screenRecordingPermission).toBe(false)
    })

    it('requests screenRecordingPermission only when includeWindowTitle is explicitly true', async () => {
      mockActiveWindow.mockResolvedValue({ owner: { name: 'Chrome' }, title: 'tab' })
      await getActiveContext({ includeWindowTitle: true })
      const opts = mockActiveWindow.mock.calls[0][0]
      expect(opts.screenRecordingPermission).toBe(true)
    })

    it('resolves to null when active-win returns undefined (no active window)', async () => {
      mockActiveWindow.mockResolvedValue(undefined)
      const ctx = await getActiveContext()
      expect(ctx).toBeNull()
    })

    it('resolves to null (never throws) when active-win rejects — missing permission / unsupported platform', async () => {
      mockActiveWindow.mockRejectedValue(new Error('permission denied'))
      const ctx = await getActiveContext()
      expect(ctx).toBeNull()
    })

    it('resolves to null (never throws) when active-win rejects with a non-Error value', async () => {
      vi.resetModules()
      const fresh = await import('../src/main/context')
      mockActiveWindow.mockRejectedValue('a plain string rejection')
      const ctx = await fresh.getActiveContext()
      expect(ctx).toBeNull()
    })

    it('falls back to empty strings when owner/title are missing from the active-win result', async () => {
      mockActiveWindow.mockResolvedValue({})
      const ctx = await getActiveContext()
      expect(ctx).toEqual({ processName: '', windowTitle: '' })
    })

    it('logs the failure only once across repeated calls (no per-dictation spam)', async () => {
      // loggedFailureOnce is module-level state, and an earlier test in this
      // file already triggered (and logged) a failure — reset the module so
      // this test observes a fresh "never logged yet" module instance rather
      // than inheriting that state.
      vi.resetModules()
      const fresh = await import('../src/main/context')
      mockActiveWindow.mockRejectedValue(new Error('boom'))
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      try {
        await fresh.getActiveContext()
        await fresh.getActiveContext()
        await fresh.getActiveContext()
        expect(infoSpy).toHaveBeenCalledTimes(1)
      } finally {
        infoSpy.mockRestore()
      }
    })
  })

  describe('resolveToneProfile', () => {
    const toneMap: Record<string, ToneProfileId> = {
      slack: 'casual',
      gmail: 'formal',
      vscode: 'technical'
    }

    it('matches a lowercased substring of processName', () => {
      const ctx: DictationContext = { processName: 'Slack', windowTitle: '' }
      expect(resolveToneProfile(ctx, toneMap)).toBe('casual')
    })

    it('is case-insensitive on both processName and toneMap keys', () => {
      const ctx: DictationContext = { processName: 'GMAIL - Inbox', windowTitle: '' }
      const mixedCaseMap: Record<string, ToneProfileId> = { GMail: 'formal' }
      expect(resolveToneProfile(ctx, mixedCaseMap)).toBe('formal')
    })

    it('matches a real app name that contains the key as a substring', () => {
      const ctx: DictationContext = { processName: 'VSCode Insiders', windowTitle: '' }
      expect(resolveToneProfile(ctx, toneMap)).toBe('technical')
    })

    it('falls back to neutral when no key matches', () => {
      const ctx: DictationContext = { processName: 'Finder', windowTitle: '' }
      expect(resolveToneProfile(ctx, toneMap)).toBe('neutral')
    })

    it('falls back to neutral for a null context', () => {
      expect(resolveToneProfile(null, toneMap)).toBe('neutral')
    })

    it('falls back to neutral for an empty processName', () => {
      const ctx: DictationContext = { processName: '', windowTitle: 'something' }
      expect(resolveToneProfile(ctx, toneMap)).toBe('neutral')
    })

    it('falls back to neutral for an empty toneMap', () => {
      const ctx: DictationContext = { processName: 'Slack', windowTitle: '' }
      expect(resolveToneProfile(ctx, {})).toBe('neutral')
    })

    it('lets a user override win: first match in insertion order wins', () => {
      // A user-added override placed BEFORE the default-ish "code" entry.
      const overrideMap: Record<string, ToneProfileId> = {
        'code — work': 'formal',
        code: 'technical'
      }
      const ctx: DictationContext = { processName: 'Code — Work', windowTitle: '' }
      expect(resolveToneProfile(ctx, overrideMap)).toBe('formal')
    })

    it('does not match against windowTitle — only processName is used', () => {
      const ctx: DictationContext = { processName: 'Finder', windowTitle: 'slack export.txt' }
      expect(resolveToneProfile(ctx, toneMap)).toBe('neutral')
    })
  })

  // PRIVACY GATE: mechanically enforces context.ts's file-header contract —
  // this is the ONLY module that touches active-win, and it never touches
  // screen pixels. Parses the real source on disk rather than trusting
  // review/convention, so a future edit that reaches for desktopCapturer or
  // adds a second import fails this test immediately.
  describe('privacy contract (source scan)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'main', 'context.ts'), 'utf-8')

    // Strip comments before scanning: the file's own doc comments *name*
    // desktopCapturer/nativeImage/getUserMedia to explain they're NOT used
    // (see the file header) — the grep-gate cares about actual CODE usage,
    // not prose mentioning the forbidden APIs by name to disclaim them.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/^\s*\/\/.*$/gm, '') // full-line comments
      .replace(/([;{}])\s*\/\/.*$/gm, '$1') // trailing comments after code

    it('never references screen-pixel-capturing APIs in actual code', () => {
      for (const forbidden of ['desktopCapturer', 'nativeImage', 'getUserMedia', "from 'electron'", 'from "electron"']) {
        expect(codeOnly).not.toContain(forbidden)
      }
    })

    it('imports nothing but active-win as a value (type-only imports are exempt)', () => {
      const importLines = source
        .split('\n')
        .filter((line) => /^import\s/.test(line.trim()))
        .filter((line) => !/^import\s+type\s/.test(line.trim()))

      const specifiers = importLines.map((line) => {
        const match = line.match(/from\s+['"]([^'"]+)['"]/)
        return match ? match[1] : line
      })

      expect(specifiers).toEqual(['active-win'])
    })
  })
})
