// tests/ui/identity-topnav.test.tsx
// Tests for TopNav identity display (displayName + guest badge)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TopNav from '../../src/components/ui/turntable/TopNav'

// Mock useIdentity hook
vi.mock('../../src/hooks/useIdentity', () => ({
  useIdentity: vi.fn()
}))

describe('TopNav - Identity Display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders display name from whoami', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'cosmic_dolphin',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: {
          canChat: true
        }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: vi.fn()
    })

    render(<TopNav onQueueTrack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('cosmic_dolphin')).toBeInTheDocument()
    })
  })

  it('shows guest badge when ephemeral', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'cosmic_dolphin',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: {
          canChat: true
        }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: vi.fn()
    })

    render(<TopNav onQueueTrack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/guest/i)).toBeInTheDocument()
    })
  })

  it('hides guest badge when ephemeral=false', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'linked_user',
        ephemeral: false,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: {
          canChat: true
        }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: vi.fn()
    })

    render(<TopNav onQueueTrack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('linked_user')).toBeInTheDocument()
    })

    // Guest badge should not be present
    expect(screen.queryByText(/guest/i)).not.toBeInTheDocument()
  })

  it('shows loading skeleton while identity loads', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: vi.fn()
    })

    render(<TopNav onQueueTrack={vi.fn()} />)

    // Should show loading state, not crash
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })
})
