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
      mode: 'facilitator' | 'cdp' | 'rpc-only' | 'mock' | 'none'
      facilitatorUrl: string | null
      hasCDPKeys: boolean
      binding: {
        required: boolean
        ttlSeconds: number
      }
      rpc?: {
        chain: string
        chainId: number
        tokenAddress: string
        rpcEndpoint: string
      }
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

  // Determine payment mode based on X402_MODE
  const hasCDPKeys = !!(serverEnv.CDP_API_KEY_ID && serverEnv.CDP_API_KEY_SECRET)

  // Debug logging to diagnose env var issues
  if (serverEnv.STAGE === 'dev') {
    console.log('[health] Debug payment config:', {
      X402_MODE: serverEnv.X402_MODE,
      X402_FACILITATOR_URL: serverEnv.X402_FACILITATOR_URL || 'MISSING',
      CDP_API_KEY_ID: serverEnv.CDP_API_KEY_ID ? `${serverEnv.CDP_API_KEY_ID.substring(0, 10)}...` : 'MISSING',
      CDP_API_KEY_SECRET: serverEnv.CDP_API_KEY_SECRET ? `${serverEnv.CDP_API_KEY_SECRET.substring(0, 10)}...` : 'MISSING',
      hasCDPKeys,
      ENABLE_X402: serverEnv.ENABLE_X402,
      ENABLE_MOCK_PAYMENTS: serverEnv.ENABLE_MOCK_PAYMENTS
    })
  }

  let paymentMode: 'facilitator' | 'cdp' | 'rpc-only' | 'mock' | 'none' = 'none'
  if (serverEnv.ENABLE_X402) {
    if (serverEnv.X402_MODE === 'rpc-only' && serverEnv.X402_TOKEN_ADDRESS) {
      paymentMode = 'rpc-only'
    } else if (serverEnv.X402_MODE === 'facilitator' && serverEnv.X402_FACILITATOR_URL) {
      paymentMode = 'facilitator'
    } else if (serverEnv.X402_MODE === 'cdp' && hasCDPKeys) {
      paymentMode = 'cdp'
    }
  } else if (serverEnv.ENABLE_MOCK_PAYMENTS) {
    paymentMode = 'mock'
  }

  // Build RPC info if in rpc-only mode
  let rpcInfo: HealthResponse['features']['x402']['rpc'] | undefined
  if (paymentMode === 'rpc-only' && serverEnv.X402_TOKEN_ADDRESS) {
    const chainId = serverEnv.X402_CHAIN_ID
    const rpcUrl = chainId === 8453
      ? serverEnv.BASE_MAINNET_RPC_URL
      : serverEnv.BASE_SEPOLIA_RPC_URL

    // Mask token address (show first 6 and last 4 chars)
    const maskedToken = serverEnv.X402_TOKEN_ADDRESS
      ? `${serverEnv.X402_TOKEN_ADDRESS.substring(0, 6)}...${serverEnv.X402_TOKEN_ADDRESS.substring(38)}`
      : '(not set)'

    // Mask RPC endpoint (show only hostname)
    const rpcHost = new URL(rpcUrl).hostname

    rpcInfo = {
      chain: serverEnv.X402_CHAIN,
      chainId,
      tokenAddress: maskedToken,
      rpcEndpoint: `${rpcHost} (masked)`
    }
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
        facilitatorUrl: serverEnv.X402_FACILITATOR_URL || null,
        hasCDPKeys,
        binding: {
          required: serverEnv.X402_REQUIRE_BINDING,
          ttlSeconds: serverEnv.BINDING_TTL_SECONDS
        },
        ...(rpcInfo && { rpc: rpcInfo }),
        // Expose chain and token info for frontend ERC-3009 signing
        ...(paymentMode === 'facilitator' && {
          chain: serverEnv.X402_CHAIN,
          chainId: serverEnv.X402_CHAIN_ID,
          tokenAddress: serverEnv.X402_TOKEN_ADDRESS,
          receivingAddress: serverEnv.X402_RECEIVING_ADDRESS,
          asset: serverEnv.X402_ACCEPTED_ASSET
        })
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