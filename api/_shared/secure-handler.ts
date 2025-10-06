// Secure API handler wrapper
// Sprint 6: Apply security headers and rate limiting to all endpoints

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCorsAndSecurity, checkRateLimit, applyRateLimitHeaders, SecurityOptions } from './security.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker } from '../../src/lib/error-tracking.js'
import { normalizeError, createErrorResponse, redactSecrets, type ErrorMeta } from './errors.js'

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
        // Preflight request was handled
        return
      }

      // Apply rate limiting if configured
      if (options.rateLimitOptions) {
        const rateLimit = checkRateLimit(req, options.rateLimitOptions)
        applyRateLimitHeaders(res, rateLimit)
        
        if (!rateLimit.allowed) {
          if (options.logRequests) {
            logger.warn('Rate limit exceeded', {
              correlationId,
              requestId,
              route: req.url,
              method: req.method,
              path: req.url,
              queryKeysOnly: req.query ? Object.keys(req.query) : [],
              ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown'
            })
          }

          res.status(429).json({
            error: {
              code: 'TOO_MANY_REQUESTS',
              message: 'Rate limit exceeded. Please try again later.'
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