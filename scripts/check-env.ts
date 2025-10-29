#!/usr/bin/env tsx
// scripts/check-env.ts
// Hardened environment validation with x402 payment guardrails

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { z } from 'zod'

// Load environment files with proper precedence: .env.local -> .env
const envLocal = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal })
}
dotenv.config() // Fallback to .env

// ============================================================================
// HELPERS
// ============================================================================

const colors = {
  green: (text: string) => process.stdout.isTTY ? `\x1b[32m${text}\x1b[0m` : text,
  yellow: (text: string) => process.stdout.isTTY ? `\x1b[33m${text}\x1b[0m` : text,
  red: (text: string) => process.stdout.isTTY ? `\x1b[31m${text}\x1b[0m` : text,
  blue: (text: string) => process.stdout.isTTY ? `\x1b[34m${text}\x1b[0m` : text,
  bold: (text: string) => process.stdout.isTTY ? `\x1b[1m${text}\x1b[0m` : text,
}

const symbols = {
  pass: '✅',
  warn: '⚠️ ',
  fail: '❌',
  skip: '⏭️ ',
}

const bool = (v?: string) => v === 'true'
const isAddr = (v?: string) => /^0x[a-fA-F0-9]{40}$/.test(v ?? '')
const isHex = (v?: string, n?: number) =>
  new RegExp(`^0x[0-9a-fA-F]{${n ?? 64}}$`).test(v ?? '')

interface CheckResult {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP'
  message: string
}

// Schemas
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

// ============================================================================
// X402 VALIDATION (triggered when enabled, not by stage)
// ============================================================================

