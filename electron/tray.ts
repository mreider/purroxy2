import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron'
import path from 'path'

let tray: Tray | null = null

export function setupTray(mainWindow: BrowserWindow) {
  // Use "Template" naming convention so macOS auto-adapts to menu bar light/dark
  const iconPath = path.join(__dirname, '../resources/tray-iconTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('Purroxy')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Purroxy',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        (app as any).isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    mainWindow.show()
    mainWindow.focus()
  })
}
