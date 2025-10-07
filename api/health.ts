// api/health.ts
// Minimal health check endpoint with env and Supabase connectivity checks
/**
 * IMPORTANT: features.x402 is sourced from serverEnv (src/config/env.server.ts).
 * Do not read process.env directly - it bypasses our custom boolean parsing
 * and .env.local override logic. Always use serverEnv.ENABLE_X402 and
 * serverEnv.ENABLE_MOCK_PAYMENTS.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '../src/config/env.server.js'
import { secureHandler, securityConfigs } from './_shared/secure-handler.js'
import crypto from 'crypto'

interface HealthResponse {
  ok: boolean
  stage: string
  checks: {
    env: 'ok' | 'fail'
    supabase: {
      status: 'ok' | 'fail'
      latencyMs?: number
      error?: string
    }
    timeSkewMs: number
  }
  features: {
    x402: {
      enabled: boolean
      mockEnabled: boolean
      mode: 'cdp' | 'mock' | 'none'
      hasCDPKeys: boolean
    }
  }
  requestId: string
}

async function healthHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const requestId = crypto.randomUUID()

  // Only GET allowed
  if (req.method !== 'GET') {
    res.setHeader('X-Request-Id', requestId)
    return res.status(405).json({ error: 'Method not allowed', requestId })
  }

  let supabaseCheck: HealthResponse['checks']['supabase'] = { status: 'fail' }
  let timeSkewMs = 0

  // Env check: If we got here, env is valid (env.ts would have thrown on import)
  const envCheck: 'ok' | 'fail' = 'ok'

  // Supabase connectivity check with timeout
  try {
    // Create a lightweight client using anon key (not service role)
    const supabase = createClient(
      serverEnv.SUPABASE_URL,
      serverEnv.SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    )

    // Simple query with 800ms timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 800)

    try {
      const queryStart = Date.now()

      // Lightweight query - just check connectivity
      const { error } = await supabase
        .from('tracks')
        .select('id')
        .limit(1)
        .abortSignal(controller.signal)

      clearTimeout(timeoutId)
      const latencyMs = Date.now() - queryStart

      if (error) {
        supabaseCheck = {
          status: 'fail',
          latencyMs,
          error: error.message
        }
      } else {
        supabaseCheck = {
          status: 'ok',
          latencyMs
        }
      }

      // Measure time skew (server time vs current time)
      timeSkewMs = Math.abs(Date.now() - queryStart - latencyMs)

    } catch (err) {
      clearTimeout(timeoutId)
      const error = err as Error
      supabaseCheck = {
        status: 'fail',
        error: error.name === 'AbortError' ? 'timeout' : error.message
      }
    }

  } catch (err) {
    const error = err as Error
    supabaseCheck = {
      status: 'fail',
      error: error.message || 'client creation failed'
    }
  }

  // Overall health is OK if env is ok (supabase can be degraded)
  const ok = envCheck === 'ok'

  // Determine payment mode
  const hasCDPKeys = !!(serverEnv.CDP_API_KEY_ID && serverEnv.CDP_API_KEY_SECRET && serverEnv.X402_PROVIDER_URL)

  // Debug logging to diagnose env var issues
  if (serverEnv.STAGE === 'dev') {
    console.log('[health] Debug CDP keys check:', {
      CDP_API_KEY_ID: serverEnv.CDP_API_KEY_ID ? `${serverEnv.CDP_API_KEY_ID.substring(0, 10)}...` : 'MISSING',
      CDP_API_KEY_SECRET: serverEnv.CDP_API_KEY_SECRET ? `${serverEnv.CDP_API_KEY_SECRET.substring(0, 10)}...` : 'MISSING',
      X402_PROVIDER_URL: serverEnv.X402_PROVIDER_URL || 'MISSING',
      hasCDPKeys,
      ENABLE_X402: serverEnv.ENABLE_X402,
      ENABLE_MOCK_PAYMENTS: serverEnv.ENABLE_MOCK_PAYMENTS
    })
  }

  let paymentMode: 'cdp' | 'mock' | 'none' = 'none'
  if (serverEnv.ENABLE_X402 && hasCDPKeys) {
    paymentMode = 'cdp'
  } else if (serverEnv.ENABLE_MOCK_PAYMENTS) {
    paymentMode = 'mock'
  }

  const response: HealthResponse = {
    ok,
    stage: serverEnv.STAGE,
    checks: {
      env: envCheck,
      supabase: supabaseCheck,
      timeSkewMs
    },
    features: {
      x402: {
        enabled: serverEnv.ENABLE_X402,
        mockEnabled: serverEnv.ENABLE_MOCK_PAYMENTS,
        mode: paymentMode,
        hasCDPKeys
      }
    },
    requestId
  }

  res.setHeader('X-Request-Id', requestId)

  // Cache control: disable caching in dev to avoid confusion during testing
  if (serverEnv.STAGE === 'dev') {
    res.setHeader('Cache-Control', 'no-store')
  } else {
    res.setHeader('Cache-Control', 'public, max-age=60') // Cache for 1 minute
  }

  res.status(200).json(response)
}

export default secureHandler(healthHandler, securityConfigs.public)