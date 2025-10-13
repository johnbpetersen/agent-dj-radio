// Security middleware for Vercel functions
// Sprint 6: CORS lockdown and security headers

import type { VercelRequest, VercelResponse } from '@vercel/node'

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:5173', // Development
  'http://localhost:3000', // Vercel dev
  process.env.VITE_SITE_URL, // Production/Staging
].filter(Boolean) as string[]

// Security headers to apply to all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net", // Allow Vite/React dev
    "style-src 'self' 'unsafe-inline'", // Allow inline styles for Tailwind
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.elevenlabs.io https://api.cdp.coinbase.com",
    "media-src 'self' https://*.supabase.co",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'"
  ].join('; ')
} as const

export interface SecurityOptions {
  allowedMethods?: string[]
  allowCredentials?: boolean
  maxAge?: number
}

/**
 * Apply CORS and security headers to response
 */
export function applyCorsAndSecurity(
  req: VercelRequest,
  res: VercelResponse,
  options: SecurityOptions = {}
): boolean {
  const {
    allowedMethods = ['GET', 'POST', 'OPTIONS'],
    allowCredentials = false,
    maxAge = 86400 // 24 hours
  } = options

  // Get origin from request
  const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || ''
  
  // Check if origin is allowed
  const isOriginAllowed = ALLOWED_ORIGINS.includes(origin) || 
    (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost'))

  // Apply security headers first
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value)
  })

  // Apply CORS headers
  if (isOriginAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    // For non-matching origins, don't set CORS headers
    // This will cause CORS failures in browsers, which is what we want
  }
  
  res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '))
  res.setHeader('Access-Control-Allow-Headers', [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ].join(', '))
  
  if (allowCredentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  
  res.setHeader('Access-Control-Max-Age', maxAge.toString())
  res.setHeader('Access-Control-Expose-Headers', 'X-PAYMENT')

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return false // Indicates request was handled
  }

  return true // Indicates request should continue
}

/**
 * Validate request origin for sensitive operations
 */
export function validateOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || ''
  
  return ALLOWED_ORIGINS.includes(origin) || 
    (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost'))
}

/**
 * Sanitize data before sending to client (remove sensitive fields)
 */
export function sanitizeForClient<T extends Record<string, unknown>>(
  data: T,
  sensitiveFields: (keyof T)[] = []
): T {
  const sanitized = { ...data }
  
  // Always remove these fields
  const alwaysSensitive = [
    'x402_payment_tx',
    'eleven_request_id',
    'service_role_key',
    'api_key',
    'secret',
    'token',
    'password',
    'private_key'
  ]
  
  const fieldsToRemove = [...alwaysSensitive, ...sensitiveFields]
  
  fieldsToRemove.forEach(field => {
    if (field in sanitized) {
      delete sanitized[field as keyof T]
    }
  })
  
  return sanitized
}

/**
 * Rate limiting by session ID or IP + route (in-memory, simple)
 * Key = X-Session-Id (if present) → else client IP → plus route
 * Routes don't share buckets
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()

export interface RateLimitOptions {
  windowMs: number
  maxRequests: number
}

export function checkRateLimit(
  req: VercelRequest,
  options: RateLimitOptions = { windowMs: 60000, maxRequests: 60 }
): { allowed: boolean; remaining: number; resetTime: number } {
  // Build rate limit key: sessionId or IP + route path
  const sessionId = req.headers['x-session-id']?.toString()
  const ip = req.headers['x-forwarded-for']?.toString()?.split(',')[0] ||
            req.headers['x-real-ip']?.toString() ||
            'unknown'
  const route = req.url || 'unknown'

  // Prefer session ID, fallback to IP, always include route for per-route limits
  const identifier = sessionId || ip
  const key = `${identifier}:${route}`

  const now = Date.now()

  // Clean up expired entries (periodic cleanup)
  if (Math.random() < 0.01) { // 1% chance per request
    for (const [k, value] of rateLimitStore.entries()) {
      if (value.resetTime < now) {
        rateLimitStore.delete(k)
      }
    }
  }

  // Get or create entry for this key
  let entry = rateLimitStore.get(key)
  if (!entry || entry.resetTime < now) {
    entry = { count: 0, resetTime: now + options.windowMs }
    rateLimitStore.set(key, entry)
  }

  // Increment counter
  entry.count++

  const allowed = entry.count <= options.maxRequests
  const remaining = Math.max(0, options.maxRequests - entry.count)

  return {
    allowed,
    remaining,
    resetTime: entry.resetTime
  }
}

/**
 * Apply rate limiting headers to response
 */
export function applyRateLimitHeaders(
  res: VercelResponse,
  rateLimit: { allowed: boolean; remaining: number; resetTime: number }
): void {
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString())
  res.setHeader('X-RateLimit-Reset', Math.ceil(rateLimit.resetTime / 1000).toString())
  
  if (!rateLimit.allowed) {
    res.setHeader('Retry-After', Math.ceil((rateLimit.resetTime - Date.now()) / 1000).toString())
  }
}