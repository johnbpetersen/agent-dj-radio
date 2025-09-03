// Secure API handler wrapper
// Sprint 6: Apply security headers and rate limiting to all endpoints

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCorsAndSecurity, checkRateLimit, applyRateLimitHeaders, SecurityOptions } from './security'
import { logger, generateCorrelationId } from '../../src/lib/logger'
import { errorTracker } from '../../src/lib/error-tracking'

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
    const correlationId = generateCorrelationId()
    const startTime = Date.now()
    
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
              ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
              path: req.url,
              method: req.method
            })
          }
          
          res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            correlationId
          })
          return
        }
      }

      // Log request if enabled
      if (options.logRequests) {
        logger.request(req.url || 'unknown', {
          correlationId,
          method: req.method || 'UNKNOWN',
          ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
          userAgent: req.headers['user-agent']
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
            method: req.method || 'UNKNOWN',
            statusCode: res.statusCode
          }
        )
      }

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      
      errorTracker.trackError(err, {
        operation: 'secure-handler',
        correlationId,
        method: req.method,
        path: req.url
      })
      
      if (options.logRequests) {
        logger.error('Secure handler error', { correlationId }, err)
      }
      
      // Don't expose internal errors to client
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'An unexpected error occurred',
          correlationId
        })
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