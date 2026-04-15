// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import '../../setup/dom-setup'
import { resetPurroxyMock } from '../../setup/dom-setup'

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const icon = (name: string) => (props: any) => <span data-testid={`icon-${name}`} />
  return {
    Users: icon('Users'),
  }
})

import Community from '../../../src/views/Community'

describe('Community view', () => {
  beforeEach(() => {
    resetPurroxyMock()
  })

  it('renders coming soon message', () => {
    render(<Community />)
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  it('explains community features are not available yet', () => {
    render(<Community />)
    expect(screen.getByText(/not available yet/)).toBeInTheDocument()
    expect(screen.getByText(/local-only/)).toBeInTheDocument()
  })

  it('shows future release note', () => {
    render(<Community />)
    expect(screen.getByText(/will be available in a future release/)).toBeInTheDocument()
  })

  it('links to GitHub for progress tracking', () => {
    render(<Community />)
    expect(screen.getByText(/Follow progress on GitHub/)).toBeInTheDocument()
  })

  it('renders the Community heading', () => {
    render(<Community />)
    expect(screen.getByText('Community')).toBeInTheDocument()
    expect(screen.getByText(/Discover and install shared capabilities/)).toBeInTheDocument()
  })
})
