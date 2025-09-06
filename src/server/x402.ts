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

const X402_PROVIDER_URL = process.env.X402_PROVIDER_URL || 'https://api.cdp.coinbase.com/x402'
const X402_API_KEY = process.env.X402_API_KEY // optional; required for CDP
const X402_ACCEPTED_ASSET = process.env.X402_ACCEPTED_ASSET || 'USDC'
const X402_CHAIN = process.env.X402_CHAIN || 'base-sepolia'
const X402_RECEIVING_ADDRESS = process.env.X402_RECEIVING_ADDRESS

const CHALLENGE_EXPIRATION_MS = 15 * 60 * 1000
const VERIFY_RATE_LIMIT_MS = 1000
const MAX_VERIFY_RETRIES = 3
const USDC_DECIMALS = 6

export interface BuildChallengeParams {
  priceUsd: number
  trackId: string
}
export interface BuildChallengeResult {
  challenge: X402Challenge
  expiresAt: Date
}

function usdToUsdcAtomicString(priceUsd: number): string {
  // avoid float drift: format to 6dp string, strip dot, pad
  const s = priceUsd.toFixed(USDC_DECIMALS) // e.g. "5.400000"
  const [whole, frac = ''] = s.split('.')
  return `${whole}${frac.padEnd(USDC_DECIMALS, '0')}` // "5400000"
}

/** Persist the issued challenge on the track for later verification */
async function persistChallengeOnTrack(trackId: string, c: X402Challenge): Promise<void> {
  const { error } = await supabaseAdmin
    .from('tracks')
    .update({
      x402_nonce: c.nonce,
      x402_amount: c.amount,
      x402_asset: c.asset,
      x402_chain: c.chain,
      x402_pay_to: c.payTo,
      x402_expires_at: c.expiresAt
    })
    .eq('id', trackId)

  if (error) {
    errorTracker.trackError(new Error(`persistChallenge failed: ${error.message}`), {
      operation: 'persist-challenge',
      trackId
    })
  }
}

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
    expiresAt: expiresAt.toISOString()
  }

  logger.info('x402 challenge created', { correlationId, trackId, priceUsd, amount, chain: X402_CHAIN })
  await persistChallengeOnTrack(trackId, challenge)

  await auditChallengeCreated(
    supabaseAdmin,
    trackId,
    { nonce, amount, asset: X402_ACCEPTED_ASSET, chain: X402_CHAIN, expiresAt: challenge.expiresAt },
    correlationId
  )

  return { challenge, expiresAt }
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export async function verifyPayment({ challenge, paymentProof, trackId }: VerifyPaymentParams): Promise<VerifyPaymentResult> {
  const correlationId = generateCorrelationId()
  const startTime = Date.now()

  try {
    if (new Date() > new Date(challenge.expiresAt)) {
      return { verified: false, error: 'Payment challenge has expired' }
    }

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= MAX_VERIFY_RETRIES; attempt++) {
      try {
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
            metadata: { track_id: trackId, correlation_id: correlationId }
          }),
          signal: AbortSignal.timeout(10_000)
        })

        if (!response.ok) {
          const text = await response.text()
          const err = new Error(`CDP verify failed: ${response.status} ${text}`)
          lastError = err
          if (response.status >= 500 || response.status === 429) {
            if (attempt < MAX_VERIFY_RETRIES) { await sleep(VERIFY_RATE_LIMIT_MS * attempt); continue }
          }
          return { verified: false, error: err.message }
        }

        const body = await response.json()
        if (!body.verified) return { verified: false, error: body.error || 'Payment not verified' }

        const proofData = {
          amount: body.amount || challenge.amount,
          asset: body.asset || challenge.asset,
          chain: body.chain || challenge.chain,
          transaction_hash: body.transaction_hash,
          block_number: body.block_number,
          verified_at: new Date().toISOString(),
          nonce: challenge.nonce,
          proof_type: X402_API_KEY ? 'cdp' : 'dev',
          correlation_id: correlationId
        }

        await auditVerificationSuccess(
          supabaseAdmin,
          trackId,
          body.transaction_hash || 'unknown',
          body.block_number,
          Date.now() - startTime,
          correlationId
        )
        return { verified: true, proofData }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        if (attempt < MAX_VERIFY_RETRIES) { await sleep(VERIFY_RATE_LIMIT_MS * attempt); continue }
      }
    }

    return { verified: false, error: (lastError && lastError.message) || 'Verification failed' }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    errorTracker.trackError(e, { operation: 'x402-verify', correlationId, trackId })
    logger.error('x402 verify error', { correlationId, trackId }, e)
    return { verified: false, error: e.message }
  }
}

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
    rateLimitMs: VERIFY_RATE_LIMIT_MS
  }
}