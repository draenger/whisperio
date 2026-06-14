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

export function openSettingsWindow(initialTab?: string): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (initialTab) {
      settingsWin.webContents.send('settings:set-tab', initialTab)
    }
    settingsWin.focus()
    return
  }

  const icon = nativeImage.createFromPath(getIconPath())

  settingsWin = new BrowserWindow({
    width: 760,
    height: 780,
    minWidth: 660,
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

  const hash = initialTab ? `#${initialTab}` : ''
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/settings.html${hash}`)
  } else {
    settingsWin.loadFile(join(__dirname, '../renderer/settings/settings.html'), initialTab ? { hash: initialTab } : undefined)
  }

  settingsWin.on('closed', () => {
    settingsWin = null
  })
}
