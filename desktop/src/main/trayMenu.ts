import type { MenuItemConstructorOptions } from 'electron'
import { isHoldSupported, type HotkeyMode } from './dictation/overlayHint'

export interface TrayMenuOptions {
  platform: NodeJS.Platform
  hotkeyMode: HotkeyMode
  updateReadyVersion: string | null
  onInstallUpdate: () => void
  onOpenSettings: () => void
  onOpenRecordings: () => void
  onSetHotkeyMode: (mode: HotkeyMode) => void
  onQuit: () => void
}

/** Pure tray menu template builder (testable without electron). */
export function buildTrayMenuTemplate(o: TrayMenuOptions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (o.updateReadyVersion) {
    items.push(
      { label: `Restart to update (v${o.updateReadyVersion})`, click: () => o.onInstallUpdate() },
      { type: 'separator' }
    )
  }
  const holdOk = isHoldSupported(o.platform)
  items.push(
    { label: 'Settings', click: () => o.onOpenSettings() },
    { label: 'Recordings', click: () => o.onOpenRecordings() },
    { type: 'separator' },
    holdOk
      ? {
          label: 'Hold to talk',
          type: 'checkbox',
          checked: o.hotkeyMode === 'hold',
          click: (item) => o.onSetHotkeyMode(item.checked ? 'hold' : 'toggle')
        }
      : { label: 'Hold to talk (not available on Linux)', type: 'checkbox', checked: false, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => o.onQuit() }
  )
  return items
}
