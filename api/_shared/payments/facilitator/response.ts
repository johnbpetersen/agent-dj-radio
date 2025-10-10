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
export interface FacilitatorError {
  error: string
  message?: string
  details?: string
  [key: string]: any // Allow additional fields
}

/**
 * Custom error class with HTTP status
 */
export class FacilitatorError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
    this.name = 'FacilitatorError'
  }
}

/**
 * Parse facilitator response with validation
 *
 * @param response - Fetch Response object
 * @param url - URL that was called (for error logging)
 * @returns Parsed success response or throws FacilitatorError with status
 * @throws FacilitatorError on malformed response, network error, or facilitator error
 */
export async function parseFacilitatorResponse(
  response: Response,
  url: string
): Promise<FacilitatorSuccess> {
  // Try to parse JSON
  let data: any
  try {
    data = await response.json()
  } catch (error: any) {
    throw new FacilitatorError(
      `Facilitator returned invalid JSON (status ${response.status}): ${error.message}`,
      response.status
    )
  }

  // Handle success (2xx status)
  if (response.ok) {
    // Validate success shape
    if (data && typeof data === 'object' && data.ok === true) {
      return data as FacilitatorSuccess
    }

    // Success status but unexpected shape
    throw new FacilitatorError(
      `Facilitator returned success but invalid shape: ${JSON.stringify(data).slice(0, 200)}`,
      response.status
    )
  }

  // Handle error (4xx, 5xx status)
  const errorMessage = extractErrorMessage(data, response.status)
  throw new FacilitatorError(errorMessage, response.status)
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
