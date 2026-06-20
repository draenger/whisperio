import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { openSettingsWindow } from './settingsWindow'
import { getActiveHotkey, getActiveSendHotkey } from './dictation/hotkeyManager'

let tray: Tray | null = null
let updateReadyVersion: string | null = null
let onInstallUpdate: (() => void) | null = null

function getIconPath(): string {
  // macOS menubar can't render Windows .ico files (comes out blank/invisible),
  // so use the PNG there; Windows keeps the .ico.
  const file = process.platform === 'darwin' ? 'whisperio.png' : 'whisperio.ico'
  if (is.dev) {
    return join(__dirname, '../../icons', file)
  }
  return join(process.resourcesPath, 'icons', file)
}

function getTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(getIconPath())
  // The PNG is full-size; the macOS menubar needs a small icon.
  if (process.platform === 'darwin' && !icon.isEmpty()) {
    return icon.resize({ width: 18, height: 18 })
  }
  return icon
}

export function showTrayBalloon(title: string, content: string): void {
  if (!tray || tray.isDestroyed()) return
  tray.displayBalloon({ title, content, noSound: true })
}

export function createTray(): Tray {
  const icon = getTrayIcon()
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

  rebuildMenu()
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

function rebuildMenu(): void {
  if (!tray || tray.isDestroyed()) return
  const items: Electron.MenuItemConstructorOptions[] = []
  if (updateReadyVersion) {
    items.push(
      { label: `Restart to update (v${updateReadyVersion})`, click: () => onInstallUpdate?.() },
      { type: 'separator' }
    )
  }
  items.push(
    { label: 'Settings', click: () => openSettingsWindow() },
    { label: 'Recordings', click: () => openSettingsWindow('recordings') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

/** Called by the auto-updater when a downloaded update is ready to install. */
export function setUpdateReady(version: string, onInstall: () => void): void {
  updateReadyVersion = version
  onInstallUpdate = onInstall
  rebuildMenu()
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
