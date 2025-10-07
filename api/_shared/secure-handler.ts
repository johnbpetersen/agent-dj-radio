// Secure API handler wrapper
// Sprint 6: Apply security headers and rate limiting to all endpoints

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCorsAndSecurity, checkRateLimit, applyRateLimitHeaders, SecurityOptions } from './security.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker } from '../../src/lib/error-tracking.js'
import { normalizeError, createErrorResponse, redactSecrets, type ErrorMeta } from './errors.js'
import { serverEnv } from '../../src/config/env.server.js'

/**
 * Parse rate limit path overrides from env
 * Format: "/api/path:max:windowMs,/api/other:max"
 * Example: "/api/presence/ping:120:60000,/api/queue/confirm:10:60000"
 */
function parseRateLimitOverrides(overrides: string | undefined): Map<string, { max: number; windowMs: number }> {
  const map = new Map()

  if (!overrides) return map

  const entries = overrides.split(',').map(s => s.trim()).filter(Boolean)

  for (const entry of entries) {
    try {
      const [path, maxStr, windowMsStr] = entry.split(':')

      if (!path || !maxStr) {
        logger.warn(`Ignoring malformed rate limit override: "${entry}"`)
        continue
      }

      const max = parseInt(maxStr, 10)
      const windowMs = windowMsStr ? parseInt(windowMsStr, 10) : serverEnv.RATE_LIMIT_WINDOW_MS

      if (isNaN(max) || isNaN(windowMs)) {
        logger.warn(`Ignoring invalid rate limit override: "${entry}"`)
        continue
      }

      map.set(path.trim(), { max, windowMs })
    } catch (err) {
      logger.warn(`Ignoring malformed rate limit override: "${entry}"`)
    }
  }

  return map
}

// Parse overrides at boot time
const rateLimitOverrides = parseRateLimitOverrides(serverEnv.RATE_LIMIT_PATH_OVERRIDES)

if (rateLimitOverrides.size > 0 && serverEnv.LOG_LEVEL === 'debug') {
  logger.debug('Rate limit path overrides loaded', {
    overrides: Array.from(rateLimitOverrides.entries()).map(([path, config]) => ({
      path,
      max: config.max,
      windowMs: config.windowMs
    }))
  })
}

export interface SecureHandlerOptions extends SecurityOptions {
  rateLimitOptions?: {
    windowMs: number
    maxRequests: number
  }
  requireValidOrigin?: boolean
  logRequests?: boolean
}

/**
 * Wrap an API handler with security middleware
 */
