#!/usr/bin/env tsx
// scripts/doctor.ts
// Dev environment health check CLI

import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:net'
import dns from 'node:dns/promises'
import dotenv from 'dotenv'

// Load environment files
const envLocal = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal })
}
dotenv.config()

// Colors for output
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

interface CheckResult {
  name: string
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP'
  message: string
}

// Check Node.js version
export async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version
  const major = parseInt(version.slice(1).split('.')[0])

  if (major >= 20 && major <= 22) {
    return {
      name: 'Node.js version',
      status: 'PASS',
      message: version
    }
  } else {
    return {
      name: 'Node.js version',
      status: 'WARN',
      message: `${version} (expected >=20 <23)`
    }
  }
}

// Check required environment variables
export async function checkEnvVars(): Promise<CheckResult> {
  const stage = (process.env.STAGE || 'dev') as 'dev' | 'staging' | 'alpha'

  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY'
  ]

  // Add stage-specific requirements
  if (stage === 'alpha') {
    required.push(
      'X402_PROVIDER_URL',
      'X402_API_KEY',
      'X402_RECEIVING_ADDRESS',
      'ELEVEN_API_KEY'
    )
  }

  const missing = required.filter(key => !process.env[key])

  if (missing.length === 0) {
    return {
      name: 'Required env vars',
      status: 'PASS',
      message: `${required.length}/${required.length} present`
    }
  } else {
    return {
      name: 'Required env vars',
      status: 'FAIL',
      message: `missing: ${missing.join(', ')}`
    }
  }
}

// Check Supabase DNS resolution
export async function checkSupabaseDNS(): Promise<CheckResult> {
  const supabaseUrl = process.env.SUPABASE_URL

  if (!supabaseUrl) {
    return {
      name: 'Supabase DNS resolution',
      status: 'SKIP',
      message: 'SUPABASE_URL not set'
    }
  }

  try {
    const url = new URL(supabaseUrl)
    await dns.resolve(url.hostname)
    return {
      name: 'Supabase DNS resolution',
      status: 'PASS',
      message: url.hostname
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    return {
      name: 'Supabase DNS resolution',
      status: 'FAIL',
      message: err.code === 'ENOTFOUND' ? 'DNS lookup failed' : (err.message || 'Unknown error')
    }
  }
}

// Check Supabase HTTP reachability
export async function checkSupabaseHTTP(): Promise<CheckResult> {
  const supabaseUrl = process.env.SUPABASE_URL

  if (!supabaseUrl) {
    return {
      name: 'Supabase HTTP reachability',
      status: 'SKIP',
      message: 'SUPABASE_URL not set'
    }
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    const response = await fetch(supabaseUrl, {
      method: 'HEAD',
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (response.ok || response.status === 404) { // 404 is fine, means server responded
      return {
        name: 'Supabase HTTP reachability',
        status: 'PASS',
        message: `${response.status} ${response.statusText}`
      }
    } else {
      return {
        name: 'Supabase HTTP reachability',
        status: 'WARN',
        message: `${response.status} ${response.statusText}`
      }
    }
  } catch (error) {
    const err = error as Error
    return {
      name: 'Supabase HTTP reachability',
      status: 'FAIL',
      message: err.name === 'AbortError' ? 'timeout (>3s)' : err.message
    }
  }
}

// Check if port is available
export async function checkPort(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({
          name: `Port ${port} available`,
          status: 'WARN',
          message: 'port in use (may be dev server)'
        })
      } else {
        resolve({
          name: `Port ${port} available`,
          status: 'FAIL',
          message: err.message || 'Unknown error'
        })
      }
    })

    server.once('listening', () => {
      server.close()
      resolve({
        name: `Port ${port} available`,
        status: 'PASS',
        message: 'available'
      })
    })

    server.listen(port)
  })
}

// Check clock skew (optional)
export async function checkClockSkew(): Promise<CheckResult> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    const response = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', {
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      const data = await response.json()
      const apiTime = new Date(data.datetime).getTime()
      const localTime = Date.now()
      const skewMs = Math.abs(localTime - apiTime)

      if (skewMs < 5000) {
        return {
          name: 'Clock skew',
          status: 'PASS',
          message: `${skewMs}ms`
        }
      } else {
        return {
          name: 'Clock skew',
          status: 'WARN',
          message: `${skewMs}ms (>5s)`
        }
      }
    } else {
      return {
        name: 'Clock skew',
        status: 'SKIP',
        message: 'time API unavailable'
      }
    }
  } catch (error) {
    const err = error as Error
    return {
      name: 'Clock skew',
      status: 'SKIP',
      message: err.name === 'AbortError' ? 'timeout' : 'offline'
    }
  }
}

// Print results table
function printResults(results: CheckResult[]): void {
  console.log(colors.bold('\nDev Environment Health Check'))
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
    console.log(`  ${colorFn?.(status) || status}: ${count}`)
  })
}

// Main function
async function main(): Promise<void> {
  const results: CheckResult[] = []

  // Run all checks
  results.push(await checkNodeVersion())
  results.push(await checkEnvVars())
  results.push(await checkSupabaseDNS())
  results.push(await checkSupabaseHTTP())
  results.push(await checkPort(3001))
  results.push(await checkPort(5173))
  results.push(await checkClockSkew())

  printResults(results)

  const hasFailures = results.some(r => r.status === 'FAIL')

  if (hasFailures) {
    console.log(colors.red('\n❌ Environment has issues'))
    process.exit(1)
  } else {
    console.log(colors.green('\n✅ Environment is healthy'))
    process.exit(0)
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(colors.red('Doctor check failed:'), error)
    process.exit(1)
  })
}
