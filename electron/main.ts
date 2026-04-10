import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'path'
import { setupTray } from './tray'
import { setupIPC } from './ipc'
import { setupBrowserView, getSiteView } from './browser-view'
import { setupRecorder } from './recorder'
import { setupAI } from './ai'
import { setupExecutor } from './executor'
import { startMCPApi } from './mcp-api'
import { setupVault } from './vault'
import { setupAppLock } from './app-lock'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111827' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // In dev, load from Vite dev server; in prod, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of quitting
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
      // Hide from dock on macOS — tray icon stays
      if (process.platform === 'darwin') app.dock.hide()
    }
  })

  mainWindow.on('show', () => {
    // Show in dock again when window is visible
    if (process.platform === 'darwin') app.dock.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    const { nativeImage } = require('electron')
    const dockIcon = nativeImage.createFromPath(
      path.join(__dirname, '../resources/icon.png')
    )
    app.dock.setIcon(dockIcon)
  }

  setupIPC()
  createWindow()
  setupBrowserView(mainWindow!)
  setupRecorder(mainWindow!, getSiteView)
  setupAI(mainWindow!, getSiteView)
  setupExecutor(mainWindow!)
  setupVault()
  setupAppLock(mainWindow!)
  startMCPApi()
  setupTray(mainWindow!)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Allow the app to actually quit when explicitly requested
app.on('before-quit', () => {
  (app as any).isQuitting = true
})
