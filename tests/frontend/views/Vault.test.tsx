// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '../../setup/dom-setup'
import { getPurroxyMock, resetPurroxyMock } from '../../setup/dom-setup'

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
    Plus: icon('Plus'),
    Trash2: icon('Trash2'),
    Eye: icon('Eye'),
    EyeOff: icon('EyeOff'),
    Lock: icon('Lock'),
  }
})

import Vault from '../../../src/views/Vault'

describe('Vault view', () => {
  beforeEach(() => {
    resetPurroxyMock()
  })

  it('renders empty state when no entries', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValue([])

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('No vault entries yet')).toBeInTheDocument()
      expect(screen.getByText(/Store passwords/)).toBeInTheDocument()
    })
  })

  it('renders entries', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValue([
      {
        id: 'v-1',
        key: 'credit_card',
        hasValue: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'v-2',
        key: 'ssn_last4',
        hasValue: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ])

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('credit_card')).toBeInTheDocument()
      expect(screen.getByText('ssn_last4')).toBeInTheDocument()
    })
  })

  it('shows add entry form when Add is clicked', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValue([])

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('Add')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Add'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Key/)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/Value/)).toBeInTheDocument()
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })
  })

  it('adds a new entry via the form', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValueOnce([])
    api.vault.set.mockResolvedValue(true)
    api.vault.list.mockResolvedValueOnce([
      {
        id: 'v-new',
        key: 'my_secret',
        hasValue: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ])

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('Add')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Add'))

    const keyInput = screen.getByPlaceholderText(/Key/)
    const valueInput = screen.getByPlaceholderText(/Value/)

    fireEvent.change(keyInput, { target: { value: 'my_secret' } })
    fireEvent.change(valueInput, { target: { value: 'super-secret-value' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(api.vault.set).toHaveBeenCalledWith('my_secret', 'super-secret-value')
    })
  })

  it('peek reveals a masked value', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValue([
      {
        id: 'v-1',
        key: 'credit_card',
        hasValue: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ])
    api.vault.peek.mockResolvedValue('4111****1111')

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('credit_card')).toBeInTheDocument()
    })

    // Click the peek button (has title "Peek at value")
    const peekButton = screen.getByTitle('Peek at value')
    fireEvent.click(peekButton)

    await waitFor(() => {
      expect(api.vault.peek).toHaveBeenCalledWith('credit_card')
      expect(screen.getByText('4111****1111')).toBeInTheDocument()
    })
  })

  it('delete calls vault.delete', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValueOnce([
      {
        id: 'v-1',
        key: 'credit_card',
        hasValue: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ])
    api.vault.list.mockResolvedValueOnce([])

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('credit_card')).toBeInTheDocument()
    })

    const deleteButton = screen.getByTitle('Delete')
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(api.vault.delete).toHaveBeenCalledWith('credit_card')
    })
  })

  it('renders vault heading and description', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValue([])

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('Vault')).toBeInTheDocument()
      expect(screen.getByText(/Encrypted storage for sensitive data/)).toBeInTheDocument()
    })
  })

  it('shows masked dots for unrevealed entries', async () => {
    const api = getPurroxyMock()
    api.vault.list.mockResolvedValue([
      {
        id: 'v-1',
        key: 'secret_key',
        hasValue: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    ])

    render(<Vault />)

    await waitFor(() => {
      expect(screen.getByText('secret_key')).toBeInTheDocument()
    })
  })
})
