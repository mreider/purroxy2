/**
 * Global vi.mock calls for ALL electron tests.
 *
 * This file is referenced in vitest.config.ts as a setupFile for the
 * electron test project so every electron test gets these mocks automatically.
 */
import { vi } from 'vitest'
import { MockStore } from '../mocks/electron-store-mock'

// ── Vite compile-time constants ────────────────────────────────────────────
vi.stubGlobal('__BUILD_SECRET__', 'test-build-secret')

// ── electron module ────────────────────────────────────────────────────────

const registeredHandlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      registeredHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      registeredHandlers.delete(channel)
    }),
    on: vi.fn(),
    emit: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn().mockReturnValue(''),
  },
  session: {
    defaultSession: {
      cookies: {
        get: vi.fn().mockResolvedValue([]),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      clearStorageData: vi.fn().mockResolvedValue(undefined),
    },
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn().mockReturnValue('https://example.com'),
      getTitle: vi.fn().mockReturnValue('Example'),
      openDevTools: vi.fn(),
      session: {
        cookies: {
          get: vi.fn().mockResolvedValue([]),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        clearStorageData: vi.fn().mockResolvedValue(undefined),
      },
    },
    getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 800, height: 600 }),
    setBounds: vi.fn(),
    setSize: vi.fn(),
    getSize: vi.fn().mockReturnValue([800, 600]),
    getAllWindows: vi.fn().mockReturnValue([]),
  })),
  app: {
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    once: vi.fn(),
    getAppPath: vi.fn().mockReturnValue('/mock/app/path'),
    getPath: vi.fn().mockReturnValue('/mock/user/data'),
    isQuitting: vi.fn().mockReturnValue(false),
    quit: vi.fn(),
    dock: {
      show: vi.fn(),
      hide: vi.fn(),
      setBadge: vi.fn(),
      bounce: vi.fn(),
    },
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((text: string) => Buffer.from(text)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({
      toPNG: vi.fn().mockReturnValue(Buffer.from([])),
      toJPEG: vi.fn().mockReturnValue(Buffer.from([])),
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,'),
      getSize: vi.fn().mockReturnValue({ width: 16, height: 16 }),
      isEmpty: vi.fn().mockReturnValue(false),
      resize: vi.fn().mockReturnThis(),
    }),
  },
  screen: {
    getDisplayMatching: vi.fn().mockReturnValue({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
    getPrimaryDisplay: vi.fn().mockReturnValue({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  Tray: vi.fn().mockImplementation(() => ({
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
    setImage: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  })),
  Menu: {
    buildFromTemplate: vi.fn().mockReturnValue({}),
  },
}))

// ── electron-store ─────────────────────────────────────────────────────────

vi.mock('electron-store', () => ({
  default: MockStore,
  __esModule: true,
}))

// ── global fetch ───────────────────────────────────────────────────────────

const fetchMock = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
)
vi.stubGlobal('fetch', fetchMock)

// ── Export helpers for test files ──────────────────────────────────────────

/**
 * Retrieve the handler registered via ipcMain.handle for a given channel.
 * Useful for calling IPC handlers directly in unit tests.
 *
 * @example
 * const handler = getRegisteredHandler('settings:get')
 * const result = await handler({}, 'aiApiKey')
 */
export function getRegisteredHandler(channel: string) {
  return registeredHandlers.get(channel)
}

/** Get a snapshot of all registered IPC handler channels. */
export function getRegisteredChannels(): string[] {
  return [...registeredHandlers.keys()]
}

/** Clear all registered handlers (useful in beforeEach). */
export function clearRegisteredHandlers(): void {
  registeredHandlers.clear()
}
