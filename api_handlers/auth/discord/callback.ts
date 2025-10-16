// GET /api/auth/discord/callback?code=...&state=...
// Handles Discord OAuth callback
// 1. Verify CSRF state
// 2. Exchange code for access token
// 3. Fetch Discord user profile
// 4. Link or merge with current session user
// 5. Redirect back to frontend

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { getSessionId, parseCookies, clearOAuthStateCookie, debugOAuth } from '../../_shared/session-helpers.js'
import { computeRedirectUri } from '../../_shared/url-helpers.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'
import { safeRedirect } from '../../_shared/http.js'
import { resolveDisplayNameWithSuffix } from '../../_shared/identity.js'

// --- Type definitions ---
type DiscordTokenError = { error: string; error_description?: string }

interface DiscordTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

interface DiscordUser {
  id: string
  username: string
  discriminator?: string
  global_name: string | null
  avatar: string | null
}

// --- Type guards for safe JSON narrowing ---
function isDiscordTokenResponse(v: unknown): v is DiscordTokenResponse {
  return !!v && typeof v === 'object'
    && typeof (v as any).access_token === 'string'
    && typeof (v as any).token_type === 'string'
}

function isDiscordUser(v: unknown): v is DiscordUser {
  return !!v && typeof v === 'object'
    && typeof (v as any).id === 'string'
    && typeof (v as any).username === 'string'
}

// Removed: parseCookie() - now using parseCookies() from session-helpers

/**
 * Parse OAuth state parameter (base64url encoded JSON with csrf + sid)
 */
function parseStatePayload(state: string): { csrf: string; sid: string } | null {
  try {
    // Decode base64url to JSON
    const base64 = state
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const json = Buffer.from(base64 + padding, 'base64').toString('utf-8')
    const payload = JSON.parse(json)

    if (typeof payload?.csrf === 'string' && typeof payload?.sid === 'string') {
      return { csrf: payload.csrf, sid: payload.sid }
    }
  } catch {
    // Parsing failed
  }
  return null
}

