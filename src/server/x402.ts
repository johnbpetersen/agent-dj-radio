// x402 payment challenge and verification logic

import type { X402Challenge } from '../types'
import { logger, generateCorrelationId } from '../lib/logger'
import { errorTracker } from '../lib/error-tracking'
import { auditChallengeCreated, auditVerificationStarted, auditVerificationSuccess, auditVerificationFailed } from './x402-audit'
import { supabaseAdmin } from '../../api/_shared/supabase'

// x402 Configuration
const X402_PROVIDER_URL = process.env.X402_PROVIDER_URL || 'https://api.cdp.coinbase.com/x402'
const X402_ACCEPTED_ASSET = process.env.X402_ACCEPTED_ASSET || 'USDC'
const X402_CHAIN = process.env.X402_CHAIN || 'base-sepolia'
const X402_RECEIVING_ADDRESS = process.env.X402_RECEIVING_ADDRESS

// Challenge expiration (15 minutes)
const CHALLENGE_EXPIRATION_MS = 15 * 60 * 1000

// Rate limiting for verification attempts
const VERIFY_RATE_LIMIT_MS = 1000 // 1 second between verification attempts
const MAX_VERIFY_RETRIES = 3

// Convert USDC decimals (USDC has 6 decimal places)
const USDC_DECIMALS = 6

export interface BuildChallengeParams {
  priceUsd: number
  trackId: string
}

export interface BuildChallengeResult {
  challenge: X402Challenge
  expiresAt: Date
}

/**
 * Convert USD price to USDC amount with proper decimals
 */
function convertUsdToUsdc(priceUsd: number): string {
  // USDC has 6 decimal places, so multiply by 10^6
  const usdcWei = Math.floor(priceUsd * Math.pow(10, USDC_DECIMALS))
  return usdcWei.toString()
}

/**
 * Build x402 payment challenge for Coinbase CDP sandbox
 */
