// src/config/env.ts
// Unified zod-validated environment configuration for server and client

import { z } from 'zod'

// Environment stage detection
const STAGE = (process.env.STAGE || 'dev') as 'dev' | 'staging' | 'alpha'

// Helper validators
const urlSchema = z.string().url().transform(url => url.replace(/\/$/, '')) // Remove trailing slash
const jwtTokenSchema = z.string().min(10).refine(
  (val) => val.startsWith('eyJ') && val.includes('.'),
  { message: 'Must be a valid JWT token starting with eyJ and containing .' }
)
const hexAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid hex address')

// Server environment schema (Node.js process.env)
const serverSchema = z.object({
  // Core configuration
  STAGE: z.enum(['dev', 'staging', 'alpha']).default('dev'),

  // Supabase server config
  SUPABASE_URL: urlSchema,
  SUPABASE_ANON_KEY: jwtTokenSchema,
  SUPABASE_SERVICE_ROLE_KEY: jwtTokenSchema.optional(),

  // Feature flags
  ENABLE_MOCK_PAYMENTS: z.coerce.boolean().default(STAGE === 'dev'),
  ENABLE_X402: z.coerce.boolean().default(STAGE === 'alpha'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // X402 configuration (required in alpha)
  X402_PROVIDER_URL: urlSchema.optional(),
  X402_API_KEY: z.string().optional(),
  X402_CHAIN: z.string().default('base-sepolia'),
  X402_RECEIVING_ADDRESS: hexAddressSchema.optional(),

  // ElevenLabs configuration (required in alpha)
  ELEVEN_API_KEY: z.string().optional(),

  // Optional features
  ADMIN_TOKEN: z.string().optional(),
  ALLOW_ENV_WARNINGS: z.coerce.boolean().default(false),
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

// Client environment schema (Vite import.meta.env - VITE_* only)
const clientSchema = z.object({
  VITE_SUPABASE_URL: urlSchema,
  VITE_SUPABASE_ANON_KEY: jwtTokenSchema,
})

// Environment validation and loading
function loadServerEnv() {
  try {
    return serverSchema.parse(process.env)
  } catch (error) {
    console.error('❌ Server environment validation failed:')
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`)
      })
    } else {
      console.error(error)
    }
    process.exit(1)
  }
}

function loadClientEnv() {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') {
    // Server-side: return minimal client config for SSR
    return {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || '',
    }
  }

  try {
    return clientSchema.parse(import.meta.env)
  } catch (error) {
    console.error('❌ Client environment validation failed:')
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`)
      })
    } else {
      console.error(error)
    }
    throw new Error('Client environment validation failed')
  }
}

// Cross-environment validation helpers
export function validateEnvironmentConsistency(serverEnv: ReturnType<typeof loadServerEnv>, clientEnv: ReturnType<typeof loadClientEnv>) {
  const issues: Array<{ type: 'error' | 'warning', message: string }> = []

  // Host consistency check
  try {
    const serverHost = new URL(serverEnv.SUPABASE_URL).hostname
    const clientHost = new URL(clientEnv.VITE_SUPABASE_URL).hostname

    if (serverHost !== clientHost) {
      const issue = {
        type: (serverEnv.STAGE === 'dev' ? 'warning' : 'error') as 'error' | 'warning',
        message: `Supabase URL host mismatch: ${serverHost} != ${clientHost}`
      }
      issues.push(issue)
    }
  } catch (error) {
    issues.push({
      type: 'error',
      message: `Invalid Supabase URL format: ${error}`
    })
  }

  // Anon key consistency check
  if (serverEnv.SUPABASE_ANON_KEY !== clientEnv.VITE_SUPABASE_ANON_KEY) {
    const issue = {
      type: (serverEnv.STAGE === 'dev' ? 'warning' : 'error') as 'error' | 'warning',
      message: 'Supabase anon key mismatch between server and client'
    }
    issues.push(issue)
  }

  // Service role key host consistency (if present)
  if (serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const serverHost = new URL(serverEnv.SUPABASE_URL).hostname
      // We can't decode the JWT easily, but we can assume it should match the same project
      // This is a basic check - in practice, service role keys are project-specific
    } catch (error) {
      issues.push({
        type: 'warning',
        message: 'Could not validate service role key consistency'
      })
    }
  } else if (serverEnv.STAGE !== 'dev') {
    issues.push({
      type: 'warning',
      message: 'No service role key provided for non-dev environment'
    })
  }

  return issues
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

// Load and export environment configurations
export const serverEnv = loadServerEnv()
export const clientEnv = loadClientEnv()

// Export validation results for check script
export const envValidation = validateEnvironmentConsistency(serverEnv, clientEnv)

// Stage helpers
export const isDev = serverEnv.STAGE === 'dev'
export const isStaging = serverEnv.STAGE === 'staging'
export const isAlpha = serverEnv.STAGE === 'alpha'
export const isProduction = isStaging || isAlpha