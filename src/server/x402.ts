// x402 payment challenge and verification logic

import type { X402Challenge } from '../types'
import { logger, generateCorrelationId } from '../lib/logger.js'
import { errorTracker } from '../lib/error-tracking.js'
import {
  auditChallengeCreated,
  auditVerificationStarted,
  auditVerificationSuccess,
  auditVerificationFailed
} from './x402-audit.js'
import { supabaseAdmin } from '../../api/_shared/supabase.js'

// --- Configuration ----------------------------------------------------------

const X402_PROVIDER_URL =
  process.env.X402_PROVIDER_URL || 'https://api.cdp.coinbase.com/x402'

// If you set an API key, default to CDP; otherwise default to mock.
const X402_API_KEY = process.env.X402_API_KEY || ''
const X402_VERIFY_MODE =
  (process.env.X402_VERIFY_MODE as 'mock' | 'cdp' | undefined) ||
  (X402_API_KEY ? 'cdp' : 'mock')

const X402_ACCEPTED_ASSET = process.env.X402_ACCEPTED_ASSET || 'USDC'
const X402_CHAIN = process.env.X402_CHAIN || 'base-sepolia'
const X402_RECEIVING_ADDRESS = process.env.X402_RECEIVING_ADDRESS

// Challenge expiration (15 minutes)
const CHALLENGE_EXPIRATION_MS = 15 * 60 * 1000

// Verify retry policy
const VERIFY_RATE_LIMIT_MS = 1000
const MAX_VERIFY_RETRIES = 3

// USDC precision
const USDC_DECIMALS = 6

// --- Types ------------------------------------------------------------------

