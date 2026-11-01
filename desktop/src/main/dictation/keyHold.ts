/**
 * Hold-to-talk support: Electron's globalShortcut only reports key PRESS (and
 * auto-repeats while held), never release. To know when the user lets go of the
 * dictation hotkey we poll the OS key state (no native build, no new npm
 * dependency — koffi is already bundled for autoPaste.ts):
 *
 *  - Windows: user32 GetAsyncKeyState(vk)
 *  - macOS:   CoreGraphics CGEventSourceKeyState(combinedSessionState, keycode)
 *  - other / backend load failure: unsupported -> callers get `null` and fall
 *    back to plain toggle behaviour (one warning is logged).
 *
 * Release semantics (deliberate choice): we only watch the MAIN key of the
 * accelerator (e.g. Space in Ctrl+Shift+Space), not the modifiers. Releasing a
 * modifier first while still holding the main key does not stop the recording;
 * the recording ends when the main key goes up. This keeps the mapping surface
 * small (one key, no left/right modifier variants) and avoids false releases.
 * A safety timeout ends a watch that never sees a release (stuck key / lost
 * focus / backend glitch).
 */

export interface ParsedAccelerator {
  /** Normalised modifiers: 'ctrl' | 'alt' | 'shift' | 'meta' (deduplicated). */
  modifiers: string[]
  /** Normalised main key, e.g. 'A', '5', 'F12', 'SPACE', 'ENTER', ';'. */
  key: string
}

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  commandorcontrol: 'ctrl',
  cmdorctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  altgr: 'alt',
  shift: 'shift',
  super: 'meta',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta'
}

const KEY_ALIASES: Record<string, string> = {
  space: 'SPACE',
  tab: 'TAB',
  enter: 'ENTER',
  return: 'ENTER',
  escape: 'ESCAPE',
  esc: 'ESCAPE',
  backspace: 'BACKSPACE',
  delete: 'DELETE',
  insert: 'INSERT',
  home: 'HOME',
  end: 'END',
  pageup: 'PAGEUP',
  pagedown: 'PAGEDOWN',
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  plus: '+'
}

/** Split an Electron accelerator ("Ctrl+Shift+Space", "Alt+Plus") into modifiers + main key. */
export function parseAccelerator(accel: string): ParsedAccelerator | null {
  if (typeof accel !== 'string' || !accel.trim()) return null
  // A trailing "+" ("Ctrl++") is the literal plus key.
  const parts = accel
    .trim()
    .replace(/\+\+$/, '+Plus')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const modifiers: string[] = []
  let key: string | null = null
  for (const part of parts) {
    const lower = part.toLowerCase()
    const mod = MODIFIER_ALIASES[lower]
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod)
      continue
    }
    if (key !== null) return null // two main keys: not a valid accelerator
    key = KEY_ALIASES[lower] ?? part.toUpperCase()
  }
  if (key === null) return null
  return { modifiers, key }
}

const WIN_PUNCT: Record<string, number> = {
  ';': 0xba,
  '=': 0xbb,
  '+': 0xbb,
  ',': 0xbc,
  '-': 0xbd,
  '.': 0xbe,
  '/': 0xbf,
  '`': 0xc0,
  '[': 0xdb,
  '\\': 0xdc,
  ']': 0xdd,
  "'": 0xde
}
const WIN_NAMED: Record<string, number> = {
  SPACE: 0x20,
  TAB: 0x09,
  ENTER: 0x0d,
  ESCAPE: 0x1b,
  BACKSPACE: 0x08,
  DELETE: 0x2e,
  INSERT: 0x2d,
  HOME: 0x24,
  END: 0x23,
  PAGEUP: 0x21,
  PAGEDOWN: 0x22,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  NUMMULT: 0x6a,
  NUMADD: 0x6b,
  NUMSUB: 0x6d,
  NUMDEC: 0x6e,
  NUMDIV: 0x6f
}

/**
 * Windows virtual-key code for a normalised main key, or null if unknown.
 *
 * Deliberately a STATIC table, not VkKeyScanExW: Electron maps accelerator
 * characters to virtual keys with its own fixed table (e.g. ';' -> VK_OEM_1,
 * '-' -> VK_OEM_MINUS) and registers via RegisterHotKey with that code, so the
 * key that triggers the hotkey is the fixed-table VK regardless of keyboard
 * layout. Polling that same VK keeps press and release detection on one key.
 * (A layout-aware lookup would poll a different physical key on QWERTZ/AZERTY.)
 * VK_A..Z / VK_0..9 are the ASCII codes by definition.
 */
export function winVirtualKey(key: string): number | null {
  if (/^[A-Z]$/.test(key)) return key.charCodeAt(0) // 0x41..0x5A
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0) // 0x30..0x39
  const f = /^F(\d{1,2})$/.exec(key)
  if (f) {
    const n = Number(f[1])
    return n >= 1 && n <= 24 ? 0x70 + n - 1 : null
  }
  const num = /^NUM([0-9])$/.exec(key)
  if (num) return 0x60 + Number(num[1])
  if (key in WIN_NAMED) return WIN_NAMED[key]
  if (key in WIN_PUNCT) return WIN_PUNCT[key]
  return null
}

