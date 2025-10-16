import type { VercelRequest } from '@vercel/node'

/**
 * Admin authentication guard for admin endpoints
 * Returns null on success, error message on failure
 * If ADMIN_TOKEN not set, returns 'NOT_FOUND' to trigger 404
 */
export function requireAdminAuth(req: VercelRequest): string | null {
  const adminToken = process.env.ADMIN_TOKEN
  
  // If admin token not configured, pretend endpoint doesn't exist
  if (!adminToken) {
    return 'NOT_FOUND'
  }
  
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return 'Missing or invalid Authorization header'
  }
  
  const token = authHeader.slice(7)
  if (token !== adminToken) {
    return 'Invalid admin token'
  }
  
  return null // Success
}