// tests/ui/ChatPanel.test.tsx
// Tests for ChatPanel error handling and canChat gating

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ChatPanel from '../../src/components/ui/turntable/ChatPanel'

// Mock dependencies
vi.mock('../../src/hooks/useEphemeralUser', () => ({
  useEphemeralUser: vi.fn(() => ({
    identity: { userId: 'user-123', avatarUrl: null },
    loading: false
  }))
}))

vi.mock('../../src/hooks/useIdentity', () => ({
  useIdentity: vi.fn()
}))

vi.mock('../../src/lib/api', () => ({
  apiFetch: vi.fn()
}))

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock fetch for chat feature check and message fetching
    global.fetch = vi.fn((url) => {
      if (typeof url === 'string' && url.includes('/api/chat/recent')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ messages: [] })
        } as Response)
      }
      return Promise.resolve({
        ok: false,
        status: 404
      } as Response)
    })
  })

  describe('canChat gating', () => {
    it('disables composer when canChat=false and clicking Send does not call fetch', async () => {
      const { useIdentity } = await import('../../src/hooks/useIdentity')
      vi.mocked(useIdentity).mockReturnValue({
        identity: {
          userId: 'user-123',
          displayName: 'test_user',
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

      const { apiFetch } = await import('../../src/lib/api')
      vi.mocked(apiFetch).mockResolvedValue({
        ok: true,
        status: 200
      } as Response)

      render(<ChatPanel />)

      // Wait for chat to be enabled
      await waitFor(() => {
        expect(screen.getByText(/Link Discord to chat/i)).toBeInTheDocument()
      })

      // Composer should not be visible (shows CTA instead)
      expect(screen.queryByPlaceholderText(/type a message/i)).not.toBeInTheDocument()

      // Link Discord button should be present
      const linkButton = screen.getByText('Link Discord')
      expect(linkButton).toBeInTheDocument()

      // Verify apiFetch was not called for posting
      expect(apiFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/chat/post'),
        expect.anything()
      )
    })

    it('enables composer when canChat=true', async () => {
      const { useIdentity } = await import('../../src/hooks/useIdentity')
      vi.mocked(useIdentity).mockReturnValue({
        identity: {
          userId: 'user-123',
          displayName: 'test_user',
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

      // Wait for composer to be visible
      await waitFor(() => {
        const input = screen.getByPlaceholderText(/type a message/i)
        expect(input).toBeInTheDocument()
        expect(input).not.toBeDisabled()
      })
    })
  })

  describe('error handling', () => {
    it('shows string message when API returns error object', async () => {
      const { useIdentity } = await import('../../src/hooks/useIdentity')
      vi.mocked(useIdentity).mockReturnValue({
        identity: {
          userId: 'user-123',
          displayName: 'test_user',
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

      const { apiFetch } = await import('../../src/lib/api')
      vi.mocked(apiFetch).mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: 'FORBIDDEN',
            message: 'Forbidden'
          }
        })
      } as Response)

      render(<ChatPanel />)

      // Wait for composer
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument()
      })

      // Type a message
      const input = screen.getByPlaceholderText(/type a message/i)
      fireEvent.change(input, { target: { value: 'test message' } })

      // Click send
      const sendButton = screen.getByLabelText(/send message/i)
      fireEvent.click(sendButton)

      // Wait for error to appear
      await waitFor(() => {
        // Should show "Forbidden" text, not [object Object]
        expect(screen.getByText(/Forbidden/i)).toBeInTheDocument()
      })

      // Verify no crash (component still renders)
      expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument()
    })

    it('does not crash when error object has nested structure', async () => {
      const { useIdentity } = await import('../../src/hooks/useIdentity')
      vi.mocked(useIdentity).mockReturnValue({
        identity: {
          userId: 'user-123',
          displayName: 'test_user',
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

      const { apiFetch } = await import('../../src/lib/api')
      vi.mocked(apiFetch).mockRejectedValue({
        error: {
          code: 'NETWORK_ERROR',
          message: 'Network error occurred'
        }
      })

      render(<ChatPanel />)

      // Wait for composer
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument()
      })

      // Type and send
      const input = screen.getByPlaceholderText(/type a message/i)
      fireEvent.change(input, { target: { value: 'test' } })
      const sendButton = screen.getByLabelText(/send message/i)
      fireEvent.click(sendButton)

      // Wait for error
      await waitFor(() => {
        // Should show a string message, not crash
        const errorText = screen.getByText(/Network error occurred/i)
        expect(errorText).toBeInTheDocument()
        expect(errorText.textContent).not.toContain('[object Object]')
      })
    })
  })
})
