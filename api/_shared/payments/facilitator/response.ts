// api/_shared/payments/facilitator/response.ts
// Response parsing and validation for facilitator API
// Handles success, error, and malformed response cases

/**
 * Successful facilitator verification response
 */
export interface FacilitatorSuccess {
  ok: true
  verified: boolean
  txHash?: string
  [key: string]: any // Allow additional fields
}

/**
 * Facilitator error response
 */
export interface FacilitatorErrorResponse {
  error: string
  message?: string
  details?: string
  [key: string]: any // Allow additional fields
}

/**
 * Custom error class with HTTP status
 */
export class FacilitatorError extends Error {
  public status: number

  constructor(
    message: string,
    status: number
  ) {
    super(message)
    this.name = 'FacilitatorError'
    this.status = status
  }
}

/**
 * Parse facilitator HTTP result with validation
 * Never throws - always returns success or throws FacilitatorError
 *
 * @param httpResult - HTTP result from postToFacilitator
 * @param url - URL that was called (for error logging)
 * @returns Parsed success response or throws FacilitatorError with status
 * @throws FacilitatorError on malformed response, network error, or facilitator error
 */
export function parseFacilitatorResponse(
  httpResult: { ok: boolean; status?: number; text: string; error?: string },
  _url: string
): FacilitatorSuccess {
  const status = httpResult.status ?? 0
  const text = httpResult.text ?? ''

  // Network/timeout error
  if (httpResult.error) {
    throw new FacilitatorError(
      `Network error: ${httpResult.error}`,
      status || 503
    )
  }

  // Empty response with error status
  if (status >= 400 && text.length === 0) {
    const codeType = status >= 500 ? 'Server error' : 'Client error'
    throw new FacilitatorError(
      `${codeType} (${status}): Empty response from facilitator`,
      status
    )
  }

  // Try to parse JSON
  let data: any
  try {
    data = JSON.parse(text)
  } catch (error: any) {
    // Invalid JSON
    const preview = text.slice(0, 200)
    throw new FacilitatorError(
      `Invalid JSON response (status ${status}): ${preview}`,
      status
    )
  }

  // Handle success (2xx status)
  if (httpResult.ok && status >= 200 && status < 300) {
    // Validate success shape
    if (data && typeof data === 'object' && data.ok === true) {
      return data as FacilitatorSuccess
    }

    // Success status but unexpected shape
    const preview = JSON.stringify(data).slice(0, 200)
    throw new FacilitatorError(
      `Success status but invalid shape: ${preview}`,
      status
    )
  }

  // Handle error (4xx, 5xx status)
  const errorMessage = extractErrorMessage(data, status)
  throw new FacilitatorError(errorMessage, status)
}

/**
 * Extract error message from facilitator error response
 * Handles various error response shapes
 */
function extractErrorMessage(data: any, status: number): string {
  // Standard error shape: { error: "...", message: "..." }
  if (data && typeof data === 'object') {
    const error = data.error || data.message || data.details
    if (typeof error === 'string') {
      return `Facilitator error (${status}): ${error}`
    }
  }

  // Fallback for unknown error shape
  return `Facilitator error (${status}): ${JSON.stringify(data).slice(0, 200)}`
}

/**
 * Check if error should be retried
 * - 5xx server errors: retry
 * - 429 rate limit: retry
 * - 4xx client errors: don't retry
 */
export function shouldRetryError(error: Error, status?: number): boolean {
  // Network/timeout errors: retry
  if (error.message.includes('timeout') || error.message.includes('network error')) {
    return true
  }

  // HTTP status-based retry
  if (status !== undefined) {
    // 5xx server errors: retry
    if (status >= 500) {
      return true
    }

    // 429 rate limit: retry
    if (status === 429) {
      return true
    }

    // 4xx client errors: don't retry
    if (status >= 400 && status < 500) {
      return false
    }
  }

  // Unknown errors: don't retry by default
  return false
}
