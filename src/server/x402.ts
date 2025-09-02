// x402 payment challenge and verification logic

import type { X402Challenge } from '../types'

// x402 Configuration
const X402_PROVIDER_URL = process.env.X402_PROVIDER_URL || 'https://api.cdp.coinbase.com/x402'
const X402_ACCEPTED_ASSET = process.env.X402_ACCEPTED_ASSET || 'USDC'
const X402_CHAIN = process.env.X402_CHAIN || 'base-sepolia'
const X402_RECEIVING_ADDRESS = process.env.X402_RECEIVING_ADDRESS

// Challenge expiration (15 minutes)
const CHALLENGE_EXPIRATION_MS = 15 * 60 * 1000

export interface BuildChallengeParams {
  priceUsd: number
  trackId: string
}

export interface BuildChallengeResult {
  challenge: X402Challenge
  expiresAt: Date
}

/**
 * Build x402 payment challenge
 */
export function buildChallenge({ priceUsd, trackId }: BuildChallengeParams): BuildChallengeResult {
  if (!X402_RECEIVING_ADDRESS) {
    throw new Error('x402 receiving address not configured')
  }

  if (priceUsd <= 0) {
    throw new Error('Price must be positive')
  }

  if (!trackId) {
    throw new Error('Track ID is required')
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRATION_MS)
  
  // Generate unique nonce for replay protection
  const nonce = crypto.randomUUID()
  
  // Convert USD to asset amount (assuming 1:1 for USDC)
  const amount = priceUsd.toFixed(2)
  
  const challenge: X402Challenge = {
    amount,
    asset: X402_ACCEPTED_ASSET,
    chain: X402_CHAIN,
    payTo: X402_RECEIVING_ADDRESS,
    nonce,
    expiresAt: expiresAt.toISOString()
  }

  return {
    challenge,
    expiresAt
  }
}

export interface VerifyPaymentParams {
  challenge: X402Challenge
  paymentProof: string
  trackId: string
}

export interface VerifyPaymentResult {
  verified: boolean
  error?: string
  proofData?: any
}

/**
 * Verify x402 payment proof
 */
export async function verifyPayment({ challenge, paymentProof, trackId }: VerifyPaymentParams): Promise<VerifyPaymentResult> {
  try {
    // Check challenge expiration
    const now = new Date()
    const expiresAt = new Date(challenge.expiresAt)
    
    if (now > expiresAt) {
      return {
        verified: false,
        error: 'Payment challenge has expired'
      }
    }

    // Verify payment proof with x402 provider
    const response = await fetch(`${X402_PROVIDER_URL}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proof: paymentProof,
        challenge: {
          amount: challenge.amount,
          asset: challenge.asset,
          chain: challenge.chain,
          payTo: challenge.payTo,
          nonce: challenge.nonce
        },
        metadata: {
          track_id: trackId
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        verified: false,
        error: `Payment verification failed: ${response.status} ${errorText}`
      }
    }

    const verificationResult = await response.json()
    
    if (!verificationResult.verified) {
      return {
        verified: false,
        error: verificationResult.error || 'Payment verification failed'
      }
    }

    // Store minimal proof data for records
    const proofData = {
      amount: verificationResult.amount,
      asset: verificationResult.asset,
      chain: verificationResult.chain,
      transaction_hash: verificationResult.transaction_hash,
      verified_at: now.toISOString(),
      nonce: challenge.nonce
    }

    return {
      verified: true,
      proofData
    }

  } catch (error) {
    console.error('Payment verification error:', error)
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Payment verification failed'
    }
  }
}

/**
 * Check if payment challenge is valid (not expired)
 */
export function isChallengeValid(challenge: X402Challenge): boolean {
  const now = new Date()
  const expiresAt = new Date(challenge.expiresAt)
  
  return now <= expiresAt
}

/**
 * Generate a mock payment proof for testing
 */
export function generateMockPaymentProof(challenge: X402Challenge, valid: boolean = true): string {
  if (!valid) {
    return 'invalid-proof-' + crypto.randomUUID()
  }

  const mockProof = {
    transaction_hash: '0x' + crypto.randomUUID().replace(/-/g, ''),
    amount: challenge.amount,
    asset: challenge.asset,
    chain: challenge.chain,
    nonce: challenge.nonce,
    timestamp: Date.now()
  }

  return Buffer.from(JSON.stringify(mockProof)).toString('base64')
}