// src/config/env.server.ts
// Server-only environment configuration (Node.js APIs allowed)

// Load .env first, then .env.local with override (correct precedence)
import path from 'node:path'
import dotenv from 'dotenv'

// 1. Load .env first (base config)
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: false })

// 2. Load .env.local second (overrides .env values)
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true })

import { z } from 'zod'

// Type guard for ZodError
function isZodError(err: unknown): err is z.ZodError {
  return !!err && typeof err === 'object' && 'issues' in err
}

// Environment stage detection
const STAGE = (process.env.STAGE || 'dev') as 'dev' | 'staging' | 'alpha'

// Helper validators
const urlSchema = z.string().url().transform(url => url.replace(/\/$/, '')) // Remove trailing slash
const jwtTokenSchema = z.string().min(10).refine(
  (val) => val.startsWith('eyJ') && val.includes('.'),
  { message: 'Must be a valid JWT token starting with eyJ and containing .' }
)
const hexAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid hex address')

// Custom boolean parser that handles string "false" correctly
// z.coerce.boolean() converts ALL non-empty strings to true, even "false"!
const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((val) => {
    if (typeof val === 'boolean') return val
    const lower = val.toLowerCase().trim()
    if (lower === 'true' || lower === '1') return true
    if (lower === 'false' || lower === '0' || lower === '') return false
    // Any other string treated as truthy
    return Boolean(val)
  })

// Server environment schema (Node.js process.env)
const serverSchema = z.object({
  // Core configuration
  STAGE: z.enum(['dev', 'staging', 'alpha']).default('dev'),

  // Supabase server config
  SUPABASE_URL: urlSchema,
  SUPABASE_ANON_KEY: jwtTokenSchema,
  SUPABASE_SERVICE_ROLE_KEY: jwtTokenSchema.optional(),

  // Feature flags
  ENABLE_MOCK_PAYMENTS: booleanFromString.default(STAGE === 'dev'),
  ENABLE_X402: booleanFromString.default(STAGE === 'alpha'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // X402 configuration (required in alpha)
  X402_PROVIDER_URL: urlSchema.optional(),
  X402_API_KEY: z.string().optional(),
  X402_CHAIN: z.string().default('base-sepolia'),
  X402_ACCEPTED_ASSET: z.string().default('USDC'),
  X402_RECEIVING_ADDRESS: hexAddressSchema.optional(),

  // ElevenLabs configuration (required in alpha)
  ELEVEN_API_KEY: z.string().optional(),

  // Optional features
  ADMIN_TOKEN: z.string().optional(),
  ALLOW_ENV_WARNINGS: booleanFromString.default(false),
}).refine((data) => {
  // Stage-specific validations
  if (data.STAGE === 'alpha') {
    const required = {
      X402_PROVIDER_URL: data.X402_PROVIDER_URL,
      X402_API_KEY: data.X402_API_KEY,
      X402_RECEIVING_ADDRESS: data.X402_RECEIVING_ADDRESS,
      ELEVEN_API_KEY: data.ELEVEN_API_KEY,
    }

    const missing = Object.entries(required)
      .filter(([_, value]) => !value)
      .map(([key]) => key)

    if (missing.length > 0) {
      throw new Error(`Alpha stage requires: ${missing.join(', ')}`)
    }
  }

  return true
})

// Environment validation and loading
function loadServerEnv() {
  try {
    return serverSchema.parse(process.env)
  } catch (error) {
    console.error('❌ Server environment validation failed:')
    if (isZodError(error)) {
      error.issues.forEach(issue => {
        const fieldPath = issue.path.join('.') || '(root)'
        console.error(`  ${fieldPath}: ${issue.message}`)
      })
    } else if (error instanceof Error) {
      console.error(`  ${error.name}: ${error.message}`)
    } else {
      console.error(`  ${String(error)}`)
    }
    throw new Error('Server env validation failed; see above.')
  }
}

// Token masking utility for secure logging
export function maskToken(token: string): string {
  if (!token) return '(missing)'
  if (token.length < 10) return '(invalid)'

  const prefix = token.substring(0, 6)
  const suffix = token.substring(token.length - 4)
  return `${prefix}...${suffix} (len:${token.length})`
}

// URL host extraction utility
export function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return '(invalid URL)'
  }
}

// Load and export environment configuration
export const serverEnv = loadServerEnv()

// Stage helpers
export const isDev = serverEnv.STAGE === 'dev'
export const isStaging = serverEnv.STAGE === 'staging'
export const isAlpha = serverEnv.STAGE === 'alpha'
export const isProduction = isStaging || isAlpha

// Debug logging for x402 feature flags (only when LOG_LEVEL=debug)
if (serverEnv.LOG_LEVEL === 'debug') {
  console.log('[env] x402 feature flags:', {
    x402Enabled: serverEnv.ENABLE_X402,
    mockEnabled: serverEnv.ENABLE_MOCK_PAYMENTS,
    stage: serverEnv.STAGE
  })
}
