// tests/client/x402-parse.test.ts
// Unit tests for x402 header parsing and utility functions

import { describe, it, expect } from 'vitest'
import {
  parseXPaymentHeader,
  formatUSDCAmount,
  getExpiryCountdown,
  formatCountdown,
  validateTxHash,
  getChainDisplayName,
  getBlockExplorerUrl
} from '../../src/lib/x402-utils'

describe('parseXPaymentHeader', () => {
  const validHeader = 'payTo=0x1234567890123456789012345678901234567890; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123'

  it('should parse valid header', () => {
    const result = parseXPaymentHeader(validHeader)
    expect(result).toBeTruthy()
    expect(result?.payTo).toBe('0x1234567890123456789012345678901234567890')
    expect(result?.amount).toBe('150000')
    expect(result?.asset).toBe('USDC')
    expect(result?.chain).toBe('base-sepolia')
    expect(result?.expiresAt).toBe('2025-10-07T12:34:56Z')
    expect(result?.challengeId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(result?.nonce).toBe('abc123')
  })

  it('should handle different field order', () => {
    const reordered = 'chain=base-sepolia; amount=150000; payTo=0x1234567890123456789012345678901234567890; asset=USDC; nonce=abc123; challengeId=550e8400-e29b-41d4-a716-446655440000; expiresAt=2025-10-07T12:34:56Z'
    const result = parseXPaymentHeader(reordered)
    expect(result).toBeTruthy()
    expect(result?.payTo).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should handle extra whitespace', () => {
    const withSpaces = ' payTo=0x1234567890123456789012345678901234567890 ;  amount=150000  ; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123 '
    const result = parseXPaymentHeader(withSpaces)
    expect(result).toBeTruthy()
    expect(result?.payTo).toBe('0x1234567890123456789012345678901234567890')
  })

  it('should return null for missing required fields', () => {
    const missing = 'payTo=0x1234567890123456789012345678901234567890; amount=150000'
    expect(parseXPaymentHeader(missing)).toBeNull()
  })

  it('should return null for invalid payTo address', () => {
    const invalid = 'payTo=invalid; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123'
    expect(parseXPaymentHeader(invalid)).toBeNull()
  })

  it('should return null for invalid amount', () => {
    const invalid = 'payTo=0x1234567890123456789012345678901234567890; amount=abc; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123'
    expect(parseXPaymentHeader(invalid)).toBeNull()
  })

  it('should return null for invalid challengeId', () => {
    const invalid = 'payTo=0x1234567890123456789012345678901234567890; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=2025-10-07T12:34:56Z; challengeId=not-a-uuid; nonce=abc123'
    expect(parseXPaymentHeader(invalid)).toBeNull()
  })

  it('should return null for invalid expiresAt', () => {
    const invalid = 'payTo=0x1234567890123456789012345678901234567890; amount=150000; asset=USDC; chain=base-sepolia; expiresAt=not-a-date; challengeId=550e8400-e29b-41d4-a716-446655440000; nonce=abc123'
    expect(parseXPaymentHeader(invalid)).toBeNull()
  })

  it('should return null for empty string', () => {
    expect(parseXPaymentHeader('')).toBeNull()
  })

  it('should return null for null input', () => {
    expect(parseXPaymentHeader(null as any)).toBeNull()
  })
})

describe('formatUSDCAmount', () => {
  it('should format whole numbers', () => {
    expect(formatUSDCAmount('1000000')).toBe('1 USDC')
    expect(formatUSDCAmount('5000000')).toBe('5 USDC')
  })

  it('should format decimal amounts', () => {
    expect(formatUSDCAmount('150000')).toBe('0.15 USDC')
    expect(formatUSDCAmount('123456')).toBe('0.123456 USDC')
  })

  it('should remove trailing zeros', () => {
    expect(formatUSDCAmount('150000')).toBe('0.15 USDC')
    expect(formatUSDCAmount('100000')).toBe('0.1 USDC')
  })

  it('should handle small amounts', () => {
    expect(formatUSDCAmount('1')).toBe('0.000001 USDC')
    expect(formatUSDCAmount('10')).toBe('0.00001 USDC')
  })

  it('should handle large amounts', () => {
    expect(formatUSDCAmount('1000000000')).toBe('1000 USDC')
  })

  it('should handle numeric input', () => {
    expect(formatUSDCAmount(150000)).toBe('0.15 USDC')
  })
})

describe('getExpiryCountdown', () => {
  it('should return positive seconds for future time', () => {
    const future = new Date(Date.now() + 60000).toISOString() // 1 minute from now
    const countdown = getExpiryCountdown(future)
    expect(countdown).toBeGreaterThan(55)
    expect(countdown).toBeLessThanOrEqual(60)
  })

  it('should return negative seconds for past time', () => {
    const past = new Date(Date.now() - 60000).toISOString() // 1 minute ago
    const countdown = getExpiryCountdown(past)
    expect(countdown).toBeLessThan(0)
  })

  it('should return approximately 0 for current time', () => {
    const now = new Date().toISOString()
    const countdown = getExpiryCountdown(now)
    expect(countdown).toBeGreaterThanOrEqual(-1)
    expect(countdown).toBeLessThanOrEqual(1)
  })
})

describe('formatCountdown', () => {
  it('should format minutes and seconds', () => {
    expect(formatCountdown(125)).toBe('2m 5s')
    expect(formatCountdown(600)).toBe('10m 0s')
  })

  it('should format seconds only', () => {
    expect(formatCountdown(45)).toBe('45s')
    expect(formatCountdown(1)).toBe('1s')
  })

  it('should show EXPIRED for zero or negative', () => {
    expect(formatCountdown(0)).toBe('EXPIRED')
    expect(formatCountdown(-10)).toBe('EXPIRED')
  })
})

describe('validateTxHash', () => {
  it('should validate correct transaction hashes', () => {
    expect(validateTxHash('0x' + '1'.repeat(64))).toBe(true)
    expect(validateTxHash('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')).toBe(true)
  })

  it('should reject invalid formats', () => {
    expect(validateTxHash('1234')).toBe(false)
    expect(validateTxHash('0x123')).toBe(false)
    expect(validateTxHash('0x' + '1'.repeat(63))).toBe(false)
    expect(validateTxHash('0x' + '1'.repeat(65))).toBe(false)
    expect(validateTxHash('')).toBe(false)
  })

  it('should reject hashes without 0x prefix', () => {
    expect(validateTxHash('1'.repeat(64))).toBe(false)
  })

  it('should reject hashes with invalid characters', () => {
    expect(validateTxHash('0x' + 'g'.repeat(64))).toBe(false)
    expect(validateTxHash('0x' + ' '.repeat(64))).toBe(false)
  })
})

describe('getChainDisplayName', () => {
  it('should return display names for known chains', () => {
    expect(getChainDisplayName('base-sepolia')).toBe('Base Sepolia')
    expect(getChainDisplayName('base')).toBe('Base')
    expect(getChainDisplayName('ethereum')).toBe('Ethereum')
  })

  it('should return input for unknown chains', () => {
    expect(getChainDisplayName('unknown-chain')).toBe('unknown-chain')
  })
})

describe('getBlockExplorerUrl', () => {
  const txHash = '0x1234567890123456789012345678901234567890123456789012345678901234'

  it('should return correct URLs for known chains', () => {
    expect(getBlockExplorerUrl('base-sepolia', txHash)).toBe(`https://sepolia.basescan.org/tx/${txHash}`)
    expect(getBlockExplorerUrl('base', txHash)).toBe(`https://basescan.org/tx/${txHash}`)
    expect(getBlockExplorerUrl('ethereum', txHash)).toBe(`https://etherscan.io/tx/${txHash}`)
  })

  it('should return null for unknown chains', () => {
    expect(getBlockExplorerUrl('unknown-chain', txHash)).toBeNull()
  })
})
