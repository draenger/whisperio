import { clipboard, systemPreferences, Notification } from 'electron'
import { execFile } from 'child_process'

function isWindows(): boolean {
  return process.platform === 'win32'
}

function isMac(): boolean {
  return process.platform === 'darwin'
}

// Platform-specific keystroke simulation
let sendKeystroke: (vk: 'paste' | 'enter') => void

if (isWindows()) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi')
  const user32 = koffi.load('user32.dll')
  const keybd_event = user32.func(
    'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
  )

  const VK_RETURN = 0x0d
  const VK_CONTROL = 0x11
  const VK_V = 0x56
  const KEYEVENTF_KEYUP = 0x0002

  sendKeystroke = (vk) => {
    if (vk === 'paste') {
      keybd_event(VK_CONTROL, 0, 0, 0)
      keybd_event(VK_V, 0, 0, 0)
      keybd_event(VK_V, 0, KEYEVENTF_KEYUP, 0)
      keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
    } else {
      keybd_event(VK_RETURN, 0, 0, 0)
      keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, 0)
    }
  }
} else if (isMac()) {
  sendKeystroke = (vk) => {
    const script = vk === 'paste'
      ? 'tell application "System Events" to keystroke "v" using command down'
      : 'tell application "System Events" to key code 36'
    execFile('osascript', ['-e', script], (err, _stdout, stderr) => {
      if (err || stderr) {
        console.error('[Whisperio] keystroke failed (Accessibility permission?):', stderr || err?.message)
      }
    })
  }
} else {
  // Linux — xdotool
  sendKeystroke = (vk) => {
    const key = vk === 'paste' ? 'ctrl+v' : 'Return'
    execFile('xdotool', ['key', key])
  }
}

// macOS: synthesizing ⌘V via System Events requires Accessibility permission.
// Returns true if granted. With prompt=true the first call adds Whisperio to the
// Accessibility list and shows the system prompt.
export function ensureAccessibilityPermission(prompt = false): boolean {
  if (!isMac()) return true
  return systemPreferences.isTrustedAccessibilityClient(prompt)
}

export function captureTargetWindow(): void {
  // No-op — overlay uses showInactive() so the user's window keeps focus.
}

export function restoreTargetWindow(): void {
  // No-op — focus was never stolen, nothing to restore.
}

export async function autoPaste(text: string): Promise<void> {
  console.log(`[Whisperio] autoPaste: "${text.substring(0, 80)}..."`)
  clipboard.writeText(text)

  // macOS: without Accessibility permission the ⌘V keystroke silently no-ops.
  // Leave the text on the clipboard and tell the user how to enable auto-paste.
  if (isMac() && !ensureAccessibilityPermission(true)) {
    console.warn('[Whisperio] No Accessibility permission — text left on clipboard, auto-paste skipped')
    new Notification({
      title: 'Whisperio — enable auto-paste',
      body: 'Your text is on the clipboard (press ⌘V). To paste automatically, enable Whisperio in System Settings → Privacy & Security → Accessibility.'
    }).show()
    return
  }

  // Wait for modifier keys from hotkey to release
  await new Promise((r) => setTimeout(r, 300))

  sendKeystroke('paste')
  console.log('[Whisperio] autoPaste done')
}

export function sendEnter(): void {
  sendKeystroke('enter')
}
