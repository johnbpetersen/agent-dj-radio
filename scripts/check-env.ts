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

const bool = (v?: string) => v === 'true';
const isAddr = (v?: string) => /^0x[a-fA-F0-9]{40}$/.test(v ?? '');
const isHex = (v?: string, n?: number) =>
  new RegExp(`^0x[0-9a-fA-F]{${n ?? 64}}$`).test(v ?? '');
const requireEnv = (k: string, ok: boolean, why: string) => {
  if (!ok) throw new Error(`ENV ${k} invalid/missing → ${why}`);
  console.log(`${k.padEnd(32)} → ✅ PASS`);
};

// decide if x402 must be validated
const x402Enabled =
  bool(process.env.ENABLE_X402) || (process.env.X402_MODE ?? '').length > 0;

if (x402Enabled) {
  console.log('\nX402 Validation (payments enabled)\n==============================');
  const chain = process.env.X402_CHAIN ?? 'base';
  requireEnv('X402_FACILITATOR_URL',
    !!(process.env.X402_FACILITATOR_URL && process.env.X402_FACILITATOR_URL.includes('://')),
    'set to https://facilitator.daydreams.systems');

  const strategy = process.env.X402_SETTLE_STRATEGY ?? 'auto';
  requireEnv('X402_SETTLE_STRATEGY',
    ['auto','local','facilitator'].includes(strategy),
    'must be one of auto|local|facilitator');

  // facilitator settle URL optional (default is FACILITATOR_URL + /settle)
  if (['auto','facilitator'].includes(strategy)) {
    // no hard require; just warn if missing
    console.log('FACILITATOR_SETTLE_URL       → (optional; defaults to FACILITATOR_URL/settle)');
  }

  if (['auto','local'].includes(strategy)) {
    requireEnv('SETTLER_PRIVATE_KEY',
      isHex(process.env.SETTLER_PRIVATE_KEY, 64),
      '0x + 64 hex; used for local settlement broadcast');
  } else {
    // facilitator-only strategy: key not required
    if (process.env.SETTLER_PRIVATE_KEY) {
      console.log('SETTLER_PRIVATE_KEY          → ⚠️  present but unused (strategy=facilitator)');
    } else {
      console.log('SETTLER_PRIVATE_KEY          → ⏭️  not required (strategy=facilitator)');
    }
  }

  // mainnet USDC required if base mainnet
  if (chain === 'base') {
    requireEnv('USDC_CONTRACT_ADDRESS_BASE',
      (process.env.USDC_CONTRACT_ADDRESS_BASE ?? '').toLowerCase()
        === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      'must be Base USDC: 0x833589...02913');
    console.log('BASE_MAINNET_RPC_URL         → ' + (process.env.BASE_MAINNET_RPC_URL ? '✅ PASS' : 'ℹ️ using public RPC'));
  }

  requireEnv('X402_RECEIVING_ADDRESS',
    isAddr(process.env.X402_RECEIVING_ADDRESS),
    'payee address (where USDC lands)');
  requireEnv('X402_ACCEPTED_ASSET',
    (process.env.X402_ACCEPTED_ASSET ?? '').toUpperCase() === 'USDC',
    'must be USDC');
}

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

  // Service role key validation (completely optional in all stages)
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
    // Optional in all stages - skip if not provided
    results.push({
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      status: 'SKIP',
      message: 'optional in all stages'
    })
  }

  // Discord OAuth configuration (prod guardrails)
  const discordLinkingEnabled = process.env.ENABLE_DISCORD_LINKING
  const discordClientId = process.env.DISCORD_CLIENT_ID
  const discordRedirectUri = process.env.DISCORD_REDIRECT_URI
  const requireLinkedForChat = process.env.REQUIRE_LINKED_FOR_CHAT
  const debugAuth = process.env.DEBUG_AUTH

  if (stage === 'prod') {
    // FAIL checks for prod
    if (discordLinkingEnabled !== 'true') {
      results.push({
        name: 'ENABLE_DISCORD_LINKING',
        status: 'FAIL',
        message: 'must be "true" in prod (Discord OAuth required)'
      })
    } else {
      results.push({
        name: 'ENABLE_DISCORD_LINKING',
        status: 'PASS',
        message: 'enabled'
      })
    }

    if (!discordClientId || discordClientId.trim() === '') {
      results.push({
        name: 'DISCORD_CLIENT_ID',
        status: 'FAIL',
        message: 'required in prod'
      })
    } else {
      results.push({
        name: 'DISCORD_CLIENT_ID',
        status: 'PASS',
        message: maskToken(discordClientId)
      })
    }

    if (!discordRedirectUri || discordRedirectUri.trim() === '') {
      results.push({
        name: 'DISCORD_REDIRECT_URI',
        status: 'FAIL',
        message: 'required in prod'
      })
    } else {
      try {
        urlSchema.parse(discordRedirectUri)
        results.push({
          name: 'DISCORD_REDIRECT_URI',
          status: 'PASS',
          message: discordRedirectUri
        })
      } catch {
        results.push({
          name: 'DISCORD_REDIRECT_URI',
          status: 'FAIL',
          message: 'invalid URL'
        })
      }
    }

    // WARN checks for prod
    if (debugAuth === '1') {
      results.push({
        name: 'DEBUG_AUTH',
        status: 'WARN',
        message: 'enabled in prod (should be disabled)'
      })
    } else {
      results.push({
        name: 'DEBUG_AUTH',
        status: 'PASS',
        message: 'disabled'
      })
    }

    if (requireLinkedForChat !== 'true') {
      results.push({
        name: 'REQUIRE_LINKED_FOR_CHAT',
        status: 'WARN',
        message: 'not enabled (linked-only chat recommended)'
      })
    } else {
      results.push({
        name: 'REQUIRE_LINKED_FOR_CHAT',
        status: 'PASS',
        message: 'enabled'
      })
    }

    // Success message if all Discord OAuth checks pass
    const discordOAuthReady =
      discordLinkingEnabled === 'true' &&
      discordClientId &&
      discordRedirectUri
    if (discordOAuthReady) {
      results.push({
        name: 'Discord OAuth',
        status: 'PASS',
        message: '✅ ready for production'
      })
    }
  } else {
    // Non-prod: just check if configured
    if (discordLinkingEnabled === 'true' && discordClientId && discordRedirectUri) {
      results.push({
        name: 'Discord OAuth',
        status: 'PASS',
        message: `configured for ${stage}`
      })
    } else {
      results.push({
        name: 'Discord OAuth',
        status: 'SKIP',
        message: `optional in ${stage}`
      })
    }
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

  // X402 Settlement layer configuration (alpha only)
  if (stage === 'alpha') {
    // Settlement strategy validation
    const settleStrategy = process.env.X402_SETTLE_STRATEGY || 'auto'
    try {
      z.enum(['facilitator', 'local', 'auto']).parse(settleStrategy)
      results.push({
        name: 'X402_SETTLE_STRATEGY',
        status: 'PASS',
        message: settleStrategy
      })
    } catch {
      results.push({
        name: 'X402_SETTLE_STRATEGY',
        status: 'FAIL',
        message: `invalid strategy: ${settleStrategy} (must be facilitator, local, or auto)`
      })
    }

    // Settler private key validation (required for local/auto strategies)
    const settlerPrivateKey = process.env.SETTLER_PRIVATE_KEY
    if (settleStrategy === 'local' || settleStrategy === 'auto') {
      if (!settlerPrivateKey) {
        results.push({
          name: 'SETTLER_PRIVATE_KEY',
          status: 'FAIL',
          message: `required for strategy=${settleStrategy}`
        })
      } else {
        // Validate format (0x + 64 hex chars)
        if (!/^0x[a-fA-F0-9]{64}$/.test(settlerPrivateKey)) {
          results.push({
            name: 'SETTLER_PRIVATE_KEY',
            status: 'FAIL',
            message: 'invalid format (expected 0x + 64 hex chars)'
          })
        } else {
          // Validate derived address is not 0x0 (requires viem)
          try {
            // Lazy-load viem to avoid startup penalty if not needed
            const { privateKeyToAccount } = require('viem/accounts')
            const account = privateKeyToAccount(settlerPrivateKey as `0x${string}`)
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
                message: `${settlerPrivateKey.substring(0, 6)}...${settlerPrivateKey.substring(settlerPrivateKey.length - 4)} → ${account.address.substring(0, 10)}...`
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
      }
    } else {
      // Strategy doesn't require private key
      if (settlerPrivateKey) {
        results.push({
          name: 'SETTLER_PRIVATE_KEY',
          status: 'WARN',
          message: `present but not used with strategy=${settleStrategy}`
        })
      } else {
        results.push({
          name: 'SETTLER_PRIVATE_KEY',
          status: 'SKIP',
          message: `not required for strategy=${settleStrategy}`
        })
      }
    }

    // USDC contract address validation (required in alpha)
    const usdcContract = process.env.USDC_CONTRACT_ADDRESS_BASE
    const MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

    if (!usdcContract) {
      results.push({
        name: 'USDC_CONTRACT_ADDRESS_BASE',
        status: 'FAIL',
        message: 'required in alpha for settlement'
      })
    } else {
      try {
        hexAddressSchema.parse(usdcContract)

        // Check if it matches mainnet USDC
        if (usdcContract.toLowerCase() === MAINNET_USDC.toLowerCase()) {
          results.push({
            name: 'USDC_CONTRACT_ADDRESS_BASE',
            status: 'PASS',
            message: `${usdcContract} (Base mainnet)`
          })
        } else {
          results.push({
            name: 'USDC_CONTRACT_ADDRESS_BASE',
            status: 'WARN',
            message: `${usdcContract} (not mainnet USDC, expected ${MAINNET_USDC})`
          })
        }
      } catch {
        results.push({
          name: 'USDC_CONTRACT_ADDRESS_BASE',
          status: 'FAIL',
          message: 'invalid hex address format'
        })
      }
    }

    // Facilitator settle URL (optional)
    const facilitatorSettleUrl = process.env.FACILITATOR_SETTLE_URL
    if (facilitatorSettleUrl) {
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
    } else {
      results.push({
        name: 'FACILITATOR_SETTLE_URL',
        status: 'SKIP',
        message: 'optional (defaults to facilitator URL + /settle)'
      })
    }

    // Facilitator API key (optional)
    const facilitatorApiKey = process.env.FACILITATOR_API_KEY
    if (facilitatorApiKey) {
      results.push({
        name: 'FACILITATOR_API_KEY',
        status: 'PASS',
        message: maskToken(facilitatorApiKey)
      })
    } else {
      results.push({
        name: 'FACILITATOR_API_KEY',
        status: 'SKIP',
        message: 'optional (for authenticated settle requests)'
      })
    }
  } else {
    results.push({
      name: 'X402_SETTLE_* (alpha only)',
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

/**
 * Parse .env.local.example to extract all keys
 */
function parseEnvExample(): Set<string> {
  const examplePath = path.resolve(process.cwd(), '.env.local.example')
  if (!fs.existsSync(examplePath)) {
    return new Set()
  }

  const content = fs.readFileSync(examplePath, 'utf-8')
  const keys = new Set<string>()

  // Extract keys from env file (ignore comments and empty lines)
  content.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const key = trimmed.split('=')[0].trim()
      keys.add(key)
    }
  })

  return keys
}

/**
 * Detect env delta: new keys in example vs process.env
 */
function checkEnvDelta(): { added: string[]; missing: string[] } {
  const exampleKeys = parseEnvExample()
  const envKeys = new Set(Object.keys(process.env))

  const added: string[] = []
  const missing: string[] = []

  // Check for keys in example but not in process.env
  exampleKeys.forEach(key => {
    if (!envKeys.has(key)) {
      added.push(key)
    }
  })

  // For now, we don't check "missing from example" as that's less critical
  // (developers may have extra keys locally)

  return { added, missing }
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

  // Env delta detection
  const delta = checkEnvDelta()
  if (delta.added.length > 0 || delta.missing.length > 0) {
    console.log(colors.bold('\nEnv Delta:'))
    if (delta.added.length > 0) {
      console.log(colors.red(`  🔴 NEW ENV KEYS (add to your .env.local): ${delta.added.join(', ')}`))
    }
    if (delta.missing.length > 0) {
      console.log(colors.yellow(`  🟡 MISSING FROM EXAMPLE: ${delta.missing.join(', ')}`))
    }
    console.log(`  Env delta: [ADDED: ${delta.added.length}, MISSING: ${delta.missing.length}]`)
  } else {
    console.log(colors.green('\n✓ No env delta detected'))
  }
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