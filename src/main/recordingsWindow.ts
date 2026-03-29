import { BrowserWindow, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let recordingsWin: BrowserWindow | null = null

function getIconPath(): string {
  if (is.dev) {
    return join(__dirname, '../../icons/whisperio.ico')
  }
  return join(process.resourcesPath, 'icons/whisperio.ico')
}

export function openRecordingsWindow(): void {
  if (recordingsWin && !recordingsWin.isDestroyed()) {
    recordingsWin.focus()
    return
  }

  const icon = nativeImage.createFromPath(getIconPath())

  recordingsWin = new BrowserWindow({
    width: 700,
    height: 600,
    minWidth: 500,
    minHeight: 400,
    resizable: true,
    frame: false,
    icon,
    title: 'Whisperio Recordings',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  recordingsWin.setMenu(Menu.buildFromTemplate([]))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    recordingsWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/recordings/recordings.html`)
  } else {
    recordingsWin.loadFile(join(__dirname, '../renderer/recordings/recordings.html'))
  }

  recordingsWin.on('closed', () => {
    recordingsWin = null
  })
}
