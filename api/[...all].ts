// Catch-all API router - Single Vercel Function for Hobby plan
// Routes all /api/* requests to appropriate handlers

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { matchRoute, findMatchingMethods, getRouteMetadata, type Route } from './_shared/router.js'
import { logger, generateCorrelationId } from '../src/lib/logger.js'

// Import all handlers from api_handlers/ (not treated as Vercel Functions)
// Note: These handlers are already wrapped with secureHandler()
import healthHandler from '../api_handlers/health.js'
import versionHandler from '../api_handlers/version.js'
import pingHandler from '../api_handlers/ping.js'
import sessionHelloHandler from '../api_handlers/session/hello.js'
import sessionWhoamiHandler from '../api_handlers/session/whoami.js'
import chatRecentHandler from '../api_handlers/chat/recent.js'
import chatPostHandler from '../api_handlers/chat/post.js'
import stationStateHandler from '../api_handlers/station/state.js'
import stationAdvanceHandler from '../api_handlers/station/advance.js'
import usersHandler from '../api_handlers/users.js'
import usersActiveHandler from '../api_handlers/users/active.js'
import usersBioHandler from '../api_handlers/users/bio.js'
import usersRenameHandler from '../api_handlers/users/rename.js'
import usersGetHandler from '../api_handlers/users/[id].js'
import userAvatarHandler from '../api_handlers/users/[id]/avatar.js'
import presencePingHandler from '../api_handlers/presence/ping.js'
import queuePriceQuoteHandler from '../api_handlers/queue/price-quote.js'
import queueSubmitHandler from '../api_handlers/queue/submit.js'
import queueConfirmHandler from '../api_handlers/queue/confirm.js'
import reactionsHandler from '../api_handlers/reactions.js'
import adminStateHandler from '../api_handlers/admin/state.js'
import adminAuditHandler from '../api_handlers/admin/audit.js'
import adminGenerateHandler from '../api_handlers/admin/generate.js'
import adminAdvanceHandler from '../api_handlers/admin/advance.js'
import adminTrackHandler from '../api_handlers/admin/track/[id].js'
import adminCleanupTestDataHandler from '../api_handlers/admin/cleanup-test-data.js'
import adminDebugTracksHandler from '../api_handlers/admin/debug-tracks.js'
import adminFixAudioUrlsHandler from '../api_handlers/admin/fix-audio-urls.js'
import legalPrivacyHandler from '../api_handlers/legal/privacy.js'
import legalTermsHandler from '../api_handlers/legal/terms.js'
import debugEnvHandler from '../api_handlers/debug/env.js'
import audioProxyHandler from '../api_handlers/audio-proxy.js'
import workerGenerateHandler from '../api_handlers/worker/generate.js'
import workerAugmentHandler from '../api_handlers/worker/augment.js'
import workerCleanupHandler from '../api_handlers/worker/cleanup-ephemeral.js'
import walletProveHandler from '../api_handlers/wallet/prove.js'
import x402MockProofsHandler from '../api_handlers/x402/mock-proofs.js'
import authLinkDevHandler from '../api_handlers/auth/link/dev.js'
import authUnlinkDevHandler from '../api_handlers/auth/unlink/dev.js'

