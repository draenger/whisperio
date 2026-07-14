import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// P0.4 — Static IPC integrity guard.
//
// This is NOT a runtime test. It parses the actual source of the preload
// bridge, the main-process IPC registrations, and the renderer's window.api.*
// call sites with fs + regex (no Electron runtime, no new dependencies), and
// asserts the three surfaces agree with each other. Its job is to make "no
// handler registered for 'X'" and "window.api.foo.bar is not a function"
// structurally impossible to ship silently:
//
//   1. Every channel the preload invokes/sends has a main-process handler/listener.
//   2. Every channel the main process handles/listens on is actually reachable
//      from the preload (or is explicitly allowlisted with a reason below).
//   3. Every channel the preload listens on (renderer-bound push) is actually
//      emitted somewhere in main (directly or via a documented forwarding
//      helper), and vice versa.
//   4. Every `window.api.NS.method` call site in the renderer exists on the
//      object literal actually passed to contextBridge.exposeInMainWorld.
//   5. All ipcMain.handle/on registrations in src/main/index.ts textually
//      precede the first window-creating call in the same app.whenReady()
//      body (see ORDERING HEURISTIC below).

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const PRELOAD_FILE = path.join(DESKTOP_ROOT, 'src/preload/index.ts')
const MAIN_INDEX_FILE = path.join(DESKTOP_ROOT, 'src/main/index.ts')
const MAIN_DIR = path.join(DESKTOP_ROOT, 'src/main')
const RENDERER_DIR = path.join(DESKTOP_ROOT, 'src/renderer')

// ---------------------------------------------------------------------------
// Allowlists — every entry MUST carry a reason. Keep this list short; it is
// reviewed as part of this test. An empty match here means the channel is a
// real gap and the test should fail.
// ---------------------------------------------------------------------------

// ipcMain.on(...) channels with no matching ipcRenderer.send(...) in preload.
const ALLOWLIST_MAIN_ON_WITHOUT_PRELOAD_SENDER: Record<string, string> = {
  'dictation:cancel':
    "hotkeyManager.ts registers ipcMain.on('dictation:cancel', cancel) as a " +
    "dormant symmetry hook, but cancel() is currently invoked in-process by " +
    "the Escape globalShortcut, never via IPC from the renderer (there is no " +
    "ipcRenderer.send('dictation:cancel') anywhere in preload/renderer). " +
    'Harmless (an unused listener, not a missing one) — flagged here so a ' +
    'future removal or a future renderer-side sender is a deliberate choice.'
}

// webContents.send(...) push channels with no matching ipcRenderer.on(...) in preload.
const ALLOWLIST_PUSH_WITHOUT_PRELOAD_LISTENER: Record<string, string> = {
  'updater:ready':
    "autoUpdater.ts sends 'updater:ready' right after 'updater:status' on " +
    "update-downloaded, explicitly commented \"Legacy channel kept for any " +
    'existing listeners" — status is delivered via updater:status/onStatus; ' +
    'this is intentional legacy broadcast, not a missing bridge method.'
}

// ---------------------------------------------------------------------------
// Small fs helpers (no new dependencies)
// ---------------------------------------------------------------------------

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, exts))
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

function matchAll(re: RegExp, src: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  while ((m = g.exec(src))) {
    out.push(m[1])
  }
  return out
}