export interface BuildChallengeParams {
  priceUsd: number
  trackId: string
}
export interface BuildChallengeResult {
  challenge: X402Challenge
  expiresAt: Date
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

// --- Helpers ----------------------------------------------------------------

/** Convert a USD price to USDC atomic units (6 decimals) as a string. */
function usdToUsdcAtomicString(priceUsd: number): string {
  // Avoid float drift by formatting and padding explicitly.
  const s = priceUsd.toFixed(USDC_DECIMALS) // e.g. "5.400000"
  const [whole, frac = ''] = s.split('.')
  return `${whole}${frac.padEnd(USDC_DECIMALS, '0')}` // "5400000"
}

/** Persist the challenge on the track so confirm can read it 1:1 later. */
async function persistChallengeOnTrack(trackId: string, c: X402Challenge): Promise<void> {
  const { error } = await supabaseAdmin
    .from('tracks')
    .update({
      x402_challenge_nonce: c.nonce,
      // store amount as text in code; PostgREST/DB casts to bigint appropriately
      x402_challenge_amount: c.amount,
      x402_challenge_asset: c.asset,
      x402_challenge_chain: c.chain,
      x402_challenge_pay_to: c.payTo,
      x402_challenge_expires_at: c.expiresAt
    })
    .eq('id', trackId)

  if (error) {
    errorTracker.trackError(new Error(`persistChallenge failed: ${error.message}`), {
      operation: 'persist-challenge',
      trackId
    })
    // Do not throw; failure to persist must not break the flow.
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- Challenge build --------------------------------------------------------

export async function buildChallenge({ priceUsd, trackId }: BuildChallengeParams): Promise<BuildChallengeResult> {
  const correlationId = generateCorrelationId()

  if (!X402_RECEIVING_ADDRESS) {
    const err = new Error('x402 receiving address not configured')
    errorTracker.trackError(err, { operation: 'buildChallenge', correlationId, trackId })
    throw err
  }
  if (priceUsd <= 0) throw new Error('Price must be positive')
  if (!trackId) throw new Error('Track ID is required')

  const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRATION_MS)
  const nonce = crypto.randomUUID()
  const amount = usdToUsdcAtomicString(priceUsd)

  const challenge: X402Challenge = {
    amount,
    asset: X402_ACCEPTED_ASSET,
    chain: X402_CHAIN,
    payTo: X402_RECEIVING_ADDRESS,
    nonce,
    expiresAt: expiresAt.toISOString(),
    expiresAtSec: Math.trunc(expiresAt.getTime() / 1000)
  }

  logger.info('x402 challenge created', {
    correlationId,
    trackId,
    priceUsd,
    amount,
    chain: X402_CHAIN,
    expiresAt: challenge.expiresAt
  })

  // Persist for confirm-time verification & auditing
  await persistChallengeOnTrack(trackId, challenge)

  await auditChallengeCreated(
    supabaseAdmin,
    trackId,
    {
      nonce,
      amount,
      asset: X402_ACCEPTED_ASSET,
      chain: X402_CHAIN,
      expiresAt: challenge.expiresAt
    },
    correlationId
  )

  return { challenge, expiresAt }
}

// --- Verification -----------------------------------------------------------

export async function verifyPayment({ challenge, paymentProof, trackId }: VerifyPaymentParams): Promise<VerifyPaymentResult> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  logger.info('Starting x402 payment verification', {
    correlationId,
    trackId,
    chain: challenge.chain,
    asset: challenge.asset,
    amount: challenge.amount,
    mode: X402_VERIFY_MODE
  })

  try {
    // Expiry check (common to both modes)
    const now = new Date()
    if (now > new Date(challenge.expiresAt)) {
      logger.warn('x402 payment challenge expired', {
        correlationId,
        trackId,
        expiresAt: challenge.expiresAt,
        currentTime: now.toISOString()
      })
      return { verified: false, error: 'Payment challenge has expired' }
    }

    // --- MOCK MODE ----------------------------------------------------------
    if (X402_VERIFY_MODE === 'mock') {
      try {
        const decoded = Buffer.from(paymentProof, 'base64').toString('utf8')
        const proof = JSON.parse(decoded)

        // Minimal integrity checks vs the ORIGINAL challenge we issued
        const fieldsMatch =
          String(proof.amount) === String(challenge.amount) &&
          String(proof.asset) === String(challenge.asset) &&
          String(proof.chain) === String(challenge.chain) &&
          String(proof.payTo) === String(challenge.payTo) &&
          String(proof.nonce) === String(challenge.nonce)

        if (!fieldsMatch) {
          await auditVerificationFailed(
            supabaseAdmin,
            trackId,
            'Mock proof does not match challenge',
            Date.now() - startTime,
            correlationId,
            1
          )
          return { verified: false, error: 'Mock proof does not match challenge' }
        }

        const txHashOk =
          typeof proof.transaction_hash === 'string' &&
          proof.transaction_hash.startsWith('0x')

        if (!txHashOk) {
          await auditVerificationFailed(
            supabaseAdmin,
            trackId,
            'Invalid mock transaction hash',
            Date.now() - startTime,
            correlationId,
            1
          )
          return { verified: false, error: 'Invalid mock transaction hash' }
        }

        const proofData = {
          amount: challenge.amount,
          asset: challenge.asset,
          chain: challenge.chain,
          transaction_hash: proof.transaction_hash,
          block_number: proof.block_number || undefined,
          verified_at: now.toISOString(),
          nonce: challenge.nonce,
          proof_type: 'base_sepolia_mock',
          correlation_id: correlationId
        }

        logger.info('x402 mock verification successful', {
          correlationId,
          trackId,
          transactionHash: proof.transaction_hash,
          duration: Date.now() - startTime
        })

        await auditVerificationSuccess(
          supabaseAdmin,
          trackId,
          proof.transaction_hash || 'mock',
          proof.block_number,
          Date.now() - startTime,
          correlationId
        )

        return { verified: true, proofData }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.warn('x402 mock verification parsing failed', { correlationId, trackId, error: msg })
        await auditVerificationFailed(supabaseAdmin, trackId, `Invalid mock proof: ${msg}`, Date.now() - startTime, correlationId, 1)
        return { verified: false, error: 'Invalid mock payment proof format' }
      }
    }

    // --- CDP MODE -----------------------------------------------------------
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= MAX_VERIFY_RETRIES; attempt++) {
      try {
        logger.info('x402 verification attempt', {
          correlationId,
          trackId,
          attempt,
          maxRetries: MAX_VERIFY_RETRIES
        })

        await auditVerificationStarted(supabaseAdmin, trackId, correlationId, attempt)

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'Agent-DJ-Radio/1.0'
        }
        if (X402_API_KEY) headers['Authorization'] = `Bearer ${X402_API_KEY}`

        const response = await fetch(`${X402_PROVIDER_URL}/verify`, {
          method: 'POST',
          headers,
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
          signal: AbortSignal.timeout(10_000)
        })

        if (!response.ok) {
          const errorText = await response.text()
          const err = new Error(`CDP verification failed: ${response.status} ${errorText}`)

          // retryable?
          if (response.status >= 500 || response.status === 429) {
            lastError = err
            logger.warn('Retryable x402 verification error', {
              correlationId,
              trackId,
              attempt,
              status: response.status,
              error: errorText
            })

            if (attempt < MAX_VERIFY_RETRIES) {
              await sleep(VERIFY_RATE_LIMIT_MS * attempt)
              continue
            }
          }

          await auditVerificationFailed(
            supabaseAdmin,
            trackId,
            err.message,
            Date.now() - startTime,
            correlationId,
            attempt
          )
          return { verified: false, error: err.message }
        }

        const verificationResult = await response.json()

        if (!verificationResult.verified) {
          const errMsg = verificationResult.error || 'Payment verification failed'
          await auditVerificationFailed(
            supabaseAdmin,
            trackId,
            errMsg,
            Date.now() - startTime,
            correlationId,
            attempt
          )
          return { verified: false, error: errMsg }
        }

        const proofData = {
          amount: verificationResult.amount || challenge.amount,
          asset: verificationResult.asset || challenge.asset,
          chain: verificationResult.chain || challenge.chain,
          transaction_hash: verificationResult.transaction_hash,
          block_number: verificationResult.block_number,
          verified_at: now.toISOString(),
          nonce: challenge.nonce,
          proof_type: 'cdp',
          correlation_id: correlationId
        }

        logger.info('x402 payment verification successful', {
          correlationId,
          trackId,
          transactionHash: verificationResult.transaction_hash,
          blockNumber: verificationResult.block_number,
          duration: Date.now() - startTime
        })

        await auditVerificationSuccess(
          supabaseAdmin,
          trackId,
          verificationResult.transaction_hash || 'unknown',
          verificationResult.block_number,
          Date.now() - startTime,
          correlationId
        )

        return { verified: true, proofData }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
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
    await auditVerificationFailed(
      supabaseAdmin,
      trackId,
      finalError.message,
      Date.now() - startTime,
      correlationId,
      MAX_VERIFY_RETRIES
    )
    return { verified: false, error: finalError.message || 'Payment verification failed after multiple attempts' }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    errorTracker.trackError(err, {
      operation: 'x402-verify',
      correlationId,
      trackId
    })
    logger.error('x402 payment verification error', { correlationId, trackId }, err)
    await auditVerificationFailed(
      supabaseAdmin,
      trackId,
      err.message || 'Unknown error',
      Date.now() - Date.now(), // duration not meaningful here
      correlationId,
      1
    )
    return { verified: false, error: err.message || 'Payment verification failed' }
  }
}

// --- Misc utils -------------------------------------------------------------

export function isChallengeValid(challenge: X402Challenge): boolean {
  return new Date() <= new Date(challenge.expiresAt)
}

export function generateMockPaymentProof(challenge: X402Challenge, valid = true): string {
  if (!valid) return 'invalid-' + crypto.randomUUID()
  const txHash = '0x' + crypto.randomUUID().replace(/-/g, '').slice(0, 64)

  const mock = {
    transaction_hash: txHash,
    amount: challenge.amount,
    asset: challenge.asset,
    chain: challenge.chain,
    payTo: challenge.payTo,
    nonce: challenge.nonce,
    block_number: Math.floor(Math.random() * 1_000_000) + 5_000_000,
    timestamp: Date.now(),
    proof_type: 'base_sepolia_mock'
  }

  return Buffer.from(JSON.stringify(mock)).toString('base64')
}

export function getSandboxConfig() {
  return {
    providerUrl: X402_PROVIDER_URL,
    acceptedAsset: X402_ACCEPTED_ASSET,
    chain: X402_CHAIN,
    receivingAddress: X402_RECEIVING_ADDRESS,
    challengeExpirationMinutes: CHALLENGE_EXPIRATION_MS / 60000,
    usdcDecimals: USDC_DECIMALS,
    maxRetries: MAX_VERIFY_RETRIES,
    rateLimitMs: VERIFY_RATE_LIMIT_MS,
    verifyMode: X402_VERIFY_MODE
  }
}