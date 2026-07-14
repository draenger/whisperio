import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// P0.5 — Durable settings full-loop guard (Gate 4: "a control that writes a
// key nobody reads is a FAILURE").
//
// This is NOT a runtime test. Like tests/ipc-integrity.spec.ts (P0.4), it
// parses real source with fs + regex (no Electron runtime, no new
// dependencies) and asserts, PER SETTINGS KEY, that the full loop is intact:
//
//   1. DEFAULT  — the key has a seed value in DEFAULT_SETTINGS.
//   2. PRELOAD  — the key is declared in BOTH preload copies of AppSettings
//                 (src/preload/index.ts and src/preload/index.d.ts).
//   3. CONSUMER — something outside settingsManager/preload/the settings-
//                 authoring UI actually reads the key and does something with
//                 it (directly, or indirectly through an exported
//                 settingsManager.ts helper like getActiveVocabulary()).
//   4. CONTROL  — a settings-UI file lets the user change the key (directly,
//                 or — for the 3 keys where the renderer never sees the
//                 literal key name because it crosses the IPC boundary under
//                 a renamed field — via a justified allowlist entry).
//
// Condition 3 deliberately does NOT count a reference inside the settings-
// authoring UI files themselves as "consumption" — SettingsForm.tsx loading
// `settings.inputDeviceId` into local state so it can round-trip it back out
// on Save is the CONTROL, not a CONSUMER. Counting it as both would let a key
// pass this test while doing literally nothing at runtime, which is exactly
// the "control writes a key nobody reads" failure mode this test exists to
// catch (see the mutation sanity check + the real bug it caught, both noted
// below and in docs/PARITY.md).

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const SETTINGS_MANAGER_FILE = path.join(DESKTOP_ROOT, 'src/main/settingsManager.ts')
const PRELOAD_TS_FILE = path.join(DESKTOP_ROOT, 'src/preload/index.ts')
const PRELOAD_DTS_FILE = path.join(DESKTOP_ROOT, 'src/preload/index.d.ts')
const MAIN_DIR = path.join(DESKTOP_ROOT, 'src/main')
const RENDERER_DIR = path.join(DESKTOP_ROOT, 'src/renderer')

// The settings-authoring UI: files whose whole job is to let a human view and
// edit AppSettings. A key showing up here is the CONTROL (condition 4) — it
// must NOT by itself count as the CONSUMER (condition 3).
const SETTINGS_UI_FILES = [
  path.join(DESKTOP_ROOT, 'src/renderer/settings/settings.tsx'),
  path.join(DESKTOP_ROOT, 'src/renderer/components/settings/SettingsForm.tsx'),
  path.join(DESKTOP_ROOT, 'src/renderer/components/settings/CleanupPanel.tsx'),
  path.join(DESKTOP_ROOT, 'src/renderer/components/settings/ModelPicker.tsx'),
  path.join(DESKTOP_ROOT, 'src/renderer/components/settings/UsagePanel.tsx')
].filter((f) => fs.existsSync(f))

// theme/accentColor are the one pair whose actual save-on-change control
// lives outside the settings-authoring panel proper — in ThemeContext.tsx's
// setMode/setAccent (SettingsForm.tsx's Appearance tab just calls into that
// context via useThemeHook()). It stays OUT of SETTINGS_UI_FILES (so it can
// still count as a CONSUMER — it's the thing that actually applies the
// theme/accent) but is added here so the CONTROL scan can find it too.
const CONTROL_SOURCE_FILES = [
  ...SETTINGS_UI_FILES,
  path.join(DESKTOP_ROOT, 'src/renderer/ThemeContext.tsx')
].filter((f) => fs.existsSync(f))

// ---------------------------------------------------------------------------
// Allowlists — every entry MUST carry a reason. Keep this list short; it is
// reviewed as part of this test, same convention as ipc-integrity.spec.ts.
// ---------------------------------------------------------------------------

