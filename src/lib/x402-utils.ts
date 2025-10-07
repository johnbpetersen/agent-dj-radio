// src/lib/x402-utils.ts
// Client-side utilities for parsing and handling x402 payment challenges

export interface ParsedXPayment {
  payTo: string
  amount: string // Atomic units as string
  asset: string
  chain: string
  expiresAt: string // ISO 8601
  challengeId: string
  nonce: string
}

/**
 * Parse X-PAYMENT header value (semicolon-delimited, order-agnostic)
 *
 * Format: payTo=0x...; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=uuid; nonce=abc123
 *
 * @param header - X-PAYMENT header value
 * @returns Parsed payment data or null if invalid
 */
export function parseXPaymentHeader(header: string): ParsedXPayment | null {
  if (!header || typeof header !== 'string') {
    return null
  }

  try {
    const parts = header.split(';').map(p => p.trim())
    const parsed: Record<string, string> = {}

    for (const part of parts) {
      const [key, ...valueParts] = part.split('=')
      const value = valueParts.join('=').trim() // Handle values with = in them
      if (key && value) {
        parsed[key.trim()] = value
      }
    }

    // Validate required fields
    const required = ['payTo', 'amount', 'asset', 'chain', 'expiresAt', 'challengeId', 'nonce']
    for (const field of required) {
      if (!parsed[field]) {
        console.warn(`Missing required field in X-PAYMENT: ${field}`)
        return null
      }
    }

    // Validate payTo format (0x + 40 hex chars)
    if (!parsed.payTo.match(/^0x[0-9a-fA-F]{40}$/)) {
      console.warn('Invalid payTo address format')
      return null
    }

    // Validate amount is numeric
    if (!parsed.amount.match(/^\d+$/)) {
      console.warn('Invalid amount format (must be integer)')
      return null
    }

    // Validate challengeId is UUID
    if (!parsed.challengeId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      console.warn('Invalid challengeId format (must be UUID)')
      return null
    }

    // Validate expiresAt is valid ISO date
    const expiryDate = new Date(parsed.expiresAt)
    if (isNaN(expiryDate.getTime())) {
      console.warn('Invalid expiresAt date format')
      return null
    }

    return {
      payTo: parsed.payTo,
      amount: parsed.amount,
      asset: parsed.asset,
      chain: parsed.chain,
      expiresAt: parsed.expiresAt,
      challengeId: parsed.challengeId,
      nonce: parsed.nonce
    }
  } catch (error) {
    console.error('Failed to parse X-PAYMENT header:', error)
    return null
  }
}

/**
 * Format atomic USDC amount to display string
 *
 * @param atomicAmount - Amount in atomic units (6 decimals for USDC)
 * @param decimals - Number of decimal places (default 6 for USDC)
 * @returns Formatted string like "0.15 USDC"
 */
export function formatUSDCAmount(atomicAmount: string | number, decimals = 6): string {
  const amount = typeof atomicAmount === 'string' ? BigInt(atomicAmount) : BigInt(Math.floor(atomicAmount))
  const divisor = BigInt(10 ** decimals)

  const whole = amount / divisor
  const fraction = amount % divisor

  // Format fraction with leading zeros
  const fractionStr = fraction.toString().padStart(decimals, '0')

  // Remove trailing zeros from fraction
  const trimmedFraction = fractionStr.replace(/0+$/, '')

  if (trimmedFraction === '') {
    return `${whole} USDC`
  }

  return `${whole}.${trimmedFraction} USDC`
}

/**
 * Get remaining seconds until expiry
 *
 * @param expiresAt - ISO 8601 expiry timestamp
 * @returns Seconds remaining (negative if expired)
 */
export function getExpiryCountdown(expiresAt: string): number {
  const now = Date.now()
  const expiry = new Date(expiresAt).getTime()
  return Math.floor((expiry - now) / 1000)
}

/**
 * Format countdown seconds to human-readable string
 *
 * @param seconds - Seconds remaining
 * @returns Formatted string like "9m 45s" or "EXPIRED"
 */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) {
    return 'EXPIRED'
  }

  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60

  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }

  return `${secs}s`
}

/**
 * Validate transaction hash format (client-side)
 *
 * @param hash - Transaction hash to validate
 * @returns true if valid format
 */
export function validateTxHash(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash)
}

/**
 * Get user-friendly chain name
 *
 * @param chain - Chain identifier (e.g., "base-sepolia")
 * @returns Display name (e.g., "Base Sepolia")
 */
export function getChainDisplayName(chain: string): string {
  const chainNames: Record<string, string> = {
    'base-sepolia': 'Base Sepolia',
    'base': 'Base',
    'base-mainnet': 'Base Mainnet',
    'ethereum': 'Ethereum',
    'sepolia': 'Sepolia'
  }

  return chainNames[chain] || chain
}

/**
 * Get block explorer URL for transaction
 *
 * @param chain - Chain identifier
 * @param txHash - Transaction hash
 * @returns Block explorer URL or null if unknown chain
 */
export function getBlockExplorerUrl(chain: string, txHash: string): string | null {
  const explorers: Record<string, string> = {
    'base-sepolia': 'https://sepolia.basescan.org/tx',
    'base': 'https://basescan.org/tx',
    'base-mainnet': 'https://basescan.org/tx',
    'ethereum': 'https://etherscan.io/tx',
    'sepolia': 'https://sepolia.etherscan.io/tx'
  }

  const baseUrl = explorers[chain]
  return baseUrl ? `${baseUrl}/${txHash}` : null
}
