import { describe, it, expect, vi, beforeEach } from 'vitest'
import { safeRedirect } from '../../api/_shared/http'

describe('safeRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('302 redirect strategies (force302=true)', () => {
    it('should use status().setHeader().end() for Vercel response', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/callback')

      expect(mockRes.status).toHaveBeenCalledWith(302)
      expect(mockRes.setHeader).toHaveBeenCalledWith('Location', 'https://example.com/callback')
      expect(mockRes.end).toHaveBeenCalled()
    })

    it('should use writeHead for Node.js http.ServerResponse', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/callback')

      expect(mockRes.writeHead).toHaveBeenCalledWith(302, { Location: 'https://example.com/callback' })
      expect(mockRes.end).toHaveBeenCalled()
    })

    it('should use statusCode + setHeader when only those are available', () => {
      const mockRes = {
        statusCode: 200,
        setHeader: vi.fn(),
        end: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/callback')

      expect(mockRes.statusCode).toBe(302)
      expect(mockRes.setHeader).toHaveBeenCalledWith('Location', 'https://example.com/callback')
      expect(mockRes.end).toHaveBeenCalled()
    })

    it('should use res.redirect() for Express-style response', () => {
      const mockRes = {
        redirect: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/callback')

      expect(mockRes.redirect).toHaveBeenCalledWith(302, 'https://example.com/callback')
    })

    it('should fallback to HTML when 302 methods fail', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn()
      }

      // Force 302 methods to fail
      safeRedirect(mockRes, 'https://example.com/callback', { force302: true })

      expect(mockRes.send).toHaveBeenCalled()
      const html = mockRes.send.mock.calls[0][0] as string
      expect(html).toContain('https://example.com/callback')
      expect(html).toContain('<meta http-equiv="refresh"')
      expect(html).toContain('window.location.replace')
    })
  })

  describe('HTML redirect strategy (force302=false)', () => {
    it('should use HTML meta refresh when force302=false', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/callback', { force302: false })

      expect(mockRes.send).toHaveBeenCalled()
      const html = mockRes.send.mock.calls[0][0] as string
      expect(html).toContain('https://example.com/callback')
      expect(html).toContain('<meta http-equiv="refresh"')
    })

    it('should escape HTML entities in meta refresh tag', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn()
      }

      const urlWithSpecialChars = 'https://example.com/?foo=bar&baz=<script>alert("xss")</script>'
      safeRedirect(mockRes, urlWithSpecialChars, { force302: false })

      const html = mockRes.send.mock.calls[0][0] as string
      // HTML entities should be escaped in meta refresh and anchor tags
      expect(html).toContain('content="0;url=https://example.com/?foo=bar&amp;baz=&lt;script&gt;')
      expect(html).toContain('&quot;')
      // JavaScript portion uses JSON.stringify which properly escapes for JS context
      expect(html).toContain('window.location.replace')
    })
  })

  describe('OAuth callback scenarios', () => {
    it('should redirect to homepage with discord_linked param', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/?discord_linked=1')

      expect(mockRes.status).toHaveBeenCalledWith(302)
      expect(mockRes.setHeader).toHaveBeenCalledWith('Location', 'https://example.com/?discord_linked=1')
    })

    it('should redirect to error page with discord_error param', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/?discord_error=access_denied')

      expect(mockRes.status).toHaveBeenCalledWith(302)
      expect(mockRes.setHeader).toHaveBeenCalledWith('Location', 'https://example.com/?discord_error=access_denied')
    })
  })

  describe('fallback strategies', () => {
    it('should fallback to JSON when all HTML methods fail', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }

      // No other methods available
      safeRedirect(mockRes, 'https://example.com/callback', { force302: false })

      expect(mockRes.json).toHaveBeenCalledWith({
        ok: true,
        redirectUrl: 'https://example.com/callback'
      })
    })

    it('should handle response objects with no methods gracefully', () => {
      const mockRes = {}

      // Should not throw
      expect(() => {
        safeRedirect(mockRes, 'https://example.com/callback')
      }).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('should handle relative URLs', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn()
      }

      safeRedirect(mockRes, '/callback')

      expect(mockRes.setHeader).toHaveBeenCalledWith('Location', '/callback')
    })

    it('should handle URLs with fragments', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn()
      }

      safeRedirect(mockRes, 'https://example.com/#section')

      expect(mockRes.setHeader).toHaveBeenCalledWith('Location', 'https://example.com/#section')
    })

    it('should handle localhost URLs for development', () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn()
      }

      safeRedirect(mockRes, 'http://localhost:5173/?discord_linked=1')

      expect(mockRes.setHeader).toHaveBeenCalledWith('Location', 'http://localhost:5173/?discord_linked=1')
    })
  })
})