const MAC_KEYS: Record<string, number> = {
  A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13,
  E: 14, R: 15, Y: 16, T: 17, '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23,
  '=': 24, '+': 24, '9': 25, '7': 26, '-': 27, '8': 28, '0': 29, ']': 30, O: 31,
  U: 32, '[': 33, I: 34, P: 35, L: 37, J: 38, "'": 39, K: 40, ';': 41, '\\': 42,
  ',': 43, '/': 44, N: 45, M: 46, '.': 47, '`': 50,
  ENTER: 36, TAB: 48, SPACE: 49, BACKSPACE: 51, ESCAPE: 53, DELETE: 117,
  HOME: 115, END: 119, PAGEUP: 116, PAGEDOWN: 121,
  LEFT: 123, RIGHT: 124, DOWN: 125, UP: 126,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101,
  F10: 109, F11: 103, F12: 111, F13: 105, F14: 107, F15: 113, F16: 106, F17: 64,
  F18: 79, F19: 80, F20: 90
}

/** macOS virtual keycode (ANSI layout) for a normalised main key, or null if unknown. */
export function macKeyCode(key: string): number | null {
  return key in MAC_KEYS ? MAC_KEYS[key] : null
}

let warned = new Set<string>()
function warnOnce(msg: string): void {
  if (warned.has(msg)) return
  warned.add(msg)
  console.warn(`[Whisperio] ${msg}`)
}
/** Test helper: forget which warnings were already logged. */
export function _resetKeyHoldWarnings(): void {
  warned = new Set<string>()
  backendCache.clear()
  deps = { ...defaultDeps }
  inputMonCache = null
  firstPollUpStreak = 0
  macDegraded = false
  notified = false
}

type RawKeyState = (code: number) => boolean

/** IOHIDAccessType: 0 granted, 1 denied, 2 unknown (not yet asked). */
export type InputMonitoringAccess = 0 | 1 | 2

const MSG_INPUT_MONITORING =
  "Hold-to-talk can't read the keyboard. Grant Input Monitoring to Whisperio in System Settings → Privacy & Security, or switch to toggle mode."

// Overridable seams (tests inject fakes; production resolves natives lazily).
interface Deps {
  checkInputMonitoring: () => InputMonitoringAccess | null
  notify: (title: string, body: string) => void
}
const defaultDeps: Deps = {
  checkInputMonitoring: () => checkInputMonitoringNative(),
  notify: () => {}
}
let deps: Deps = { ...defaultDeps }

/** Wire the one-time user notification (hotkeyManager passes errorHandler.notifyInfo). */
export function setKeyHoldNotifier(fn: (title: string, body: string) => void): void {
  deps.notify = fn
}
/** Test helper: override native seams. Reset with _resetKeyHoldWarnings(). */
export function _setKeyHoldDeps(over: Partial<Deps>): void {
  deps = { ...deps, ...over }
}

let inputMonCache: { value: (() => InputMonitoringAccess) | null } | null = null
function checkInputMonitoringNative(): InputMonitoringAccess | null {
  if (!inputMonCache) {
    let fn: (() => InputMonitoringAccess) | null = null
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi')
      const iokit = koffi.load('/System/Library/Frameworks/IOKit.framework/IOKit')
      const IOHIDCheckAccess = iokit.func('uint32_t IOHIDCheckAccess(uint32_t requestType)')
      const kIOHIDRequestTypeListenEvent = 1
      fn = () => {
        const r = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)
        return (r === 0 || r === 1 ? r : 2) as InputMonitoringAccess
      }
    } catch {
      fn = null // API unavailable (old macOS / load failure): rely on the first-poll heuristic
    }
    inputMonCache = { value: fn }
  }
  try {
    return inputMonCache.value ? inputMonCache.value() : null
  } catch {
    return null
  }
}

// macOS: CGEventSourceKeyState reads "up" for everything without Input
// Monitoring, which would look like an instant release -> silent cancel.
const FIRST_POLL_UP_LIMIT = 3
let firstPollUpStreak = 0
let macDegraded = false
let notified = false
function notifyInputMonitoringOnce(): void {
  if (notified) return
  notified = true
  try {
    deps.notify('Whisperio', MSG_INPUT_MONITORING)
  } catch {
    /* notification is best-effort */
  }
}

// Native backend per platform, loaded once lazily. A failed load is cached as
// null so we neither retry koffi.load on every hotkey press nor re-warn.
const backendCache = new Map<string, RawKeyState | null>()

