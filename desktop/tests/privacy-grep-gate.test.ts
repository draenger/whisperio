import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, relative } from 'path'
import { execSync } from 'child_process'

// GREP-GATE (Context-aware tone, v1.5 Work Item B — spec item 6): zero
// occurrences of a screen/window-pixel-capturing API anywhere under src/,
// except a justified allowlist. This is repo-wide (not scoped to context.ts)
// so a future feature can't quietly reintroduce a screenshot capability
// elsewhere while context.ts itself stays clean.
//
// Screenshot APIs actually gated here: Electron's `desktopCapturer` and
// `capturePage`/`capturePage` (BrowserWindow/webContents) — the primitives
// that read screen or window PIXELS. `nativeImage` and `getUserMedia` are
// deliberately NOT gated repo-wide: nativeImage is a generic image container
// used elsewhere only to load static tray/window icon files from disk (no
// pixel capture involved), and getUserMedia is audio-only microphone capture
// (the app's core dictation feature, unrelated to screenshots) — gating
// those globally would false-positive on legitimate, pre-existing,
// unrelated code. context.ts's OWN privacy test (tests/context.test.ts) is
// stricter and does bar all four identifiers from that one file.
const SCREENSHOT_APIS = ['desktopCapturer', 'capturePage']

// Allowlist: [filename, justification]. Any match on SCREENSHOT_APIS outside
// these exact files fails the test.
const ALLOWLIST: Record<string, string> = {
  'src/main/index.ts':
    'setDisplayMediaRequestHandler requires a `video` source object to satisfy ' +
    "getDisplayMedia's API contract even for AUDIO-ONLY loopback capture (System " +
    'Audio dictation, pre-existing feature, unrelated to Context-aware tone). The ' +
    "video track is immediately discarded by the renderer (useDictation.ts's " +
    'startOutputRecording: `stream.getVideoTracks().forEach(t => t.stop())`) — no ' +
    'frame is ever read, rendered, or stored.'
}

// Strip comments before scanning — several files in this repo (context.ts,
// ContextTonePanel.tsx) *name* desktopCapturer in prose specifically to
// disclaim using it. The gate cares about actual CODE usage, not comments
// explaining what's deliberately avoided.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([;{}])\s*\/\/.*$/gm, '$1')
}

function listSourceFiles(): string[] {
  const root = join(__dirname, '..')
  // Tracked + untracked-but-not-gitignored files under src/ — deliberately
  // NOT just `git ls-files` alone, which would silently skip brand-new files
  // still sitting uncommitted in a working tree (e.g. this very feature's
  // context.ts/ContextTonePanel.tsx before their first commit) and let a
  // screenshot-API violation slip through review undetected. Both git
  // invocations naturally skip node_modules/out/dist for free.
  const tracked = execSync('git ls-files -- src', { cwd: root, encoding: 'utf-8' })
  const untracked = execSync('git ls-files --others --exclude-standard -- src', { cwd: root, encoding: 'utf-8' })
  const files = new Set([...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean))
  return [...files].map((f) => join(root, f))
}

describe('privacy grep-gate: screenshot APIs (src/)', () => {
  it('never references desktopCapturer/capturePage outside the justified allowlist', () => {
    const root = join(__dirname, '..')
    const offenders: string[] = []

    for (const file of listSourceFiles()) {
      const rel = relative(root, file).replace(/\\/g, '/')
      const content = stripComments(readFileSync(file, 'utf-8'))
      for (const api of SCREENSHOT_APIS) {
        if (content.includes(api) && !(rel in ALLOWLIST)) {
          offenders.push(`${rel}: contains "${api}"`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('the allowlist itself only names files that actually exist and actually use a screenshot API (no stale entries)', () => {
    const root = join(__dirname, '..')
    for (const [file, justification] of Object.entries(ALLOWLIST)) {
      expect(justification.length).toBeGreaterThan(20)
      const content = readFileSync(join(root, file), 'utf-8')
      const usesOne = SCREENSHOT_APIS.some((api) => content.includes(api))
      expect(usesOne).toBe(true)
    }
  })
})