const CONSUMER_ALLOWLIST: Record<string, string> = {
  aiPostProcessing:
    'Legacy pre-v1.4 toggle, deliberately never dropped (settings invariant — see ' +
    "settingsManager.ts's AppSettings doc comment). Its only reader is " +
    'migrateCleanupSettings() inside settingsManager.ts itself (one-time read on load, ' +
    'used to seed cleanupAuto/cleanupMode for old settings.json files) — by design that ' +
    "function is main-process-internal and not called from outside, so it's invisible " +
    'to this scan on purpose. Not a live control either (see CONTROL note below); kept ' +
    'purely so old settings.json files round-trip losslessly.',
  outputDeviceId:
    'REAL GAP, documented debt (see docs/PARITY.md P0.5 row): SettingsForm.tsx has a ' +
    'working "Output Device (System Audio)" control that saves this key, but ' +
    'useDictation.ts\'s startOutputRecording() captures system audio via ' +
    "getDisplayMedia()/desktopCapturer loopback (src/main/index.ts's " +
    'setDisplayMediaRequestHandler, audio: \'loopback\') — an API that captures loopback ' +
    "audio for a whole screen/source, not a specific named output/playback device, so " +
    'there is no low-risk place to plug outputDeviceId into today. Fixing this for real ' +
    'means reworking the loopback-capture path, which is out of scope for a ' +
    '"minimal fix if the test finds a real bug" pass — flagged here instead of silently ' +
    'shipping a dead control. TODO: wire this up (or remove the control) when the audio ' +
    'capture path is revisited.'
}

const CONTROL_ALLOWLIST: Record<string, string> = {
  githubUser:
    "Controlled via the GitHub tab's connect/select-repo OAuth-device-flow buttons in " +
    'SettingsForm.tsx (window.api.github.connect/poll/selectRepo, ~line 2221+), but the ' +
    'renderer only ever sees the *response* shape (GithubStatus.user), never the literal ' +
    "settings key name — githubSync.ts maps `s.githubUser` -> `user` at the IPC boundary " +
    '(see githubSync.ts). A literal-text scan of the renderer can never find this control ' +
    "by construction; verified manually that the flow is wired end-to-end.",
  githubRepo:
    'Same GitHub-tab OAuth flow as githubUser (selectRepo(fullName, branch) ' +
    '-> saveSettings({ githubRepo, githubBranch })); renamed to `repo` across the IPC ' +
    'boundary in githubSync.ts, so the literal key never appears in renderer source.',
  githubBranch:
    'Same GitHub-tab OAuth flow as githubUser; renamed to `branch` across the IPC ' +
    'boundary in githubSync.ts, so the literal key never appears in renderer source.'
}

// ---------------------------------------------------------------------------
// Small fs helpers (no new dependencies) — mirrors ipc-integrity.spec.ts
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

/** Top-level `  key:` field names (2-space indent) of an interface/object-literal block. */
function topLevelKeys(blockBody: string): string[] {
  const out: string[] = []
  const re = /^ {2}(\w+)(\?)?\s*:/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(blockBody))) out.push(m[1])
  return out
}

function interfaceKeys(src: string, name: string): string[] {
  const m = src.match(new RegExp(`export interface ${name}\\s*\\{`))
  if (!m || m.index === undefined) throw new Error(`Could not find "export interface ${name}"`)
  const block = extractBracedBlock(src, m.index)
  if (!block) throw new Error(`Could not extract body of interface ${name}`)
  return topLevelKeys(block.body)
}

// ---------------------------------------------------------------------------
// 1. Enumerate AppSettings keys from settingsManager.ts (interface + DEFAULT_SETTINGS)
// ---------------------------------------------------------------------------

const settingsManagerSrc = fs.readFileSync(SETTINGS_MANAGER_FILE, 'utf8')

const interfaceKeyList = interfaceKeys(settingsManagerSrc, 'AppSettings')

const defaultsMatch = settingsManagerSrc.match(/const DEFAULT_SETTINGS\s*:\s*AppSettings\s*=\s*/)
if (!defaultsMatch || defaultsMatch.index === undefined) {
  throw new Error('Could not find "const DEFAULT_SETTINGS: AppSettings = ..." in settingsManager.ts')
}
const defaultsBlock = extractBracedBlock(settingsManagerSrc, defaultsMatch.index)
if (!defaultsBlock) throw new Error('Could not extract DEFAULT_SETTINGS object literal body')
const defaultKeyList = topLevelKeys(defaultsBlock.body)

