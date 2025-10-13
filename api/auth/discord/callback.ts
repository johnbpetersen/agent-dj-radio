// GET /api/auth/discord/callback?code=...&state=...
// Handles Discord OAuth callback
// 1. Verify CSRF state
// 2. Exchange code for access token
// 3. Fetch Discord user profile
// 4. Link or merge with current session user
// 5. Redirect back to frontend

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../../_shared/supabase.js'
import { requireSessionId } from '../../_shared/session.js'
import { secureHandler, securityConfigs } from '../../_shared/secure-handler.js'
import { logger, generateCorrelationId } from '../../../src/lib/logger.js'
import { httpError } from '../../_shared/errors.js'
import { safeRedirect } from '../../_shared/http.js'

interface DiscordTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

interface DiscordUser {
  id: string
  username: string
  discriminator: string
  global_name: string | null
  avatar: string | null
  bot?: boolean
  system?: boolean
  mfa_enabled?: boolean
  banner?: string | null
  accent_color?: number | null
  locale?: string
  verified?: boolean
  email?: string | null
  flags?: number
  premium_type?: number
  public_flags?: number
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

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

  // Verify CSRF state from cookie
  const cookieState = parseCookie(req.headers.cookie, 'discord_state')
  if (!cookieState || cookieState !== state) {
    logger.warn('Discord OAuth state mismatch', {
      correlationId,
      receivedState: typeof state === 'string' ? state.substring(0, 8) + '...' : 'invalid',
      cookieState: cookieState ? cookieState.substring(0, 8) + '...' : 'missing'
    })
    throw httpError.badRequest('Invalid state parameter (CSRF check failed)')
  }

  // Clear state cookie (but keep x_session_id cookie)
  res.setHeader('Set-Cookie', 'discord_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0')

  // Environment validation
  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  const redirectUri = process.env.DISCORD_REDIRECT_URI ||
                      `${process.env.VITE_SITE_URL || 'http://localhost:5173'}/api/auth/discord/callback`

  if (!clientId || !clientSecret) {
    logger.error('Discord credentials not configured', { correlationId })
    throw httpError.internal('Discord authentication not configured')
  }

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

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      logger.error('Discord token exchange failed', {
        correlationId,
        status: tokenResponse.status,
        error: errorText
      })
      throw httpError.external('Failed to authenticate with Discord', 'discord_token_exchange_failed')
    }

    const tokenData: DiscordTokenResponse = await tokenResponse.json()

    // Fetch Discord user profile
    logger.debug('Fetching Discord user profile', { correlationId })

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    })

    if (!userResponse.ok) {
      const errorText = await userResponse.text()
      logger.error('Discord user fetch failed', {
        correlationId,
        status: userResponse.status,
        error: errorText
      })
      throw httpError.external('Failed to fetch Discord profile', 'discord_user_fetch_failed')
    }

    const discordUser: DiscordUser = await userResponse.json()
    const { id: discordUserId, username, global_name, avatar } = discordUser

    logger.info('Discord user authenticated', {
      correlationId,
      discordUserId,
      username,
      hasAvatar: !!avatar
    })

    // Get current session user
    const sessionId = requireSessionId(req)

    // Debug: Log session ID source
    const fromHeader = req.headers['x-session-id']
    const fromCookie = parseCookie(req.headers.cookie, 'x_session_id')
    const sidSource = fromHeader ? 'header' : fromCookie ? 'cookie' : 'state'
    console.log('[discord/callback] sid source:', sidSource)

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
          db: { type: 'RPC', operation: 'merge_users_on_discord_link' }
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

      // Update user display name if they still have generated name (contains underscore)
      if (currentUser.display_name.includes('_')) {
        const newDisplayName = global_name || username

        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ display_name: newDisplayName })
          .eq('id', currentUser.id)

        if (updateError) {
          logger.warn('Failed to update display name (non-fatal)', { correlationId }, updateError)
          // Continue - not critical
        }

        // Also update presence display name for immediate UI update
        await supabaseAdmin
          .from('presence')
          .update({ display_name: newDisplayName })
          .eq('session_id', sessionId)
      }

      logger.info('Discord linked successfully', {
        correlationId,
        userId: currentUser.id,
        discordUserId,
        durationMs: Date.now() - startTime
      })
    }

    // Redirect back to frontend with success indicator
    const siteUrl = process.env.VITE_SITE_URL || 'http://localhost:5173'
    const redirectTo = `${siteUrl.replace(/\/+$/, '')}/?discord_linked=1`

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
