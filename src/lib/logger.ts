// Structured logging with correlation IDs
// Uses native console with structured formatting for Vercel/serverless compatibility

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  correlationId?: string
  userId?: string
  trackId?: string
  endpoint?: string
  duration?: number
  [key: string]: any
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

class Logger {
  private logLevel: LogLevel = 'info'
  private enableRequestLogging: boolean = false

  constructor() {
    // Configure from environment
    const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel
    if (['debug', 'info', 'warn', 'error'].includes(envLevel)) {
      this.logLevel = envLevel
    }
    
    this.enableRequestLogging = process.env.ENABLE_REQUEST_LOGGING === 'true'
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    }
    return levels[level] >= levels[this.logLevel]
  }

  private formatLog(level: LogLevel, message: string, context: LogContext = {}, error?: Error): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      })
    }
  }

  private write(entry: LogEntry): void {
    const output = JSON.stringify(entry)
    
    switch (entry.level) {
      case 'debug':
        console.debug(output)
        break
      case 'info':
        console.info(output)
        break
      case 'warn':
        console.warn(output)
        break
      case 'error':
        console.error(output)
        break
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      this.write(this.formatLog('debug', message, context))
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.write(this.formatLog('info', message, context))
    }
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    if (this.shouldLog('warn')) {
      this.write(this.formatLog('warn', message, context, error))
    }
  }

  error(message: string, context?: LogContext, error?: Error): void {
    if (this.shouldLog('error')) {
      this.write(this.formatLog('error', message, context, error))
    }
  }

  // Request-specific logging
  request(endpoint: string, context: LogContext = {}): void {
    if (this.enableRequestLogging) {
      this.info('Request received', { 
        endpoint, 
        ...context 
      })
    }
  }

  requestComplete(endpoint: string, duration: number, context: LogContext = {}): void {
    if (this.enableRequestLogging) {
      this.info('Request completed', { 
        endpoint, 
        duration, 
        ...context 
      })
    }
  }

  // Admin action logging
  adminAction(action: string, context: LogContext = {}): void {
    this.info('Admin action executed', { 
      action, 
      ...context 
    })
  }

  // Track lifecycle logging
  trackCreated(trackId: string, context: LogContext = {}): void {
    this.info('Track created', { trackId, ...context })
  }

  trackStatusChanged(trackId: string, fromStatus: string, toStatus: string, context: LogContext = {}): void {
    this.info('Track status changed', { 
      trackId, 
      fromStatus, 
      toStatus, 
      ...context 
    })
  }

  cronJobStart(jobName: string, context: LogContext = {}): void {
    this.info('Cron job started', { jobName, ...context })
  }

  cronJobComplete(jobName: string, duration: number, context: LogContext = {}): void {
    this.info('Cron job completed', { 
      jobName, 
      duration, 
      ...context 
    })
  }
}

// Correlation ID utilities
export function generateCorrelationId(): string {
  return crypto.randomUUID()
}

export function getCorrelationId(req: any): string {
  return req.correlationId || req.headers['x-correlation-id'] || generateCorrelationId()
}

// Singleton logger instance
export const logger = new Logger()

// Request middleware helper
export function withLogging<T>(
  endpoint: string,
  handler: (correlationId: string) => Promise<T>
): Promise<T> {
  return async function(this: any) {
    const correlationId = generateCorrelationId()
    const startTime = Date.now()
    
    logger.request(endpoint, { correlationId })
    
    try {
      const result = await handler(correlationId)
      const duration = Date.now() - startTime
      
      logger.requestComplete(endpoint, duration, { correlationId })
      return result
    } catch (error) {
      const duration = Date.now() - startTime
      
      logger.error('Request failed', { 
        endpoint, 
        correlationId, 
        duration 
      }, error instanceof Error ? error : new Error(String(error)))
      
      throw error
    }
  }.call(this)
}