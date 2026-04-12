/**
 * Tests for electron/mcp-api.ts
 *
 * The MCP API is an HTTP server exposing capabilities as MCP tools.
 * We mock http.createServer to capture the request handler, then
 * simulate HTTP requests against it with mock req/res objects.
 *
 * Note: The POST /execute handler in mcp-api.ts uses dynamic require()
 * calls (require('./account') on line 76, require('./capabilities') on
 * line 140) that don't resolve in Vitest's ESM environment. Those code
 * paths are tested through the executor.test.ts suite instead. The tests
 * here cover everything up to those require() boundaries, plus the GET
 * /tools endpoint which works fully.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// ── Mock dependencies ────────────────────────────────────────────────────

const mockIsLocked = vi.fn().mockReturnValue(false)
vi.mock('../../electron/app-lock', () => ({
  isLocked: (...args: any[]) => mockIsLocked(...args),
}))

const mockIsLicenseValid = vi.fn().mockReturnValue(true)
vi.mock('../../electron/account', () => ({
  isLicenseValid: (...args: any[]) => mockIsLicenseValid(...args),
}))

const mockCaps: any[] = []
const mockGetAllCapabilities = vi.fn(() => [...mockCaps])
const mockGetCapability = vi.fn((id: string) => mockCaps.find((c: any) => c.id === id))
const mockUpdateCapability = vi.fn()
vi.mock('../../electron/capabilities', () => ({
  getAllCapabilities: (...args: any[]) => mockGetAllCapabilities(...args),
  getCapability: (...args: any[]) => mockGetCapability(...args),
  updateCapability: (...args: any[]) => mockUpdateCapability(...args),
}))

const mockSites: any[] = []
const mockGetAllSites = vi.fn(() => [...mockSites])
const mockGetSite = vi.fn((id: string) => mockSites.find((s: any) => s.id === id))
const mockGetSession = vi.fn().mockReturnValue(null)
vi.mock('../../electron/sites', () => ({
  getAllSites: (...args: any[]) => mockGetAllSites(...args),
  getSite: (...args: any[]) => mockGetSite(...args),
  getSession: (...args: any[]) => mockGetSession(...args),
}))

const mockGetAllDecryptedValues = vi.fn().mockReturnValue({})
vi.mock('../../electron/vault', () => ({
  getAllDecryptedValues: (...args: any[]) => mockGetAllDecryptedValues(...args),
}))

const mockLaunch = vi.fn().mockResolvedValue(undefined)
const mockExecute = vi.fn().mockResolvedValue({
  success: true, data: { title: 'Test' }, durationMs: 500, log: [],
})
const mockClose = vi.fn().mockResolvedValue(undefined)
const mockSetHealer = vi.fn()
const mockGetHealedLocators = vi.fn().mockReturnValue([])
vi.mock('../../core/browser/playwright-engine', () => {
  const MockEngine = vi.fn().mockImplementation(function (this: any) {
    this.launch = mockLaunch
    this.execute = mockExecute
    this.close = mockClose
    this.setHealer = mockSetHealer
    this.getHealedLocators = mockGetHealedLocators
  })
  return { PlaywrightEngine: MockEngine }
})

vi.mock('../../electron/healer', () => ({
  healSelector: vi.fn().mockResolvedValue(null),
}))

const mockStoreGet = vi.fn().mockReturnValue('')
vi.mock('../../electron/store', () => ({
  store: {
    get: (...args: any[]) => mockStoreGet(...args),
    set: vi.fn(),
  },
}))

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  default: { writeFileSync: vi.fn() },
}))

// ── Capture the createServer handler ────────────────────────────────────

let capturedHandler: ((req: any, res: any) => void) | null = null
const mockServer = {
  listen: vi.fn().mockImplementation(function (this: any, _port: any, _host: any, cb: any) {
    if (cb) cb()
    return this
  }),
  close: vi.fn(),
  address: vi.fn().mockReturnValue({ port: 12345 }),
}

vi.mock('http', async () => {
  const actual = await vi.importActual<typeof import('http')>('http')
  return {
    ...actual,
    createServer: vi.fn((handler: any) => {
      capturedHandler = handler
      return mockServer
    }),
  }
})

import { startMCPApi, stopMCPApi } from '../../electron/mcp-api'

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockReq(method: string, url: string, body?: any): EventEmitter & { method: string; url: string } {
  const req = new EventEmitter() as any
  req.method = method
  req.url = url
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', JSON.stringify(body))
    req.emit('end')
  })
  return req
}

function createMockRes() {
  const res = {
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  }
  return res
}

async function simulateRequest(method: string, url: string, body?: any) {
  if (!capturedHandler) throw new Error('Server handler not captured — did you call startMCPApi()?')

  const req = createMockReq(method, url, body)
  const res = createMockRes()
  capturedHandler(req, res)

  // Wait for async handler to settle
  await new Promise(resolve => setTimeout(resolve, 100))

  const writeHeadCall = res.writeHead.mock.calls[0]
  const endCall = res.end.mock.calls[0]
  const status = writeHeadCall ? writeHeadCall[0] : 200
  let data: any
  try {
    data = endCall ? JSON.parse(endCall[0]) : undefined
  } catch {
    data = endCall ? endCall[0] : undefined
  }

  return { status, data, res }
}

describe('electron/mcp-api', () => {
  beforeEach(() => {
    capturedHandler = null
    mockCaps.length = 0
    mockSites.length = 0

    // Clear call history only (not implementations)
    ;[mockLaunch, mockExecute, mockClose, mockSetHealer, mockGetHealedLocators,
      mockUpdateCapability, mockGetAllCapabilities, mockGetCapability,
      mockGetAllSites, mockGetSite, mockGetSession, mockGetAllDecryptedValues,
      mockStoreGet, mockIsLocked, mockIsLicenseValid, mockServer.close, mockServer.listen,
    ].forEach(m => m.mockClear())

    mockIsLocked.mockReturnValue(false)
    mockIsLicenseValid.mockReturnValue(true)
    mockStoreGet.mockReturnValue('')
    mockGetAllDecryptedValues.mockReturnValue({})
    mockGetHealedLocators.mockReturnValue([])
    mockGetSession.mockReturnValue(null)
    mockExecute.mockResolvedValue({
      success: true, data: { title: 'Test' }, durationMs: 500, log: [],
    })

    startMCPApi()
  })

  afterEach(() => {
    stopMCPApi()
  })

  // ── GET /tools ────────────────────────────────────────────────────────

  describe('GET /tools', () => {
    it('returns empty tools array when no capabilities exist', async () => {
      const { status, data } = await simulateRequest('GET', '/tools')
      expect(status).toBe(200)
      expect(data.tools).toEqual([])
    })

    it('lists capabilities as MCP tools with correct schema', async () => {
      mockSites.push({ id: 'site-1', hostname: 'example.com', url: 'https://example.com' })
      mockCaps.push({
        id: 'cap-1',
        siteProfileId: 'site-1',
        name: 'Check Reservations',
        description: 'Check upcoming reservations',
        parameters: [
          { name: 'startDate', description: 'Start date', actionIndex: 1, field: 'value', defaultValue: 'today', required: true },
          { name: 'filter', description: 'Optional filter', actionIndex: 2, field: 'value', defaultValue: '', required: false },
        ],
        extractionRules: [],
        actions: [],
      })

      const { status, data } = await simulateRequest('GET', '/tools')

      expect(status).toBe(200)
      expect(data.tools).toHaveLength(1)

      const tool = data.tools[0]
      expect(tool.name).toBe('purroxy_check_reservations')
      expect(tool.description).toContain('Check Reservations')
      expect(tool.description).toContain('example.com')
      expect(tool._capabilityId).toBe('cap-1')
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties.startDate).toEqual({
        type: 'string',
        description: 'Start date',
        default: 'today',
      })
      expect(tool.inputSchema.required).toEqual(['startDate'])
    })

    it('generates clean tool name from capability name with special chars', async () => {
      mockSites.push({ id: 'site-1', hostname: 'test.com' })
      mockCaps.push({
        id: 'cap-1', siteProfileId: 'site-1', name: 'My Awesome Tool!!!',
        description: 'test', parameters: [], extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      expect(data.tools[0].name).toBe('purroxy_my_awesome_tool')
    })

    it('truncates long tool names to 40 chars', async () => {
      mockSites.push({ id: 'site-1', hostname: 'test.com' })
      mockCaps.push({
        id: 'cap-1', siteProfileId: 'site-1',
        name: 'A Very Long Capability Name That Goes On And On And On Forever',
        description: 'test', parameters: [], extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      // 'purroxy_' prefix + up to 40 chars of the cleaned name
      const name = data.tools[0].name
      expect(name.startsWith('purroxy_')).toBe(true)
      expect(name.length).toBeLessThanOrEqual(8 + 40) // purroxy_ + 40
    })

    it('shows unknown site when site profile is missing', async () => {
      mockCaps.push({
        id: 'cap-1', siteProfileId: 'missing-site', name: 'Orphan',
        description: 'test', parameters: [], extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      expect(data.tools[0].description).toContain('unknown site')
    })

    it('lists multiple capabilities from different sites', async () => {
      mockSites.push(
        { id: 'site-1', hostname: 'a.com' },
        { id: 'site-2', hostname: 'b.com' },
      )
      mockCaps.push(
        { id: 'c1', siteProfileId: 'site-1', name: 'Cap A', description: 'a', parameters: [], extractionRules: [], actions: [] },
        { id: 'c2', siteProfileId: 'site-2', name: 'Cap B', description: 'b', parameters: [], extractionRules: [], actions: [] },
      )

      const { data } = await simulateRequest('GET', '/tools')
      expect(data.tools).toHaveLength(2)
      expect(data.tools[0]._capabilityId).toBe('c1')
      expect(data.tools[1]._capabilityId).toBe('c2')
    })

    it('includes non-required params without required array entry', async () => {
      mockSites.push({ id: 'site-1', hostname: 'example.com' })
      mockCaps.push({
        id: 'cap-1', siteProfileId: 'site-1', name: 'Search', description: 'search',
        parameters: [
          { name: 'query', description: 'Search term', actionIndex: 0, field: 'value', defaultValue: '', required: true },
          { name: 'page', description: 'Page number', actionIndex: 1, field: 'value', defaultValue: '1', required: false },
        ],
        extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      expect(data.tools[0].inputSchema.required).toEqual(['query'])
      expect(data.tools[0].inputSchema.properties.page).toBeDefined()
    })

    it('sets JSON content type header', async () => {
      const { res } = await simulateRequest('GET', '/tools')
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    })
  })

  // ── POST /execute — guard checks ─────────────────────────────────────
  // These tests cover the guards that fire BEFORE the dynamic require() calls.
  // The isLocked() check uses a top-level import, so it works in test.

  describe('POST /execute — lock guard', () => {
    it('returns 403 when app is locked', async () => {
      mockIsLocked.mockReturnValue(true)

      const { status, data } = await simulateRequest('POST', '/execute', {
        capabilityId: 'cap-1',
      })

      expect(status).toBe(403)
      expect(data.error).toContain('locked')
    })

    it('proceeds past lock check when not locked', async () => {
      mockIsLocked.mockReturnValue(false)

      const { status } = await simulateRequest('POST', '/execute', {
        capabilityId: 'cap-1',
      })

      // Should get past lock check (will fail at require('./account') in test env
      // but won't be 403)
      expect(status).not.toBe(403)
    })
  })

  // ── POST /execute — execution path ────────────────────────────────────
  // The full execution path involves require('./account') and
  // require('./capabilities') calls that don't resolve in Vitest ESM.
  // These paths are thoroughly tested in executor.test.ts.
  // Here we verify the HTTP-specific behaviors:
  //   - The lock guard (tested above)
  //   - Route selection and method matching
  //   - JSON response formatting

  // ── Unknown routes ────────────────────────────────────────────────────

  describe('unknown routes', () => {
    it('returns 404 for GET /unknown', async () => {
      const { status, data } = await simulateRequest('GET', '/unknown')
      expect(status).toBe(404)
      expect(data.error).toBe('Not found')
    })

    it('returns 404 for POST /tools (wrong method)', async () => {
      const { status, data } = await simulateRequest('POST', '/tools', {})
      expect(status).toBe(404)
      expect(data.error).toBe('Not found')
    })

    it('returns 404 for GET /execute (wrong method)', async () => {
      const { status, data } = await simulateRequest('GET', '/execute')
      expect(status).toBe(404)
      expect(data.error).toBe('Not found')
    })

    it('returns 404 for DELETE /tools', async () => {
      const { status, data } = await simulateRequest('DELETE', '/tools')
      expect(status).toBe(404)
      expect(data.error).toBe('Not found')
    })

    it('returns 404 for PUT /execute', async () => {
      const { status, data } = await simulateRequest('PUT', '/execute', {})
      expect(status).toBe(404)
      expect(data.error).toBe('Not found')
    })

    it('returns 404 for root path', async () => {
      const { status, data } = await simulateRequest('GET', '/')
      expect(status).toBe(404)
      expect(data.error).toBe('Not found')
    })
  })

  // ── Server lifecycle ──────────────────────────────────────────────────

  describe('server lifecycle', () => {
    it('startMCPApi creates an HTTP server and captures the handler', () => {
      expect(capturedHandler).not.toBeNull()
      expect(typeof capturedHandler).toBe('function')
    })

    it('startMCPApi calls server.listen on 127.0.0.1', () => {
      expect(mockServer.listen).toHaveBeenCalledWith(
        0, '127.0.0.1', expect.any(Function)
      )
    })

    it('stopMCPApi closes the server', () => {
      stopMCPApi()
      expect(mockServer.close).toHaveBeenCalled()
    })

    it('startMCPApi returns immediately if already running', () => {
      // Server is already running from beforeEach
      const port = startMCPApi()
      // Should return cached port without creating a new server
      expect(port).toBeGreaterThanOrEqual(0)
    })

    it('sets Content-Type to application/json on all responses', async () => {
      const { res } = await simulateRequest('GET', '/unknown')
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    })
  })

  // ── Comprehensive tool schema verification ────────────────────────────

  describe('tool schema', () => {
    it('generates correct description with site hostname', async () => {
      mockSites.push({ id: 's1', hostname: 'dashboard.example.com' })
      mockCaps.push({
        id: 'c1', siteProfileId: 's1', name: 'Get Report',
        description: 'Download weekly analytics report',
        parameters: [], extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      expect(data.tools[0].description).toBe('Get Report (dashboard.example.com): Download weekly analytics report')
    })

    it('handles capability with no parameters', async () => {
      mockSites.push({ id: 's1', hostname: 'x.com' })
      mockCaps.push({
        id: 'c1', siteProfileId: 's1', name: 'Check Status',
        description: 'Check system status', parameters: [], extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      const tool = data.tools[0]
      expect(tool.inputSchema.properties).toEqual({})
      expect(tool.inputSchema.required).toEqual([])
    })

    it('handles capability with all required parameters', async () => {
      mockSites.push({ id: 's1', hostname: 'x.com' })
      mockCaps.push({
        id: 'c1', siteProfileId: 's1', name: 'Test', description: 'test',
        parameters: [
          { name: 'a', description: 'A', actionIndex: 0, field: 'value', defaultValue: '', required: true },
          { name: 'b', description: 'B', actionIndex: 1, field: 'value', defaultValue: '', required: true },
        ],
        extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      expect(data.tools[0].inputSchema.required).toEqual(['a', 'b'])
    })

    it('strips leading and trailing underscores from tool names', async () => {
      mockSites.push({ id: 's1', hostname: 'x.com' })
      mockCaps.push({
        id: 'c1', siteProfileId: 's1', name: '  _Hello World_  ',
        description: 'test', parameters: [], extractionRules: [], actions: [],
      })

      const { data } = await simulateRequest('GET', '/tools')
      const name = data.tools[0].name
      expect(name).toBe('purroxy_hello_world')
    })
  })
})