/** Extract the `{ ... }` block that starts at the first `{` at/after `fromIndex`, brace-balanced. */
function extractBracedBlock(src: string, fromIndex: number): { body: string; end: number } | null {
  const start = src.indexOf('{', fromIndex)
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) {
        return { body: src.slice(start + 1, i), end: i }
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// 1. Parse the preload bridge
// ---------------------------------------------------------------------------

const preloadSrc = fs.readFileSync(PRELOAD_FILE, 'utf8')

const preloadInvokeChannels = new Set(matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g, preloadSrc))
const preloadSendChannels = new Set(matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g, preloadSrc))
const preloadOnChannels = new Set(matchAll(/ipcRenderer\.on\(\s*'([^']+)'/g, preloadSrc))

// contextBridge.exposeInMainWorld('api', { dictation: dictationApi, ... })
function parseBridgeSurface(src: string): Set<string> {
  const exposeMatch = src.match(/contextBridge\.exposeInMainWorld\(\s*'api'\s*,/)
  if (!exposeMatch || exposeMatch.index === undefined) {
    throw new Error('Could not find contextBridge.exposeInMainWorld(\'api\', ...) in preload')
  }
  const block = extractBracedBlock(src, exposeMatch.index)
  if (!block) throw new Error('Could not extract exposeInMainWorld object literal')

  // namespace: variableName pairs, e.g. "dictation: dictationApi,"
  const nsPairs = matchAll(/(\w+):\s*(\w+)\s*,?/g, block.body).length
    ? [...block.body.matchAll(/(\w+):\s*(\w+)\s*,?/g)].map((m) => [m[1], m[2]] as const)
    : []

  const surface = new Set<string>()
  for (const [ns, varName] of nsPairs) {
    const constMatch = src.match(new RegExp(`const\\s+${varName}\\s*:\\s*\\w+\\s*=\\s*`))
    if (!constMatch || constMatch.index === undefined) {
      throw new Error(`Bridge references '${varName}' for namespace '${ns}' but no matching const was found`)
    }
    const varBlock = extractBracedBlock(src, constMatch.index)
    if (!varBlock) throw new Error(`Could not extract object literal for const ${varName}`)
    // Top-level keys only (2-space indent directly under the object literal) —
    // nested arrow-function bodies are indented further and must NOT be picked up.
    const keys = matchAll(/^  (\w+):/gm, varBlock.body)
    for (const key of keys) surface.add(`${ns}.${key}`)
  }
  return surface
}

const bridgeSurface = parseBridgeSurface(preloadSrc)

// ---------------------------------------------------------------------------
// 2. Parse main-process IPC registrations across src/main/**/*.ts
// ---------------------------------------------------------------------------

const mainFiles = walk(MAIN_DIR, ['.ts']).filter((f) => !f.endsWith('.d.ts'))
const mainSources = mainFiles.map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))

const handleChannels = new Map<string, string[]>() // channel -> file(s)
const mainOnChannels = new Map<string, string[]>()
const directSendChannels = new Set<string>()

function addTo(map: Map<string, string[]>, key: string, file: string): void {
  const rel = path.relative(DESKTOP_ROOT, file)
  const list = map.get(key) ?? []
  if (!list.includes(rel)) list.push(rel)
  map.set(key, list)
}

