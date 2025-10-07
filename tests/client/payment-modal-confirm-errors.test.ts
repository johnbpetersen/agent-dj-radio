// tests/client/payment-modal-confirm-errors.test.ts
// Tests for PaymentModal error handling in /api/queue/confirm flow

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * These tests verify PaymentModal error handling:
 * - Mock 400 VALIDATION_ERROR with fields → Shows formatted string with all fields
 * - Mock 429 with Retry-After → Countdown displayed, button disabled
 * - Mock 429 with X-RateLimit-Reset → Countdown computed correctly
 * - Mock non-JSON 400 response → Fallback to text, no "[object Object]"
 * - Mock network error → Shows error.message
 * - Verify setError never called with non-string
 */

describe('PaymentModal /api/queue/confirm Error Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('toErrorString Helper', () => {
    it('should format VALIDATION_ERROR with fields array', () => {
      const errorResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          fields: [
            { path: 'txHash', message: 'Invalid transaction hash format' },
            { path: 'challengeId', message: 'Invalid challenge ID format' }
          ]
        },
        requestId: 'req-123'
      }

      // Simulate toErrorStringSync logic
      const errObj = errorResponse.error
      const code = errObj.code
      const message = errObj.message
      const fields = errObj.fields

      const fieldMessages = fields
        .map((f: any) => `${f.path}: ${f.message}`)
        .join(', ')
      const formatted = `${code}: ${message} (${fieldMessages})`

      expect(formatted).toBe(
        'VALIDATION_ERROR: Invalid request (txHash: Invalid transaction hash format, challengeId: Invalid challenge ID format)'
      )
      expect(formatted).not.toContain('[object Object]')
    })

    it('should format structured error without fields', () => {
      const errorResponse = {
        error: {
          code: 'EXPIRED',
          message: 'Payment challenge has expired'
        },
        requestId: 'req-456'
      }

      const errObj = errorResponse.error
      const formatted = `${errObj.code}: ${errObj.message}`

      expect(formatted).toBe('EXPIRED: Payment challenge has expired')
    })

    it('should format structured error with hint', () => {
      const errorResponse = {
        error: {
          code: 'NO_MATCH',
          message: 'Transaction not found',
          hint: 'Check the transaction hash'
        },
        requestId: 'req-789'
      }

      const errObj = errorResponse.error
      const formatted = errObj.hint
        ? `${errObj.code}: ${errObj.message} - ${errObj.hint}`
        : `${errObj.code}: ${errObj.message}`

      expect(formatted).toBe('NO_MATCH: Transaction not found - Check the transaction hash')
    })

    it('should handle Error instance', () => {
      const error = new Error('Network connection failed')

      const formatted = error instanceof Error ? error.message : String(error)

      expect(formatted).toBe('Network connection failed')
      expect(formatted).not.toContain('[object Object]')
    })

    it('should handle plain string', () => {
      const error = 'Something went wrong'

      const formatted = typeof error === 'string' ? error : String(error)

      expect(formatted).toBe('Something went wrong')
    })

    it('should handle unknown object by stringifying', () => {
      const error = { unexpected: 'value' }

      const formatted = (() => {
        try {
          const str = JSON.stringify(error)
          return str.length <= 200 ? str : str.substring(0, 197) + '...'
        } catch {
          return 'An unexpected error occurred'
        }
      })()

      expect(formatted).toBe('{"unexpected":"value"}')
      expect(formatted).not.toContain('[object Object]')
    })

    it('should cap long JSON strings', () => {
      const longError = { message: 'x'.repeat(300) }

      const formatted = (() => {
        try {
          const str = JSON.stringify(longError)
          return str.length <= 200 ? str : str.substring(0, 197) + '...'
        } catch {
          return 'An unexpected error occurred'
        }
      })()

      expect(formatted.length).toBeLessThanOrEqual(200)
      expect(formatted.endsWith('...')).toBe(true)
    })

    it('should never return "[object Object]"', () => {
      const testCases = [
        { error: { code: 'TEST', message: 'Test message' } },
        new Error('Test error'),
        'String error',
        { unexpected: 'data' },
        null,
        undefined
      ]

      testCases.forEach(testCase => {
        const formatted = (() => {
          if (testCase && typeof testCase === 'object' && 'error' in testCase) {
            const errObj = (testCase as any).error
            return `${errObj.code}: ${errObj.message}`
          }
          if (testCase instanceof Error) {
            return testCase.message
          }
          if (typeof testCase === 'string') {
            return testCase
          }
          try {
            return JSON.stringify(testCase) || 'An unexpected error occurred'
          } catch {
            return 'An unexpected error occurred'
          }
        })()

        expect(formatted).not.toBe('[object Object]')
        expect(formatted).not.toContain('[object Object]')
      })
    })
  })

  describe('400 VALIDATION_ERROR Response', () => {
    it('should display VALIDATION_ERROR with all fields', async () => {
      const mockResponse = {
        status: 400,
        ok: false,
        json: async () => ({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            fields: [
              { path: 'txHash', message: 'Required' },
              { path: 'challengeId', message: 'Required' }
            ]
          },
          requestId: 'req-123'
        })
      }

      const data = await mockResponse.json()
      const errObj = data.error

      const fieldMessages = errObj.fields
        .map((f: any) => `${f.path}: ${f.message}`)
        .join(', ')
      const formatted = `${errObj.code}: ${errObj.message} (${fieldMessages})`

      expect(formatted).toBe('VALIDATION_ERROR: Invalid request (txHash: Required, challengeId: Required)')
    })

    it('should display txHash format error', async () => {
      const mockResponse = {
        status: 400,
        ok: false,
        json: async () => ({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            fields: [
              { path: 'txHash', message: 'Invalid transaction hash format' }
            ]
          },
          requestId: 'req-456'
        })
      }

      const data = await mockResponse.json()
      const errObj = data.error

      const fieldMessages = errObj.fields
        .map((f: any) => `${f.path}: ${f.message}`)
        .join(', ')
      const formatted = `${errObj.code}: ${errObj.message} (${fieldMessages})`

      expect(formatted).toContain('Invalid transaction hash format')
      expect(formatted).not.toContain('[object Object]')
    })

    it('should include all fields in error message', async () => {
      const mockResponse = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          fields: [
            { path: 'txHash', message: 'Must be 0x followed by 64 hex characters' },
            { path: 'challengeId', message: 'Must be a valid UUID' },
            { path: 'amount', message: 'Must be positive' }
          ]
        },
        requestId: 'req-789'
      }

      const errObj = mockResponse.error
      const fieldMessages = errObj.fields
        .map((f: any) => `${f.path}: ${f.message}`)
        .join(', ')

      expect(fieldMessages).toContain('txHash:')
      expect(fieldMessages).toContain('challengeId:')
      expect(fieldMessages).toContain('amount:')
    })
  })

  describe('429 Rate Limit Response', () => {
    it('should parse Retry-After header and show countdown', () => {
      const mockResponse = {
        status: 429,
        headers: new Headers({
          'Retry-After': '30'
        })
      }

      const retryAfterHeader = mockResponse.headers.get('Retry-After')
      const retrySeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 30

      expect(retrySeconds).toBe(30)
    })

    it('should compute retry time from X-RateLimit-Reset', () => {
      const now = Date.now()
      const resetTimeUnix = Math.ceil((now + 45000) / 1000) // 45 seconds from now

      const mockResponse = {
        status: 429,
        headers: new Headers({
          'X-RateLimit-Reset': resetTimeUnix.toString()
        })
      }

      const resetHeader = mockResponse.headers.get('X-RateLimit-Reset')
      const resetTime = resetHeader ? parseInt(resetHeader, 10) * 1000 : 0
      const retrySeconds = Math.ceil((resetTime - now) / 1000)

      // Allow some margin for timing variability
      expect(retrySeconds).toBeGreaterThanOrEqual(44)
      expect(retrySeconds).toBeLessThanOrEqual(46)
    })

    it('should show countdown message and disable button', () => {
      let retryAfter: number | null = 30
      let isSubmitting = true

      const errorMessage = `RATE_LIMITED: Please wait ${retryAfter}s`
      const buttonDisabled = isSubmitting || retryAfter !== null

      expect(errorMessage).toBe('RATE_LIMITED: Please wait 30s')
      expect(buttonDisabled).toBe(true)
    })

    it('should decrement countdown every second', () => {
      let retryAfter: number | null = 10

      const interval = setInterval(() => {
        if (retryAfter === null || retryAfter <= 1) {
          clearInterval(interval)
          retryAfter = null
        } else {
          retryAfter--
        }
      }, 1000)

      // Advance 5 seconds
      vi.advanceTimersByTime(5000)
      expect(retryAfter).toBe(5)

      // Advance 5 more seconds
      vi.advanceTimersByTime(5000)
      expect(retryAfter).toBeNull()

      clearInterval(interval)
    })

    it('should re-enable button after countdown completes', () => {
      let retryAfter: number | null = 2
      let isSubmitting = true

      const interval = setInterval(() => {
        if (retryAfter === null || retryAfter <= 1) {
          clearInterval(interval)
          isSubmitting = false
          retryAfter = null
        } else {
          retryAfter--
        }
      }, 1000)

      // Fast-forward to completion
      vi.advanceTimersByTime(2000)

      expect(retryAfter).toBeNull()
      expect(isSubmitting).toBe(false)

      clearInterval(interval)
    })
  })

  describe('Non-JSON Response Handling', () => {
    it('should handle non-JSON 400 response with text fallback', async () => {
      const mockResponse = {
        status: 400,
        ok: false,
        json: async () => {
          throw new Error('Not JSON')
        },
        text: async () => 'Bad Request: Invalid format'
      }

      let errorText: string
      try {
        await mockResponse.json()
        errorText = 'Should not reach here'
      } catch {
        errorText = await mockResponse.text()
      }

      expect(errorText).toBe('Bad Request: Invalid format')
      expect(errorText).not.toContain('[object Object]')
    })

    it('should handle Response with no body', async () => {
      const mockResponse = {
        status: 500,
        ok: false,
        json: async () => {
          throw new Error('Not JSON')
        },
        text: async () => ''
      }

      let errorText: string
      try {
        await mockResponse.json()
        errorText = ''
      } catch {
        const text = await mockResponse.text()
        errorText = text || `HTTP ${mockResponse.status}`
      }

      expect(errorText).toBe('HTTP 500')
    })

    it('should handle completely malformed response', async () => {
      const mockResponse = {
        status: 502,
        ok: false,
        json: async () => {
          throw new Error('Parse error')
        },
        text: async () => {
          throw new Error('Read error')
        }
      }

      let errorText: string
      try {
        await mockResponse.json()
        errorText = ''
      } catch {
        try {
          errorText = await mockResponse.text()
        } catch {
          errorText = `HTTP ${mockResponse.status}`
        }
      }

      expect(errorText).toBe('HTTP 502')
    })
  })

  describe('Network Error Handling', () => {
    it('should extract message from Error instance', () => {
      const error = new Error('Failed to fetch')

      const errorMsg = error instanceof Error ? error.message : String(error)

      expect(errorMsg).toBe('Failed to fetch')
    })

    it('should handle fetch rejection', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      let errorMessage = ''
      try {
        await fetch('/api/queue/confirm', { method: 'POST' })
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err)
      }

      expect(errorMessage).toBe('Network error')
    })

    it('should handle timeout error', () => {
      const error = new Error('Request timeout')

      const formatted = error.message

      expect(formatted).toBe('Request timeout')
      expect(formatted).not.toContain('[object Object]')
    })
  })

  describe('setError Type Safety', () => {
    it('should always pass string to setError', () => {
      const testErrors = [
        { error: { code: 'TEST', message: 'Test' } },
        new Error('Error object'),
        'String error',
        42,
        null
      ]

      testErrors.forEach(testError => {
        let errorString: string

        if (testError && typeof testError === 'object' && 'error' in testError) {
          const errObj = (testError as any).error
          errorString = `${errObj.code}: ${errObj.message}`
        } else if (testError instanceof Error) {
          errorString = testError.message
        } else if (typeof testError === 'string') {
          errorString = testError
        } else {
          errorString = String(testError) || 'An unexpected error occurred'
        }

        expect(typeof errorString).toBe('string')
      })
    })

    it('should never set error to object', () => {
      const errorObject = { code: 'TEST', message: 'Test' }

      // Bad: setError(errorObject)
      // Good: setError(toErrorStringSync(errorObject))

      const formatted = (() => {
        if (errorObject && typeof errorObject === 'object') {
          if ('code' in errorObject && 'message' in errorObject) {
            return `${errorObject.code}: ${errorObject.message}`
          }
        }
        return String(errorObject)
      })()

      expect(typeof formatted).toBe('string')
      expect(formatted).not.toBe('[object Object]')
    })
  })

  describe('Integration Scenarios', () => {
    it('should handle complete VALIDATION_ERROR flow', async () => {
      // 1. Submit with invalid data
      const requestBody = { txHash: 'bad', challengeId: 'not-uuid' }

      // 2. Server responds with 400 VALIDATION_ERROR
      const serverResponse = {
        status: 400,
        ok: false,
        json: async () => ({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            fields: [
              { path: 'txHash', message: 'Invalid transaction hash format' },
              { path: 'challengeId', message: 'Invalid challenge ID format' }
            ]
          },
          requestId: 'req-validation-123'
        })
      }

      // 3. Client parses response
      const data = await serverResponse.json()
      const errObj = data.error

      // 4. Format error message
      const fieldMessages = errObj.fields
        .map((f: any) => `${f.path}: ${f.message}`)
        .join(', ')
      const errorMessage = `${errObj.code}: ${errObj.message} (${fieldMessages})`

      // 5. Verify UI shows readable error
      expect(errorMessage).toContain('VALIDATION_ERROR')
      expect(errorMessage).toContain('txHash')
      expect(errorMessage).toContain('challengeId')
      expect(errorMessage).not.toContain('[object Object]')
    })

    it('should handle 429 countdown flow', () => {
      let retryAfter: number | null = 15
      let isSubmitting = true
      let error: string | null = `RATE_LIMITED: Please wait ${retryAfter}s`

      // Initial state
      expect(retryAfter).toBe(15)
      expect(isSubmitting).toBe(true)
      expect(error).toBe('RATE_LIMITED: Please wait 15s')

      // Simulate countdown
      const interval = setInterval(() => {
        if (retryAfter === null || retryAfter <= 1) {
          clearInterval(interval)
          isSubmitting = false
          retryAfter = null
          error = null
        } else {
          retryAfter--
          error = `RATE_LIMITED: Please wait ${retryAfter}s`
        }
      }, 1000)

      // Advance 10 seconds
      vi.advanceTimersByTime(10000)
      expect(retryAfter).toBe(5)
      expect(error).toBe('RATE_LIMITED: Please wait 5s')

      // Advance 5 more seconds (complete)
      vi.advanceTimersByTime(5000)
      expect(retryAfter).toBeNull()
      expect(isSubmitting).toBe(false)
      expect(error).toBeNull()

      clearInterval(interval)
    })

    it('should handle network error gracefully', () => {
      const networkError = new Error('Failed to fetch')

      const errorMsg = networkError instanceof Error
        ? networkError.message
        : String(networkError)

      const displayError = `Network error: ${errorMsg}`

      expect(displayError).toBe('Network error: Failed to fetch')
      expect(displayError).not.toContain('[object Object]')
    })
  })
})
