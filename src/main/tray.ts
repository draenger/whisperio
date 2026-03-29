import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { openSettingsWindow } from './settingsWindow'
import { openRecordingsWindow } from './recordingsWindow'
import { getActiveHotkey, getActiveSendHotkey } from './dictation/hotkeyManager'

let tray: Tray | null = null

function getIconPath(): string {
  if (is.dev) {
    return join(__dirname, '../../icons/whisperio.ico')
  }
  return join(process.resourcesPath, 'icons/whisperio.ico')
}

export function showTrayBalloon(title: string, content: string): void {
  if (!tray || tray.isDestroyed()) return
  tray.displayBalloon({ title, content, noSound: true })
}

export function createTray(): Tray {
  const iconPath = getIconPath()
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon)

  const hotkey = getActiveHotkey()
  const sendHotkey = getActiveSendHotkey()
  let tooltip = hotkey
    ? `Whisperio — press ${hotkey} to dictate`
    : 'Whisperio — no hotkey registered!'
  if (sendHotkey) {
    tooltip += ` | ${sendHotkey} to dictate & send`
  }
  tray.setToolTip(tooltip)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => openSettingsWindow() },
    { label: 'Recordings', click: () => openRecordingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => openSettingsWindow())

  // Show balloon notification so user knows which hotkey to press
  if (hotkey) {
    tray.displayBalloon({
      title: 'Whisperio',
      content: `Press ${hotkey} to start dictating.`,
      icon,
      noSound: true
    })
  } else {
    tray.displayBalloon({
      title: 'Whisperio',
      content: 'No hotkey could be registered. Close apps that may block Ctrl+Shift+Space.',
      icon,
      noSound: false
    })
  }

  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
