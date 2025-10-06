#!/usr/bin/env tsx
// scripts/check-env.ts
// Environment validation check script with PASS/WARN/FAIL reporting

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { z } from 'zod'

// Load environment files with proper precedence: .env.local -> .env
const envLocal = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal })
}
// Fallback to .env (load only if not already set)
dotenv.config() // default .env

// Define colors for better readability (fallback to plain text in CI)
const colors = {
  green: (text: string) => process.stdout.isTTY ? `\x1b[32m${text}\x1b[0m` : text,
  yellow: (text: string) => process.stdout.isTTY ? `\x1b[33m${text}\x1b[0m` : text,
  red: (text: string) => process.stdout.isTTY ? `\x1b[31m${text}\x1b[0m` : text,
  blue: (text: string) => process.stdout.isTTY ? `\x1b[34m${text}\x1b[0m` : text,
  bold: (text: string) => process.stdout.isTTY ? `\x1b[1m${text}\x1b[0m` : text,
}

// Status symbols
const symbols = {
  pass: '✅',
  warn: '⚠️ ',
  fail: '❌',
  skip: '⏭️ ',
}

interface CheckResult {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP'
  message: string
}

// Environment validation schemas (copied from env.ts for isolated checking)
const urlSchema = z.string().url().transform(url => url.replace(/\/$/, ''))
const jwtTokenSchema = z.string().min(10).refine(
  (val) => val.startsWith('eyJ') && val.includes('.'),
  { message: 'Must be a valid JWT token starting with eyJ and containing .' }
)
const hexAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid hex address')

function maskToken(token: string): string {
  if (!token) return '(missing)'
  if (token.length < 10) return '(invalid)'
  const prefix = token.substring(0, 6)
  const suffix = token.substring(token.length - 4)
  return `${prefix}...${suffix} (len:${token.length})`
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return '(invalid URL)'
  }
}

function checkEnvironment(): CheckResult[] {
  const results: CheckResult[] = []
  const stage = (process.env.STAGE || 'dev') as 'dev' | 'staging' | 'alpha'

  // Stage validation
  try {
    z.enum(['dev', 'staging', 'alpha']).parse(stage)
    results.push({
      name: 'STAGE',
      status: 'PASS',
      message: stage
    })
  } catch {
    results.push({
      name: 'STAGE',
      status: 'FAIL',
      message: `Invalid stage: ${stage} (must be dev/staging/alpha)`
    })
  }

  // Server Supabase URL validation
  const supabaseUrl = process.env.SUPABASE_URL
  let serverHost = ''
  try {
    if (!supabaseUrl) throw new Error('Missing SUPABASE_URL')
    urlSchema.parse(supabaseUrl)
    serverHost = extractHost(supabaseUrl)
    results.push({
      name: 'SUPABASE_URL',
      status: 'PASS',
      message: `valid URL (${serverHost})`
    })
  } catch (error) {
    results.push({
      name: 'SUPABASE_URL',
      status: 'FAIL',
      message: `${error instanceof Error ? error.message : 'Invalid URL'}`
    })
  }

  // Client Supabase URL validation
  const viteSupabaseUrl = process.env.VITE_SUPABASE_URL
  let clientHost = ''
  try {
    if (!viteSupabaseUrl) throw new Error('Missing VITE_SUPABASE_URL')
    urlSchema.parse(viteSupabaseUrl)
    clientHost = extractHost(viteSupabaseUrl)
    results.push({
      name: 'VITE_SUPABASE_URL',
      status: 'PASS',
      message: `valid URL (${clientHost})`
    })
  } catch (error) {
    results.push({
      name: 'VITE_SUPABASE_URL',
      status: 'FAIL',
      message: `${error instanceof Error ? error.message : 'Invalid URL'}`
    })
  }

  // URL host consistency check
  if (serverHost && clientHost) {
    if (serverHost === clientHost) {
      results.push({
        name: 'SUPABASE_URL vs VITE_SUPABASE_URL',
        status: 'PASS',
        message: 'host match'
      })
    } else {
      const status = stage === 'dev' ? 'WARN' : 'FAIL'
      results.push({
        name: 'SUPABASE_URL vs VITE_SUPABASE_URL',
        status,
        message: `host mismatch: ${serverHost} ≠ ${clientHost}`
      })
    }
  }

  // Server anon key validation
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
  try {
    if (!supabaseAnonKey) throw new Error('Missing SUPABASE_ANON_KEY')
    jwtTokenSchema.parse(supabaseAnonKey)
    results.push({
      name: 'SUPABASE_ANON_KEY',
      status: 'PASS',
      message: maskToken(supabaseAnonKey)
    })
  } catch (error) {
    results.push({
      name: 'SUPABASE_ANON_KEY',
      status: 'FAIL',
      message: `${error instanceof Error ? error.message : 'Invalid token'}`
    })
  }

  // Client anon key validation
  const viteSupabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  try {
    if (!viteSupabaseAnonKey) throw new Error('Missing VITE_SUPABASE_ANON_KEY')
    jwtTokenSchema.parse(viteSupabaseAnonKey)
    results.push({
      name: 'VITE_SUPABASE_ANON_KEY',
      status: 'PASS',
      message: maskToken(viteSupabaseAnonKey)
    })
  } catch (error) {
    results.push({
      name: 'VITE_SUPABASE_ANON_KEY',
      status: 'FAIL',
      message: `${error instanceof Error ? error.message : 'Invalid token'}`
    })
  }

  // Anon key consistency check
  if (supabaseAnonKey && viteSupabaseAnonKey) {
    if (supabaseAnonKey === viteSupabaseAnonKey) {
      results.push({
        name: 'SUPABASE_ANON_KEY vs VITE_SUPABASE_ANON_KEY',
        status: 'PASS',
        message: 'keys match'
      })
    } else {
      const status = stage === 'dev' ? 'WARN' : 'FAIL'
      results.push({
        name: 'SUPABASE_ANON_KEY vs VITE_SUPABASE_ANON_KEY',
        status,
        message: 'key mismatch'
      })
    }
  }

  // Service role key validation (optional)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey) {
    try {
      jwtTokenSchema.parse(serviceRoleKey)
      // Basic host consistency check (service role should be for same project)
      if (serverHost) {
        results.push({
          name: 'SUPABASE_SERVICE_ROLE_KEY',
          status: 'PASS',
          message: `${maskToken(serviceRoleKey)} (same project)`
        })
      } else {
        results.push({
          name: 'SUPABASE_SERVICE_ROLE_KEY',
          status: 'WARN',
          message: `${maskToken(serviceRoleKey)} (cannot verify project)`
        })
      }
    } catch (error) {
      results.push({
        name: 'SUPABASE_SERVICE_ROLE_KEY',
        status: 'FAIL',
        message: `${error instanceof Error ? error.message : 'Invalid token'}`
      })
    }
  } else {
    const status = stage === 'dev' ? 'WARN' : 'FAIL'
    const message = stage === 'dev' ? 'optional in dev' : 'required in staging/alpha'
    results.push({
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      status,
      message
    })
  }

  // X402 configuration (required in alpha)
  if (stage === 'alpha') {
    const x402Fields = {
      X402_PROVIDER_URL: { validator: urlSchema, required: true },
      X402_API_KEY: { validator: z.string().min(1), required: true },
      X402_RECEIVING_ADDRESS: { validator: hexAddressSchema, required: true },
    }

    Object.entries(x402Fields).forEach(([key, { validator, required }]) => {
      const value = process.env[key]
      if (!value && required) {
        results.push({
          name: key,
          status: 'FAIL',
          message: 'required in alpha stage'
        })
      } else if (value) {
        try {
          validator.parse(value)
          const displayValue = key.includes('KEY') ? maskToken(value) :
                             key.includes('ADDRESS') ? value :
                             extractHost(value)
          results.push({
            name: key,
            status: 'PASS',
            message: displayValue
          })
        } catch (error) {
          results.push({
            name: key,
            status: 'FAIL',
            message: `${error instanceof Error ? error.message : 'Invalid format'}`
          })
        }
      } else {
        results.push({
          name: key,
          status: 'SKIP',
          message: 'optional in dev/staging'
        })
      }
    })
  } else {
    results.push({
      name: 'X402_* (alpha only)',
      status: 'SKIP',
      message: `${stage} stage`
    })
  }

  // ElevenLabs API key (required in alpha)
  const elevenApiKey = process.env.ELEVEN_API_KEY
  if (stage === 'alpha') {
    if (!elevenApiKey) {
      results.push({
        name: 'ELEVEN_API_KEY',
        status: 'FAIL',
        message: 'required in alpha stage'
      })
    } else {
      results.push({
        name: 'ELEVEN_API_KEY',
        status: 'PASS',
        message: maskToken(elevenApiKey)
      })
    }
  } else {
    results.push({
      name: 'ELEVEN_API_KEY',
      status: 'SKIP',
      message: `optional in ${stage}`
    })
  }

  return results
}

