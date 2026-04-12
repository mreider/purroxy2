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
    getViewportSize: () => ipcRenderer.invoke('browser:getViewportSize'),
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
  ai: {
    getPageContent: () => ipcRenderer.invoke('ai:getPageContent'),
    chat: (messages: Array<{ role: string; content: string }>, pageContext?: string) =>
      ipcRenderer.invoke('ai:chat', messages, pageContext),
    generateCapability: (actions: unknown[], chatHistory: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke('ai:generateCapability', actions, chatHistory)
  },
  sites: {
    getAll: () => ipcRenderer.invoke('sites:getAll'),
    create: (url: string, name: string, faviconUrl: string) =>
      ipcRenderer.invoke('sites:create', url, name, faviconUrl),
    saveSession: (siteId: string, session: unknown) =>
      ipcRenderer.invoke('sites:saveSession', siteId, session),
    delete: (id: string) => ipcRenderer.invoke('sites:delete', id)
  },
  capabilities: {
    getAll: () => ipcRenderer.invoke('capabilities:getAll'),
    getForSite: (siteProfileId: string) => ipcRenderer.invoke('capabilities:getForSite', siteProfileId),
    create: (data: unknown) => ipcRenderer.invoke('capabilities:create', data),
    delete: (id: string) => ipcRenderer.invoke('capabilities:delete', id),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('capabilities:update', id, updates)
  },
  executor: {
    test: (capabilityId: string, paramValues?: Record<string, string>, options?: { visible?: boolean }) =>
      ipcRenderer.invoke('executor:test', capabilityId, paramValues, options),
    onStatus: (cb: (status: unknown) => void) => {
      const handler = (_e: unknown, status: unknown) => cb(status)
      ipcRenderer.on('executor:status', handler)
      return () => ipcRenderer.removeListener('executor:status', handler)
    }
  },
  account: {
    getStatus: () => ipcRenderer.invoke('account:getStatus'),
    signup: (email: string, password: string) => ipcRenderer.invoke('account:signup', email, password),
    login: (email: string, password: string) => ipcRenderer.invoke('account:login', email, password),
    logout: () => ipcRenderer.invoke('account:logout'),
    validate: () => ipcRenderer.invoke('account:validate'),
    subscribe: () => ipcRenderer.invoke('account:subscribe'),
    manageSubscription: () => ipcRenderer.invoke('account:manageSubscription'),
    canUse: () => ipcRenderer.invoke('account:canUse'),
    refresh: () => ipcRenderer.invoke('account:refresh')
  },
  lock: {
    getConfig: () => ipcRenderer.invoke('lock:getConfig'),
    setPin: (pin: string) => ipcRenderer.invoke('lock:setPin', pin),
    setTimeout: (minutes: number) => ipcRenderer.invoke('lock:setTimeout', minutes),
    disable: (pin: string) => ipcRenderer.invoke('lock:disable', pin),
    lockNow: () => ipcRenderer.invoke('lock:lockNow'),
    unlock: (pin: string) => ipcRenderer.invoke('lock:unlock', pin),
    activity: () => ipcRenderer.invoke('lock:activity'),
    onStateChanged: (cb: (locked: boolean) => void) => {
      const handler = (_e: unknown, locked: boolean) => cb(locked)
      ipcRenderer.on('lock:stateChanged', handler)
      return () => ipcRenderer.removeListener('lock:stateChanged', handler)
    }
  },
  vault: {
    list: () => ipcRenderer.invoke('vault:list'),
    set: (key: string, value: string) => ipcRenderer.invoke('vault:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('vault:delete', key),
    peek: (key: string) => ipcRenderer.invoke('vault:peek', key)
  },
  claude: {
    getStatus: () => ipcRenderer.invoke('claude:getStatus'),
    connect: () => ipcRenderer.invoke('claude:connect'),
    disconnect: () => ipcRenderer.invoke('claude:disconnect')
  },
  window: {
    expandForRecording: () => ipcRenderer.invoke('window:expandForRecording'),
    restoreSize: () => ipcRenderer.invoke('window:restoreSize')
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    getVersion: () => ipcRenderer.invoke('updates:getVersion'),
    onStatus: (cb: (status: unknown) => void) => {
      const handler = (_e: unknown, status: unknown) => cb(status)
      ipcRenderer.on('updates:status', handler)
      return () => ipcRenderer.removeListener('updates:status', handler)
    }
  },
  system: {
    copyAndOpenClaude: (text: string) => ipcRenderer.invoke('system:copyAndOpenClaude', text)
  }
})
