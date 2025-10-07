// api/_shared/payments/x402-facilitator.ts
// x402 facilitator payment verification using official SDK

import { createFacilitator } from '@coinbase/x402/server'
import { logger } from '../../../src/lib/logger.js'
import type { VerifyPaymentSuccess, VerifyPaymentFailure, VerificationErrorCode } from './x402-cdp.js'

export interface VerifyWithFacilitatorInput {
  facilitatorUrl: string
  xPaymentHeader: string
  txHash: string
  // Challenge data for requirements
  chain: string
  asset: string
  payTo: string
  amountAtomic: number
  challengeId: string
}

/**
 * Map facilitator error responses to our standardized error codes
 */
function mapFacilitatorError(error: any): VerifyPaymentFailure {
  const errorMsg = error?.message || 'Verification failed'
  const errorCode = error?.code || 'UNKNOWN'

  logger.debug('Mapping facilitator error', { errorCode, errorMsg, fullError: error })

  // Map common error patterns
  if (errorCode.includes('WRONG_CHAIN') || errorMsg.toLowerCase().includes('chain')) {
    return {
      ok: false,
      code: 'WRONG_CHAIN',
      message: 'Payment sent on wrong blockchain network',
      detail: errorMsg
    }
  }

  if (errorCode.includes('WRONG_ASSET') || errorMsg.toLowerCase().includes('asset') || errorMsg.toLowerCase().includes('token')) {
    return {
      ok: false,
      code: 'WRONG_ASSET',
      message: 'Wrong cryptocurrency used for payment',
      detail: errorMsg
    }
  }

  if (errorCode.includes('WRONG_AMOUNT') || errorCode.includes('INSUFFICIENT') || errorMsg.toLowerCase().includes('amount')) {
    return {
      ok: false,
      code: 'WRONG_AMOUNT',
      message: 'Payment amount is insufficient',
      detail: errorMsg
    }
  }

  if (errorCode.includes('NOT_FOUND') || errorCode.includes('NO_TRANSACTION') || errorMsg.toLowerCase().includes('not found')) {
    return {
      ok: false,
      code: 'NO_MATCH',
      message: 'Transaction not found on blockchain',
      detail: errorMsg
    }
  }

  if (errorCode.includes('EXPIRED') || errorMsg.toLowerCase().includes('expired')) {
    return {
      ok: false,
      code: 'EXPIRED',
      message: 'Transaction expired or timed out',
      detail: errorMsg
    }
  }

  // Default to PROVIDER_ERROR
  return {
    ok: false,
    code: 'PROVIDER_ERROR',
    message: 'Payment verification service error',
    detail: errorMsg
  }
}

/**
 * Verify payment using x402 facilitator with official SDK
 */
export async function verifyWithFacilitator(
  input: VerifyWithFacilitatorInput
): Promise<VerifyPaymentSuccess | VerifyPaymentFailure> {
  const { facilitatorUrl, xPaymentHeader, txHash, chain, asset, payTo, amountAtomic, challengeId } = input

  logger.info('Facilitator verification started', {
    challengeId,
    txHash,
    facilitatorUrl,
    chain,
    asset,
    amountAtomic,
    payTo: payTo.substring(0, 10) + '...'
  })

  try {
    // Create facilitator instance
    const facilitator = createFacilitator({ url: facilitatorUrl.replace(/\/$/, '') })

    // Verify payment using SDK
    const result = await facilitator.verify({
      paymentPayload: {
        payment: xPaymentHeader, // Exact X-PAYMENT header string
        txHash
      },
      paymentRequirements: {
        chain,
        asset,
        to: payTo,
        amount: amountAtomic.toString() // SDK expects string
      }
    })

    // Check verification result
    if (!result.ok) {
      logger.warn('Facilitator verification rejected', {
        challengeId,
        txHash,
        error: result.error
      })
      return mapFacilitatorError(result.error)
    }

    // Success! Extract verified payment details
    const verifiedPayment = result.data
    const amountPaid = parseInt(verifiedPayment.amount || '0', 10)

    // Validate amount meets minimum requirement
    if (amountPaid < amountAtomic) {
      const diff = amountAtomic - amountPaid
      logger.warn('Facilitator verification: insufficient amount', {
        challengeId,
        txHash,
        expected: amountAtomic,
        actual: amountPaid,
        shortfall: diff
      })
      return {
        ok: false,
        code: 'WRONG_AMOUNT',
        message: 'Payment amount is insufficient',
        detail: `Insufficient payment: expected ${amountAtomic}, got ${amountPaid} (short by ${diff})`
      }
    }

    logger.info('Facilitator verification successful', {
      challengeId,
      txHash,
      amountPaidAtomic: amountPaid,
      asset: verifiedPayment.asset,
      chain: verifiedPayment.chain
    })

    return {
      ok: true,
      amountPaidAtomic: amountPaid
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))

    logger.error('Facilitator verification error', {
      challengeId,
      txHash,
      error: err.message,
      stack: err.stack
    })

    // Check if it's a network/HTTP error
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: 'Payment verification service unavailable',
        detail: `Facilitator unavailable: ${err.message}`
      }
    }

    // Check for timeout
    if (err.message.includes('timeout') || err.message.includes('AbortError')) {
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: 'Payment verification service timeout',
        detail: `Facilitator timeout: ${err.message}`
      }
    }

    // Generic error
    return mapFacilitatorError(err)
  }
}
