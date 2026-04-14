import { ipcMain, shell, clipboard, app, BrowserWindow, screen } from 'electron'
import { store } from './store'
import { getAllSites, createSite, saveSession, deleteSite } from './sites'
import { getAllCapabilities, getCapabilitiesForSite, createCapability, deleteCapability, updateCapability } from './capabilities'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync, exec } from 'child_process'

export function setupIPC() {
  // Settings
  ipcMain.handle('settings:get', (_event, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('settings:getAll', () => {
    return store.store
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    store.set(key, value)
    return true
  })

  // Sites
  ipcMain.handle('sites:getAll', () => {
    return getAllSites()
  })

  ipcMain.handle('sites:create', (_event, url: string, name: string, faviconUrl: string) => {
    return createSite(url, name, faviconUrl)
  })

  ipcMain.handle('sites:saveSession', (_event, siteId: string, session: { cookies: unknown[]; localStorage: Record<string, string> }) => {
    saveSession(siteId, session as any)
    return true
  })

  ipcMain.handle('sites:delete', (_event, id: string) => {
    // Delete all capabilities belonging to this site first
    const siteCaps = getCapabilitiesForSite(id)
    for (const cap of siteCaps) {
      deleteCapability(cap.id)
    }
    deleteSite(id)
    return true
  })

  // Capabilities
  ipcMain.handle('capabilities:getAll', () => {
    return getAllCapabilities()
  })

  ipcMain.handle('capabilities:getForSite', (_event, siteProfileId: string) => {
    return getCapabilitiesForSite(siteProfileId)
  })

  ipcMain.handle('capabilities:create', (_event, data: any) => {
    return createCapability(data)
  })

  ipcMain.handle('capabilities:delete', (_event, id: string) => {
    deleteCapability(id)
    return true
  })

  ipcMain.handle('capabilities:update', (_event, id: string, updates: any) => {
    return updateCapability(id, updates)
  })

  // Claude Desktop integration
  ipcMain.handle('claude:getStatus', () => {
    const configPath = getClaudeConfigPath()
    const configDir = path.dirname(configPath)

    if (!fs.existsSync(configDir)) {
      console.log('[claude] Config dir not found:', configDir)
      return { installed: false, connected: false }
    }

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      const connected = !!config?.mcpServers?.purroxy
      console.log('[claude] Status — installed: true, connected:', connected)
      return { installed: true, connected, configPath }
    } catch {
      console.log('[claude] Config dir exists but no valid config file at:', configPath)
      return { installed: true, connected: false, configPath }
    }
  })

  ipcMain.handle('claude:connect', () => {
    try {
      const configPath = getClaudeConfigPath()

      // Get absolute path to mcp-server.mjs
      // In packaged app, asarUnpack puts it at app.asar.unpacked/mcp-server.mjs
      const appPath = app.getAppPath()
      const mcpServerPath = appPath.includes('.asar')
        ? path.resolve(appPath.replace('.asar', '.asar.unpacked'), 'mcp-server.mjs')
        : path.resolve(appPath, 'mcp-server.mjs')

      if (!fs.existsSync(mcpServerPath)) {
        console.error('[claude] MCP server not found at:', mcpServerPath)
        return { error: `MCP server not found at ${mcpServerPath}` }
      }

      // Read existing config or create new
      let config: any = {}
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      } catch {
        // Config doesn't exist yet — create directory
        console.log('[claude] No existing config, creating directory:', path.dirname(configPath))
        fs.mkdirSync(path.dirname(configPath), { recursive: true })
      }

      // Add/update purroxy server
      if (!config.mcpServers) config.mcpServers = {}
      config.mcpServers.purroxy = {
        command: 'node',
        args: [mcpServerPath]
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      console.log('[claude] Connected — wrote config to:', configPath, 'server:', mcpServerPath)
      return { success: true, configPath, mcpServerPath }
    } catch (err: any) {
      console.error('[claude] Connect failed:', err)
      return { error: `Failed to connect: ${err.message}` }
    }
  })

  ipcMain.handle('claude:disconnect', () => {
    try {
      const configPath = getClaudeConfigPath()

      if (!fs.existsSync(configPath)) {
        console.log('[claude] No config file to disconnect from:', configPath)
        return { success: true }
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (config?.mcpServers?.purroxy) {
        delete config.mcpServers.purroxy
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        console.log('[claude] Disconnected — removed purroxy from:', configPath)
      } else {
        console.log('[claude] Already disconnected (no purroxy entry in config)')
      }
      return { success: true }
    } catch (err: any) {
      console.error('[claude] Disconnect failed:', err)
      return { error: `Failed to disconnect: ${err.message}` }
    }
  })

  // Window management
  let savedBounds: Electron.Rectangle | null = null
  ipcMain.handle('window:expandForRecording', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    savedBounds = win.getBounds()
    const display = screen.getDisplayMatching(savedBounds)
    // Expand to ~90% of screen width, keep height
    const newWidth = Math.round(display.workArea.width * 0.9)
    const newX = Math.round(display.workArea.x + (display.workArea.width - newWidth) / 2)
    win.setBounds({ x: newX, y: savedBounds.y, width: newWidth, height: savedBounds.height }, true)
  })

  ipcMain.handle('window:restoreSize', () => {
    if (!savedBounds) return
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    win.setBounds(savedBounds, true)
    savedBounds = null
  })

  // System
  ipcMain.handle('system:copyAndOpenClaude', async (_event, text: string) => {
    clipboard.writeText(text)

    let installed = false
    if (process.platform === 'darwin') {
      installed = fs.existsSync('/Applications/Claude.app')
    } else if (process.platform === 'win32') {
      try { execSync('where claude', { stdio: 'ignore' }); installed = true } catch { installed = false }
    } else {
      try { execSync('which claude', { stdio: 'ignore' }); installed = true } catch { installed = false }
    }

    if (installed) {
      if (process.platform === 'darwin') {
        exec('open -a "Claude"')
      } else if (process.platform === 'win32') {
        exec('start "" "Claude"')
      }
      return { opened: true }
    } else {
      return { opened: false, downloadUrl: 'https://claude.ai/download' }
    }
  })
}

function getClaudeConfigPath(): string {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  } else if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
  } else {
    return path.join(home, '.config', 'Claude', 'claude_desktop_config.json')
  }
}
