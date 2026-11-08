// Pinned paste target for the headset-button flow: remember a window, and
// before pasting bring it back to the foreground — VERIFYING that it really is
// foreground afterwards (SetForegroundWindow can silently fail). The OS calls
// are injected (FocusDeps) so the logic is unit-testable; the real deps use
// koffi/user32 (Windows), osascript (macOS) and xdotool (Linux). Deliberately
// does NOT use active-win (context.ts is the only module allowed to).
import { execFile } from 'child_process'

export interface FocusTarget {
  /** Opaque, comparable id: HWND (Windows), "pid:<n>" (macOS), window id (Linux). */
  handle: string
  pid: number
}

export interface FocusDeps {
  ownPid: number
  getForeground: () => Promise<FocusTarget | null> | FocusTarget | null
  /** Try to bring the target to the foreground. May silently fail; the controller verifies. */
  activate: (t: FocusTarget) => Promise<void> | void
  sleep: (ms: number) => Promise<void>
}

export interface FocusController {
  /** Pin the current foreground window (never our own); returns it or null. */
  pinForeground(): Promise<FocusTarget | null>
  getPinned(): FocusTarget | null
  clear(): void
  /**
   * true = pinned window is foreground (or nothing is pinned, so nothing to
   * enforce); false = could not be restored -> caller must NOT paste.
   */
  restore(): Promise<boolean>
}

const ATTEMPTS = 3
const SETTLE_MS = 120

export function createFocusController(deps: FocusDeps): FocusController {
  let pinned: FocusTarget | null = null
  const same = (a: FocusTarget | null, b: FocusTarget | null): boolean => !!a && !!b && a.handle === b.handle
  return {
    async pinForeground() {
      const fg = await deps.getForeground()
      if (!fg || fg.pid === deps.ownPid) return null
      pinned = fg
      return fg
    },
    getPinned: () => pinned,
    clear() {
      pinned = null
    },
    async restore() {
      if (!pinned) return true
      for (let i = 0; i < ATTEMPTS; i++) {
        if (same(await deps.getForeground(), pinned)) return true
        try {
          await deps.activate(pinned)
        } catch (err) {
          console.warn('[Whisperio] focus activate failed:', (err as Error)?.message)
        }
        await deps.sleep(SETTLE_MS)
      }
      return same(await deps.getForeground(), pinned)
    }
  }
}

// ---------------------------------------------------------------------------
// Real platform deps (lazy: nothing native is loaded at import time)
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim()))
  })
}

function windowsDeps(): Pick<FocusDeps, 'getForeground' | 'activate'> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()')
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(uintptr_t hWnd)')
  const IsIconic = user32.func('int __stdcall IsIconic(uintptr_t hWnd)')
  const ShowWindow = user32.func('int __stdcall ShowWindow(uintptr_t hWnd, int nCmdShow)')
  const AllowSetForegroundWindow = user32.func('int __stdcall AllowSetForegroundWindow(uint32_t dwProcessId)')
  const GetWindowThreadProcessId = user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'
  )
  const keybd_event = user32.func(
    'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
  )
  const VK_MENU = 0x12
  const KEYEVENTF_KEYUP = 0x0002
  const SW_RESTORE = 9
  const ASFW_ANY = 0xffffffff
  return {
    getForeground: () => {
      const h = GetForegroundWindow()
      if (!h) return null
      const pidOut = [0]
      GetWindowThreadProcessId(h, pidOut)
      return { handle: String(h), pid: pidOut[0] }
    },
    activate: (t) => {
      const h = BigInt(t.handle)
      if (IsIconic(h)) ShowWindow(h, SW_RESTORE)
      AllowSetForegroundWindow(ASFW_ANY)
      // Standard workaround: a synthetic Alt press makes the foreground lock
      // treat us as having received the last input event.
      keybd_event(VK_MENU, 0, 0, 0)
      keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
      SetForegroundWindow(h)
    }
  }
}

function macDeps(): Pick<FocusDeps, 'getForeground' | 'activate'> {
  return {
    getForeground: async () => {
      const out = await run('osascript', [
        '-e',
        'tell application "System Events" to get unix id of first process whose frontmost is true'
      ])
      const pid = parseInt(out, 10)
      return Number.isInteger(pid) && pid > 0 ? { handle: `pid:${pid}`, pid } : null
    },
    activate: async (t) => {
      await run('osascript', [
        '-e',
        `tell application "System Events" to set frontmost of (first process whose unix id is ${Math.trunc(t.pid)}) to true`
      ])
    }
  }
}

function linuxDeps(): Pick<FocusDeps, 'getForeground' | 'activate'> {
  return {
    getForeground: async () => {
      const id = await run('xdotool', ['getactivewindow'])
      if (!/^\d+$/.test(id)) return null
      const pid = parseInt(await run('xdotool', ['getwindowpid', id]), 10)
      return { handle: id, pid: Number.isInteger(pid) ? pid : 0 }
    },
    activate: async (t) => {
      if (/^\d+$/.test(t.handle)) await run('xdotool', ['windowactivate', t.handle])
    }
  }
}

let shared: FocusController | null = null

export function getFocusController(): FocusController {
  if (!shared) {
    const platformDeps =
      process.platform === 'win32' ? windowsDeps() : process.platform === 'darwin' ? macDeps() : linuxDeps()
    shared = createFocusController({
      ownPid: process.pid,
      ...platformDeps,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    })
  }
  return shared
}
