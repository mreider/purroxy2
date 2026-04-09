import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('purroxy', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },
  browser: {
    open: (url: string) => ipcRenderer.invoke('browser:open', url),
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    close: () => ipcRenderer.invoke('browser:close'),
    resize: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('browser:resize', bounds),
    detectLogin: () => ipcRenderer.invoke('browser:detectLogin'),
    captureSession: () => ipcRenderer.invoke('browser:captureSession'),
    getPageInfo: () => ipcRenderer.invoke('browser:getPageInfo'),
    onUrlChanged: (cb: (url: string) => void) => {
      const handler = (_e: unknown, url: string) => cb(url)
      ipcRenderer.on('browser:url-changed', handler)
      return () => ipcRenderer.removeListener('browser:url-changed', handler)
    },
    onTitleChanged: (cb: (title: string) => void) => {
      const handler = (_e: unknown, title: string) => cb(title)
      ipcRenderer.on('browser:title-changed', handler)
      return () => ipcRenderer.removeListener('browser:title-changed', handler)
    },
    onLoading: (cb: (loading: boolean) => void) => {
      const handler = (_e: unknown, loading: boolean) => cb(loading)
      ipcRenderer.on('browser:loading', handler)
      return () => ipcRenderer.removeListener('browser:loading', handler)
    }
  },
  recorder: {
    start: () => ipcRenderer.invoke('recorder:start'),
    stop: () => ipcRenderer.invoke('recorder:stop'),
    isRecording: () => ipcRenderer.invoke('recorder:isRecording'),
    onAction: (cb: (action: unknown) => void) => {
      const handler = (_e: unknown, action: unknown) => cb(action)
      ipcRenderer.on('recorder:action', handler)
      return () => ipcRenderer.removeListener('recorder:action', handler)
    }
  },
  sites: {
    getAll: () => ipcRenderer.invoke('sites:getAll'),
    create: (url: string, name: string, faviconUrl: string) =>
      ipcRenderer.invoke('sites:create', url, name, faviconUrl),
    saveSession: (siteId: string, session: unknown) =>
      ipcRenderer.invoke('sites:saveSession', siteId, session),
    delete: (id: string) => ipcRenderer.invoke('sites:delete', id)
  }
})