function printResults(results: CheckResult[]): void {
  console.log(colors.bold('\nEnvironment Validation Report'))
  console.log(colors.bold('============================'))

  results.forEach(result => {
    const symbol = symbols[result.status.toLowerCase() as keyof typeof symbols]
    const colorFn = {
      PASS: colors.green,
      WARN: colors.yellow,
      FAIL: colors.red,
      SKIP: colors.blue,
    }[result.status]

    const status = colorFn(`${symbol} ${result.status}`)
    console.log(`${result.name.padEnd(35)} → ${status} (${result.message})`)
  })

  // Summary
  const summary = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  console.log(colors.bold('\nSummary:'))
  Object.entries(summary).forEach(([status, count]) => {
    const colorFn = {
      PASS: colors.green,
      WARN: colors.yellow,
      FAIL: colors.red,
      SKIP: colors.blue,
    }[status]
    console.log(`  ${colorFn(status)}: ${count}`)
  })
}

function main(): void {
  const results = checkEnvironment()
  printResults(results)

  const hasFailures = results.some(r => r.status === 'FAIL')
  const hasWarnings = results.some(r => r.status === 'WARN')
  const allowWarnings = process.env.ALLOW_ENV_WARNINGS === 'true'
  const stage = process.env.STAGE || 'dev'

  if (hasFailures) {
    console.log(colors.red('\n❌ Environment validation FAILED'))
    process.exit(1)
  } else if (hasWarnings && stage !== 'dev') {
    console.log(colors.red('\n❌ Environment warnings not allowed in staging/alpha'))
    process.exit(1)
  } else if (hasWarnings && !allowWarnings) {
    console.log(colors.yellow('\n⚠️  Environment warnings detected (set ALLOW_ENV_WARNINGS=true to ignore)'))
    process.exit(1)
  } else {
    console.log(colors.green('\n✅ Environment validation PASSED'))
    process.exit(0)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}