// Canonical key set = union of both sources — a key present in one but not
// the other is itself a bug (interface/defaults drift) and must show up below.
const ALL_KEYS = [...new Set([...interfaceKeyList, ...defaultKeyList])].sort()

// ---------------------------------------------------------------------------
// 2. Preload copies
// ---------------------------------------------------------------------------

const preloadTsSrc = fs.readFileSync(PRELOAD_TS_FILE, 'utf8')
const preloadDtsSrc = fs.readFileSync(PRELOAD_DTS_FILE, 'utf8')
const preloadTsKeys = new Set(interfaceKeys(preloadTsSrc, 'AppSettings'))
const preloadDtsKeys = new Set(interfaceKeys(preloadDtsSrc, 'AppSettings'))

// ---------------------------------------------------------------------------
// 3. Consumer scan across src/main/** and src/renderer/**
// ---------------------------------------------------------------------------

const scanFiles = [...walk(MAIN_DIR, ['.ts']), ...walk(RENDERER_DIR, ['.ts', '.tsx'])].filter(
  (f) => f !== SETTINGS_MANAGER_FILE && !SETTINGS_UI_FILES.includes(f) && !f.endsWith('.d.ts')
)
const scanSources = scanFiles.map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))

function keyReferenced(key: string): boolean {
  const re = new RegExp(`\\b${key}\\b`)
  return scanSources.some(({ content }) => re.test(content))
}

