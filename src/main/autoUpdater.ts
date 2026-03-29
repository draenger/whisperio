import { autoUpdater } from 'electron-updater'
import { BrowserWindow, Notification } from 'electron'

export function initAutoUpdater(): void {
  if (!autoUpdater.isUpdaterActive()) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    console.log(`[Whisperio] Update available: v${info.version}`)
    if (Notification.isSupported()) {
      new Notification({
        title: 'Whisperio Update',
        body: `Version ${info.version} is downloading...`
      }).show()
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Whisperio] Update downloaded: v${info.version}`)
    if (Notification.isSupported()) {
      new Notification({
        title: 'Whisperio Update Ready',
        body: `Version ${info.version} will install on next restart.`
      }).show()
    }
    // Notify all windows
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('updater:ready', info.version)
      }
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[Whisperio] Auto-update error:', err.message)
  })

  // Check for updates after 10s, then every 4 hours
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 10_000)

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 4 * 60 * 60 * 1000)
}
