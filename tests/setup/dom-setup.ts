/**
 * DOM environment setup for React/frontend tests (jsdom).
 *
 * Stubs window.purroxy with a complete mock of PurroxyAPI matching
 * the real preload.ts shape. All functions are vi.fn() with sensible
 * defaults so components render without errors.
 */
import { vi } from 'vitest'

// ── Locator-style helpers for event callbacks ──────────────────────────────

function createCallbackRegistration() {
  return vi.fn().mockReturnValue(() => {
    /* unsubscribe noop */
  })
}

// ── PurroxyAPI mock ────────────────────────────────────────────────────────

const purroxyMock = {
  platform: 'darwin',
  versions: {
    node: '20.0.0',
    chrome: '120.0.0',
    electron: '28.0.0',
  },

  settings: {
    get: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue({
      aiApiKey: '',
      telemetryEnabled: false,
    }),
    set: vi.fn().mockResolvedValue(true),
  },

  browser: {
    open: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    back: vi.fn().mockResolvedValue(undefined),
    forward: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
    detectLogin: vi.fn().mockResolvedValue({
      hasLogin: false,
      hasPasswordField: false,
      hasUsernameField: false,
      formCount: 0,
    }),
    captureSession: vi.fn().mockResolvedValue(null),
    getPageInfo: vi.fn().mockResolvedValue(null),
    onUrlChanged: createCallbackRegistration(),
    onTitleChanged: createCallbackRegistration(),
    onLoading: createCallbackRegistration(),
  },

  ai: {
    getPageContent: vi.fn().mockResolvedValue(''),
    chat: vi.fn().mockResolvedValue({ content: '', usage: { input: 0, output: 0 } }),
    generateCapability: vi.fn().mockResolvedValue({
      capability: {
        name: 'Test Capability',
        description: 'A generated capability',
        parameters: [],
        extractionRules: [],
      },
    }),
  },

  recorder: {
    start: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(true),
    isRecording: vi.fn().mockResolvedValue(false),
    onAction: createCallbackRegistration(),
  },

  sites: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async (url: string, name: string, faviconUrl: string) => ({
      id: crypto.randomUUID(),
      url,
      hostname: new URL(url).hostname,
      name,
      faviconUrl,
      sessionEncrypted: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    saveSession: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
  },

  capabilities: {
    getAll: vi.fn().mockResolvedValue([]),
    getForSite: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(async (data: any) => ({
      id: crypto.randomUUID(),
      ...data,
      healthStatus: 'healthy',
      consecutiveFailures: 0,
      lastRunAt: null,
      lastSuccessAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    delete: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockImplementation(async (_id: string, updates: any) => ({
      id: _id,
      ...updates,
      updatedAt: new Date().toISOString(),
    })),
  },

  account: {
    getStatus: vi.fn().mockResolvedValue({
      loggedIn: false,
      email: null,
      plan: null,
      status: null,
      trialEndsAt: null,
      trialDaysLeft: null,
      accountType: 'none',
      emailVerified: false,
      apiUrl: 'http://localhost',
    }),
    signup: vi.fn().mockResolvedValue({ success: true, needsVerification: true }),
    login: vi.fn().mockResolvedValue({ success: true }),
    logout: vi.fn().mockResolvedValue(true),
    validate: vi.fn().mockResolvedValue({ valid: false }),
    subscribe: vi.fn().mockResolvedValue({ success: true }),
    manageSubscription: vi.fn().mockResolvedValue({ success: true }),
    canUse: vi.fn().mockResolvedValue({ allowed: true }),
    refresh: vi.fn().mockResolvedValue({ success: true }),
  },

  lock: {
    getConfig: vi.fn().mockResolvedValue({
      enabled: false,
      timeoutMinutes: 5,
      hasPin: false,
      isLocked: false,
    }),
    setPin: vi.fn().mockResolvedValue(true),
    setTimeout: vi.fn().mockResolvedValue(true),
    disable: vi.fn().mockResolvedValue({ success: true }),
    lockNow: vi.fn().mockResolvedValue(true),
    unlock: vi.fn().mockResolvedValue({ success: true }),
    activity: vi.fn().mockResolvedValue(true),
    onStateChanged: createCallbackRegistration(),
  },

  vault: {
    list: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    peek: vi.fn().mockResolvedValue(null),
  },

  executor: {
    test: vi.fn().mockResolvedValue({
      success: true,
      data: {},
      durationMs: 100,
      log: ['Step 1: Navigate', 'Step 2: Complete'],
    }),
    onStatus: createCallbackRegistration(),
  },

  claude: {
    getStatus: vi.fn().mockResolvedValue({ installed: false, connected: false }),
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue({ success: true }),
  },

  updates: {
    check: vi.fn().mockResolvedValue({ success: true }),
    download: vi.fn().mockResolvedValue({ success: true }),
    install: vi.fn().mockResolvedValue(undefined),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    onStatus: createCallbackRegistration(),
  },

  window: {
    expandForRecording: vi.fn().mockResolvedValue(undefined),
    restoreSize: vi.fn().mockResolvedValue(undefined),
  },

  system: {
    copyAndOpenClaude: vi.fn().mockResolvedValue({ opened: true }),
  },
}

vi.stubGlobal('purroxy', purroxyMock)

// ── Export for test-level overrides ────────────────────────────────────────

/**
 * Get the purroxy mock object for configuring per-test return values.
 *
 * @example
 * const api = getPurroxyMock()
 * api.sites.getAll.mockResolvedValueOnce([buildSite()])
 */
export function getPurroxyMock() {
  return purroxyMock
}

/**
 * Reset all purroxy mock functions to their defaults.
 * Call in beforeEach for a clean slate.
 */
export function resetPurroxyMock(): void {
  const resetObj = (obj: Record<string, any>) => {
    for (const value of Object.values(obj)) {
      if (typeof value === 'function' && 'mockReset' in value) {
        value.mockReset()
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        resetObj(value)
      }
    }
  }

  // Reset all mocks then re-apply defaults
  resetObj(purroxyMock)

  // Re-apply default resolved values
  purroxyMock.settings.get.mockResolvedValue(null)
  purroxyMock.settings.getAll.mockResolvedValue({ aiApiKey: '', telemetryEnabled: false })
  purroxyMock.settings.set.mockResolvedValue(true)

  purroxyMock.browser.open.mockResolvedValue(undefined)
  purroxyMock.browser.navigate.mockResolvedValue(undefined)
  purroxyMock.browser.back.mockResolvedValue(undefined)
  purroxyMock.browser.forward.mockResolvedValue(undefined)
  purroxyMock.browser.reload.mockResolvedValue(undefined)
  purroxyMock.browser.close.mockResolvedValue(undefined)
  purroxyMock.browser.resize.mockResolvedValue(undefined)
  purroxyMock.browser.detectLogin.mockResolvedValue({
    hasLogin: false, hasPasswordField: false, hasUsernameField: false, formCount: 0,
  })
  purroxyMock.browser.captureSession.mockResolvedValue(null)
  purroxyMock.browser.getPageInfo.mockResolvedValue(null)
  purroxyMock.browser.onUrlChanged.mockReturnValue(() => {})
  purroxyMock.browser.onTitleChanged.mockReturnValue(() => {})
  purroxyMock.browser.onLoading.mockReturnValue(() => {})

  purroxyMock.ai.getPageContent.mockResolvedValue('')
  purroxyMock.ai.chat.mockResolvedValue({ content: '', usage: { input: 0, output: 0 } })
  purroxyMock.ai.generateCapability.mockResolvedValue({
    capability: { name: 'Test Capability', description: 'A generated capability', parameters: [], extractionRules: [] },
  })

  purroxyMock.recorder.start.mockResolvedValue(true)
  purroxyMock.recorder.stop.mockResolvedValue(true)
  purroxyMock.recorder.isRecording.mockResolvedValue(false)
  purroxyMock.recorder.onAction.mockReturnValue(() => {})

  purroxyMock.sites.getAll.mockResolvedValue([])
  purroxyMock.sites.saveSession.mockResolvedValue(true)
  purroxyMock.sites.delete.mockResolvedValue(true)

  purroxyMock.capabilities.getAll.mockResolvedValue([])
  purroxyMock.capabilities.getForSite.mockResolvedValue([])
  purroxyMock.capabilities.delete.mockResolvedValue(true)

  purroxyMock.account.getStatus.mockResolvedValue({
    loggedIn: false, email: null, plan: null, status: null,
    trialEndsAt: null, trialDaysLeft: null, accountType: 'none',
    emailVerified: false, apiUrl: 'http://localhost',
  })
  purroxyMock.account.signup.mockResolvedValue({ success: true, needsVerification: true })
  purroxyMock.account.login.mockResolvedValue({ success: true })
  purroxyMock.account.logout.mockResolvedValue(true)
  purroxyMock.account.validate.mockResolvedValue({ valid: false })
  purroxyMock.account.subscribe.mockResolvedValue({ success: true })
  purroxyMock.account.manageSubscription.mockResolvedValue({ success: true })
  purroxyMock.account.canUse.mockResolvedValue({ allowed: true })
  purroxyMock.account.refresh.mockResolvedValue({ success: true })

  purroxyMock.lock.getConfig.mockResolvedValue({
    enabled: false, timeoutMinutes: 5, hasPin: false, isLocked: false,
  })
  purroxyMock.lock.setPin.mockResolvedValue(true)
  purroxyMock.lock.setTimeout.mockResolvedValue(true)
  purroxyMock.lock.disable.mockResolvedValue({ success: true })
  purroxyMock.lock.lockNow.mockResolvedValue(true)
  purroxyMock.lock.unlock.mockResolvedValue({ success: true })
  purroxyMock.lock.activity.mockResolvedValue(true)
  purroxyMock.lock.onStateChanged.mockReturnValue(() => {})

  purroxyMock.vault.list.mockResolvedValue([])
  purroxyMock.vault.set.mockResolvedValue(true)
  purroxyMock.vault.delete.mockResolvedValue(true)
  purroxyMock.vault.peek.mockResolvedValue(null)

  purroxyMock.executor.test.mockResolvedValue({
    success: true, data: {}, durationMs: 100, log: ['Step 1: Navigate', 'Step 2: Complete'],
  })
  purroxyMock.executor.onStatus.mockReturnValue(() => {})

  purroxyMock.claude.getStatus.mockResolvedValue({ installed: false, connected: false })
  purroxyMock.claude.connect.mockResolvedValue({ success: true })
  purroxyMock.claude.disconnect.mockResolvedValue({ success: true })

  purroxyMock.updates.check.mockResolvedValue({ success: true })
  purroxyMock.updates.download.mockResolvedValue({ success: true })
  purroxyMock.updates.install.mockResolvedValue(undefined)
  purroxyMock.updates.getVersion.mockResolvedValue('1.0.0')
  purroxyMock.updates.onStatus.mockReturnValue(() => {})

  purroxyMock.window.expandForRecording.mockResolvedValue(undefined)
  purroxyMock.window.restoreSize.mockResolvedValue(undefined)

  purroxyMock.system.copyAndOpenClaude.mockResolvedValue({ opened: true })
}
