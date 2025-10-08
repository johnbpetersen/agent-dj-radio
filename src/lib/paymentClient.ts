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
    code: 'WALLET_NOT_BOUND' | 'WRONG_PAYER' | 'NO_MATCH' | 'WRONG_AMOUNT' | 'WRONG_ASSET' | 'WRONG_CHAIN' | 'PROVIDER_ERROR' | 'EXPIRED' | 'VALIDATION_ERROR' | 'DB_ERROR' | 'INTERNAL'
    message: string
    detail?: string
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
    const error = data as ConfirmPaymentError
    throw new PaymentError(
      error.error.code,
      error.error.message,
      response.status,
      error.requestId,
      error.error.detail
    )
  }

  return data as ConfirmPaymentResponse
}

/**
 * Custom error class for payment operations
 * Preserves error codes and request IDs for debugging
 */
export class PaymentError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId: string,
    public detail?: string
  ) {
    super(message)
    this.name = 'PaymentError'
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
}
