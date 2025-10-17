// Structured error handling utilities
// Provides normalized error extraction, classification, and response formatting

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'CHAT_REQUIRES_LINKED'
  | 'NETWORK_ERROR'
  | 'UPSTREAM_4XX'
  | 'UPSTREAM_5XX'
  | 'DB_ERROR'
  | 'INTERNAL'

export interface ErrorMeta {
  db?: {
    type: 'CONNECTION' | 'QUERY'
    operation?: string
    table?: string
  }
  network?: {
    code?: string
    errno?: string | number
    syscall?: string
    address?: string
    port?: number
    url?: string
    method?: string
  }
  upstream?: {
    status?: number
    statusText?: string
    url?: string
    method?: string
    responsePreview?: string
    responseKeys?: string[]
  }
  context?: {
    route?: string
    method?: string
    path?: string
    queryKeysOnly?: string[]
    targetUrl?: string
  }
}

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly httpStatus: number
  public readonly hint?: string
  public readonly meta: ErrorMeta

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      httpStatus?: number
      hint?: string
      meta?: ErrorMeta
      cause?: Error
    } = {}
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.httpStatus = options.httpStatus ?? this.getDefaultStatus(code)
    this.hint = options.hint
    this.meta = options.meta ?? {}

    if (options.cause) {
      this.cause = options.cause
    }
  }

  private getDefaultStatus(code: ErrorCode): number {
    switch (code) {
      case 'BAD_REQUEST': return 400
      case 'UNAUTHORIZED': return 401
      case 'FORBIDDEN': return 403
      case 'NOT_FOUND': return 404
      case 'CONFLICT': return 409
      case 'TOO_MANY_REQUESTS': return 429
      case 'CHAT_REQUIRES_LINKED': return 403
      case 'NETWORK_ERROR': return 503
      case 'UPSTREAM_4XX': return 502
      case 'UPSTREAM_5XX': return 503
      case 'DB_ERROR': return 503
      case 'INTERNAL': return 500
      default: return 500
    }
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      meta: this.meta
    }
  }
}

/**
 * Security utility to redact sensitive data from log strings
 */
export function redactSecrets(str: string): string {
  if (typeof str !== 'string') return str

  return str
    // Long base64 strings (>128 chars) - must come before JWT check
    .replace(/\b[A-Za-z0-9+/]{128,}={0,2}\b/g, '[BASE64_REDACTED]')
    // JWT tokens (xxx.yyy.zzz pattern with minimum length requirements)
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[JWT_REDACTED]')
    // API keys and tokens
    .replace(/([A-Z_]*(?:KEY|TOKEN|SECRET)[A-Z_]*\s*[:=]\s*)([^\s,}\]]+)/gi, '$1[REDACTED]')
    // Environment variable dumps
    .replace(/((?:SUPABASE|ELEVEN|X402)[A-Z_]*\s*[:=]\s*)([^\s,}\]]+)/gi, '$1[REDACTED]')
}

/**
 * Extract detailed error information from any error type
 */
export function normalizeError(error: unknown, context?: ErrorMeta['context']): {
  message: string
  code: ErrorCode
  meta: ErrorMeta
  originalError: Error
} {
  let originalError: Error
  let message: string
  let code: ErrorCode = 'INTERNAL'
  const meta: ErrorMeta = { context }

  // Convert non-Error objects to Error
  if (!(error instanceof Error)) {
    originalError = new Error(String(error))
    message = originalError.message
  } else {
    originalError = error
    message = error.message
  }

  // Extract Node.js/undici network error details
  if (originalError.name === 'TypeError' && message.includes('fetch failed')) {
    code = 'NETWORK_ERROR'

    // Try to extract undici error details from cause chain
    let cause = originalError.cause as Record<string, unknown> | undefined
    while (cause && typeof cause === 'object') {
      if ('code' in cause || 'errno' in cause || 'syscall' in cause) {
        meta.network = {
          code: typeof cause.code === 'string' ? cause.code : undefined,
          errno: typeof cause.errno === 'number' || typeof cause.errno === 'string' ? cause.errno : undefined,
          syscall: typeof cause.syscall === 'string' ? cause.syscall : undefined,
          address: typeof cause.address === 'string' ? cause.address : undefined,
          port: typeof cause.port === 'number' ? cause.port : undefined
        }
        break
      }
      cause = cause.cause as Record<string, unknown> | undefined
    }
  }

  // Handle HTTP Response errors
  if (originalError.name === 'HTTPError' || message.includes('HTTP')) {
    const statusMatch = message.match(/\b([4-5]\d\d)\b/)
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10)
      code = status >= 500 ? 'UPSTREAM_5XX' : 'UPSTREAM_4XX'

      meta.upstream = {
        status,
        statusText: extractStatusText(message),
        url: extractUrl(message),
        method: extractMethod(message)
      }
    }
  }

  // Handle Supabase/PostgREST errors
  if (message.includes('PGRST') || originalError.name === 'PostgrestError') {
    code = 'DB_ERROR'

    // Detect connection vs query issues
    if (message.includes('connection') || message.includes('timeout') || message.includes('ECONNREFUSED')) {
      meta.db = { type: 'CONNECTION' }
    } else {
      meta.db = { type: 'QUERY' }
    }
  }

  // Handle common validation errors
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    code = 'BAD_REQUEST'
  }

  // Handle authentication errors
  if (message.includes('unauthorized') || message.includes('authentication') || message.includes('token')) {
    code = 'UNAUTHORIZED'
  }

  // Handle not found errors
  if (message.includes('not found') || message.includes('404')) {
    code = 'NOT_FOUND'
  }

  return {
    message: redactSecrets(message),
    code,
    meta,
    originalError
  }
}

