import { ipcMain, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { createHash } from 'crypto'

interface LockSchema {
  pinHash: string | null
  timeoutMinutes: number
  enabled: boolean
}

const lockStore = new Store<LockSchema>({
  name: 'lock',
  defaults: {
    pinHash: null,
    timeoutMinutes: 5,
    enabled: false
  }
})

let locked = false
let lastActivity = Date.now()
let lockTimer: ReturnType<typeof setInterval> | null = null

function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex')
}

export function isLocked(): boolean {
  return locked
}

export function setupAppLock(mainWindow: BrowserWindow) {

  // Check if lock is configured
  ipcMain.handle('lock:getConfig', () => {
    return {
      enabled: lockStore.get('enabled'),
      timeoutMinutes: lockStore.get('timeoutMinutes'),
      hasPin: !!lockStore.get('pinHash'),
      isLocked: locked
    }
  })

  // Set up PIN
  ipcMain.handle('lock:setPin', (_event, pin: string) => {
    lockStore.set('pinHash', hashPin(pin))
    lockStore.set('enabled', true)
    startLockTimer(mainWindow)
    return true
  })

  // Change timeout
  ipcMain.handle('lock:setTimeout', (_event, minutes: number) => {
    lockStore.set('timeoutMinutes', minutes)
    if (lockStore.get('enabled')) {
      startLockTimer(mainWindow)
    }
    return true
  })

  // Disable lock
  ipcMain.handle('lock:disable', (_event, pin: string) => {
    const stored = lockStore.get('pinHash')
    if (stored && hashPin(pin) !== stored) return { error: 'Wrong PIN' }
    lockStore.set('enabled', false)
    lockStore.set('pinHash', null)
    locked = false
    if (lockTimer) { clearInterval(lockTimer); lockTimer = null }
    return { success: true }
  })

  // Lock now
  ipcMain.handle('lock:lockNow', () => {
    if (!lockStore.get('enabled')) return false
    locked = true
    mainWindow.webContents.send('lock:stateChanged', true)
    return true
  })

  // Unlock with PIN
  ipcMain.handle('lock:unlock', (_event, pin: string) => {
    const stored = lockStore.get('pinHash')
    if (!stored) return { error: 'No PIN set' }
    if (hashPin(pin) !== stored) return { error: 'Wrong PIN' }
    locked = false
    lastActivity = Date.now()
    mainWindow.webContents.send('lock:stateChanged', false)
    return { success: true }
  })

  // Track activity
  ipcMain.handle('lock:activity', () => {
    lastActivity = Date.now()
    return true
  })

  // Start auto-lock timer if enabled
  if (lockStore.get('enabled') && lockStore.get('pinHash')) {
    startLockTimer(mainWindow)
  }
}

function startLockTimer(mainWindow: BrowserWindow) {
  if (lockTimer) clearInterval(lockTimer)

  lockTimer = setInterval(() => {
    if (locked || !lockStore.get('enabled')) return
    const timeout = lockStore.get('timeoutMinutes') * 60 * 1000
    if (Date.now() - lastActivity > timeout) {
      locked = true
      mainWindow.webContents.send('lock:stateChanged', true)
    }
  }, 10000) // Check every 10 seconds
}