// Route table - order matters! Specific routes before dynamic ones
const routes: Route[] = [
  // Health & version
  { method: 'GET', pattern: '/health', handler: healthHandler },
  { method: 'GET', pattern: '/version', handler: versionHandler },
  { method: 'GET', pattern: '/ping', handler: pingHandler },

  // Session
  { method: 'GET', pattern: '/session/hello', handler: sessionHelloHandler },
  { method: 'POST', pattern: '/session/hello', handler: sessionHelloHandler },
  { method: 'GET', pattern: '/session/whoami', handler: sessionWhoamiHandler },

  // Auth
  { method: 'POST', pattern: '/auth/link/dev', handler: authLinkDevHandler },
  { method: 'POST', pattern: '/auth/unlink/dev', handler: authUnlinkDevHandler },

  // Chat
  { method: 'GET', pattern: '/chat/recent', handler: chatRecentHandler },
  { method: 'POST', pattern: '/chat/post', handler: chatPostHandler },

  // Station
  { method: 'GET', pattern: '/station/state', handler: stationStateHandler },
  { method: 'GET', pattern: '/station/advance', handler: stationAdvanceHandler },
  { method: 'POST', pattern: '/station/advance', handler: stationAdvanceHandler },

  // Users - specific routes BEFORE dynamic param routes
  { method: 'GET', pattern: '/users/active', handler: usersActiveHandler },
  { method: 'GET', pattern: '/users', handler: usersHandler },
  { method: 'POST', pattern: '/users/bio', handler: usersBioHandler },
  { method: 'POST', pattern: '/users/rename', handler: usersRenameHandler },
  { method: 'GET', pattern: '/users/:id/avatar', handler: userAvatarHandler },
  { method: 'GET', pattern: '/users/:id', handler: usersGetHandler },
  { method: 'PATCH', pattern: '/users/:id', handler: usersGetHandler },
  { method: 'PUT', pattern: '/users/:id', handler: usersGetHandler },

  // Presence
  { method: 'POST', pattern: '/presence/ping', handler: presencePingHandler },

  // Queue
  { method: 'POST', pattern: '/queue/price-quote', handler: queuePriceQuoteHandler },
  { method: 'POST', pattern: '/queue/submit', handler: queueSubmitHandler },
  { method: 'POST', pattern: '/queue/confirm', handler: queueConfirmHandler },

  // Reactions
  { method: 'POST', pattern: '/reactions', handler: reactionsHandler },

  // Admin
  { method: 'GET', pattern: '/admin/state', handler: adminStateHandler },
  { method: 'GET', pattern: '/admin/audit', handler: adminAuditHandler },
  { method: 'POST', pattern: '/admin/generate', handler: adminGenerateHandler },
  { method: 'GET', pattern: '/admin/advance', handler: adminAdvanceHandler },
  { method: 'POST', pattern: '/admin/cleanup-test-data', handler: adminCleanupTestDataHandler },
  { method: 'GET', pattern: '/admin/debug-tracks', handler: adminDebugTracksHandler },
  { method: 'POST', pattern: '/admin/fix-audio-urls', handler: adminFixAudioUrlsHandler },
  { method: 'GET', pattern: '/admin/track/:id', handler: adminTrackHandler },
  { method: 'POST', pattern: '/admin/track/:id', handler: adminTrackHandler },
  { method: 'DELETE', pattern: '/admin/track/:id', handler: adminTrackHandler },

  // Legal
  { method: 'GET', pattern: '/legal/privacy', handler: legalPrivacyHandler },
  { method: 'GET', pattern: '/legal/terms', handler: legalTermsHandler },

  // Debug
  { method: 'GET', pattern: '/debug/env', handler: debugEnvHandler },

  // Audio proxy
  { method: 'GET', pattern: '/audio-proxy', handler: audioProxyHandler },

  // Worker
  { method: 'POST', pattern: '/worker/generate', handler: workerGenerateHandler },
  { method: 'POST', pattern: '/worker/augment', handler: workerAugmentHandler },
  { method: 'POST', pattern: '/worker/cleanup-ephemeral', handler: workerCleanupHandler },

  // Wallet
  { method: 'POST', pattern: '/wallet/prove', handler: walletProveHandler },

  // X402
  { method: 'POST', pattern: '/x402/mock-proofs', handler: x402MockProofsHandler },
]

/**
 * Catch-all handler that routes to appropriate endpoint handlers
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) || generateCorrelationId()
  const method = req.method || 'GET'
  const path = req.url || '/'

  // Set request ID early
  res.setHeader('X-Request-Id', requestId)

  // Enable debug logging in dev
  const isDev = process.env.NODE_ENV !== 'production'

  // Special handling for debug route (dev only)
  if (isDev && method === 'GET' && path.includes('/_debug/routes')) {
    const metadata = getRouteMetadata(routes)
    res.status(200).json({
      routes: metadata,
      count: metadata.length,
      env: process.env.NODE_ENV
    })
    return
  }

  // Handle OPTIONS preflight (always allow CORS)
  if (method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  // Match route
  const match = matchRoute(routes, method, path, {
    debug: isDev,
    correlationId: requestId
  })

  if (!match) {
    // Check if path matches but different method (405 vs 404)
    const allowedMethods = findMatchingMethods(routes, path)

    if (allowedMethods.length > 0) {
      // Path exists but method not allowed
      res.setHeader('Allow', allowedMethods.join(', '))
      logger.warn('Method not allowed', {
        requestId,
        method,
        path,
        allowedMethods
      })

      res.status(405).json({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `Method ${method} not allowed for this endpoint`,
          hint: `Allowed methods: ${allowedMethods.join(', ')}`
        },
        requestId
      })
      return
    }

    // No route found at all
    logger.warn('Route not found', {
      requestId,
      method,
      path
    })

    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API endpoint not found'
      },
      requestId
    })
    return
  }

  // Inject params into req for handlers that expect them (e.g., /users/:id)
  if (match.params && Object.keys(match.params).length > 0) {
    // Some handlers read from req.query for dynamic params
    req.query = { ...req.query, ...match.params }
  }

  // Route to handler (already wrapped with secureHandler)
  await match.handler(req, res)
}
