// x402 Payment Audit Trail
// Comprehensive tracking of payment challenges, submissions, and verifications

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../lib/logger.js'
import { errorTracker } from '../lib/error-tracking.js'

export type X402EventType = 
  | 'CHALLENGE_CREATED'
  | 'PAYMENT_SUBMITTED' 
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_SUCCESS'
  | 'VERIFICATION_FAILED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_EXPIRED'
  | 'CHALLENGE_REBUILT'

export interface X402AuditEvent {
  trackId: string
  eventType: X402EventType
  
  // Challenge data
  challengeNonce?: string
  challengeAmount?: string
  challengeAsset?: string
  challengeChain?: string
  challengeExpiresAt?: string
  
  // Verification data
  paymentProof?: string
  transactionHash?: string
  blockNumber?: number
  verificationAttempts?: number
  verificationDurationMs?: number
  
  // Context
  correlationId?: string
  userAgent?: string
  ipAddress?: string
  errorMessage?: string
  
  // Additional metadata
  metadata?: Record<string, any>
}

export interface PaymentAuditTrail {
  eventType: X402EventType
  challengeNonce?: string
  transactionHash?: string
  verificationAttempts?: number
  errorMessage?: string
  correlationId?: string
  createdAt: string
}

export interface PaymentStatistics {
  totalChallenges: number
  totalSubmissions: number
  successfulVerifications: number
  failedVerifications: number
  expiredChallenges: number
  successRate: number
  avgVerificationTimeMs: number
}

/**
 * Log an x402 audit event to the database
 */
export async function logX402Event(
  supabase: SupabaseClient,
  event: X402AuditEvent
): Promise<void> {
  try {
    const { error } = await supabase
      .from('x402_payment_audit')
      .insert({
        track_id: event.trackId,
        event_type: event.eventType,
        challenge_nonce: event.challengeNonce,
        challenge_amount: event.challengeAmount,
        challenge_asset: event.challengeAsset,
        challenge_chain: event.challengeChain,
        challenge_expires_at: event.challengeExpiresAt,
        payment_proof: event.paymentProof,
        transaction_hash: event.transactionHash,
        block_number: event.blockNumber,
        verification_attempts: event.verificationAttempts,
        verification_duration_ms: event.verificationDurationMs,
        correlation_id: event.correlationId,
        user_agent: event.userAgent,
        ip_address: event.ipAddress,
        error_message: event.errorMessage,
        metadata: event.metadata
      })

    if (error) {
      errorTracker.trackError(new Error(`Failed to log x402 audit event: ${error.message}`), {
        operation: 'x402-audit-log',
        trackId: event.trackId,
        eventType: event.eventType,
        correlationId: event.correlationId
      })
      
      // Don't throw - audit logging should not break payment flow
      logger.error('x402 audit logging failed', {
        correlationId: event.correlationId,
        trackId: event.trackId,
        eventType: event.eventType
      }, new Error(error.message))
    } else {
      logger.debug('x402 audit event logged', {
        correlationId: event.correlationId,
        trackId: event.trackId,
        eventType: event.eventType
      })
    }
  } catch (error) {
    // Never throw from audit logging
    errorTracker.trackError(error instanceof Error ? error : new Error(String(error)), {
      operation: 'x402-audit-log',
      trackId: event.trackId,
      eventType: event.eventType,
      correlationId: event.correlationId
    })
  }
}

/**
 * Get complete audit trail for a track's payment
 */
export async function getPaymentAuditTrail(
  supabase: SupabaseClient,
  trackId: string
): Promise<PaymentAuditTrail[]> {
  try {
    const { data, error } = await supabase
      .rpc('get_payment_audit_trail', { p_track_id: trackId })

    if (error) {
      throw new Error(`Failed to get payment audit trail: ${error.message}`)
    }

    return data || []
  } catch (error) {
    errorTracker.trackError(error instanceof Error ? error : new Error(String(error)), {
      operation: 'get-payment-audit-trail',
      trackId
    })
    
    logger.error('Failed to get payment audit trail', { trackId }, error instanceof Error ? error : new Error(String(error)))
    return []
  }
}

