// api/wallet/prove.ts
// Wallet binding endpoint for RPC-only mode
// Verifies wallet ownership via signature and binds address to challenge

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z, ZodError } from 'zod'
import { recoverMessageAddress } from 'viem'
import { supabaseAdmin } from '../_shared/supabase.js'
import { serverEnv } from '../../src/config/env.server.js'
import { logger, generateCorrelationId } from '../../src/lib/logger.js'
import { errorTracker } from '../../src/lib/error-tracking.js'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'
import { normalizeEvmAddress } from '../../src/lib/binding-utils.js'
import { validateBindingMessageV1, maskForLogging } from '../../src/shared/binding-message.js'

// Request validation schema
const proveRequestSchema = z.object({
  challengeId: z.string().uuid('Invalid challenge ID format'),
  message: z.string().min(1, 'Message is required'),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/, 'Invalid signature format')
})

async function proveHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const requestId = generateCorrelationId()
  const startTime = Date.now()

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed', requestId })
    return
  }

  logger.info('wallet/prove request received', { requestId })

  try {
    // Validate request body
    let challengeId: string
    let message: string
    let signature: string

    try {
      const parsed = proveRequestSchema.parse(req.body)
      challengeId = parsed.challengeId
      message = parsed.message
      signature = parsed.signature as `0x${string}`
    } catch (error) {
      if (error instanceof ZodError) {
        const fields = error.issues.map(issue => ({
          path: issue.path.join('.') || 'body',
          message: issue.message
        }))

        logger.warn('wallet/prove validation failed', {
          requestId,
          fields: fields.map(f => `${f.path}: ${f.message}`).join(', ')
        })

        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            fields
          },
          requestId
        })
        return
      }

      throw error
    }

    logger.info('wallet/prove processing', { requestId, challengeId })

    // 1. Load challenge from database
    const { data: challenge, error: challengeErr } = await supabaseAdmin
      .from('payment_challenges')
      .select('*')
      .eq('challenge_id', challengeId)
      .single()

    if (challengeErr || !challenge) {
      logger.warn('wallet/prove challenge not found', { requestId, challengeId })
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payment challenge not found or expired'
        },
        requestId
      })
      return
    }

    // 2. Check challenge not expired
    const now = new Date()
    const expiresAt = new Date(challenge.expires_at)

    if (now > expiresAt) {
      logger.warn('wallet/prove challenge expired', {
        requestId,
        challengeId,
        expiresAt: challenge.expires_at
      })

      res.status(400).json({
        error: {
          code: 'EXPIRED',
          message: 'Payment challenge has expired. Please refresh and try again.'
        },
        requestId
      })
      return
    }

    // 3. Validate message format and TTL
    let parsed: ReturnType<typeof validateBindingMessageV1>
    try {
      // Use shared parser with clock skew tolerance (±120s)
      parsed = validateBindingMessageV1(message, challengeId, 120)

      // Log message diagnostics
      const masked = maskForLogging(parsed)
      logger.info('wallet/prove message diagnostics', {
        requestId,
        challengeId: masked.challengeIdMasked,
        lineEnding: masked.lineEnding,
        lineCount: masked.lineCount,
        hasTrailingNewline: masked.hasTrailingNewline
      })

      logger.info('wallet/prove parsed message', {
        requestId,
        ...masked
      })

      // Additional TTL check: ensure (ts + ttl) hasn't passed serverEnv.BINDING_TTL_SECONDS
      const nowUnix = Math.floor(Date.now() / 1000)
      const age = nowUnix - parsed.ts
      const remaining = parsed.ttl - age

      if (remaining < 0) {
        throw new Error(
          `Message expired: issued ${age}s ago with ttl=${parsed.ttl}s`
        )
      }

      logger.info('wallet/prove TTL check', {
        requestId,
        age,
        ttl: parsed.ttl,
        remaining,
        maxTtl: serverEnv.BINDING_TTL_SECONDS
      })

    } catch (error: any) {
      logger.warn('wallet/prove message validation failed', {
        requestId,
        challengeId,
        error: error.message
      })

      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          hint: 'Message must be recent and match expected format (v1)'
        },
        requestId
      })
      return
    }

    // 4. Recover address from signature
    let recoveredAddress: string
    try {
      const recovered = await recoverMessageAddress({
        message,
        signature: signature as `0x${string}`
      })
      recoveredAddress = normalizeEvmAddress(recovered)

      logger.info('wallet/prove signature verified', {
        requestId,
        challengeId,
        address: `${recoveredAddress.slice(0, 6)}...${recoveredAddress.slice(-4)}`
      })
    } catch (error: any) {
      logger.warn('wallet/prove signature recovery failed', {
        requestId,
        challengeId,
        error: error.message
      })

      res.status(400).json({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Invalid signature. Please try signing again.',
          detail: error.message
        },
        requestId
      })
      return
    }

    // 5. Update challenge with bound address
    const { error: updateErr } = await supabaseAdmin
      .from('payment_challenges')
      .update({
        bound_address: recoveredAddress,
        bound_at: new Date().toISOString(),
        bound_message: message,
        bound_signature: signature
      })
      .eq('challenge_id', challengeId)

    if (updateErr) {
      logger.error('wallet/prove failed to update challenge', {
        requestId,
        challengeId,
        error: updateErr
      })

      res.status(500).json({
        error: {
          code: 'DB_ERROR',
          message: 'Failed to bind wallet address'
        },
        requestId
      })
      return
    }

    const durationMs = Date.now() - startTime

    logger.info('wallet/prove success', {
      requestId,
      challengeId,
      address: `${recoveredAddress.slice(0, 6)}...${recoveredAddress.slice(-4)}`,
      durationMs
    })

    // 6. Return success with bound address
    res.status(200).json({
      ok: true,
      address: recoveredAddress,
      requestId
    })

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    errorTracker.trackError(err, { operation: 'wallet/prove', requestId })
    logger.error('wallet/prove unhandled error', { requestId }, err)

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          code: 'INTERNAL',
          message: 'Internal server error during wallet binding'
        },
        requestId
      })
    }
  }
}

export default secureHandler(proveHandler, securityConfigs.user)
