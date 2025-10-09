// src/shared/binding-message.ts
// Shared wallet binding message builder and parser (v1)
// Used by both client and server to ensure format consistency
//
// Message Format (3 logical lines, LF on build, tolerant in parse):
// Line 1: "Agent DJ Radio Wallet Binding v1"
// Line 2: "challengeId=<uuid>; ts=<unix>; ttl=<seconds>"
// Line 3: "nonce=<32-hex>"

/**
 * Generate a random 32-byte nonce as 64 hex characters
 */
function generateNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // Browser or Node 19+
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  } else {
    // Fallback: use crypto.randomUUID twice and hash (not cryptographically secure, but acceptable for nonce)
    const uuid1 = crypto.randomUUID().replace(/-/g, '')
    const uuid2 = crypto.randomUUID().replace(/-/g, '')
    return (uuid1 + uuid2).slice(0, 64)
  }
}

/**
 * Build a binding message v1 (always uses LF, no trailing newline)
 */
export function buildBindingMessageV1(params: {
  challengeId: string
  ts: number
  ttl: number
  nonce?: string
}): string {
  const { challengeId, ts, ttl, nonce = generateNonce() } = params

  // Validate inputs
  if (!challengeId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId)) {
    throw new Error('Invalid challengeId: must be a valid UUID')
  }
  if (!Number.isInteger(ts) || ts <= 0) {
    throw new Error('Invalid ts: must be a positive integer (Unix timestamp)')
  }
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error('Invalid ttl: must be a positive integer (seconds)')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new Error('Invalid nonce: must be 64 hex characters (32 bytes)')
  }

  // Build message with LF only
  const line1 = 'Agent DJ Radio Wallet Binding v1'
  const line2 = `challengeId=${challengeId}; ts=${ts}; ttl=${ttl}`
  const line3 = `nonce=${nonce}`

  return `${line1}\n${line2}\n${line3}`
}

/**
 * Parse a binding message v1 (tolerant to CRLF, trailing newlines, extra spaces)
 */
export function parseBindingMessageV1(message: string): {
  challengeId: string
  ts: number
  ttl: number
  nonce: string
  lineEnding: 'LF' | 'CRLF' | 'MIXED'
  lineCount: number
  hasTrailingNewline: boolean
} {
  if (!message || typeof message !== 'string') {
    throw new Error('Message must be a non-empty string')
  }

  // Detect line ending
  const hasCRLF = message.includes('\r\n')
  const hasLF = message.includes('\n')
  let lineEnding: 'LF' | 'CRLF' | 'MIXED'

  if (hasCRLF && hasLF) {
    // Check if all newlines are CRLF or mixed
    const normalized = message.replace(/\r\n/g, '\n')
    const crlfCount = (message.match(/\r\n/g) || []).length
    const lfCount = (normalized.match(/\n/g) || []).length
    lineEnding = crlfCount === lfCount ? 'CRLF' : 'MIXED'
  } else if (hasCRLF) {
    lineEnding = 'CRLF'
  } else {
    lineEnding = 'LF'
  }

  // Check for trailing newline
  const hasTrailingNewline = message.endsWith('\n') || message.endsWith('\r\n')

  // Normalize: convert CRLF to LF, split, trim each line, filter blank lines
  const normalized = message.replace(/\r\n/g, '\n')
  const allLines = normalized.split('\n').map(line => line.trim())
  const lines = allLines.filter(line => line.length > 0)

  if (lines.length !== 3) {
    throw new Error(
      `Invalid message format: expected 3 lines, got ${lines.length} (after removing blank lines)`
    )
  }

  // Parse line 1: header
  if (lines[0] !== 'Agent DJ Radio Wallet Binding v1') {
    throw new Error(
      `Invalid message format: line 1 must be "Agent DJ Radio Wallet Binding v1", got "${lines[0]}"`
    )
  }

  // Parse line 2: key=value pairs separated by semicolons
  const line2 = lines[1]
  const pairs = line2.split(';').map(pair => pair.trim())

  let challengeId: string | undefined
  let ts: number | undefined
  let ttl: number | undefined

  for (const pair of pairs) {
    const [key, value] = pair.split('=').map(s => s.trim())
    if (!key || !value) {
      throw new Error(`Invalid message format: line 2 contains invalid pair "${pair}"`)
    }

    if (key === 'challengeId') {
      challengeId = value
    } else if (key === 'ts') {
      ts = parseInt(value, 10)
      if (isNaN(ts)) {
        throw new Error(`Invalid message format: ts must be an integer, got "${value}"`)
      }
    } else if (key === 'ttl') {
      ttl = parseInt(value, 10)
      if (isNaN(ttl)) {
        throw new Error(`Invalid message format: ttl must be an integer, got "${value}"`)
      }
    }
    // Ignore unknown keys for forward compatibility
  }

  if (!challengeId || ts === undefined || ttl === undefined) {
    throw new Error(
      'Invalid message format: line 2 must contain challengeId, ts, and ttl'
    )
  }

  // Validate challengeId format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId)) {
    throw new Error(`Invalid challengeId format: must be a UUID, got "${challengeId}"`)
  }

  // Validate ts and ttl are positive
  if (ts <= 0) {
    throw new Error(`Invalid ts: must be positive, got ${ts}`)
  }
  if (ttl <= 0) {
    throw new Error(`Invalid ttl: must be positive, got ${ttl}`)
  }

  // Parse line 3: nonce
  const line3 = lines[2]
  const nonceMatch = line3.match(/^nonce\s*=\s*([0-9a-fA-F]{64})$/)
  if (!nonceMatch) {
    throw new Error(
      `Invalid message format: line 3 must be "nonce=<64-hex>", got "${line3}"`
    )
  }
  const nonce = nonceMatch[1]

  return {
    challengeId,
    ts,
    ttl,
    nonce,
    lineEnding,
    lineCount: lines.length,
    hasTrailingNewline
  }
}

