declare module '*.png' {
  const src: string
  export default src
}

interface LoginDetection {
  hasLogin: boolean
  hasPasswordField: boolean
  hasUsernameField: boolean
  formCount: number
}

interface PageInfo {
  url: string
  title: string
  faviconUrl: string
}

interface SessionData {
  cookies: Array<Record<string, unknown>>
  localStorage: Record<string, string>
}

interface SiteProfile {
  id: string
  url: string
  hostname: string
  name: string
  faviconUrl: string
  sessionEncrypted: string | null
  createdAt: string
  updatedAt: string
}

interface RecordedAction {
  type: 'click' | 'type' | 'navigate' | 'select' | 'scroll' | 'wait'
  timestamp: number
  selector?: string
  tagName?: string
  label?: string
  value?: string
  url?: string
  sensitive?: boolean
}

interface PurroxyAPI {
  platform: string
  versions: {
    node: string
    chrome: string
    electron: string
  }
  settings: {
    get: (key: string) => Promise<unknown>
    getAll: () => Promise<Record<string, unknown>>
    set: (key: string, value: unknown) => Promise<boolean>
  }
  browser: {
    open: (url: string) => Promise<void>
    navigate: (url: string) => Promise<void>
    back: () => Promise<void>
    forward: () => Promise<void>
    reload: () => Promise<void>
    close: () => Promise<void>
    resize: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
    detectLogin: () => Promise<LoginDetection>
    captureSession: () => Promise<SessionData | null>
    getPageInfo: () => Promise<PageInfo | null>
    onUrlChanged: (cb: (url: string) => void) => () => void
    onTitleChanged: (cb: (title: string) => void) => () => void
    onLoading: (cb: (loading: boolean) => void) => () => void
  }
  recorder: {
    start: () => Promise<boolean>
    stop: () => Promise<boolean>
    isRecording: () => Promise<boolean>
    onAction: (cb: (action: RecordedAction) => void) => () => void
  }
  sites: {
    getAll: () => Promise<SiteProfile[]>
    create: (url: string, name: string, faviconUrl: string) => Promise<SiteProfile>
    saveSession: (siteId: string, session: SessionData) => Promise<boolean>
    delete: (id: string) => Promise<boolean>
  }
}

declare interface Window {
  purroxy: PurroxyAPI
}
