// tests/ui/chat-composer-gate.test.tsx
// Tests for ChatPanel composer gating based on canChat capability

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ChatPanel from '../../src/components/ui/turntable/ChatPanel'

// Mock useIdentity hook
vi.mock('../../src/hooks/useIdentity', () => ({
  useIdentity: vi.fn()
}))

// Mock useEphemeralUser (still used by ChatPanel for avatars)
vi.mock('../../src/hooks/useEphemeralUser', () => ({
  useEphemeralUser: vi.fn(() => ({
    identity: { userId: 'user-123', avatarUrl: null },
    loading: false
  }))
}))

describe('ChatPanel - Composer Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock chat feature enabled
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [] })
    } as Response)
  })

  it('disables composer when canChat=false', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'guest_user',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: {
          canChat: false
        }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: vi.fn()
    })

    render(<ChatPanel />)

    await waitFor(() => {
      const textarea = screen.queryByPlaceholderText(/type a message/i)
      const sendButton = screen.queryByRole('button', { name: /send/i })

      if (textarea) {
        expect(textarea).toBeDisabled()
      }
      if (sendButton) {
        expect(sendButton).toBeDisabled()
      }
    })
  })

  it('shows hint when canChat=false', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'guest_user',
        ephemeral: true,
        kind: 'human',
        banned: false,
        createdAt: '2025-01-17T10:00:00Z',
        capabilities: {
          canChat: false
        }
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
      renaming: false,
      rename: vi.fn()
    })

    render(<ChatPanel />)

    await waitFor(() => {
      expect(screen.getByText(/link discord to chat/i)).toBeInTheDocument()
    })
  })

  it('enables composer when canChat=true', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'active_user',
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

    render(<ChatPanel />)

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/type a message/i)
      expect(textarea).not.toBeDisabled()
    })
  })

  it('does not show hint when canChat=true', async () => {
    const { useIdentity } = await import('../../src/hooks/useIdentity')
    vi.mocked(useIdentity).mockReturnValue({
      identity: {
        userId: 'user-123',
        displayName: 'active_user',
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

    render(<ChatPanel />)

    await waitFor(() => {
      expect(screen.queryByText(/link discord to chat/i)).not.toBeInTheDocument()
    })
  })
})
