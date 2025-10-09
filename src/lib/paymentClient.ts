// src/lib/paymentClient.ts
// Thin client for payment-related API calls
// Handles /wallet/prove and /queue/confirm endpoints

export interface ProveWalletRequest {
  challengeId: string
  message: string
  signature: string
}

export interface ProveWalletResponse {
  ok: true
  address: string
  requestId: string
}

export interface ProveWalletError {
  error: {
    code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'EXPIRED' | 'INVALID_SIGNATURE' | 'DB_ERROR'
    message: string
    fields?: Array<{ path: string; message: string }>
  }
  requestId: string
}

export interface ConfirmPaymentRequest {
  challengeId: string
  txHash: string
}

export interface ConfirmPaymentResponse {
  ok: true
  trackId: string
  status: string
  requestId: string
}

export interface ConfirmPaymentError {
  error: {
    code: 'WALLET_NOT_BOUND' | 'WRONG_PAYER' | 'TX_ALREADY_USED' | 'NO_MATCH' | 'WRONG_AMOUNT' | 'WRONG_ASSET' | 'WRONG_CHAIN' | 'PROVIDER_ERROR' | 'EXPIRED' | 'VALIDATION_ERROR' | 'DB_ERROR' | 'INTERNAL'
    message: string
    detail?: string
    reasonCodes?: string[]
    // TX_ALREADY_USED error shape (409)
    original?: {
      challengeId: string
      trackId: string
      confirmedAt: string
      txFrom: string | null
      boundAddress: string | null
    }
    // WRONG_PAYER error shape (400)
    detected?: {
      txFrom: string
      boundAddress: string
    }
    // Legacy data field (deprecated, use original/detected)
    data?: {
      originalChallengeId?: string
      originalTrackId?: string
      originalConfirmedAt?: string
      payerAddress?: string | null
      boundAddress?: string | null
      reasonCodes?: string[]
    }
    fields?: Array<{ path: string; message: string }>
  }
  requestId: string
}

/**
 * Prove wallet ownership by submitting a signed message
 * POST /api/wallet/prove
 */
export async function proveWallet(
  request: ProveWalletRequest
): Promise<ProveWalletResponse> {
  const response = await fetch('/api/wallet/prove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })

  const data = await response.json()

  if (!response.ok) {
    const error = data as ProveWalletError
    throw new PaymentError(
      error.error.code,
      error.error.message,
      response.status,
      error.requestId
    )
  }

  return data as ProveWalletResponse
}

/**
 * Confirm payment by submitting transaction hash
 * POST /api/queue/confirm
 */
export async function confirmPayment(
  request: ConfirmPaymentRequest
): Promise<ConfirmPaymentResponse> {
  const response = await fetch('/api/queue/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })

  const data = await response.json()

  if (!response.ok) {
    const errorResponse = data as ConfirmPaymentError
    throw new PaymentError(
      errorResponse.error.code,
      errorResponse.error.message,
      response.status,
      errorResponse.requestId,
      errorResponse.error.detail,
      errorResponse.error.data,
      errorResponse.error // Pass full error object for new format
    )
  }

  return data as ConfirmPaymentResponse
}

/**
 * Custom error class for payment operations
 * Preserves error codes and request IDs for debugging
 */
export class PaymentError extends Error {
  public error?: any // Store full error object for new response shapes

  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId: string,
    public detail?: string,
    public data?: {
      originalChallengeId?: string
      originalTrackId?: string
      originalConfirmedAt?: string
      payerAddress?: string | null
      boundAddress?: string | null
      reasonCodes?: string[]
    },
    errorObject?: any // New parameter for full error object
  ) {
    super(message)
    this.name = 'PaymentError'
    this.error = errorObject
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    // Return the server message as-is (server already provides user-friendly messages)
    return this.message
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    return this.status >= 500 || this.code === 'PROVIDER_ERROR'
  }

  /**
   * Check if error indicates binding required
   */
  isBindingRequired(): boolean {
    return this.code === 'WALLET_NOT_BOUND'
  }

  /**
   * Check if error indicates wrong payer
   */
  isWrongPayer(): boolean {
    return this.code === 'WRONG_PAYER'
  }

  /**
   * Check if error is expired (challenge or message)
   */
  isExpired(): boolean {
    return this.code === 'EXPIRED'
  }

  /**
   * Check if error indicates transaction hash already used (reuse)
   */
  isTxReused(): boolean {
    return this.code === 'TX_ALREADY_USED'
  }

  /**
   * Get reason codes for TX_ALREADY_USED or WRONG_PAYER errors
   * Returns array of codes like ['TX_ALREADY_USED', 'WRONG_PAYER']
   */
  getReasonCodes(): string[] {
    // Check error response first (new format)
    const errorData = (this as any).error
    if (errorData?.reasonCodes) {
      return errorData.reasonCodes
    }
    // Fallback to legacy data field
    return this.data?.reasonCodes || []
  }

  /**
   * Get original payment references for TX_ALREADY_USED errors
   * Returns null if not applicable
   */
  getOriginalRefs(): { challengeId: string; trackId: string; confirmedAt: string; txFrom: string | null; boundAddress: string | null } | null {
    if (!this.isTxReused()) return null

    // Check new original format first
    const errorData = (this as any).error
    if (errorData?.original) {
      return {
        challengeId: errorData.original.challengeId,
        trackId: errorData.original.trackId,
        confirmedAt: errorData.original.confirmedAt,
        txFrom: errorData.original.txFrom,
        boundAddress: errorData.original.boundAddress
      }
    }

    // Fallback to legacy data field
    if (this.data) {
      return {
        challengeId: this.data.originalChallengeId || '',
        trackId: this.data.originalTrackId || '',
        confirmedAt: this.data.originalConfirmedAt || '',
        txFrom: this.data.payerAddress || null,
        boundAddress: this.data.boundAddress || null
      }
    }

    return null
  }

  /**
   * Get detected payer info for WRONG_PAYER errors
   * Returns null if not applicable
   */
  getDetectedPayer(): { txFrom: string; boundAddress: string } | null {
    if (!this.isWrongPayer()) return null

    // Check new detected format first
    const errorData = (this as any).error
    if (errorData?.detected) {
      return {
        txFrom: errorData.detected.txFrom,
        boundAddress: errorData.detected.boundAddress
      }
    }

    // Fallback to detail string parsing (legacy)
    if (this.detail) {
      const match = this.detail.match(/Transaction from (0x[0-9a-fA-F]+), expected (0x[0-9a-fA-F]+)/)
      if (match) {
        return {
          txFrom: match[1],
          boundAddress: match[2]
        }
      }
    }

    return null
  }
}
