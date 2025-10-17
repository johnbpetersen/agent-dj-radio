// tests/ui/rename-flow.test.tsx
// Tests for ProfileRename component and rename flow

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProfileRename from '../../src/components/ProfileRename'
import * as api from '../../src/lib/api'

// Mock useIdentity hook
vi.mock('../../src/hooks/useIdentity', () => ({
  useIdentity: vi.fn()
}))

describe('ProfileRename - Rename Flow', () => {
  const mockRename = vi.fn()
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('successful rename updates displayed name', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'old_name',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: { canChat: true }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: mockRename.mockResolvedValue(undefined)
    })

    const user = userEvent.setup()
    render(<ProfileRename onClose={mockOnClose} />)

    const input = screen.getByLabelText(/new display name/i)
    const saveButton = screen.getByRole('button', { name: /save/i })

    await user.clear(input)
    await user.type(input, 'new_name')
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalledWith('new_name')
    })
  })

  it('409 NAME_TAKEN shows inline error', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')

    const error = new Error('Name already taken')
    ;(error as any).status = 409
    ;(error as any).code = 'CONFLICT'

    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'old_name',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: { canChat: true }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: mockRename.mockRejectedValue(error)
    })

    const user = userEvent.setup()
    render(<ProfileRename onClose={mockOnClose} />)

    const input = screen.getByLabelText(/new display name/i)
    const saveButton = screen.getByRole('button', { name: /save/i })

    await user.clear(input)
    await user.type(input, 'taken_name')
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/already taken/i)).toBeInTheDocument()
    })
  })

  it('400 validation error shows message', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')

    const error = new Error('Display name must be at least 3 characters')
    ;(error as any).status = 400
    ;(error as any).code = 'BAD_REQUEST'

    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'old_name',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: { canChat: true }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: mockRename.mockRejectedValue(error)
    })

    const user = userEvent.setup()
    render(<ProfileRename onClose={mockOnClose} />)

    const input = screen.getByLabelText(/new display name/i)
    const saveButton = screen.getByRole('button', { name: /save/i })

    await user.clear(input)
    await user.type(input, 'ab')
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument()
    })
  })

  it('403 banned shows error', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')

    const error = new Error('User is banned')
    ;(error as any).status = 403
    ;(error as any).code = 'FORBIDDEN'

    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'old_name',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: { canChat: true }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: mockRename.mockRejectedValue(error)
    })

    const user = userEvent.setup()
    render(<ProfileRename onClose={mockOnClose} />)

    const input = screen.getByLabelText(/new display name/i)
    const saveButton = screen.getByRole('button', { name: /save/i })

    await user.clear(input)
    await user.type(input, 'new_name')
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/banned/i)).toBeInTheDocument()
    })
  })

  it('client-side validation for invalid names', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'old_name',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: { canChat: true }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: mockRename
    })

    const user = userEvent.setup()
    render(<ProfileRename onClose={mockOnClose} />)

    const input = screen.getByLabelText(/new display name/i)
    const saveButton = screen.getByRole('button', { name: /save/i })

    // Test uppercase
    await user.clear(input)
    await user.type(input, 'UPPERCASE')
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/lowercase letters, numbers, and underscores/i)).toBeInTheDocument()
    })

    // Test too short
    await user.clear(input)
    await user.type(input, 'ab')
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument()
    })

    // Test with spaces
    await user.clear(input)
    await user.type(input, 'has space')
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/lowercase letters, numbers, and underscores/i)).toBeInTheDocument()
    })
  })
})