/**
 * Get payment statistics for monitoring
 */
export async function getPaymentStatistics(
  supabase: SupabaseClient,
  startDate?: Date
): Promise<PaymentStatistics | null> {
  try {
    const params = startDate ? { p_start_date: startDate.toISOString() } : {}
    const { data, error } = await supabase
      .rpc('get_payment_statistics', params)

    if (error) {
      throw new Error(`Failed to get payment statistics: ${error.message}`)
    }

    return data?.[0] || null
  } catch (error) {
    errorTracker.trackError(error instanceof Error ? error : new Error(String(error)), {
      operation: 'get-payment-statistics'
    })
    
    logger.error('Failed to get payment statistics', {}, error instanceof Error ? error : new Error(String(error)))
    return null
  }
}

/**
 * Helper functions for common audit events
 */

export async function auditChallengeCreated(
  supabase: SupabaseClient,
  trackId: string,
  challenge: {
    nonce: string
    amount: string
    asset: string
    chain: string
    expiresAt: string
  },
  correlationId: string
): Promise<void> {
  await logX402Event(supabase, {
    trackId,
    eventType: 'CHALLENGE_CREATED',
    challengeNonce: challenge.nonce,
    challengeAmount: challenge.amount,
    challengeAsset: challenge.asset,
    challengeChain: challenge.chain,
    challengeExpiresAt: challenge.expiresAt,
    correlationId
  })
}

export async function auditPaymentSubmitted(
  supabase: SupabaseClient,
  trackId: string,
  paymentProof: string,
  correlationId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<void> {
  await logX402Event(supabase, {
    trackId,
    eventType: 'PAYMENT_SUBMITTED',
    paymentProof: paymentProof.slice(0, 100), // Store only first 100 chars for security
    correlationId,
    userAgent,
    ipAddress
  })
}

export async function auditVerificationStarted(
  supabase: SupabaseClient,
  trackId: string,
  correlationId: string,
  attempt: number = 1
): Promise<void> {
  await logX402Event(supabase, {
    trackId,
    eventType: 'VERIFICATION_STARTED',
    verificationAttempts: attempt,
    correlationId
  })
}

export async function auditVerificationSuccess(
  supabase: SupabaseClient,
  trackId: string,
  transactionHash: string,
  blockNumber: number | undefined,
  durationMs: number,
  correlationId: string
): Promise<void> {
  await logX402Event(supabase, {
    trackId,
    eventType: 'VERIFICATION_SUCCESS',
    transactionHash,
    blockNumber,
    verificationDurationMs: durationMs,
    correlationId
  })
}

export async function auditVerificationFailed(
  supabase: SupabaseClient,
  trackId: string,
  errorMessage: string,
  durationMs: number,
  correlationId: string,
  attempts: number = 1
): Promise<void> {
  await logX402Event(supabase, {
    trackId,
    eventType: 'VERIFICATION_FAILED',
    errorMessage: errorMessage.slice(0, 500), // Truncate long error messages
    verificationDurationMs: durationMs,
    verificationAttempts: attempts,
    correlationId
  })
}

export async function auditPaymentConfirmed(
  supabase: SupabaseClient,
  trackId: string,
  transactionHash: string,
  correlationId: string
): Promise<void> {
  await logX402Event(supabase, {
    trackId,
    eventType: 'PAYMENT_CONFIRMED',
    transactionHash,
    correlationId
  })
}

export async function auditPaymentExpired(
  supabase: SupabaseClient,
  trackId: string,
  challengeNonce: string,
  correlationId: string
): Promise<void> {
  await logX402Event(supabase, {
    trackId,
    eventType: 'PAYMENT_EXPIRED',
    challengeNonce,
    correlationId
  })
}