function checkX402(results: CheckResult[]): void {
  const x402Enabled = bool(process.env.ENABLE_X402) || (process.env.X402_MODE ?? '').length > 0

  if (!x402Enabled) {
    results.push({
      name: 'X402 Payments',
      status: 'SKIP',
      message: 'disabled (ENABLE_X402=false)'
    })
    return
  }

  // X402 is enabled - validate all required config
  results.push({
    name: 'X402 Payments',
    status: 'PASS',
    message: 'enabled - validating configuration...'
  })

  // 1. Facilitator URL (must include ://)
  const facilitatorUrl = process.env.X402_FACILITATOR_URL
  if (!facilitatorUrl || !facilitatorUrl.includes('://')) {
    results.push({
      name: 'X402_FACILITATOR_URL',
      status: 'FAIL',
      message: 'required when x402 enabled (must include ://)'
    })
  } else {
    try {
      urlSchema.parse(facilitatorUrl)
      results.push({
        name: 'X402_FACILITATOR_URL',
        status: 'PASS',
        message: extractHost(facilitatorUrl)
      })
    } catch {
      results.push({
        name: 'X402_FACILITATOR_URL',
        status: 'FAIL',
        message: 'invalid URL format'
      })
    }
  }

  // 2. Settlement strategy validation
  const settleStrategy = process.env.X402_SETTLE_STRATEGY || 'auto'
  const validStrategies = ['auto', 'local', 'facilitator']
  if (!validStrategies.includes(settleStrategy)) {
    results.push({
      name: 'X402_SETTLE_STRATEGY',
      status: 'FAIL',
      message: `invalid: ${settleStrategy} (must be auto|local|facilitator)`
    })
  } else {
    results.push({
      name: 'X402_SETTLE_STRATEGY',
      status: 'PASS',
      message: settleStrategy
    })
  }

  // 3. Settler private key (required for auto/local)
  const settlerKey = process.env.SETTLER_PRIVATE_KEY
  if (settleStrategy === 'auto' || settleStrategy === 'local') {
    if (!settlerKey) {
      results.push({
        name: 'SETTLER_PRIVATE_KEY',
        status: 'FAIL',
        message: `required for strategy=${settleStrategy}`
      })
    } else if (!isHex(settlerKey, 64)) {
      results.push({
        name: 'SETTLER_PRIVATE_KEY',
        status: 'FAIL',
        message: 'invalid format (expected 0x + 64 hex chars)'
      })
    } else {
      // Derive address and verify not zero
      try {
        const { privateKeyToAccount } = require('viem/accounts')
        const account = privateKeyToAccount(settlerKey as `0x${string}`)
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

        if (account.address.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
          results.push({
            name: 'SETTLER_PRIVATE_KEY',
            status: 'FAIL',
            message: 'derives to zero address (invalid key)'
          })
        } else {
          results.push({
            name: 'SETTLER_PRIVATE_KEY',
            status: 'PASS',
            message: `present → ${account.address.substring(0, 10)}...`
          })
        }
      } catch (err: any) {
        results.push({
          name: 'SETTLER_PRIVATE_KEY',
          status: 'FAIL',
          message: `failed to derive address: ${err?.message}`
        })
      }
    }
  } else {
    if (settlerKey) {
      results.push({
        name: 'SETTLER_PRIVATE_KEY',
        status: 'WARN',
        message: `present but unused with strategy=${settleStrategy}`
      })
    } else {
      results.push({
        name: 'SETTLER_PRIVATE_KEY',
        status: 'SKIP',
        message: `not required for strategy=${settleStrategy}`
      })
    }
  }

  // 4. Chain validation
  const chain = process.env.X402_CHAIN || 'base'
  const validChains = ['base', 'base-sepolia']
  if (!validChains.includes(chain)) {
    results.push({
      name: 'X402_CHAIN',
      status: 'FAIL',
      message: `invalid: ${chain} (must be base|base-sepolia)`
    })
  } else {
    results.push({
      name: 'X402_CHAIN',
      status: 'PASS',
      message: chain
    })

    // 4a. If base, validate USDC contract address
    if (chain === 'base') {
      const usdcContract = process.env.USDC_CONTRACT_ADDRESS_BASE
      const MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

      if (!usdcContract) {
        results.push({
          name: 'USDC_CONTRACT_ADDRESS_BASE',
          status: 'FAIL',
          message: 'required for chain=base'
        })
      } else if (!isAddr(usdcContract)) {
        results.push({
          name: 'USDC_CONTRACT_ADDRESS_BASE',
          status: 'FAIL',
          message: 'invalid address format'
        })
      } else if (usdcContract.toLowerCase() !== MAINNET_USDC.toLowerCase()) {
        results.push({
          name: 'USDC_CONTRACT_ADDRESS_BASE',
          status: 'FAIL',
          message: `address mismatch (expected Base mainnet USDC: ${MAINNET_USDC})`
        })
      } else {
        results.push({
          name: 'USDC_CONTRACT_ADDRESS_BASE',
          status: 'PASS',
          message: `${usdcContract.substring(0, 10)}... (Base mainnet)`
        })
      }
    }
  }

  // 5. RPC URL (optional but recommended)
  const baseRpcUrl = process.env.BASE_MAINNET_RPC_URL
  if (!baseRpcUrl) {
    results.push({
      name: 'BASE_MAINNET_RPC_URL',
      status: 'WARN',
      message: 'not set (will use public RPC: https://mainnet.base.org)'
    })
  } else {
    try {
      urlSchema.parse(baseRpcUrl)
      results.push({
        name: 'BASE_MAINNET_RPC_URL',
        status: 'PASS',
        message: extractHost(baseRpcUrl)
      })
    } catch {
      results.push({
        name: 'BASE_MAINNET_RPC_URL',
        status: 'FAIL',
        message: 'invalid URL format'
      })
    }
  }

  // 6. Receiving address (treasury)
  const receivingAddr = process.env.X402_RECEIVING_ADDRESS
  if (!receivingAddr) {
    results.push({
      name: 'X402_RECEIVING_ADDRESS',
      status: 'FAIL',
      message: 'required (payment treasury address)'
    })
  } else if (!isAddr(receivingAddr)) {
    results.push({
      name: 'X402_RECEIVING_ADDRESS',
      status: 'FAIL',
      message: 'invalid address format (expected 0x + 40 hex chars)'
    })
  } else {
    // Check for non-zero (but allow since it's syntactically valid)
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
    if (receivingAddr.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
      results.push({
        name: 'X402_RECEIVING_ADDRESS',
        status: 'WARN',
        message: `${receivingAddr} (zero address - is this intentional?)`
      })
    } else {
      results.push({
        name: 'X402_RECEIVING_ADDRESS',
        status: 'PASS',
        message: `${receivingAddr.substring(0, 10)}...`
      })
    }
  }

  // 7. Accepted asset
  const asset = (process.env.X402_ACCEPTED_ASSET || '').toUpperCase()
  if (asset !== 'USDC') {
    results.push({
      name: 'X402_ACCEPTED_ASSET',
      status: 'FAIL',
      message: `must be USDC (got: ${asset || '(empty)'})`
    })
  } else {
    results.push({
      name: 'X402_ACCEPTED_ASSET',
      status: 'PASS',
      message: 'USDC'
    })
  }

  // 8. Facilitator settle URL (optional)
  const facilitatorSettleUrl = process.env.FACILITATOR_SETTLE_URL
  if (!facilitatorSettleUrl) {
    results.push({
      name: 'FACILITATOR_SETTLE_URL',
      status: 'SKIP',
      message: 'optional (defaults to FACILITATOR_URL/settle)'
    })
  } else {
    try {
      urlSchema.parse(facilitatorSettleUrl)
      results.push({
        name: 'FACILITATOR_SETTLE_URL',
        status: 'PASS',
        message: extractHost(facilitatorSettleUrl)
      })
    } catch {
      results.push({
        name: 'FACILITATOR_SETTLE_URL',
        status: 'FAIL',
        message: 'invalid URL format'
      })
    }
  }

  // 9. Facilitator API key (optional)
  const facilitatorApiKey = process.env.FACILITATOR_API_KEY
  if (facilitatorApiKey) {
    results.push({
      name: 'FACILITATOR_API_KEY',
      status: 'PASS',
      message: 'present'
    })
  } else {
    results.push({
      name: 'FACILITATOR_API_KEY',
      status: 'SKIP',
      message: 'optional (for authenticated settle requests)'
    })
  }
}

