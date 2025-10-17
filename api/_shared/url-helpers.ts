// api/_shared/url-helpers.ts
// URL computation helpers for OAuth redirect URIs

import type { VercelRequest } from '@vercel/node'

/**
 * Compute public origin from request headers
 * Prefers Host + x-forwarded-proto (Vercel standard)
 * Falls back to VITE_SITE_URL in dev only
 *
 * @param req - Vercel request with headers
 * @returns Full origin like "https://domain.com" or "http://localhost:3001"
 */
export function computePublicOrigin(req: VercelRequest): string {
  const host = req.headers.host

  // Extract protocol from x-forwarded-proto (may be comma-separated list)
  const forwardedProto = req.headers['x-forwarded-proto'] as string | undefined
  let protocol = 'https' // Default to https on Vercel

  if (forwardedProto) {
    // Handle "https,http" lists - use first value
    protocol = forwardedProto.split(',')[0].trim()
  } else if (process.env.NODE_ENV !== 'production') {
    // Dev fallback: check if localhost, use http
    if (host?.includes('localhost') || host?.includes('127.0.0.1')) {
      protocol = 'http'
    }
  }

  // If we have host, use it
  if (host) {
    return `${protocol}://${host}`
  }

  // Dev fallback to VITE_SITE_URL (never in production)
  if (process.env.NODE_ENV !== 'production' && process.env.VITE_SITE_URL) {
    return process.env.VITE_SITE_URL
  }

  // No host header and not dev - this is an error
  throw new Error('Unable to determine public origin: missing Host header')
}

/**
 * Compute full redirect URI for OAuth callback
 *
 * @param req - Vercel request
 * @param path - Callback path (e.g., "/api/auth/callback")
 * @returns Full redirect URI
 */
export function computeRedirectUri(req: VercelRequest, path: string): string {
  const origin = computePublicOrigin(req)

  // Normalize path to start with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return `${origin}${normalizedPath}`
}