export function secureHandler(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>,
  options: SecureHandlerOptions = {}
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    // Request ID propagation: accept x-request-id or generate new UUID
    const requestId = (req.headers['x-request-id'] as string) || generateCorrelationId()
    const correlationId = requestId // Keep existing correlationId usage for compatibility
    const startTime = Date.now()

    // Add request ID to response header
    res.setHeader('X-Request-Id', requestId)
    
    try {
      // Apply CORS and security headers
      const shouldContinue = applyCorsAndSecurity(req, res, options)
      if (!shouldContinue) {
        // Preflight request was handled (OPTIONS - do not count against rate limit)
        return
      }

      // Apply rate limiting if configured
      // Dev bypass: Only honor RATE_LIMIT_BYPASS in dev stage
      const bypassRateLimit = serverEnv.RATE_LIMIT_BYPASS && serverEnv.STAGE === 'dev'

      if (options.rateLimitOptions && !bypassRateLimit) {
        // Check for path-specific override
        const route = req.url || ''
        const override = rateLimitOverrides.get(route)

        let rateLimitConfig = override
          ? { windowMs: override.windowMs, maxRequests: override.max }
          : options.rateLimitOptions

        // Dev-only: Increase /api/queue/confirm limit for debugging
        if (serverEnv.STAGE === 'dev' && route === '/api/queue/confirm') {
          rateLimitConfig = { windowMs: 60000, maxRequests: 30 }
        }

        const rateLimit = checkRateLimit(req, rateLimitConfig)
        applyRateLimitHeaders(res, rateLimit)

        if (!rateLimit.allowed) {
          // Calculate retry after in seconds
          const retryAfterSeconds = Math.ceil((rateLimit.resetTime - Date.now()) / 1000)

          if (options.logRequests) {
            logger.warn('Rate limit exceeded', {
              correlationId,
              requestId,
              route: req.url,
              method: req.method,
              retryAfterSeconds
            })
          }

          res.status(429).json({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests. Please wait before retrying.',
              hint: `Retry in ${retryAfterSeconds}s`
            },
            requestId
          })
          return
        }
      }

      // Log request if enabled
      if (options.logRequests) {
        logger.request(req.url || 'unknown', {
          correlationId,
          requestId,
          route: req.url,
          method: req.method || 'UNKNOWN',
          path: req.url,
          queryKeysOnly: req.query ? Object.keys(req.query) : [],
          ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
          userAgent: redactSecrets(req.headers['user-agent'] || '')
        })
      }

      // Call the actual handler
      await handler(req, res)

      // Log response if enabled and not already logged by handler
      if (options.logRequests && !res.headersSent) {
        logger.requestComplete(
          req.url || 'unknown',
          Date.now() - startTime,
          {
            correlationId,
            requestId,
            route: req.url,
            method: req.method || 'UNKNOWN',
            path: req.url,
            queryKeysOnly: req.query ? Object.keys(req.query) : [],
            statusCode: res.statusCode,
            durationMs: Date.now() - startTime
          }
        )
      }

    } catch (error) {
      const durationMs = Date.now() - startTime

      // Build context for error normalization
      const context: ErrorMeta['context'] = {
        route: req.url || 'unknown',
        method: req.method || 'UNKNOWN',
        path: req.url,
        queryKeysOnly: req.query ? Object.keys(req.query) : []
      }

      // Normalize the error with full context
      const normalized = normalizeError(error, context)

      errorTracker.trackError(normalized.originalError, {
        operation: 'secure-handler',
        correlationId,
        requestId,
        method: req.method,
        path: req.url
      })

      if (options.logRequests) {
        logger.error('Secure handler error', {
          correlationId,
          requestId,
          route: req.url,
          method: req.method,
          path: req.url,
          queryKeysOnly: req.query ? Object.keys(req.query) : [],
          durationMs,
          errorCode: normalized.code,
          errorMeta: normalized.meta
        }, normalized.originalError)
      }

      // Create standardized error response
      if (!res.headersSent) {
        const errorResponse = createErrorResponse(error, requestId, context)
        res.status(errorResponse.status).json(errorResponse.body)
      }
    }
  }
}

/**
 * Predefined security configurations
 */
export const securityConfigs = {
  // Public endpoints (station state, etc)
  public: {
    allowedMethods: ['GET', 'OPTIONS'],
    rateLimitOptions: { windowMs: 60000, maxRequests: 100 }, // 100/min
    logRequests: true
  } satisfies SecureHandlerOptions,

  // User endpoints (queue submit, reactions)
  user: {
    allowedMethods: ['GET', 'POST', 'OPTIONS'],
    rateLimitOptions: { windowMs: 60000, maxRequests: 30 }, // 30/min
    logRequests: true,
    requireValidOrigin: true
  } satisfies SecureHandlerOptions,

  // Admin endpoints
  admin: {
    allowedMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    rateLimitOptions: { windowMs: 60000, maxRequests: 60 }, // 60/min
    logRequests: true,
    requireValidOrigin: true
  } satisfies SecureHandlerOptions,

  // Worker endpoints (internal)
  worker: {
    allowedMethods: ['POST', 'OPTIONS'],
    rateLimitOptions: { windowMs: 60000, maxRequests: 120 }, // 120/min (cron jobs)
    logRequests: true
  } satisfies SecureHandlerOptions
} as const