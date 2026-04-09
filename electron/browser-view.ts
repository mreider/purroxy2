import { BrowserWindow, WebContentsView, ipcMain } from 'electron'

let siteView: WebContentsView | null = null

export function getSiteView(): WebContentsView | null {
  return siteView
}

export function setupBrowserView(mainWindow: BrowserWindow) {
  ipcMain.handle('browser:open', (_event, url: string) => {
    if (siteView) {
      siteView.webContents.loadURL(normalizeUrl(url))
      return
    }

    siteView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    mainWindow.contentView.addChildView(siteView)
    positionView(mainWindow)

    // Forward URL and title changes to the renderer
    siteView.webContents.on('did-navigate', (_e, url) => {
      mainWindow.webContents.send('browser:url-changed', url)
    })
    siteView.webContents.on('did-navigate-in-page', (_e, url) => {
      mainWindow.webContents.send('browser:url-changed', url)
    })
    siteView.webContents.on('page-title-updated', (_e, title) => {
      mainWindow.webContents.send('browser:title-changed', title)
    })
    siteView.webContents.on('did-start-loading', () => {
      mainWindow.webContents.send('browser:loading', true)
    })
    siteView.webContents.on('did-stop-loading', () => {
      mainWindow.webContents.send('browser:loading', false)
    })

    // Intercept new windows (target="_blank", window.open) — load in our view instead
    siteView.webContents.setWindowOpenHandler(({ url }) => {
      siteView!.webContents.loadURL(url)
      return { action: 'deny' }
    })

    siteView.webContents.loadURL(normalizeUrl(url))
  })

  ipcMain.handle('browser:navigate', (_event, url: string) => {
    siteView?.webContents.loadURL(normalizeUrl(url))
  })

  ipcMain.handle('browser:back', () => {
    if (siteView?.webContents.canGoBack()) siteView.webContents.goBack()
  })

  ipcMain.handle('browser:forward', () => {
    if (siteView?.webContents.canGoForward()) siteView.webContents.goForward()
  })

  ipcMain.handle('browser:reload', () => {
    siteView?.webContents.reload()
  })

  ipcMain.handle('browser:close', () => {
    if (siteView) {
      mainWindow.contentView.removeChildView(siteView)
      siteView.webContents.close()
      siteView = null
    }
  })

  ipcMain.handle('browser:resize', (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    siteView?.setBounds(bounds)
  })

  // Detect login forms on the current page
  ipcMain.handle('browser:detectLogin', async () => {
    if (!siteView) return { hasLogin: false }
    const result = await siteView.webContents.executeJavaScript(`
      (() => {
        const pwFields = document.querySelectorAll('input[type="password"]');
        const emailFields = document.querySelectorAll('input[type="email"], input[name*="user"], input[name*="email"], input[name*="login"]');
        return {
          hasLogin: pwFields.length > 0,
          hasPasswordField: pwFields.length > 0,
          hasUsernameField: emailFields.length > 0,
          formCount: document.querySelectorAll('form').length
        };
      })()
    `)
    return result
  })

  // Capture session (cookies + localStorage) from the current site
  ipcMain.handle('browser:captureSession', async () => {
    if (!siteView) return null
    const url = siteView.webContents.getURL()
    const cookies = await siteView.webContents.session.cookies.get({ url })
    const localStorage = await siteView.webContents.executeJavaScript(`
      (() => {
        const items = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          items[key] = localStorage.getItem(key);
        }
        return items;
      })()
    `)
    return { cookies, localStorage }
  })

  // Get page info (title, favicon, URL)
  ipcMain.handle('browser:getPageInfo', async () => {
    if (!siteView) return null
    const url = siteView.webContents.getURL()
    const title = siteView.webContents.getTitle()
    const faviconUrl = await siteView.webContents.executeJavaScript(`
      (() => {
        const link = document.querySelector('link[rel*="icon"]');
        return link ? link.href : '';
      })()
    `)
    return { url, title, faviconUrl }
  })

  // Reposition on window resize
  mainWindow.on('resize', () => {
    positionView(mainWindow)
  })
}

function positionView(mainWindow: BrowserWindow) {
  if (!siteView) return
  const [winWidth, winHeight] = mainWindow.getContentSize()
  // Sidebar is 80px, guide panel takes ~380px, rest goes to browser
  const sidebarWidth = 80
  const guidePanelWidth = 380
  const x = sidebarWidth + guidePanelWidth
  const titleBarHeight = 44
  const browserWidth = winWidth - x
  const browserHeight = winHeight - titleBarHeight

  if (browserWidth > 0 && browserHeight > 0) {
    siteView.setBounds({
      x,
      y: titleBarHeight,
      width: browserWidth,
      height: browserHeight
    })
  }
}

function normalizeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    return 'https://' + url
  }
  return url
}
