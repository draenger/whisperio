import { BrowserWindow, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let settingsWin: BrowserWindow | null = null

function getIconPath(): string {
  if (is.dev) {
    return join(__dirname, '../../icons/whisperio.ico')
  }
  return join(process.resourcesPath, 'icons/whisperio.ico')
}

export function openSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return
  }

  const icon = nativeImage.createFromPath(getIconPath())

  settingsWin = new BrowserWindow({
    width: 580,
    height: 780,
    minWidth: 520,
    minHeight: 600,
    resizable: true,
    frame: false,
    icon,
    title: 'Whisperio Settings',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  settingsWin.setMenu(Menu.buildFromTemplate([]))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/settings.html`)
  } else {
    settingsWin.loadFile(join(__dirname, '../renderer/settings/settings.html'))
  }

  settingsWin.on('closed', () => {
    settingsWin = null
  })
}