/**
 * Validate a binding message with clock skew and expiry checks
 *
 * @param message - The message to validate
 * @param expectedChallengeId - The challenge ID this message should be for
 * @param clockSkewSeconds - Maximum allowed clock skew (default 120s = ±2min)
 * @returns Parsed message data if valid, throws otherwise
 */
export function validateBindingMessageV1(
  message: string,
  expectedChallengeId: string,
  clockSkewSeconds: number = 120
): ReturnType<typeof parseBindingMessageV1> {
  // Parse message
  const parsed = parseBindingMessageV1(message)

  // Check challengeId matches
  if (parsed.challengeId !== expectedChallengeId) {
    throw new Error(
      `Challenge ID mismatch: expected ${expectedChallengeId}, got ${parsed.challengeId}`
    )
  }

  // Check clock skew (ts should be within ±clockSkewSeconds of now)
  const nowUnix = Math.floor(Date.now() / 1000)
  const skew = Math.abs(nowUnix - parsed.ts)

  if (skew > clockSkewSeconds) {
    throw new Error(
      `Clock skew too large: message ts=${parsed.ts}, now=${nowUnix}, diff=${skew}s (max ${clockSkewSeconds}s)`
    )
  }

  // Check message not expired (ts + ttl must be in the future)
  const expiresAt = parsed.ts + parsed.ttl
  if (nowUnix >= expiresAt) {
    const age = nowUnix - parsed.ts
    throw new Error(
      `Message expired: issued ${age}s ago with ttl=${parsed.ttl}s (expired ${nowUnix - expiresAt}s ago)`
    )
  }

  return parsed
}

/**
 * Mask sensitive values for logging
 */
export function maskForLogging(parsed: ReturnType<typeof parseBindingMessageV1>): {
  challengeIdMasked: string
  ts: number
  ttl: number
  nonceMasked: string
  lineEnding: string
  lineCount: number
  hasTrailingNewline: boolean
} {
  return {
    challengeIdMasked:
      parsed.challengeId.slice(0, 8) + '...' + parsed.challengeId.slice(-4),
    ts: parsed.ts,
    ttl: parsed.ttl,
    nonceMasked: parsed.nonce.slice(0, 6) + '...' + parsed.nonce.slice(-4),
    lineEnding: parsed.lineEnding,
    lineCount: parsed.lineCount,
    hasTrailingNewline: parsed.hasTrailingNewline
  }
}
