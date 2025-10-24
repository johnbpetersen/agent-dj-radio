// Discord OAuth PKCE utilities
// Implements RFC 7636 (PKCE) with S256 challenge method

import { createHash, randomBytes } from 'crypto'

/**
 * Generate cryptographically secure random bytes and encode as base64url
 * Base64url: no padding, URL-safe characters (- and _ instead of + and /)
 */
export function generateRandomBytes(length: number): string {
  const buffer = randomBytes(length)
  return base64urlEncode(buffer)
}

/**
 * Generate OAuth state parameter (32 bytes → base64url)
 * Used to prevent CSRF attacks
 */
export function generateState(): string {
  return generateRandomBytes(32)
}

/**
 * Generate PKCE code verifier (32 bytes → base64url)
 * Stored securely, never sent to client
 */
export function generateCodeVerifier(): string {
  return generateRandomBytes(32)
}

/**
 * Compute PKCE code challenge using S256 method
 * code_challenge = base64url(sha256(code_verifier))
 */
export function computeCodeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest()
  return base64urlEncode(hash)
}

/**
 * Encode buffer to base64url (RFC 4648 §5)
 * - Use URL-safe characters: - instead of +, _ instead of /
 * - Remove padding (=)
 */
function base64urlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/**
 * Build Discord OAuth authorize URL with PKCE
 */
export function buildDiscordAuthorizeUrl(params: {
  apiBase: string
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scope?: string
}): string {
  const {
    apiBase,
    clientId,
    redirectUri,
    state,
    codeChallenge,
    scope = 'identify'
  } = params

  const url = new URL(`${apiBase}/oauth2/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('code_challenge', codeChallenge)

  return url.toString()
}