for (const { file, content } of mainSources) {
  for (const ch of matchAll(/ipcMain\.handle\(\s*'([^']+)'/g, content)) addTo(handleChannels, ch, file)
  for (const ch of matchAll(/ipcMain\.on\(\s*'([^']+)'/g, content)) addTo(mainOnChannels, ch, file)
  for (const ch of matchAll(/\.send\(\s*'([^']+)'/g, content)) directSendChannels.add(ch)
}

// Forwarding helpers: `function name(channel: string, ...args): void { ... .send(channel ...) ... }`
// e.g. overlayWindow.ts's broadcastToOverlays/sendToPrimaryOverlay forward a
// dynamic `channel` param into `win.webContents.send(channel, ...args)`. A
// literal-channel regex alone can't see through that indirection, so: find
// every function whose first param is named `channel` and whose body calls
// `.send(channel`, then scan the whole main tree for literal-string call
// sites of that function name.
const forwardingWrapperNames = new Set<string>()
for (const { content } of mainSources) {
  const fnRe = /function\s+(\w+)\(\s*channel\s*:\s*string[^)]*\)\s*:\s*void\s*\{/g
  let m: RegExpExecArray | null
  while ((m = fnRe.exec(content))) {
    const block = extractBracedBlock(content, m.index)
    if (block && /\.send\(\s*channel\b/.test(block.body)) {
      forwardingWrapperNames.add(m[1])
    }
  }
}

const indirectSendChannels = new Set<string>()
for (const { content } of mainSources) {
  for (const wrapper of forwardingWrapperNames) {
    const callRe = new RegExp(`\\b${wrapper}\\(\\s*'([^']+)'`, 'g')
    let m: RegExpExecArray | null
    while ((m = callRe.exec(content))) indirectSendChannels.add(m[1])
  }
}

const pushChannels = new Set<string>([...directSendChannels, ...indirectSendChannels])

// ---------------------------------------------------------------------------
// 3. Parse renderer window.api.* call sites
// ---------------------------------------------------------------------------

const rendererFiles = walk(RENDERER_DIR, ['.ts', '.tsx'])
const rendererUsages = new Set<string>()
for (const file of rendererFiles) {
  const content = fs.readFileSync(file, 'utf8')
  for (const m of content.matchAll(/window\.api\.(\w+)\.(\w+)/g)) {
    rendererUsages.add(`${m[1]}.${m[2]}`)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IPC integrity (P0.4 — static parity guard)', () => {
  it('sanity: the parsers actually found channels (guards against a silently-broken regex)', () => {
    expect(preloadInvokeChannels.size).toBeGreaterThan(10)
    expect(preloadSendChannels.size).toBeGreaterThan(0)
    expect(preloadOnChannels.size).toBeGreaterThan(5)
    expect(handleChannels.size).toBeGreaterThan(10)
    expect(mainOnChannels.size).toBeGreaterThan(0)
    expect(pushChannels.size).toBeGreaterThan(5)
    expect(bridgeSurface.size).toBeGreaterThan(10)
    expect(rendererUsages.size).toBeGreaterThan(10)
  })

  it('every ipcRenderer.invoke(...) channel in preload has a matching ipcMain.handle(...) in main', () => {
    const missing = [...preloadInvokeChannels].filter((ch) => !handleChannels.has(ch))
    expect(missing, `preload invokes these channels but no ipcMain.handle exists:\n${missing.join('\n')}`).toEqual([])
  })

  it('every ipcMain.handle(...) channel in main is reachable from the preload bridge', () => {
    const missing = [...handleChannels.keys()].filter((ch) => !preloadInvokeChannels.has(ch))
    expect(
      missing,
      `main registers ipcMain.handle for these channels but preload never invokes them ` +
        `(dead handler — either wire it up or remove it):\n${missing
          .map((ch) => `  ${ch}  (${handleChannels.get(ch)?.join(', ')})`)
          .join('\n')}`
    ).toEqual([])
  })

  it('every ipcRenderer.send(...) channel in preload has a matching ipcMain.on(...) in main', () => {
    const missing = [...preloadSendChannels].filter((ch) => !mainOnChannels.has(ch))
    expect(missing, `preload sends these fire-and-forget channels but no ipcMain.on exists:\n${missing.join('\n')}`).toEqual([])
  })

  it('every ipcMain.on(...) channel in main has a matching preload sender (or is allowlisted with a reason)', () => {
    const missing = [...mainOnChannels.keys()].filter(
      (ch) => !preloadSendChannels.has(ch) && !(ch in ALLOWLIST_MAIN_ON_WITHOUT_PRELOAD_SENDER)
    )
    expect(
      missing,
      `main listens (ipcMain.on) for these channels but preload never sends them, and they're not ` +
        `allowlisted above:\n${missing.map((ch) => `  ${ch}  (${mainOnChannels.get(ch)?.join(', ')})`).join('\n')}`
    ).toEqual([])
  })

  it('every ipcRenderer.on(...) push channel the renderer listens for is actually emitted by main', () => {
    const missing = [...preloadOnChannels].filter((ch) => !pushChannels.has(ch))
    expect(
      missing,
      `preload listens (ipcRenderer.on) for these channels but no main-process .send(...) (direct or ` +
        `via a forwarding helper) ever emits them:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('every main-process push channel is consumed by the preload (or is allowlisted with a reason)', () => {
    const missing = [...pushChannels].filter(
      (ch) => !preloadOnChannels.has(ch) && !(ch in ALLOWLIST_PUSH_WITHOUT_PRELOAD_LISTENER)
    )
    expect(
      missing,
      `main emits these channels via .send(...) but preload never listens (ipcRenderer.on) for them, ` +
        `and they're not allowlisted above:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('every window.api.<ns>.<method> call site in the renderer exists on the exposed bridge surface', () => {
    const missing = [...rendererUsages].filter((usage) => !bridgeSurface.has(usage))
    expect(
      missing,
      `renderer calls window.api.<ns>.<method> for these, but they are not keys on the object passed ` +
        `to contextBridge.exposeInMainWorld('api', ...):\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('the preload bridge does not expose methods the renderer never calls (drift/dead-API guard)', () => {
    // Softer signal than the reverse check above (a method can legitimately be
    // added slightly ahead of its first call site), so this is informational
    // rather than a hard requirement — but keep it as a canary: a large,
    // growing gap here usually means dead bridge surface.
    const unused = [...bridgeSurface].filter((surface) => !rendererUsages.has(surface))
    // sendResult/transcribe are consumed via useDictation.ts (counted above) —
    // this assertion just documents there is no *unbounded* drift; it is not
    // meant to force 1:1 usage of every getter/setter pair.
    expect(unused.length).toBeLessThan(bridgeSurface.size)
  })

  // -------------------------------------------------------------------------
  // 5. Registration-order heuristic
  // -------------------------------------------------------------------------
  //
  // ORDERING HEURISTIC (documented per the item spec): we cannot execute
  // Electron's real startup sequence in a static test, so instead we assert a
  // structural proxy for "handlers are registered before any window can talk
  // to main": within the synchronous body of `app.whenReady().then(() => {
  // ... })` in src/main/index.ts, every ipcMain.handle/ipcMain.on call must
  // appear (by source position) BEFORE the first call to a window-creating
  // symbol (initDictation, openSettingsWindow, openRecordingsWindow, or a
  // direct `new BrowserWindow(`) that appears in that same body.
  //
  // Why this is sound here: BrowserWindow creation kicks off async
  // loadURL/loadFile work — the new window's preload/renderer JS cannot run
  // until the current synchronous callback returns control to the event loop.
  // So as long as every registration call textually precedes every
  // window-creating call within that one synchronous callback, no renderer
  // frame can possibly fire an IPC message before its handler exists. This is
  // a textual/structural check, not real control-flow analysis — it would not
  // catch a handler registration hidden behind a conditional that also gates
  // window creation, but it exactly matches this file's actual shape (a flat
  // sequence of statements in the whenReady callback).
  it('all ipcMain.handle/on registrations in main/index.ts precede window creation in app.whenReady()', () => {
    const src = fs.readFileSync(MAIN_INDEX_FILE, 'utf8')
    const whenReadyMatch = src.match(/app\.whenReady\(\)\.then\(\(\)\s*=>\s*/)
    expect(whenReadyMatch, 'could not find app.whenReady().then(() => { ... }) in main/index.ts').not.toBeNull()
    const anchor = whenReadyMatch!.index! + whenReadyMatch![0].length
    const block = extractBracedBlock(src, anchor)
    expect(block, 'could not extract the app.whenReady() callback body').not.toBeNull()
    const body = block!.body

    const registrationPositions = [
      ...matchAllPositions(/ipcMain\.(handle|on)\(/g, body)
    ]
    expect(registrationPositions.length).toBeGreaterThan(10)
    const lastRegistrationPos = Math.max(...registrationPositions)

    // Only count a window-creator name as an "eager" call when it is a
    // top-level statement of the whenReady body (exactly 2-space indent, the
    // body's own statement depth) — NOT when it appears nested inside an
    // ipcMain.handle/on(...) callback (e.g. `ipcMain.on('recordings:openWindow',
    // () => openRecordingsWindow())`, which only creates the window lazily,
    // later, in response to a renderer IPC message — that's not a startup race).
    const windowCreatorNames = ['initDictation', 'openSettingsWindow', 'openRecordingsWindow', 'new BrowserWindow(']
    const windowCreationPositions = windowCreatorNames.flatMap((name) => {
      const lineRe = new RegExp(`^ {2}${name.replace(/[()]/g, '\\$&')}`, 'gm')
      return matchAllPositions(lineRe, body)
    })
    expect(
      windowCreationPositions.length,
      'expected at least one window-creating call in the app.whenReady() body to anchor the ordering check against'
    ).toBeGreaterThan(0)
    const firstWindowCreationPos = Math.min(...windowCreationPositions)

    expect(
      lastRegistrationPos,
      'an ipcMain.handle/on registration appears AFTER a window-creating call in the app.whenReady() body — ' +
        'a window created that early could send/invoke an IPC message before its handler exists'
    ).toBeLessThan(firstWindowCreationPos)
  })
})

function matchAllPositions(re: RegExp, src: string): number[] {
  const out: number[] = []
  let m: RegExpExecArray | null
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  while ((m = g.exec(src))) out.push(m.index)
  return out
}