export async function buildChallenge({ priceUsd, trackId }: BuildChallengeParams): Promise<BuildChallengeResult> {
  const correlationId = generateCorrelationId()
  
  if (!X402_RECEIVING_ADDRESS) {
    errorTracker.trackError(new Error('x402 receiving address not configured'), {
      operation: 'buildChallenge',
      correlationId,
      trackId
    })
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
  
  // Convert USD to USDC amount (with 6 decimal precision for Base network)
  const amount = convertUsdToUsdc(priceUsd)
  
  const challenge: X402Challenge = {
    amount,
    asset: X402_ACCEPTED_ASSET,
    chain: X402_CHAIN,
    payTo: X402_RECEIVING_ADDRESS,
    nonce,
    expiresAt: expiresAt.toISOString()
  }

  logger.info('x402 challenge created', {
    correlationId,
    trackId,
    priceUsd,
    amountUsdc: amount,
    chain: X402_CHAIN,
    expiresAt: expiresAt.toISOString()
  })

  // Audit trail: log challenge creation
  await auditChallengeCreated(supabaseAdmin, trackId, {
    nonce,
    amount,
    asset: X402_ACCEPTED_ASSET,
    chain: X402_CHAIN,
    expiresAt: expiresAt.toISOString()
  }, correlationId)

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
 * Wait between retry attempts
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Verify x402 payment proof with Coinbase CDP sandbox
 */
export async function verifyPayment({ challenge, paymentProof, trackId }: VerifyPaymentParams): Promise<VerifyPaymentResult> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.info('Starting x402 payment verification', {
    correlationId,
    trackId,
    chain: challenge.chain,
    asset: challenge.asset,
    amount: challenge.amount
  })

  try {
    // Check challenge expiration
    const now = new Date()
    const expiresAt = new Date(challenge.expiresAt)
    
    if (now > expiresAt) {
      logger.warn('x402 payment challenge expired', {
        correlationId,
        trackId,
        expiresAt: challenge.expiresAt,
        currentTime: now.toISOString()
      })
      
      return {
        verified: false,
        error: 'Payment challenge has expired'
      }
    }

    // Retry logic for verification
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= MAX_VERIFY_RETRIES; attempt++) {
      try {
        logger.info('x402 verification attempt', {
          correlationId,
          trackId,
          attempt,
          maxRetries: MAX_VERIFY_RETRIES
        })

        // Audit trail: log verification attempt
        await auditVerificationStarted(supabaseAdmin, trackId, correlationId, attempt)

        // Verify payment proof with Coinbase CDP sandbox
        const response = await fetch(`${X402_PROVIDER_URL}/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Agent-DJ-Radio/1.0'
          },
          body: JSON.stringify({
            proof: paymentProof,
            challenge: {
              amount: challenge.amount,
              asset: challenge.asset,
              chain: challenge.chain,
              payTo: challenge.payTo,
              nonce: challenge.nonce,
              expiresAt: challenge.expiresAt
            },
            metadata: {
              track_id: trackId,
              correlation_id: correlationId
            }
          }),
          signal: AbortSignal.timeout(10000) // 10 second timeout
        })

        if (!response.ok) {
          const errorText = await response.text()
          const error = new Error(`CDP verification failed: ${response.status} ${errorText}`)
          
          // Check if it's a retryable error
          if (response.status >= 500 || response.status === 429) {
            lastError = error
            logger.warn('Retryable x402 verification error', {
              correlationId,
              trackId,
              attempt,
              status: response.status,
              error: errorText
            })
            
            if (attempt < MAX_VERIFY_RETRIES) {
              await sleep(VERIFY_RATE_LIMIT_MS * attempt) // Exponential backoff
              continue
            }
          }
          
          // Non-retryable error
          errorTracker.trackError(error, {
            operation: 'x402-verify',
            correlationId,
            trackId,
            status: response.status,
            attempt
          })
          
          return {
            verified: false,
            error: `Payment verification failed: ${response.status} ${errorText}`
          }
        }

        const verificationResult = await response.json()
        
        logger.info('x402 verification response received', {
          correlationId,
          trackId,
          attempt,
          verified: verificationResult.verified,
          duration: Date.now() - startTime
        })
        
        if (!verificationResult.verified) {
          return {
            verified: false,
            error: verificationResult.error || 'Payment verification failed'
          }
        }

        // Store proof data for audit trail
        const proofData = {
          amount: verificationResult.amount || challenge.amount,
          asset: verificationResult.asset || challenge.asset,
          chain: verificationResult.chain || challenge.chain,
          transaction_hash: verificationResult.transaction_hash,
          block_number: verificationResult.block_number,
          verified_at: now.toISOString(),
          nonce: challenge.nonce,
          proof_type: 'cdp_sandbox',
          correlation_id: correlationId
        }

        logger.info('x402 payment verification successful', {
          correlationId,
          trackId,
          transactionHash: verificationResult.transaction_hash,
          blockNumber: verificationResult.block_number,
          duration: Date.now() - startTime
        })

        // Audit trail: log verification success
        await auditVerificationSuccess(
          supabaseAdmin,
          trackId,
          verificationResult.transaction_hash || 'unknown',
          verificationResult.block_number,
          Date.now() - startTime,
          correlationId
        )

        return {
          verified: true,
          proofData
        }

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        logger.warn('x402 verification attempt failed', {
          correlationId,
          trackId,
          attempt,
          error: lastError.message
        })
        
        if (attempt < MAX_VERIFY_RETRIES) {
          await sleep(VERIFY_RATE_LIMIT_MS * attempt)
          continue
        }
      }
    }
    
    // All retries exhausted
    const finalError = lastError || new Error('x402 verification failed after retries')
    
    errorTracker.trackError(finalError, {
      operation: 'x402-verify',
      correlationId,
      trackId,
      attempts: MAX_VERIFY_RETRIES
    })
    
    // Audit trail: log final verification failure
    await auditVerificationFailed(
      supabaseAdmin,
      trackId,
      finalError.message,
      Date.now() - startTime,
      correlationId,
      MAX_VERIFY_RETRIES
    )
    
    return {
      verified: false,
      error: finalError.message || 'Payment verification failed after multiple attempts'
    }

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    
    errorTracker.trackError(err, {
      operation: 'x402-verify',
      correlationId,
      trackId
    })
    
    logger.error('x402 payment verification error', { correlationId, trackId }, err)
    
    return {
      verified: false,
      error: err.message || 'Payment verification failed'
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
 * Generate a mock payment proof for Base-Sepolia testing
 */
export function generateMockPaymentProof(challenge: X402Challenge, valid: boolean = true): string {
  if (!valid) {
    return 'invalid-proof-' + crypto.randomUUID()
  }

  // Mock a Base-Sepolia transaction hash format
  const txHash = '0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 64)
  
  const mockProof = {
    transaction_hash: txHash,
    amount: challenge.amount,
    asset: challenge.asset,
    chain: challenge.chain,
    payTo: challenge.payTo,
    nonce: challenge.nonce,
    block_number: Math.floor(Math.random() * 1000000) + 5000000, // Mock Base-Sepolia block
    timestamp: Date.now(),
    proof_type: 'base_sepolia_mock'
  }

  return Buffer.from(JSON.stringify(mockProof)).toString('base64')
}

/**
 * Get sandbox configuration details
 */
export function getSandboxConfig() {
  return {
    providerUrl: X402_PROVIDER_URL,
    acceptedAsset: X402_ACCEPTED_ASSET,
    chain: X402_CHAIN,
    receivingAddress: X402_RECEIVING_ADDRESS,
    challengeExpirationMinutes: CHALLENGE_EXPIRATION_MS / (60 * 1000),
    usdcDecimals: USDC_DECIMALS,
    maxRetries: MAX_VERIFY_RETRIES,
    rateLimitMs: VERIFY_RATE_LIMIT_MS
  }
}