async function discordCallbackHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    throw httpError.badRequest('Method not allowed', 'Only GET requests are supported')
  }

  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.info('Discord OAuth callback', { correlationId })

  // Parse query params
  const { code, state, error, error_description } = req.query

  // Handle OAuth errors from Discord
  if (error) {
    logger.warn('Discord OAuth error', {
      correlationId,
      error,
      error_description
    })

    const errorUrl = new URL(process.env.VITE_SITE_URL || 'http://localhost:5173')
    errorUrl.searchParams.set('discord_error', error as string)
    if (error_description) {
      errorUrl.searchParams.set('discord_error_description', error_description as string)
    }

    console.log('[discord/callback] redirecting to error URL', errorUrl.toString())
    safeRedirect(res, errorUrl.toString())
    return
  }

  // Validate required params
  if (!code || !state) {
    logger.warn('Discord callback missing code or state', { correlationId })
    throw httpError.badRequest('Invalid callback parameters')
  }

  // Parse state payload (contains csrf + sid)
  const statePayload = parseStatePayload(state as string)
  if (!statePayload) {
    logger.warn('Discord OAuth state payload invalid', { correlationId })
    throw httpError.badRequest('Invalid state parameter format')
  }

  // Verify CSRF state from cookie (use oauth_state)
  const cookies = parseCookies(req)
  const cookieState = cookies.oauth_state

  debugOAuth('Verifying OAuth state', {
    correlationId,
    hasState: !!state,
    hasCookie: !!cookieState,
    stateMatch: cookieState === state
  })

  if (!cookieState || cookieState !== state) {
    logger.warn('Discord OAuth state mismatch', {
      correlationId,
      receivedState: typeof state === 'string' ? state.substring(0, 8) + '...' : 'invalid',
      cookieState: cookieState ? cookieState.substring(0, 8) + '...' : 'missing'
    })
    throw httpError.unauthorized('Invalid OAuth state', 'State mismatch - please try logging in again')
  }

  // Clear oauth_state cookie (keep sid cookie)
  clearOAuthStateCookie(res, req)
  debugOAuth('Cleared oauth_state cookie', { correlationId })

  // Environment validation
  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    logger.error('Discord credentials not configured', { correlationId })
    throw httpError.internal('Discord authentication not configured')
  }

  // Compute redirect_uri using url-helpers (same as start handler)
  const redirectUri = computeRedirectUri(req, '/api/auth/discord/callback')

  debugOAuth('Computed redirect URI for token exchange', {
    correlationId,
    redirectUri
  })

  try {
    // Exchange code for access token
    logger.debug('Exchanging code for token', { correlationId })

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri
      })
    })

    // Parse token response defensively
    const rawTokenPayload: unknown = await tokenResponse.json().catch(() => null)

    if (!tokenResponse.ok) {
      // Try to read Discord OAuth error shape
      const err = (rawTokenPayload ?? {}) as Partial<DiscordTokenError>

      debugOAuth('Discord token exchange failed', {
        correlationId,
        status: tokenResponse.status,
        error: err?.error,
        error_description: err?.error_description
      })

      logger.error('Discord token exchange failed', {
        correlationId,
        status: tokenResponse.status,
        error: err?.error
      })

      if (err?.error === 'invalid_grant') {
        throw httpError.badRequest(
          'Invalid or expired authorization code or redirect_uri mismatch',
          'Please try logging in again.'
        )
      }
      if (err?.error === 'invalid_client') {
        throw httpError.internal('Discord authentication misconfigured')
      }
      if (tokenResponse.status >= 500) {
        throw httpError.networkError('Discord service unavailable', {
          network: { url: 'https://discord.com/api/oauth2/token', method: 'POST' }
        })
      }

      throw httpError.badRequest(
        'Failed to authenticate with Discord',
        'Please try again or contact support.'
      )
    }

    // Validate token response shape
    if (!isDiscordTokenResponse(rawTokenPayload)) {
      debugOAuth('Discord token payload missing required fields', {
        correlationId,
        receivedKeys: rawTokenPayload && typeof rawTokenPayload === 'object'
          ? Object.keys(rawTokenPayload as any)
          : 'non-object'
      })
      throw httpError.badRequest(
        'Failed to authenticate with Discord',
        'Unexpected token response.'
      )
    }

    const tokenData = rawTokenPayload // Now typed as DiscordTokenResponse

    // Fetch Discord user profile
    logger.debug('Fetching Discord user profile', { correlationId })

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    })

    // Parse user response defensively
    const rawUserPayload: unknown = await userResponse.json().catch(() => null)

    if (!userResponse.ok) {
      const sample = rawUserPayload == null
        ? 'null'
        : typeof rawUserPayload === 'string'
          ? rawUserPayload.slice(0, 200)
          : JSON.stringify(rawUserPayload).slice(0, 200)

      debugOAuth('Discord user fetch failed', {
        correlationId,
        status: userResponse.status,
        sample
      })

      logger.error('Discord user fetch failed', {
        correlationId,
        status: userResponse.status
      })

      throw httpError.badRequest(
        'Failed to retrieve Discord profile',
        'Please try logging in again.'
      )
    }

    // Validate user response shape
    if (!isDiscordUser(rawUserPayload)) {
      debugOAuth('Discord user payload missing required fields', {
        correlationId,
        receivedKeys: rawUserPayload && typeof rawUserPayload === 'object'
          ? Object.keys(rawUserPayload as any)
          : 'non-object'
      })
      throw httpError.badRequest(
        'Failed to retrieve Discord profile',
        'Unexpected user response.'
      )
    }

    const discordUser = rawUserPayload // Now typed as DiscordUser
    const { id: discordUserId, username, global_name, avatar } = discordUser

    logger.info('Discord user authenticated', {
      correlationId,
      discordUserId,
      username,
      hasAvatar: !!avatar
    })

    // Get current session ID from header or cookie (MUST NOT create new session)
    const sessionId = getSessionId(req)

    if (!sessionId) {
      debugOAuth('Discord callback missing session ID', {
        correlationId,
        discordUserId
      })

      logger.warn('Discord callback missing session ID', {
        correlationId,
        discordUserId
      })

      // Return 401 per CTO review
      throw httpError.unauthorized(
        'Missing session',
        'Please refresh the page and try logging in again.'
      )
    }

    debugOAuth('Discord callback session check', {
      correlationId,
      sidSuffix: sessionId.slice(-6),
      discordUserId
    })

    logger.debug('Discord callback session check', {
      correlationId,
      sidSuffix: sessionId.slice(-6),
      discordUserId
    })

    const { data: presence, error: presenceError } = await supabaseAdmin
      .from('presence')
      .select('user_id, users!inner(id, display_name, ephemeral, kind)')
      .eq('session_id', sessionId)
      .single()

    if (presenceError || !presence) {
      logger.warn('Session not found for Discord callback', { correlationId, sessionId })
      throw httpError.badRequest('Session not found', 'Please refresh the page and try again')
    }

    const currentUser = presence.users as any

    logger.debug('Current session user', {
      correlationId,
      userId: currentUser.id,
      displayName: currentUser.display_name,
      ephemeral: currentUser.ephemeral
    })

    // Check if Discord account already linked to another user
    const { data: existingAccount, error: accountError } = await supabaseAdmin
      .from('user_accounts')
      .select('user_id, users!inner(id, display_name, kind)')
      .eq('provider', 'discord')
      .eq('provider_user_id', discordUserId)
      .single()

    if (accountError && accountError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is fine
      logger.error('Error checking existing Discord account', { correlationId }, accountError)
      throw httpError.dbError('Database error while linking Discord account')
    }

    if (existingAccount) {
      // Discord already linked to another user → merge current guest into existing user
      const targetUserId = existingAccount.user_id
      const targetUser = existingAccount.users as any

      logger.info('Discord account already exists, calling merge function', {
        correlationId,
        guestUserId: currentUser.id,
        targetUserId,
        targetDisplayName: targetUser.display_name
      })

      // Call atomic merge function with transaction + FOR UPDATE locks
      const { error: mergeError } = await supabaseAdmin.rpc('merge_users_on_discord_link', {
        p_guest_user_id: currentUser.id,
        p_target_user_id: targetUserId
      })

      if (mergeError) {
        logger.error('User merge function failed', { correlationId }, mergeError)
        throw httpError.dbError('Failed to merge user accounts', {
          db: { type: 'QUERY', operation: 'merge_users_on_discord_link' }
        })
      }

      logger.info('Discord merge completed successfully', {
        correlationId,
        guestUserId: currentUser.id,
        targetUserId,
        durationMs: Date.now() - startTime
      })

    } else {
      // New Discord link → attach to current user
      logger.info('Linking Discord account to current user', {
        correlationId,
        userId: currentUser.id,
        discordUserId
      })

      // Determine avatar extension (.gif for animated, .png for static)
      const avatarExt = avatar?.startsWith('a_') ? 'gif' : 'png'
      const avatarUrl = avatar
        ? `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.${avatarExt}?size=128`
        : null

      // Insert user account link
      const { error: insertError } = await supabaseAdmin
        .from('user_accounts')
        .insert({
          user_id: currentUser.id,
          provider: 'discord',
          provider_user_id: discordUserId,
          meta: {
            id: discordUserId, // Store ID in meta for avatar URL construction
            username,
            global_name,
            avatar_hash: avatar,
            avatar_url: avatarUrl // Precomputed for convenience
          }
        })

      if (insertError) {
        logger.error('Failed to link Discord account', { correlationId }, insertError)
        throw httpError.dbError('Failed to link Discord account')
      }

      // Update user display name with Discord username (with suffix resolution)
      const baseDisplayName = global_name || username
      const resolvedDisplayName = await resolveDisplayNameWithSuffix(baseDisplayName, currentUser.id)

      // Store original ephemeral name if not already stored
      const ephemeralDisplayName = currentUser.ephemeral_display_name || currentUser.display_name

      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({
          display_name: resolvedDisplayName,
          ephemeral_display_name: ephemeralDisplayName
        })
        .eq('id', currentUser.id)

      if (updateError) {
        logger.warn('Failed to update display name (non-fatal)', { correlationId }, updateError)
        // Continue - not critical
      }

      // Also update presence display name for immediate UI update
      await supabaseAdmin
        .from('presence')
        .update({ display_name: resolvedDisplayName })
        .eq('session_id', sessionId)

      // Structured logging for link success
      logger.info('Discord linked successfully', {
        event: 'oauth_link_success',
        userId: currentUser.id,
        discordUserId,
        correlationId,
        durationMs: Date.now() - startTime
      })
    }

    // Redirect back to frontend with success indicator
    const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
    const redirectTo = `${siteUrl.replace(/\/+$/, '')}/?discord_linked=1`

    logger.info('OAuth callback success', {
      correlationId,
      userId: currentUser.id,
      discordUserId,
      durationMs: Date.now() - startTime,
      event: 'oauth_callback_success'
    })

    console.log('[discord/callback] redirecting to', redirectTo)
    safeRedirect(res, redirectTo)
    return

  } catch (error) {
    // If error is already an HTTP error, let it bubble up
    if ((error as any).statusCode) {
      throw error
    }

    // Otherwise log and wrap as internal error
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Discord callback unhandled error', { correlationId }, err)
    throw httpError.internal('Failed to complete Discord authentication')
  }
}

export default secureHandler(discordCallbackHandler, securityConfigs.public)
