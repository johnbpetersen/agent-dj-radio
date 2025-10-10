// api/_shared/payments/facilitator/logger.ts
// Structured logging helpers for facilitator operations
// Concise, actionable logs with consistent format

/**
 * Log facilitator verification attempt (concise one-liner)
 */
export function logVerifyAttempt(params: {
  variant: string
  attempt: number
  chainIdType: string
  sigLen: number
  nonceLen: number
}): void {
  console.log('[facilitator]', params.variant, `(${params.attempt})`, {
    chainIdType: params.chainIdType,
    sigLen: params.sigLen,
    nonceLen: params.nonceLen
  })
}

/**
 * Log facilitator verification success
 */
export function logVerifySuccess(params: {
  variant: string
  verified: boolean
  txHash?: string
  durationMs: number
}): void {
  console.log('[facilitator] ✓', params.variant, {
    verified: params.verified,
    txHash: params.txHash?.slice(0, 10) + '...',
    durationMs: params.durationMs
  })
}

/**
 * Log facilitator verification error
 */
export function logVerifyError(params: {
  variant: string
  error: string
  status?: number
  durationMs: number
}): void {
  console.error('[facilitator] ✗', params.variant, {
    error: params.error.slice(0, 100),
    status: params.status,
    durationMs: params.durationMs
  })
}

/**
 * Log all variants exhausted
 */
export function logAllVariantsFailed(params: {
  attemptedVariants: string[]
  finalError: string
}): void {
  console.error('[facilitator] All variants failed', {
    attempted: params.attemptedVariants,
    finalError: params.finalError.slice(0, 200)
  })
}

