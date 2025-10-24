// Minimal error tracking system for production monitoring
// Uses structured logging as the foundation with optional external service integration

import { logger, type LogContext } from './logger.js'

export interface ErrorContext extends LogContext {
  userAgent?: string
  url?: string
  statusCode?: number
  stack?: string
}

export interface ErrorMetrics {
  errorCount: number
  lastError: string
  timestamp: string
}

class ErrorTracker {
  private enabled: boolean = false
  private errorCounts = new Map<string, number>()

  constructor() {
    this.enabled = process.env.ENABLE_ERROR_TRACKING === 'true'
  }

  // Track application errors
  trackError(error: Error, context: ErrorContext = {}): void {
    if (!this.enabled) return

    const errorKey = `${error.name}:${error.message}`
    const currentCount = this.errorCounts.get(errorKey) || 0
    this.errorCounts.set(errorKey, currentCount + 1)

    logger.error('Application error tracked', {
      errorName: error.name,
      errorMessage: error.message,
      errorCount: currentCount + 1,
      ...context
    }, error)

    // In a real system, this would send to external service
    this.reportToExternalService(error, context)
  }

  // Track API errors
  trackApiError(endpoint: string, statusCode: number, message: string, context: ErrorContext = {}): void {
    if (!this.enabled) return

    const errorKey = `API:${endpoint}:${statusCode}`
    const currentCount = this.errorCounts.get(errorKey) || 0
    this.errorCounts.set(errorKey, currentCount + 1)

    logger.error('API error tracked', {
      endpoint,
      statusCode,
      errorMessage: message,
      errorCount: currentCount + 1,
      ...context
    })
  }

  // Track business logic errors
  trackBusinessError(operation: string, reason: string, context: ErrorContext = {}): void {
    if (!this.enabled) return

    logger.warn('Business logic error', {
      operation,
      reason,
      ...context
    })
  }

  // Track performance issues
  trackPerformanceIssue(operation: string, duration: number, threshold: number, context: ErrorContext = {}): void {
    if (!this.enabled) return

    logger.warn('Performance issue detected', {
      operation,
      duration,
      threshold,
      ...context
    })
  }

  // Get error summary for health checks
  getErrorSummary(): Record<string, ErrorMetrics> {
    const summary: Record<string, ErrorMetrics> = {}
    
    for (const [errorKey, count] of this.errorCounts.entries()) {
      summary[errorKey] = {
        errorCount: count,
        lastError: errorKey,
        timestamp: new Date().toISOString()
      }
    }
    
    return summary
  }

  // Clear old error counts (call periodically)
  clearOldErrors(): void {
    this.errorCounts.clear()
  }

  private reportToExternalService(error: Error, context: ErrorContext): void {
    // Placeholder for external error tracking service integration
    // In production, you might integrate with:
    // - Sentry: Sentry.captureException(error, { contexts: { custom: context } })
    // - Datadog: DD.addError(error, context)
    // - Custom webhook: fetch('/api/errors', { method: 'POST', body: JSON.stringify({ error, context }) })
    
    logger.debug('Error reported to external service (placeholder)', {
      errorName: error.name,
      ...context
    })
  }
}

// Singleton instance
export const errorTracker = new ErrorTracker()

// Utility functions for common error patterns
export function withErrorTracking<T>(
  operation: string,
  handler: () => Promise<T>,
  context: ErrorContext = {}
): Promise<T> {
  return handler().catch((error) => {
    errorTracker.trackError(error instanceof Error ? error : new Error(String(error)), {
      operation,
      ...context
    })
    throw error
  })
}

export function trackApiResponse(
  endpoint: string,
  response: Response,
  context: ErrorContext = {}
): void {
  if (!response.ok) {
    errorTracker.trackApiError(endpoint, response.status, response.statusText, {
      url: response.url,
      ...context
    })
  }
}

// Express/Vercel error handler
export function handleApiError(
  error: unknown,
  endpoint: string,
  context: ErrorContext = {}
): { error: string, correlationId?: string } {
  const err = error instanceof Error ? error : new Error(String(error))
  
  errorTracker.trackError(err, {
    endpoint,
    ...context
  })

  // Return sanitized error for API response
  return {
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    correlationId: context.correlationId
  }
}