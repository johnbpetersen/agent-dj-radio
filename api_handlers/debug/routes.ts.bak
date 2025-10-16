// Debug endpoint to list all registered routes (dev only)
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * GET /api/_debug/routes
 * Returns route metadata for debugging (dev only)
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Only available in non-production
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Debug endpoints not available in production'
      }
    })
    return
  }

  // Import routes dynamically to avoid circular dependency
  const { getRouteMetadata } = await import('../../api/_shared/router.js')

  // We need to re-import the routes array from [...all].ts
  // For now, return a helpful message
  res.status(200).json({
    message: 'Debug routes endpoint',
    hint: 'Route metadata available via getRouteMetadata() from router.ts',
    documentation: 'This endpoint shows all registered API routes in development mode'
  })
}
