// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '../../setup/dom-setup'
import { getPurroxyMock, resetPurroxyMock } from '../../setup/dom-setup'
import { buildSite } from '../../factories/site-factory'
import { buildCapability, buildCapabilityWithActions } from '../../factories/capability-factory'

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: any) => <span data-testid={`icon-${name}`} />
  return {
    Trash2: icon('Trash2'),
    ShieldCheck: icon('ShieldCheck'),
    Globe: icon('Globe'),
    ChevronDown: icon('ChevronDown'),
    ChevronRight: icon('ChevronRight'),
    Zap: icon('Zap'),
    Play: icon('Play'),
    Loader2: icon('Loader2'),
    X: icon('X'),
    CheckCircle: icon('CheckCircle'),
    AlertTriangle: icon('AlertTriangle'),
    Eye: icon('Eye'),
    Pencil: icon('Pencil'),
  }
})

import Library from '../../../src/views/Library'

describe('Library view', () => {
  beforeEach(() => {
    resetPurroxyMock()
    mockNavigate.mockReset()
  })

  it('renders empty state when no sites exist', async () => {
    const api = getPurroxyMock()
    api.sites.getAll.mockResolvedValue([])
    api.capabilities.getAll.mockResolvedValue([])

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('No sites yet')).toBeInTheDocument()
    })
  })

  it('renders sites with capabilities', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1', name: 'Example', hostname: 'example.com' })
    const cap = buildCapability({
      siteProfileId: 'site-1',
      name: 'Check Prices',
      description: 'Checks prices on example.com',
      actions: [{ type: 'navigate', url: 'https://example.com', timestamp: Date.now() }],
    })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([cap])

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument()
      expect(screen.getByText('example.com')).toBeInTheDocument()
      expect(screen.getByText('Check Prices')).toBeInTheDocument()
    })
  })

  it('cleans up orphan capabilities on load', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1' })
    const validCap = buildCapability({ siteProfileId: 'site-1' })
    const orphanCap = buildCapability({ id: 'orphan-1', siteProfileId: 'deleted-site' })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([validCap, orphanCap])

    render(<Library />)

    await waitFor(() => {
      expect(api.capabilities.delete).toHaveBeenCalledWith('orphan-1')
    })
  })

  it('delete site cascades to its capabilities', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1', name: 'Example' })
    const cap = buildCapability({ id: 'cap-1', siteProfileId: 'site-1', name: 'Test Cap' })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([cap])

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByTitle('Delete')
    fireEvent.click(deleteButtons[0])

    await waitFor(() => {
      expect(api.capabilities.delete).toHaveBeenCalledWith('cap-1')
      expect(api.sites.delete).toHaveBeenCalledWith('site-1')
    })
  })

  it('runs test execution', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1', name: 'Example' })
    const cap = buildCapability({
      id: 'cap-1',
      siteProfileId: 'site-1',
      name: 'Test Cap',
      actions: [{ type: 'navigate', url: 'https://example.com', timestamp: Date.now() }],
    })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([cap])
    api.executor.test.mockResolvedValue({
      success: true,
      data: { title: 'Example' },
      durationMs: 1500,
      log: ['Step 1: Navigate'],
    })

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('Test Cap')).toBeInTheDocument()
    })

    // Click test button (has title "Test (headless)")
    const testButtons = screen.getAllByTitle('Test')
    fireEvent.click(testButtons[0])

    await waitFor(() => {
      expect(api.executor.test).toHaveBeenCalledWith('cap-1', {}, { visible: false })
    })

    await waitFor(() => {
      expect(screen.getByText('Test passed')).toBeInTheDocument()
    })
  })

  it('license error shows subscribe button', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1', name: 'Example' })
    const cap = buildCapability({
      id: 'cap-1',
      siteProfileId: 'site-1',
      name: 'Test Cap',
      actions: [{ type: 'navigate', url: 'https://example.com', timestamp: Date.now() }],
    })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([cap])
    api.executor.test.mockResolvedValue({
      success: false,
      data: {},
      error: 'Trial expired. Subscribe to continue.',
      errorType: 'license',
      durationMs: 50,
      log: [],
    })

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('Test Cap')).toBeInTheDocument()
    })

    const testButtons = screen.getAllByTitle('Test')
    fireEvent.click(testButtons[0])

    await waitFor(() => {
      expect(screen.getByText('Subscribe ($3.89/mo)')).toBeInTheDocument()
    })
  })

  it('starts rename flow', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1', name: 'Example' })
    const cap = buildCapability({
      id: 'cap-1',
      siteProfileId: 'site-1',
      name: 'Old Name',
      actions: [{ type: 'navigate', url: 'https://example.com', timestamp: Date.now() }],
    })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([cap])

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('Old Name')).toBeInTheDocument()
    })

    const renameButtons = screen.getAllByTitle('Rename')
    fireEvent.click(renameButtons[0])

    await waitFor(() => {
      // Should show the rename input with the current name
      const input = screen.getByDisplayValue('Old Name')
      expect(input).toBeInTheDocument()
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })
  })

  it('renders capability library heading', async () => {
    const api = getPurroxyMock()
    api.sites.getAll.mockResolvedValue([])
    api.capabilities.getAll.mockResolvedValue([])

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('Capability Library')).toBeInTheDocument()
    })
  })

  it('shows capability health status', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1' })
    const cap = buildCapability({
      siteProfileId: 'site-1',
      name: 'Healthy Cap',
      healthStatus: 'healthy',
      actions: [{ type: 'navigate', url: 'https://example.com', timestamp: Date.now() }],
    })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([cap])

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('healthy')).toBeInTheDocument()
    })
  })

  it('shows count badge for sites with capabilities', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1', name: 'Example' })
    const caps = [
      buildCapability({ siteProfileId: 'site-1', name: 'Cap 1', actions: [{ type: 'navigate', url: 'https://example.com', timestamp: Date.now() }] }),
      buildCapability({ siteProfileId: 'site-1', name: 'Cap 2', actions: [{ type: 'navigate', url: 'https://example.com', timestamp: Date.now() }] }),
    ]

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue(caps)

    render(<Library />)

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  it('shows "No capabilities yet" for sites without capabilities', async () => {
    const api = getPurroxyMock()
    const site = buildSite({ id: 'site-1', name: 'Empty Site' })

    api.sites.getAll.mockResolvedValue([site])
    api.capabilities.getAll.mockResolvedValue([])

    render(<Library />)

    // Click to expand the site (it starts collapsed when no caps)
    await waitFor(() => {
      expect(screen.getByText('Empty Site')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Empty Site'))

    await waitFor(() => {
      expect(screen.getByText('No capabilities yet')).toBeInTheDocument()
      expect(screen.getByText('Build one')).toBeInTheDocument()
    })
  })
})