// ============================================================================
// MAIN ENVIRONMENT CHECKS
// ============================================================================

function checkEnvironment(): CheckResult[] {
  const results: CheckResult[] = []
  const stage = (process.env.STAGE || 'dev') as 'dev' | 'staging' | 'alpha' | 'prod'

  // Stage validation
  try {
    z.enum(['dev', 'staging', 'alpha', 'prod']).parse(stage)
    results.push({
      name: 'STAGE',
      status: 'PASS',
      message: stage
    })
  } catch {
    results.push({
      name: 'STAGE',
      status: 'FAIL',
      message: `Invalid stage: ${stage} (must be dev/staging/alpha/prod)`
    })
  }

  // Supabase validation (server)
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

  // Supabase validation (client)
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

  // URL host consistency
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

  // Supabase anon key (server)
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

  // Supabase anon key (client)
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

  // Anon key consistency
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

  // Service role key (optional)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey) {
    try {
      jwtTokenSchema.parse(serviceRoleKey)
      results.push({
        name: 'SUPABASE_SERVICE_ROLE_KEY',
        status: 'PASS',
        message: `${maskToken(serviceRoleKey)} (same project)`
      })
    } catch (error) {
      results.push({
        name: 'SUPABASE_SERVICE_ROLE_KEY',
        status: 'FAIL',
        message: `${error instanceof Error ? error.message : 'Invalid token'}`
      })
    }
  } else {
    results.push({
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      status: 'SKIP',
      message: 'optional in all stages'
    })
  }

  // Discord OAuth (prod only)
  const discordEnabled = bool(process.env.ENABLE_DISCORD_LINKING)
  if (stage === 'prod' && !discordEnabled) {
    results.push({
      name: 'ENABLE_DISCORD_LINKING',
      status: 'FAIL',
      message: 'must be "true" in prod'
    })
  } else if (discordEnabled) {
    results.push({
      name: 'Discord OAuth',
      status: 'PASS',
      message: 'enabled'
    })
  } else {
    results.push({
      name: 'Discord OAuth',
      status: 'SKIP',
      message: `optional in ${stage}`
    })
  }

  // X402 validation (when enabled)
  checkX402(results)

  // ElevenLabs API key (alpha only)
  const elevenApiKey = process.env.ELEVEN_API_KEY
  if (stage === 'alpha' && !elevenApiKey) {
    results.push({
      name: 'ELEVEN_API_KEY',
      status: 'FAIL',
      message: 'required in alpha stage'
    })
  } else if (elevenApiKey) {
    results.push({
      name: 'ELEVEN_API_KEY',
      status: 'PASS',
      message: maskToken(elevenApiKey)
    })
  } else {
    results.push({
      name: 'ELEVEN_API_KEY',
      status: 'SKIP',
      message: `optional in ${stage}`
    })
  }

  return results
}

// ============================================================================
// ENV DELTA DETECTION
// ============================================================================

function parseEnvExample(): Set<string> {
  const examplePath = path.resolve(process.cwd(), '.env.local.example')
  if (!fs.existsSync(examplePath)) {
    return new Set()
  }

  const content = fs.readFileSync(examplePath, 'utf-8')
  const keys = new Set<string>()

  content.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const key = trimmed.split('=')[0].trim()
      keys.add(key)
    }
  })

  return keys
}

function checkEnvDelta(): { added: string[]; missing: string[] } {
  const exampleKeys = parseEnvExample()
  const envKeys = new Set(Object.keys(process.env))

  const added: string[] = []

  exampleKeys.forEach(key => {
    if (!envKeys.has(key)) {
      added.push(key)
    }
  })

  return { added, missing: [] }
}

// ============================================================================
// OUTPUT
// ============================================================================

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
    console.log(`${result.name.padEnd(40)} → ${status} (${result.message})`)
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

  // Env delta
  const delta = checkEnvDelta()
  if (delta.added.length > 0) {
    console.log(colors.bold('\nEnv Delta:'))
    console.log(colors.red(`  🔴 NEW ENV KEYS (add to your .env.local): ${delta.added.join(', ')}`))
  }
}

// ============================================================================
// MAIN
// ============================================================================

function main(): void {
  const results = checkEnvironment()
  printResults(results)

  const hasFailures = results.some(r => r.status === 'FAIL')
  const hasWarnings = results.some(r => r.status === 'WARN')
  const stage = process.env.STAGE || 'dev'

  if (hasFailures) {
    console.log(colors.red('\n❌ Environment validation FAILED'))
    console.log(colors.red('Fix the errors above before deploying.\n'))
    process.exit(1)
  } else if (hasWarnings && stage !== 'dev') {
    console.log(colors.red('\n❌ Warnings not allowed in staging/alpha/prod'))
    process.exit(1)
  } else {
    console.log(colors.green('\n✅ Environment validation PASSED\n'))
    process.exit(0)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
