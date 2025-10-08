// src/lib/binding-utils.ts
// Wallet binding utilities for RPC-only mode
// Handles message formatting, validation, and address normalization

/**
 * Build a wallet binding message for signing
 * Format: "I am paying challenge {challengeId}\nissuedAt={iso}\nnonce={nonce}"
 *
 * @param challengeId - UUID of the payment challenge
 * @returns Object with message string and metadata
 */
export function buildBindingMessage(challengeId: string): {
  message: string
  issuedAt: string
  nonce: string
} {
  const issuedAt = new Date().toISOString()
  const nonce = crypto.randomUUID()

  const message = `I am paying challenge ${challengeId}\nissuedAt=${issuedAt}\nnonce=${nonce}`

  return {
    message,
    issuedAt,
    nonce
  }
}

/**
 * Parse and validate a binding message
 * Ensures correct format and checks TTL
 *
 * @param message - The signed message
 * @param expectedChallengeId - Challenge ID to validate against
 * @param ttlSeconds - Time-to-live in seconds (default 300 = 5min)
 * @returns Parsed message data or throws error
 */
export function validateBindingMessage(
  message: string,
  expectedChallengeId: string,
  ttlSeconds: number = 300
): {
  challengeId: string
  issuedAt: Date
  nonce: string
} {
  // Parse message format
  const lines = message.split('\n')
  if (lines.length !== 3) {
    throw new Error('Invalid message format: expected 3 lines')
  }

  // Parse challenge line
  const challengeMatch = lines[0].match(/^I am paying challenge (.+)$/)
  if (!challengeMatch) {
    throw new Error('Invalid message format: missing challenge prefix')
  }
  const challengeId = challengeMatch[1]

  // Parse issuedAt line
  const issuedAtMatch = lines[1].match(/^issuedAt=(.+)$/)
  if (!issuedAtMatch) {
    throw new Error('Invalid message format: missing issuedAt')
  }
  const issuedAtStr = issuedAtMatch[1]
  const issuedAt = new Date(issuedAtStr)

  if (isNaN(issuedAt.getTime())) {
    throw new Error('Invalid issuedAt timestamp')
  }

  // Parse nonce line
  const nonceMatch = lines[2].match(/^nonce=(.+)$/)
  if (!nonceMatch) {
    throw new Error('Invalid message format: missing nonce')
  }
  const nonce = nonceMatch[1]

  // Validate challengeId matches
  if (challengeId !== expectedChallengeId) {
    throw new Error(`Challenge ID mismatch: expected ${expectedChallengeId}, got ${challengeId}`)
  }

  // Validate TTL (check timestamp is within ±ttlSeconds)
  const now = Date.now()
  const issuedAtTime = issuedAt.getTime()
  const diffSeconds = Math.abs(now - issuedAtTime) / 1000

  if (diffSeconds > ttlSeconds) {
    throw new Error(`Message expired: issued ${diffSeconds.toFixed(0)}s ago, max ${ttlSeconds}s`)
  }

  return {
    challengeId,
    issuedAt,
    nonce
  }
}

/**
 * Normalize EVM address to lowercase
 * Ensures consistent comparison and storage
 *
 * @param address - EVM address (0x-prefixed hex)
 * @returns Lowercase address
 */
export function normalizeEvmAddress(address: string): string {
  if (!address) {
    throw new Error('Address is required')
  }

  const trimmed = address.trim().toLowerCase()

  if (!trimmed.startsWith('0x')) {
    throw new Error('Address must start with 0x')
  }

  if (trimmed.length !== 42) {
    throw new Error('Address must be 42 characters (0x + 40 hex digits)')
  }

  if (!/^0x[0-9a-f]{40}$/.test(trimmed)) {
    throw new Error('Address must contain only hex digits')
  }

  return trimmed
}

/**
 * Compare two EVM addresses (case-insensitive)
 *
 * @param addr1 - First address
 * @param addr2 - Second address
 * @returns True if addresses match (case-insensitive)
 */
export function addressesMatch(addr1: string | null, addr2: string | null): boolean {
  if (!addr1 || !addr2) return false

  try {
    return normalizeEvmAddress(addr1) === normalizeEvmAddress(addr2)
  } catch {
    return false
  }
}

/**
 * Format address for display (show first 6 + last 4 chars)
 *
 * @param address - Full EVM address
 * @returns Formatted address (e.g., "0x1234...5678")
 */
export function formatAddressShort(address: string): string {
  if (!address || address.length < 10) return address

  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