/**
 * Helper to extract URL from error messages
 */
function extractUrl(message: string): string | undefined {
  const urlMatch = message.match(/https?:\/\/[^\s)]+/)
  return urlMatch?.[0]
}

/**
 * Helper to extract HTTP method from error messages
 */
function extractMethod(message: string): string | undefined {
  const methodMatch = message.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/i)
  return methodMatch?.[1]?.toUpperCase()
}

/**
 * Helper to extract status text from error messages
 */
function extractStatusText(message: string): string | undefined {
  const statusTextMatch = message.match(/\b\d{3}\s+([A-Za-z\s]+)/)
  return statusTextMatch?.[1]?.trim()
}

/**
 * Safely extract response body preview and JSON keys
 */
export function extractResponsePreview(responseText: string): {
  preview: string
  keys?: string[]
} {
  if (!responseText) return { preview: '' }

  // Truncate and strip newlines
  let preview = responseText.slice(0, 256).replace(/\n/g, ' ')

  let keys: string[] | undefined

  // Try to parse as JSON and extract top-level keys
  try {
    const parsed = JSON.parse(responseText)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      keys = Object.keys(parsed)
      // If we have keys, just show a summary
      preview = `{${keys.join(', ')}} (${responseText.length} chars)`
    }
  } catch {
    // Not JSON, keep the truncated preview
  }

  return { preview: redactSecrets(preview), keys }
}

/**
 * HTTP error factory functions
 */
export const httpError = {
  badRequest: (message: string, hint?: string, meta?: ErrorMeta) =>
    new AppError('BAD_REQUEST', message, { hint, meta }),

  unauthorized: (message: string = 'Unauthorized', hint?: string, meta?: ErrorMeta) =>
    new AppError('UNAUTHORIZED', message, { hint, meta }),

  forbidden: (message: string = 'Forbidden', hint?: string, meta?: ErrorMeta) =>
    new AppError('FORBIDDEN', message, { hint, meta }),

  notFound: (message: string = 'Not found', hint?: string, meta?: ErrorMeta) =>
    new AppError('NOT_FOUND', message, { hint, meta }),

  conflict: (message: string = 'Conflict', meta?: ErrorMeta) =>
    new AppError('CONFLICT', message, { meta }),

  tooManyRequests: (message: string = 'Too many requests', meta?: ErrorMeta) =>
    new AppError('TOO_MANY_REQUESTS', message, { meta }),

  chatRequiresLinked: (message: string = 'Chat requires a linked account', meta?: ErrorMeta) =>
    new AppError('CHAT_REQUIRES_LINKED', message, { meta }),

  networkError: (message: string, meta?: ErrorMeta) =>
    new AppError('NETWORK_ERROR', message, { meta }),

  dbError: (message: string, meta?: ErrorMeta) =>
    new AppError('DB_ERROR', message, { meta }),

  internal: (message: string = 'Internal server error', meta?: ErrorMeta) =>
    new AppError('INTERNAL', message, { meta })
}

/**
 * Standard error response format for API endpoints
 */
export interface ErrorResponse {
  error: {
    code: ErrorCode
    message: string
    hint?: string
  }
  requestId: string
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: AppError | Error | unknown,
  requestId: string,
  context?: ErrorMeta['context']
): {
  status: number
  body: ErrorResponse
} {
  if (error instanceof AppError) {
    return {
      status: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.message,
          hint: error.hint
        },
        requestId
      }
    }
  }

  // Normalize other errors
  const normalized = normalizeError(error, context)
  const appError = new AppError(normalized.code, normalized.message, {
    meta: normalized.meta
  })

  return {
    status: appError.httpStatus,
    body: {
      error: {
        code: appError.code,
        message: appError.message,
        hint: appError.hint
      },
      requestId
    }
  }
}