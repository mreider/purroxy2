import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, ipcMain } from 'electron'
import { execSync } from 'child_process'

let mainWindow: BrowserWindow | null = null
let checkTimeout: ReturnType<typeof setTimeout> | null = null
let checkInterval: ReturnType<typeof setInterval> | null = null

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes: string; releaseDate: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

function sendStatus(status: UpdateStatus) {
  mainWindow?.webContents.send('updates:status', status)
}

// updates:getVersion works in both dev and production
ipcMain.handle('updates:getVersion', () => app.getVersion())

export function setupUpdater(win: BrowserWindow) {
  mainWindow = win

  // Don't check for updates in dev mode — IPC handlers below are no-ops
  if (!app.isPackaged) {
    ipcMain.handle('updates:check', async () => ({ error: 'Updates disabled in dev mode' }))
    ipcMain.handle('updates:download', async () => ({ error: 'Updates disabled in dev mode' }))
    ipcMain.handle('updates:install', async () => ({ error: 'Updates disabled in dev mode' }))
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  // Events → renderer
  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const notes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n: any) => n.note || '').join('\n')
        : ''
    sendStatus({
      state: 'available',
      version: info.version,
      releaseNotes: notes,
      releaseDate: info.releaseDate || ''
    })
  })

  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({
      state: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    sendStatus({ state: 'error', message: err.message || 'Update failed' })
  })

  // IPC handlers
  ipcMain.handle('updates:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, version: result?.updateInfo.version }
    } catch (err: any) {
      return { error: err.message || 'Check failed' }
    }
  })

  ipcMain.handle('updates:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      return { error: err.message || 'Download failed' }
    }
  })

  ipcMain.handle('updates:install', async () => {
    try {
      killMCPServer()
      autoUpdater.quitAndInstall()
    } catch (err: any) {
      return { error: err.message || 'Install failed' }
    }
  })

  // Check on startup (after a short delay to let the UI settle)
  checkTimeout = setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)

  // Check every 4 hours
  checkInterval = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
}

// Clean up timers on quit
app.on('will-quit', () => {
  if (checkTimeout) clearTimeout(checkTimeout)
  if (checkInterval) clearInterval(checkInterval)
})

function killMCPServer() {
  try {
    if (process.platform === 'win32') {
      execSync('wmic process where "commandline like \'%mcp-server.mjs%\'" call terminate', { stdio: 'ignore' })
    } else {
      execSync('pkill -f mcp-server.mjs', { stdio: 'ignore' })
    }
  } catch {
    // Process may not be running — that's fine
  }
}