function loadBackend(platform: NodeJS.Platform): RawKeyState | null {
  if (backendCache.has(platform)) return backendCache.get(platform) ?? null
  let backend: RawKeyState | null = null
  try {
    if (platform === 'win32') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi')
      const user32 = koffi.load('user32.dll')
      const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vKey)')
      // High bit set = currently down (the int16 is negative then).
      backend = (vk) => (GetAsyncKeyState(vk) & 0x8000) !== 0
    } else if (platform === 'darwin') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi')
      const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
      const CGEventSourceKeyState = cg.func('bool CGEventSourceKeyState(int32_t stateID, uint16_t key)')
      const kCGEventSourceStateCombinedSessionState = 0
      backend = (code) => Boolean(CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, code))
    } else {
      warnOnce(`Hold-to-talk is not supported on ${platform} — using toggle mode`)
    }
  } catch (err) {
    warnOnce(
      `Hold-to-talk key-state backend failed to load (${err instanceof Error ? err.message : String(err)}) — using toggle mode`
    )
    backend = null
  }
  backendCache.set(platform, backend)
  return backend
}

/** Returns a "is this key currently down?" function for the platform, or null. */
export function createKeyStateReader(
  key: string,
  platform: NodeJS.Platform = process.platform
): (() => boolean) | null {
  if (platform !== 'win32' && platform !== 'darwin') {
    loadBackend(platform)
    return null
  }
  if (platform === 'darwin') {
    if (macDegraded) return null
    // 0 granted / 1 denied / 2 unknown / null no API. Only a definite "denied" short-circuits.
    if (deps.checkInputMonitoring() === 1) {
      notifyInputMonitoringOnce()
      return null
    }
  }
  const code = platform === 'win32' ? winVirtualKey(key) : macKeyCode(key)
  if (code === null) {
    warnOnce(`Hold-to-talk: unsupported key "${key}" — using toggle mode`)
    return null
  }
  const backend = loadBackend(platform)
  if (!backend) return null
  return () => backend(code)
}

export interface WatchOptions {
  /** Poll interval, default 25 ms. */
  pollMs?: number
  /** Safety cap: fire onRelease after this long even if no release was seen. Default 10 min. */
  maxDurationMs?: number
  /** Injectable key-state function (tests). Defaults to the platform backend. */
  isKeyDown?: () => boolean
  /** Injectable platform (tests). */
  platform?: NodeJS.Platform
  /**
   * Called when hold detection is judged unreliable mid-session (macOS first-poll
   * heuristic). The watcher stops polling but KEEPS its safety timer; the caller
   * must continue the recording with toggle semantics (next press stops).
   */
  onFallback?: () => void
}

export const DEFAULT_POLL_MS = 25
export const DEFAULT_MAX_HOLD_MS = 10 * 60 * 1000

/**
 * Poll the main key of `accel` and call `onRelease` exactly once when it is no
 * longer down (or when the max duration elapses). Returns a cancel function, or
 * null when hold detection is unavailable (caller must fall back to toggle).
 */
export function watchKeyRelease(
  accel: string,
  onRelease: () => void,
  opts: WatchOptions = {}
): (() => void) | null {
  const parsed = parseAccelerator(accel)
  if (!parsed) {
    warnOnce(`Hold-to-talk: cannot parse hotkey "${accel}" — using toggle mode`)
    return null
  }
  const isDown = opts.isKeyDown ?? createKeyStateReader(parsed.key, opts.platform)
  if (!isDown) return null

  let done = false
  let firstPoll = true
  const trackFirstPoll = (opts.platform ?? process.platform) === 'darwin'
  let poll: ReturnType<typeof setInterval> | null = null
  let max: ReturnType<typeof setTimeout> | null = null

  const stop = (): void => {
    done = true
    if (poll) clearInterval(poll)
    if (max) clearTimeout(max)
    poll = null
    max = null
  }
  const fire = (): void => {
    if (done) return
    stop()
    onRelease()
  }

  poll = setInterval(() => {
    let down = true
    try {
      down = isDown()
    } catch (err) {
      console.warn('[Whisperio] Hold-to-talk key-state read failed — releasing:', err)
      down = false
    }
    const wasFirst = firstPoll
    firstPoll = false
    if (trackFirstPoll && wasFirst) {
      if (down) {
        firstPollUpStreak = 0
      } else if (++firstPollUpStreak >= FIRST_POLL_UP_LIMIT) {
        // Key read as up immediately in consecutive sessions: permission or layout
        // problem. Stay in toggle mode (do NOT release/cancel) and tell the user once.
        macDegraded = true
        if (poll) clearInterval(poll)
        poll = null // keep `max` (safety timer) running; `stop` still clears it
        // Warn about Input Monitoring only if the OS does not say it is granted
        // (denied / unknown / API unavailable); granted means a different cause.
        if (deps.checkInputMonitoring() !== 0) notifyInputMonitoringOnce()
        else console.warn('[Whisperio] Hold-to-talk: key reads up immediately although Input Monitoring is granted — using toggle mode')
        try {
          opts.onFallback?.()
        } catch (err) {
          console.warn('[Whisperio] Hold-to-talk fallback callback failed:', err)
        }
        return
      }
    }
    if (!down) fire()
  }, opts.pollMs ?? DEFAULT_POLL_MS)
  max = setTimeout(fire, opts.maxDurationMs ?? DEFAULT_MAX_HOLD_MS)

  return stop
}
