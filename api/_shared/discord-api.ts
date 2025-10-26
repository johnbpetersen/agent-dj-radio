// Discord OAuth API client
// Handles token exchange and user fetching with proper error handling

import { httpError, AppError } from './errors.js'
import { logger } from '../../src/lib/logger.js'

/**
 * Discord OAuth token response
 * https://discord.com/developers/docs/topics/oauth2#authorization-code-grant-access-token-response
 */
export interface DiscordTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  scope: string
}

/**
 * Discord user object
 * https://discord.com/developers/docs/resources/user#user-object
 */
export interface DiscordUser {
  id: string // Snowflake ID
  username: string
  discriminator: string // "0" for new username system
  global_name?: string | null // Display name
  avatar: string | null
  email?: string
  verified?: boolean
}

/**
 * Exchange authorization code for access token using PKCE
 * https://discord.com/developers/docs/topics/oauth2#authorization-code-grant-access-token-exchange-example
 */
export async function exchangeCodeForToken(params: {
  code: string
  codeVerifier: string
  clientId: string
  clientSecret?: string
  redirectUri: string
  apiBase: string
  correlationId: string
}): Promise<DiscordTokenResponse> {
  const { code, codeVerifier, clientId, clientSecret, redirectUri, apiBase, correlationId } = params

  // Build token endpoint URL (handle trailing slashes)
  const baseUrl = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase
  const tokenUrl = `${baseUrl}/oauth2/token`

  // Build form body
  const formData = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId
  })

  // Add client_secret only if provided (PKCE works with or without it)
  if (clientSecret) {
    formData.set('client_secret', clientSecret)
  }

  logger.info('Exchanging authorization code for token', {
    correlationId,
    tokenUrl,
    hasClientSecret: !!clientSecret,
    codeLength: code.length,
    verifierLength: codeVerifier.length
  })

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: formData.toString()
    })

    const responseText = await response.text()
    let data: any

    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      logger.error('Failed to parse Discord token response', {
        correlationId,
        status: response.status,
        responsePreview: responseText.slice(0, 200)
      })
      throw new AppError('UPSTREAM_5XX', 'Discord returned invalid JSON', {
        meta: {
          upstream: {
            status: response.status,
            url: tokenUrl,
            method: 'POST',
            responsePreview: responseText.slice(0, 100)
          }
        }
      })
    }

    if (!response.ok) {
      // Discord error response
      logger.warn('Discord token exchange failed', {
        correlationId,
        status: response.status,
        error: data.error,
        errorDescription: data.error_description
      })

      if (response.status >= 400 && response.status < 500) {
        throw new AppError(
          'UPSTREAM_4XX',
          `Discord OAuth failed: ${data.error_description || data.error || 'Unknown error'}`,
          {
            meta: {
              upstream: {
                status: response.status,
                url: tokenUrl,
                method: 'POST',
                responseKeys: Object.keys(data)
              }
            }
          }
        )
      } else {
        throw new AppError(
          'UPSTREAM_5XX',
          'Discord OAuth service unavailable',
          {
            meta: {
              upstream: {
                status: response.status,
                url: tokenUrl,
                method: 'POST'
              }
            }
          }
        )
      }
    }

    // Validate required fields
    if (!data.access_token || !data.token_type) {
      logger.error('Discord token response missing required fields', {
        correlationId,
        hasAccessToken: !!data.access_token,
        hasTokenType: !!data.token_type,
        responseKeys: Object.keys(data)
      })
      throw new AppError('UPSTREAM_5XX', 'Discord returned incomplete token response', {
        meta: {
          upstream: {
            status: response.status,
            url: tokenUrl,
            method: 'POST',
            responseKeys: Object.keys(data)
          }
        }
      })
    }

    logger.info('Token exchange successful', {
      correlationId,
      tokenType: data.token_type,
      expiresIn: data.expiresIn,
      scope: data.scope,
      hasRefreshToken: !!data.refresh_token
    })

    return data as DiscordTokenResponse

  } catch (error) {
    // Re-throw httpError as-is
    if (error && typeof error === 'object' && 'httpStatus' in error) {
      throw error
    }

    // Network error (fetch failed)
    logger.error('Network error during token exchange', {
      correlationId,
      tokenUrl
    }, error as Error)

    throw httpError.networkError('Failed to connect to Discord', {
      network: {
        url: tokenUrl,
        method: 'POST'
      }
    })
  }
}

/**
 * Fetch Discord user info using access token
 * https://discord.com/developers/docs/resources/user#get-current-user
 */
export async function fetchDiscordUser(params: {
  accessToken: string
  apiBase: string
  correlationId: string
}): Promise<DiscordUser> {
  const { accessToken, apiBase, correlationId } = params

  // Build user endpoint URL (handle trailing slashes)
  const baseUrl = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase
  const userUrl = `${baseUrl}/users/@me`

  logger.info('Fetching Discord user info', {
    correlationId,
    userUrl,
    tokenLength: accessToken.length
  })

  try {
    const response = await fetch(userUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })

    const responseText = await response.text()
    let data: any

    try {
      data = JSON.parse(responseText)
    } catch (parseError) {
      logger.error('Failed to parse Discord user response', {
        correlationId,
        status: response.status,
        responsePreview: responseText.slice(0, 200)
      })
      throw new AppError('UPSTREAM_5XX', 'Discord returned invalid JSON', {
        meta: {
          upstream: {
            status: response.status,
            url: userUrl,
            method: 'GET',
            responsePreview: responseText.slice(0, 100)
          }
        }
      })
    }

    if (!response.ok) {
      logger.warn('Discord user fetch failed', {
        correlationId,
        status: response.status,
        error: data.message || data.error
      })

      if (response.status >= 400 && response.status < 500) {
        throw new AppError(
          'UPSTREAM_4XX',
          `Failed to fetch Discord user: ${data.message || 'Unknown error'}`,
          {
            meta: {
              upstream: {
                status: response.status,
                url: userUrl,
                method: 'GET',
                responseKeys: Object.keys(data)
              }
            }
          }
        )
      } else {
        throw new AppError(
          'UPSTREAM_5XX',
          'Discord API unavailable',
          {
            meta: {
              upstream: {
                status: response.status,
                url: userUrl,
                method: 'GET'
              }
            }
          }
        )
      }
    }

    // Validate required fields
    if (!data.id || !data.username) {
      logger.error('Discord user response missing required fields', {
        correlationId,
        hasId: !!data.id,
        hasUsername: !!data.username,
        responseKeys: Object.keys(data)
      })
      throw new AppError('UPSTREAM_5XX', 'Discord returned incomplete user data', {
        meta: {
          upstream: {
            status: response.status,
            url: userUrl,
            method: 'GET',
            responseKeys: Object.keys(data)
          }
        }
      })
    }

    logger.info('Discord user fetched successfully', {
      correlationId,
      discordId: data.id.slice(0, 8) + '...',
      username: data.username,
      hasGlobalName: !!data.global_name
    })

    return data as DiscordUser

  } catch (error) {
    // Re-throw httpError as-is
    if (error && typeof error === 'object' && 'httpStatus' in error) {
      throw error
    }

    // Network error (fetch failed)
    logger.error('Network error fetching Discord user', {
      correlationId,
      userUrl
    }, error as Error)

    throw httpError.networkError('Failed to connect to Discord', {
      network: {
        url: userUrl,
        method: 'GET'
      }
    })
  }
}
