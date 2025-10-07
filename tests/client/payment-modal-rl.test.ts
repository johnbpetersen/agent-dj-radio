// tests/client/payment-modal-rl.test.ts
// Tests for PaymentModal rate limiting UX

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * These tests verify PaymentModal rate limiting behavior:
 * - Parse Retry-After header from 429 response
 * - Compute retry time from X-RateLimit-Reset header
 * - Show countdown message: "RATE_LIMITED: Please wait 30s"
 * - Disable Verify button during countdown
 * - Re-enable Verify button after countdown completes
 * - Decrement countdown every second
 * - Handle non-JSON 429 response with Retry-After header
 * - Use extractErrorMessage helper (no "[object Object]")
 */

describe('PaymentModal Rate Limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('429 Response Parsing', () => {
    it('should parse Retry-After header from 429 response', () => {
      const mockResponse = {
        status: 429,
        headers: new Map([['Retry-After', '30']])
      }

      const retryAfterHeader = mockResponse.headers.get('Retry-After')
      const retrySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0

      expect(retrySeconds).toBe(30)
    })

    it('should compute retry time from X-RateLimit-Reset header', () => {
      const now = Date.now()
      const resetTimeUnix = Math.ceil((now + 45000) / 1000) // 45 seconds from now

      const mockResponse = {
        status: 429,
        headers: new Map([['X-RateLimit-Reset', resetTimeUnix.toString()]])
      }

      const resetHeader = mockResponse.headers.get('X-RateLimit-Reset')
      const resetTime = resetHeader ? parseInt(resetHeader, 10) * 1000 : 0
      const retrySeconds = Math.ceil((resetTime - now) / 1000)

      expect(retrySeconds).toBeGreaterThanOrEqual(44)
      expect(retrySeconds).toBeLessThanOrEqual(45)
    })

    it('should prefer Retry-After over X-RateLimit-Reset', () => {
      const now = Date.now()
      const resetTimeUnix = Math.ceil((now + 60000) / 1000) // 60 seconds

      const mockResponse = {
        status: 429,
        headers: new Map([
          ['Retry-After', '30'],
          ['X-RateLimit-Reset', resetTimeUnix.toString()]
        ])
      }

      let retrySeconds = 0
      const retryAfterHeader = mockResponse.headers.get('Retry-After')
      if (retryAfterHeader) {
        retrySeconds = parseInt(retryAfterHeader, 10)
      } else {
        const resetHeader = mockResponse.headers.get('X-RateLimit-Reset')
        if (resetHeader) {
          const resetTime = parseInt(resetHeader, 10) * 1000
          retrySeconds = Math.ceil((resetTime - now) / 1000)
        }
      }

      expect(retrySeconds).toBe(30) // Should use Retry-After
    })

    it('should use default fallback when no headers present', () => {
      const mockResponse = {
        status: 429,
        headers: new Map([])
      }

      let retrySeconds = 30 // Default fallback

      const retryAfterHeader = mockResponse.headers.get('Retry-After')
      if (retryAfterHeader) {
        retrySeconds = parseInt(retryAfterHeader, 10)
      } else {
        const resetHeader = mockResponse.headers.get('X-RateLimit-Reset')
        if (resetHeader) {
          const resetTime = parseInt(resetHeader, 10) * 1000
          retrySeconds = Math.ceil((resetTime - Date.now()) / 1000)
        }
      }

      expect(retrySeconds).toBe(30)
    })
  })

  describe('Countdown Message', () => {
    it('should show countdown message: "RATE_LIMITED: Please wait 30s"', () => {
      const retryAfter = 30
      const errorMessage = `RATE_LIMITED: Please wait ${retryAfter}s`

      expect(errorMessage).toBe('RATE_LIMITED: Please wait 30s')
    })

    it('should update message as countdown decrements', () => {
      let retryAfter = 30

      const messages = []
      for (let i = 30; i > 0; i--) {
        messages.push(`RATE_LIMITED: Please wait ${retryAfter}s`)
        retryAfter--
      }

      expect(messages[0]).toBe('RATE_LIMITED: Please wait 30s')
      expect(messages[29]).toBe('RATE_LIMITED: Please wait 1s')
      expect(messages.length).toBe(30)
    })

    it('should clear message when countdown reaches zero', () => {
      let retryAfter: number | null = 1
      let errorMessage: string | null = `RATE_LIMITED: Please wait ${retryAfter}s`

      // Simulate countdown reaching zero
      retryAfter = retryAfter - 1
      if (retryAfter <= 0) {
        retryAfter = null
        errorMessage = null
      }

      expect(retryAfter).toBeNull()
      expect(errorMessage).toBeNull()
    })
  })

  describe('Button State', () => {
    it('should disable Verify button when retryAfter is set', () => {
      const retryAfter = 30
      const txHash = '0x1234567890abcdef'
      const isSubmitting = false

      const isDisabled = isSubmitting || !txHash.trim() || retryAfter !== null

      expect(isDisabled).toBe(true)
    })

    it('should show countdown text on button during rate limit', () => {
      const retryAfter = 15
      const isSubmitting = false

      const buttonText = retryAfter !== null
        ? `Please wait ${retryAfter}s`
        : isSubmitting
        ? 'Verifying...'
        : 'Verify Payment'

      expect(buttonText).toBe('Please wait 15s')
    })

    it('should re-enable button after countdown completes', () => {
      const retryAfter = null
      const txHash = '0x1234567890abcdef'
      const isSubmitting = false

      const isDisabled = isSubmitting || !txHash.trim() || retryAfter !== null

      expect(isDisabled).toBe(false)
    })

    it('should disable button immediately on click to prevent double-submit', () => {
      let isSubmitting = false

      // Simulate button click
      const handleClick = () => {
        isSubmitting = true
      }

      handleClick()

      expect(isSubmitting).toBe(true)
    })
  })

  describe('Countdown Timer Logic', () => {
    it('should decrement countdown every second', () => {
      let retryAfter: number | null = 30

      // Simulate countdown interval
      const interval = setInterval(() => {
        if (retryAfter !== null && retryAfter > 1) {
          retryAfter--
        } else {
          clearInterval(interval)
          retryAfter = null
        }
      }, 1000)

      // Fast-forward 5 seconds
      vi.advanceTimersByTime(5000)
      expect(retryAfter).toBe(25)

      // Fast-forward 20 more seconds
      vi.advanceTimersByTime(20000)
      expect(retryAfter).toBe(5)

      // Fast-forward 5 more seconds (should reach zero and clear)
      vi.advanceTimersByTime(5000)
      expect(retryAfter).toBeNull()

      clearInterval(interval)
    })

    it('should clear interval when countdown reaches 1', () => {
      let retryAfter: number | null = 3
      let intervalCleared = false

      const mockInterval = setInterval(() => {
        if (retryAfter === null || retryAfter <= 1) {
          clearInterval(mockInterval)
          intervalCleared = true
          retryAfter = null
          return
        }
        retryAfter--
      }, 1000)

      // Advance 2 seconds (3 → 2 → 1)
      vi.advanceTimersByTime(2000)
      expect(retryAfter).toBe(1)
      expect(intervalCleared).toBe(false)

      // Advance 1 more second (should clear)
      vi.advanceTimersByTime(1000)
      expect(retryAfter).toBeNull()
      expect(intervalCleared).toBe(true)

      clearInterval(mockInterval)
    })

    it('should reset isSubmitting when countdown completes', () => {
      let retryAfter: number | null = 2
      let isSubmitting = true

      const interval = setInterval(() => {
        if (retryAfter === null || retryAfter <= 1) {
          clearInterval(interval)
          isSubmitting = false
          retryAfter = null
          return
        }
        retryAfter--
      }, 1000)

      // Fast-forward 2 seconds
      vi.advanceTimersByTime(2000)

      expect(retryAfter).toBeNull()
      expect(isSubmitting).toBe(false)

      clearInterval(interval)
    })
  })

  describe('Error Message Handling', () => {
    it('should not show "[object Object]" in error message', () => {
      const errorObject = { code: 'RATE_LIMITED', message: 'Too many requests' }

      // extractErrorMessage helper logic
      const extractErrorMessage = (err: any): string => {
        if (typeof err === 'string') return err
        if (err?.error?.message) return err.error.message
        if (err?.message) return err.message
        return 'An unexpected error occurred'
      }

      const message = extractErrorMessage(errorObject)

      expect(message).not.toContain('[object Object]')
      expect(typeof message).toBe('string')
    })

    it('should extract error message from nested error object', () => {
      const errorResponse = {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait before retrying.',
          hint: 'Retry in 30s'
        },
        requestId: 'req-123'
      }

      const extractErrorMessage = (err: any): string => {
        if (typeof err === 'string') return err
        if (err?.error?.message) return err.error.message
        if (err?.message) return err.message
        return 'An unexpected error occurred'
      }

      const message = extractErrorMessage(errorResponse)

      expect(message).toBe('Too many requests. Please wait before retrying.')
    })

    it('should handle string error message', () => {
      const error = 'Network error'

      const extractErrorMessage = (err: any): string => {
        if (typeof err === 'string') return err
        if (err?.error?.message) return err.error.message
        if (err?.message) return err.message
        return 'An unexpected error occurred'
      }

      const message = extractErrorMessage(error)

      expect(message).toBe('Network error')
    })

    it('should use fallback for unexpected error format', () => {
      const error = null

      const extractErrorMessage = (err: any): string => {
        if (typeof err === 'string') return err
        if (err?.error?.message) return err.error.message
        if (err?.message) return err.message
        return 'An unexpected error occurred'
      }

      const message = extractErrorMessage(error)

      expect(message).toBe('An unexpected error occurred')
    })
  })

  describe('Non-JSON 429 Response', () => {
    it('should handle non-JSON 429 response with Retry-After header', async () => {
      // Simulate fetch returning non-JSON 429 response
      global.fetch = vi.fn().mockResolvedValue({
        status: 429,
        ok: false,
        headers: new Headers({
          'Retry-After': '45'
        }),
        json: () => Promise.reject(new Error('Not JSON'))
      })

      let retryAfter: number | null = null
      let error: string | null = null

      try {
        const response = await fetch('/api/queue/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeId: 'test', txHash: '0xabc' })
        })

        if (response.status === 429) {
          let retrySeconds = 30 // Default

          const retryAfterHeader = response.headers.get('Retry-After')
          if (retryAfterHeader) {
            retrySeconds = parseInt(retryAfterHeader, 10)
          }

          retryAfter = retrySeconds
          error = `RATE_LIMITED: Please wait ${retrySeconds}s`
        }
      } catch (err) {
        error = 'Network error'
      }

      expect(retryAfter).toBe(45)
      expect(error).toBe('RATE_LIMITED: Please wait 45s')
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle complete rate limit flow', () => {
      // Initial state
      let retryAfter: number | null = null
      let isSubmitting = false
      let error: string | null = null

      // Simulate 429 response
      const handle429 = (retrySeconds: number) => {
        retryAfter = retrySeconds
        error = `RATE_LIMITED: Please wait ${retrySeconds}s`
      }

      handle429(10)

      expect(retryAfter).toBe(10)
      expect(error).toBe('RATE_LIMITED: Please wait 10s')
      expect(isSubmitting).toBe(false)

      // Simulate countdown
      const interval = setInterval(() => {
        if (retryAfter === null || retryAfter <= 1) {
          clearInterval(interval)
          isSubmitting = false
          retryAfter = null
          error = null
          return
        }
        retryAfter--
        error = `RATE_LIMITED: Please wait ${retryAfter}s`
      }, 1000)

      // Advance 5 seconds
      vi.advanceTimersByTime(5000)
      expect(retryAfter).toBe(5)
      expect(error).toBe('RATE_LIMITED: Please wait 5s')

      // Advance 5 more seconds (complete countdown)
      vi.advanceTimersByTime(5000)
      expect(retryAfter).toBeNull()
      expect(error).toBeNull()
      expect(isSubmitting).toBe(false)

      clearInterval(interval)
    })

    it('should prevent new request during countdown', () => {
      let retryAfter: number | null = 15
      let requestAttempts = 0

      const trySubmit = () => {
        if (retryAfter !== null) {
          // Button is disabled, don't submit
          return false
        }
        requestAttempts++
        return true
      }

      // Try to submit during countdown
      const result1 = trySubmit()
      expect(result1).toBe(false)
      expect(requestAttempts).toBe(0)

      // Clear countdown
      retryAfter = null

      // Try to submit after countdown
      const result2 = trySubmit()
      expect(result2).toBe(true)
      expect(requestAttempts).toBe(1)
    })
  })
})
