// tests/client/payment-modal-errors.test.ts
// Tests for error message extraction in PaymentModal
// Ensures no "[object Object]" errors shown to users

import { describe, it, expect } from 'vitest'

/**
 * Helper to safely extract readable error message from API response
 * (Copy from PaymentModal.tsx for testing)
 */
function extractErrorMessage(data: any, defaultMessage: string): string {
  // Try structured error object first
  if (data?.error) {
    const code = data.error.code || 'UNKNOWN'
    const message = data.error.message || defaultMessage
    return `${code}: ${message}`
  }

  // Try top-level message
  if (typeof data?.message === 'string') {
    return data.message
  }

  // Try stringifying if object (but avoid "[object Object]")
  if (data && typeof data === 'object') {
    try {
      const str = JSON.stringify(data)
      if (str.length < 200) {
        return str
      }
      return defaultMessage
    } catch {
      return defaultMessage
    }
  }

  // Fallback to string conversion
  if (typeof data === 'string') {
    return data
  }

  return defaultMessage
}

describe('PaymentModal error extraction', () => {
  describe('Structured error responses', () => {
    it('should extract code and message from standard error', () => {
      const response = {
        error: {
          code: 'WRONG_AMOUNT',
          message: 'Payment amount does not match challenge'
        },
        requestId: 'req-123'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('WRONG_AMOUNT: Payment amount does not match challenge')
      expect(result).not.toContain('[object Object]')
    })

    it('should handle missing error code gracefully', () => {
      const response = {
        error: {
          message: 'Something went wrong'
        }
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('UNKNOWN: Something went wrong')
    })

    it('should handle missing error message gracefully', () => {
      const response = {
        error: {
          code: 'DB_ERROR'
        }
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('DB_ERROR: Payment failed')
    })

    it('should handle completely empty error object', () => {
      const response = {
        error: {}
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('UNKNOWN: Payment failed')
    })
  })

  describe('Top-level message responses', () => {
    it('should extract top-level message field', () => {
      const response = {
        message: 'Server is unavailable'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('Server is unavailable')
    })

    it('should prefer structured error over top-level message', () => {
      const response = {
        error: {
          code: 'EXPIRED',
          message: 'Challenge expired'
        },
        message: 'Top level message'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      // Should use error.code + error.message, not top-level
      expect(result).toBe('EXPIRED: Challenge expired')
    })
  })

  describe('Object stringification', () => {
    it('should stringify small objects', () => {
      const response = {
        status: 500,
        detail: 'Internal error'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      // Should be valid JSON, not "[object Object]"
      expect(result).toContain('"status":500')
      expect(result).toContain('"detail":"Internal error"')
      expect(result).not.toBe('[object Object]')
    })

    it('should truncate large objects to default message', () => {
      const largeResponse = {
        data: 'x'.repeat(300), // Over 200 char limit
        moreData: 'y'.repeat(300)
      }

      const result = extractErrorMessage(largeResponse, 'Payment failed')
      // Should use default, not stringify huge object
      expect(result).toBe('Payment failed')
    })

    it('should handle circular references gracefully', () => {
      const circular: any = { a: 1 }
      circular.self = circular

      const result = extractErrorMessage(circular, 'Payment failed')
      // JSON.stringify will fail, should return default
      expect(result).toBe('Payment failed')
    })
  })

  describe('Primitive values', () => {
    it('should handle string responses', () => {
      const result = extractErrorMessage('Network error', 'Payment failed')
      expect(result).toBe('Network error')
    })

    it('should handle null/undefined gracefully', () => {
      const result1 = extractErrorMessage(null, 'Payment failed')
      const result2 = extractErrorMessage(undefined, 'Payment failed')

      expect(result1).toBe('Payment failed')
      expect(result2).toBe('Payment failed')
    })

    it('should handle numbers gracefully', () => {
      const result = extractErrorMessage(500, 'Payment failed')
      expect(result).toBe('Payment failed')
    })
  })

  describe('Real-world error scenarios', () => {
    it('should handle 500 DB_ERROR response', () => {
      const response = {
        error: {
          code: 'DB_ERROR',
          message: 'Database error while checking payment status'
        },
        requestId: 'req-db-fail'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('DB_ERROR: Database error while checking payment status')
    })

    it('should handle 500 INTERNAL response', () => {
      const response = {
        error: {
          code: 'INTERNAL',
          message: 'Internal server error during payment confirmation'
        },
        requestId: 'req-internal'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('INTERNAL: Internal server error during payment confirmation')
    })

    it('should handle malformed JSON text response', () => {
      // Simulate: await response.text() after JSON parse fails
      const htmlError = '<!DOCTYPE html><html><body>500 Internal Server Error</body></html>'

      const result = extractErrorMessage(htmlError, 'Payment failed')
      expect(result).toBe(htmlError)
    })

    it('should handle CDP provider errors', () => {
      const response = {
        error: {
          code: 'PROVIDER_ERROR',
          message: 'CDP API returned 503'
        },
        requestId: 'req-cdp-down'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toBe('PROVIDER_ERROR: CDP API returned 503')
    })

    it('should handle validation errors', () => {
      const response = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request: txHash: Invalid transaction hash format'
        },
        requestId: 'req-validation'
      }

      const result = extractErrorMessage(response, 'Payment failed')
      expect(result).toContain('VALIDATION_ERROR')
      expect(result).toContain('Invalid transaction hash format')
    })
  })

  describe('Never returns [object Object]', () => {
    it('should never return literal string "[object Object]"', () => {
      const testCases = [
        {},
        { a: 1 },
        { error: {} },
        { error: { nested: { deep: true } } },
        { toString: () => '[object Object]' },
        Object.create(null),
        new Error('test'),
        { valueOf: () => ({}) }
      ]

      testCases.forEach((testCase, i) => {
        const result = extractErrorMessage(testCase, 'Payment failed')
        expect(result).not.toBe('[object Object]')
      })
    })
  })
})

/**
 * Integration test notes:
 *
 * To manually test error display in browser:
 *
 * 1. Trigger DB_ERROR:
 *    - Stop Supabase
 *    - Submit payment confirmation
 *    - Should see: "DB_ERROR: Database error while checking payment status (Database error - please try again)"
 *
 * 2. Trigger INTERNAL:
 *    - Modify confirm.ts to throw unexpected error
 *    - Submit payment confirmation
 *    - Should see: "INTERNAL: Internal server error during payment confirmation (Server error - please contact support)"
 *
 * 3. Trigger invalid JSON:
 *    - Return HTML instead of JSON from endpoint
 *    - Should see: "Server error (invalid JSON): <!DOCTYPE html>..."
 *
 * 4. Network failure:
 *    - Go offline
 *    - Submit payment confirmation
 *    - Should see: "Network error: Failed to fetch" (from catch block)
 *
 * All error messages should be readable strings, never "[object Object]"
 */
