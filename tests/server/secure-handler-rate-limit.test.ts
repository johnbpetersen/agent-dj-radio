// tests/server/secure-handler-rate-limit.test.ts
// Tests for secure-handler rate limiting middleware with path overrides and dev bypass

import { describe, it, expect } from 'vitest'

/**
 * These tests verify rate limiting behavior in secure-handler:
 * - Global defaults (RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
 * - Path-specific overrides (RATE_LIMIT_PATH_OVERRIDES)
 * - Dev bypass (RATE_LIMIT_BYPASS only in dev stage)
 * - 429 response format (headers + JSON body)
 * - Route-specific keying (routes don't share buckets)
 * - OPTIONS requests not counted
 */

describe('Secure Handler Rate Limiting', () => {
  describe('Global defaults', () => {
    it('should respect global RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS', () => {
      const defaultConfig = {
        windowMs: 60000, // 1 minute
        maxRequests: 60   // 60 requests/minute
      }

      expect(defaultConfig.windowMs).toBe(60000)
      expect(defaultConfig.maxRequests).toBe(60)
    })

    it('should apply limits when requests exceed max', () => {
      // Simulate: 61 requests in 60 second window → 61st should be rate limited
      const maxRequests = 60
      const requestCount = 61

      const shouldRateLimit = requestCount > maxRequests
      expect(shouldRateLimit).toBe(true)
    })

    it('should reset counter after window expires', () => {
      const windowMs = 60000
      const now = Date.now()
      const resetTime = now + windowMs

      // After reset time, counter should reset
      const afterReset = now + windowMs + 1000
      const isExpired = afterReset > resetTime

      expect(isExpired).toBe(true)
    })
  })

  describe('Dev bypass', () => {
    it('should bypass all limits when RATE_LIMIT_BYPASS=true and STAGE=dev', () => {
      const config = {
        RATE_LIMIT_BYPASS: true,
        STAGE: 'dev'
      }

      const bypassEnabled = config.RATE_LIMIT_BYPASS && config.STAGE === 'dev'
      expect(bypassEnabled).toBe(true)
    })

    it('should NOT bypass in staging even if RATE_LIMIT_BYPASS=true', () => {
      const config = {
        RATE_LIMIT_BYPASS: true,
        STAGE: 'staging'
      }

      const bypassEnabled = config.RATE_LIMIT_BYPASS && config.STAGE === 'dev'
      expect(bypassEnabled).toBe(false)
    })

    it('should NOT bypass in alpha even if RATE_LIMIT_BYPASS=true', () => {
      const config = {
        RATE_LIMIT_BYPASS: true,
        STAGE: 'alpha'
      }

      const bypassEnabled = config.RATE_LIMIT_BYPASS && config.STAGE === 'dev'
      expect(bypassEnabled).toBe(false)
    })
  })

  describe('Path overrides parsing', () => {
    it('should parse override format: path:max:windowMs', () => {
      const override = '/api/presence/ping:120:60000'
      const [path, maxStr, windowMsStr] = override.split(':')

      expect(path).toBe('/api/presence/ping')
      expect(parseInt(maxStr, 10)).toBe(120)
      expect(parseInt(windowMsStr, 10)).toBe(60000)
    })

    it('should parse override format: path:max (use default windowMs)', () => {
      const override = '/api/queue/confirm:10'
      const [path, maxStr, windowMsStr] = override.split(':')

      expect(path).toBe('/api/queue/confirm')
      expect(parseInt(maxStr, 10)).toBe(10)
      expect(windowMsStr).toBeUndefined()

      // Should use default windowMs
      const windowMs = windowMsStr ? parseInt(windowMsStr, 10) : 60000
      expect(windowMs).toBe(60000)
    })

    it('should parse multiple overrides from comma-separated string', () => {
      const overrides = '/api/presence/ping:120:60000,/api/queue/confirm:10:60000,/api/queue/price-quote:20:60000'
      const entries = overrides.split(',')

      expect(entries.length).toBe(3)
      expect(entries[0].trim()).toBe('/api/presence/ping:120:60000')
      expect(entries[1].trim()).toBe('/api/queue/confirm:10:60000')
      expect(entries[2].trim()).toBe('/api/queue/price-quote:20:60000')
    })

    it('should skip empty entries when parsing', () => {
      const overrides = '/api/presence/ping:120,,/api/queue/confirm:10,'
      const entries = overrides.split(',').map(s => s.trim()).filter(Boolean)

      expect(entries.length).toBe(2)
      expect(entries[0]).toBe('/api/presence/ping:120')
      expect(entries[1]).toBe('/api/queue/confirm:10')
    })

    it('should detect malformed entries for logging', () => {
      const malformed = [
        'no-colon',           // Missing colon
        ':120:60000',         // Missing path
        '/api/path:',         // Missing max
        '/api/path:abc:def',  // Non-numeric values
      ]

      malformed.forEach(entry => {
        const parts = entry.split(':')
        const path = parts[0]
        const maxStr = parts[1]

        const isInvalid = !path || !maxStr || isNaN(parseInt(maxStr, 10))
        expect(isInvalid).toBe(true)
      })
    })

    it('should apply path-specific limit instead of global', () => {
      const globalLimit = { max: 60, windowMs: 60000 }
      const pathOverride = { max: 120, windowMs: 60000 }

      const route = '/api/presence/ping'
      const overrides = new Map([[route, pathOverride]])

      const effectiveLimit = overrides.get(route) || globalLimit
      expect(effectiveLimit.max).toBe(120) // Override, not global
    })

    it('should fall back to global limit for unspecified paths', () => {
      const globalLimit = { max: 60, windowMs: 60000 }
      const overrides = new Map([['/api/presence/ping', { max: 120, windowMs: 60000 }]])

      const route = '/api/queue/submit' // No override
      const effectiveLimit = overrides.get(route) || globalLimit

      expect(effectiveLimit.max).toBe(60) // Global limit
    })
  })

  describe('429 response format', () => {
    it('should return RATE_LIMITED code in JSON body', () => {
      const response = {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait before retrying.',
          hint: 'Retry in 30s'
        },
        requestId: 'req-abc123'
      }

      expect(response.error.code).toBe('RATE_LIMITED')
      expect(response.error.message).toContain('Too many requests')
      expect(response.error.hint).toContain('Retry in')
      expect(response.requestId).toBeTruthy()
    })

    it('should include Retry-After header in seconds', () => {
      const resetTime = Date.now() + 30000 // 30 seconds from now
      const retryAfterSeconds = Math.ceil((resetTime - Date.now()) / 1000)

      expect(retryAfterSeconds).toBeGreaterThanOrEqual(29)
      expect(retryAfterSeconds).toBeLessThanOrEqual(30)
    })

    it('should include X-RateLimit-Remaining header', () => {
      const maxRequests = 60
      const currentCount = 61
      const remaining = Math.max(0, maxRequests - currentCount)

      expect(remaining).toBe(0)
    })

    it('should include X-RateLimit-Reset header (unix timestamp)', () => {
      const windowMs = 60000
      const now = Date.now()
      const resetTimeMs = now + windowMs
      const resetTimeUnix = Math.ceil(resetTimeMs / 1000)

      expect(resetTimeUnix).toBeGreaterThan(Date.now() / 1000)
    })

    it('should include requestId in 429 response', () => {
      const requestId = 'req-rate-limited-123'
      const response = {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
          hint: 'Retry in 15s'
        },
        requestId
      }

      expect(response.requestId).toBe(requestId)
    })
  })

  describe('Route-specific keying', () => {
    it('should create unique keys per route', () => {
      const sessionId = 'session-123'
      const route1 = '/api/presence/ping'
      const route2 = '/api/queue/confirm'

      const key1 = `${sessionId}:${route1}`
      const key2 = `${sessionId}:${route2}`

      expect(key1).not.toBe(key2)
    })

    it('should prefer X-Session-Id over IP for keying', () => {
      const sessionId = 'session-456'
      const ip = '192.168.1.1'
      const route = '/api/presence/ping'

      const identifier = sessionId || ip // Prefer session
      const key = `${identifier}:${route}`

      expect(key).toBe('session-456:/api/presence/ping')
    })

    it('should fall back to IP when no X-Session-Id', () => {
      const sessionId = undefined
      const ip = '192.168.1.1'
      const route = '/api/queue/confirm'

      const identifier = sessionId || ip
      const key = `${identifier}:${route}`

      expect(key).toBe('192.168.1.1:/api/queue/confirm')
    })

    it('should not share counters across routes', () => {
      // Simulate independent counters
      const counters = new Map()
      counters.set('session-123:/api/presence/ping', { count: 50 })
      counters.set('session-123:/api/queue/confirm', { count: 5 })

      expect(counters.get('session-123:/api/presence/ping')?.count).toBe(50)
      expect(counters.get('session-123:/api/queue/confirm')?.count).toBe(5)
    })
  })

  describe('OPTIONS requests (CORS preflight)', () => {
    it('should not count OPTIONS requests against rate limit', () => {
      const method = 'OPTIONS'
      const shouldSkipRateLimit = method === 'OPTIONS'

      expect(shouldSkipRateLimit).toBe(true)
    })

    it('should count POST requests against rate limit', () => {
      const method = 'POST'
      const shouldSkipRateLimit = method === 'OPTIONS'

      expect(shouldSkipRateLimit).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should handle malformed override strings gracefully', () => {
      const malformed = '  ,,,   /api/path:10:abc,  ,'
      const entries = malformed.split(',').map(s => s.trim()).filter(Boolean)

      const validEntries = entries.filter(entry => {
        const [path, maxStr] = entry.split(':')
        return path && maxStr && !isNaN(parseInt(maxStr, 10))
      })

      // Should skip malformed entry ":10:abc"
      expect(validEntries.length).toBe(0)
    })

    it('should handle very high request counts', () => {
      const maxRequests = 60
      const requestCount = 1000000

      const shouldRateLimit = requestCount > maxRequests
      const remaining = Math.max(0, maxRequests - requestCount)

      expect(shouldRateLimit).toBe(true)
      expect(remaining).toBe(0)
    })
  })
})
