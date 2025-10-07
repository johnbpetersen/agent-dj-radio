// src/config/env.client.ts
// Client-only environment configuration (browser-safe, no Node.js APIs)

import { z } from 'zod'

// Type guard for ZodError
function isZodError(err: unknown): err is z.ZodError {
  return !!err && typeof err === 'object' && 'issues' in err
}

// Helper validators
const urlSchema = z.string().url().transform(url => url.replace(/\/$/, '')) // Remove trailing slash
const jwtTokenSchema = z.string().min(10).refine(
  (val) => val.startsWith('eyJ') && val.includes('.'),
  { message: 'Must be a valid JWT token starting with eyJ and containing .' }
)

// Client environment schema (Vite import.meta.env - VITE_* only)
const clientSchema = z.object({
  VITE_SUPABASE_URL: urlSchema,
  VITE_SUPABASE_ANON_KEY: jwtTokenSchema,
})

// Environment validation and loading
function loadClientEnv() {
  try {
    return clientSchema.parse(import.meta.env)
  } catch (error) {
    console.error('❌ Client environment validation failed:')
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
    throw new Error('Client env validation failed; see above.')
  }
}

// Load and export environment configuration
export const clientEnv = loadClientEnv()