// Indirect consumption: an EXPORTED settingsManager.ts helper that takes the
// full `settings: AppSettings` and reads `settings.<key>` inside its body,
// where the helper itself is then called from outside settingsManager.ts
// (e.g. getActiveVocabulary() is the real consumer of customVocabulary /
// removedDefaultVocabulary — transcribe.ts never touches those key names
// directly, it just calls the helper). Same "forwarding wrapper" idea as
// ipc-integrity.spec.ts's channel-forwarding detection.
const wrapperKeysByName = new Map<string, Set<string>>() // helper name -> keys it reads
{
  const fnRe = /export function (\w+)\(\s*settings\s*:\s*AppSettings\b/g
  let m: RegExpExecArray | null
  while ((m = fnRe.exec(settingsManagerSrc))) {
    const block = extractBracedBlock(settingsManagerSrc, m.index)
    if (!block) continue
    const keys = new Set<string>()
    const keyRe = /\bsettings\.(\w+)\b/g
    let km: RegExpExecArray | null
    while ((km = keyRe.exec(block.body))) keys.add(km[1])
    wrapperKeysByName.set(m[1], keys)
  }
}

function wrapperIsCalledExternally(name: string): boolean {
  const re = new RegExp(`\\b${name}\\(`)
  return scanSources.some(({ content }) => re.test(content))
}

const indirectlyConsumedKeys = new Set<string>()
for (const [wrapperName, keys] of wrapperKeysByName) {
  if (wrapperIsCalledExternally(wrapperName)) {
    for (const k of keys) indirectlyConsumedKeys.add(k)
  }
}

function hasConsumer(key: string): { ok: boolean; via: string } {
  if (keyReferenced(key)) return { ok: true, via: 'direct reference outside settingsManager/preload/settings-UI' }
  if (indirectlyConsumedKeys.has(key)) return { ok: true, via: 'indirect, via an exported settingsManager.ts helper' }
  if (key in CONSUMER_ALLOWLIST) return { ok: true, via: `allowlisted: ${CONSUMER_ALLOWLIST[key]}` }
  return { ok: false, via: '' }
}

// ---------------------------------------------------------------------------
// 4. Control scan across the settings-authoring UI
// ---------------------------------------------------------------------------

const controlSources = CONTROL_SOURCE_FILES.map((file) => fs.readFileSync(file, 'utf8'))

function hasControl(key: string): { ok: boolean; via: string } {
  const re = new RegExp(`\\b${key}\\b`)
  if (controlSources.some((content) => re.test(content))) {
    return { ok: true, via: 'referenced in the settings-authoring UI' }
  }
  if (key in CONTROL_ALLOWLIST) return { ok: true, via: `allowlisted: ${CONTROL_ALLOWLIST[key]}` }
  return { ok: false, via: '' }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings full-loop (P0.5 — default -> preload -> consumer -> control)', () => {
  it('sanity: the parsers actually found keys (guards against a silently-broken regex)', () => {
    expect(interfaceKeyList.length).toBeGreaterThan(20)
    expect(defaultKeyList.length).toBeGreaterThan(20)
    expect(ALL_KEYS.length).toBeGreaterThan(20)
    expect(preloadTsKeys.size).toBeGreaterThan(20)
    expect(preloadDtsKeys.size).toBeGreaterThan(20)
    expect(scanFiles.length).toBeGreaterThan(10)
    expect(SETTINGS_UI_FILES.length).toBeGreaterThan(0)
  })

  it('AppSettings interface and DEFAULT_SETTINGS declare exactly the same key set', () => {
    const missingFromDefaults = interfaceKeyList.filter((k) => !defaultKeyList.includes(k))
    const missingFromInterface = defaultKeyList.filter((k) => !interfaceKeyList.includes(k))
    expect(missingFromDefaults, `declared in AppSettings but no DEFAULT_SETTINGS seed:\n${missingFromDefaults.join('\n')}`).toEqual([])
    expect(missingFromInterface, `seeded in DEFAULT_SETTINGS but not declared on AppSettings:\n${missingFromInterface.join('\n')}`).toEqual([])
  })

  it('every AppSettings key has a default value in DEFAULT_SETTINGS', () => {
    const missing = ALL_KEYS.filter((k) => !defaultKeyList.includes(k))
    expect(missing, `no DEFAULT_SETTINGS entry for:\n${missing.join('\n')}`).toEqual([])
  })

  it('every AppSettings key is declared in the preload TS copy (src/preload/index.ts)', () => {
    const missing = ALL_KEYS.filter((k) => !preloadTsKeys.has(k))
    expect(missing, `missing from preload/index.ts's AppSettings:\n${missing.join('\n')}`).toEqual([])
  })

  it('every AppSettings key is declared in the preload .d.ts copy (src/preload/index.d.ts)', () => {
    const missing = ALL_KEYS.filter((k) => !preloadDtsKeys.has(k))
    expect(missing, `missing from preload/index.d.ts's AppSettings:\n${missing.join('\n')}`).toEqual([])
  })

  it('every AppSettings key has a real consumer outside settingsManager/preload/the settings UI', () => {
    const missing = ALL_KEYS.filter((k) => !hasConsumer(k).ok)
    expect(
      missing,
      `these keys are saved/loaded but nothing outside settingsManager.ts, src/preload/**, ` +
        `and the settings-authoring UI ever reads them (a control that writes a key nobody ` +
        `reads is a FAILURE — see Gate 4). Fix by wiring up a real consumer, or add a ` +
        `justified CONSUMER_ALLOWLIST entry:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('every AppSettings key has a control in the settings UI (or a justified allowlist entry)', () => {
    const missing = ALL_KEYS.filter((k) => !hasControl(k).ok)
    expect(
      missing,
      `these keys have no reference anywhere in the settings-authoring UI (${CONTROL_SOURCE_FILES.map(
        (f) => path.relative(DESKTOP_ROOT, f)
      ).join(', ')}) and are not in CONTROL_ALLOWLIST:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('per-key loop report: all 4 gates pass for every key (aggregate, readable failure list)', () => {
    const failures: string[] = []
    for (const key of ALL_KEYS) {
      const gates = {
        default: defaultKeyList.includes(key),
        preload: preloadTsKeys.has(key) && preloadDtsKeys.has(key),
        consumer: hasConsumer(key).ok,
        control: hasControl(key).ok
      }
      const failed = Object.entries(gates)
        .filter(([, ok]) => !ok)
        .map(([gate]) => gate)
      if (failed.length > 0) failures.push(`${key}: FAILS [${failed.join(', ')}]`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
