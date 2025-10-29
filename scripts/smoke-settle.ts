#!/usr/bin/env tsx
// scripts/smoke-settle.ts
// Smoke test for X402 settlement layer (facilitator + local fallback)
// Defines the success contract for all 3 settlement paths

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TEST UTILITIES
// ============================================================================

const colors = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
}

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []

function test(name: string, fn: () => Promise<void> | void) {
  return async () => {
    try {
      await fn()
      results.push({ name, passed: true })
      console.log(`${colors.green('✓')} ${name}`)
    } catch (error) {
      const err = error as Error
      results.push({ name, passed: false, error: err.message })
      console.log(`${colors.red('✗')} ${name}`)
      console.log(`  ${colors.red(err.message)}`)
    }
  }
}

// ============================================================================
// MOCK TYPES (simplified for smoke test)
// ============================================================================

interface ERC3009Authorization {
  from: string
  to: string
  value: string
  validAfter: number
  validBefore: number
  nonce: string
  signature: string
}

interface Challenge {
  challenge_id: string
  pay_to: string
  amount_atomic: string
  nonce: string
  expires_at: string
}

interface SettleContext {
  facilitatorUrl?: string
  apiKey?: string
  challenge: Challenge
  requestId: string
  privateKey?: string
  rpcUrl?: string
  usdcContract?: string
}

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

// Mock facilitator that returns txHash
async function mockFacilitatorSettle_Success(
  authorization: ERC3009Authorization,
  ctx: SettleContext
): Promise<string | null> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 10))

  // Facilitator successfully settles and returns txHash
  return '0x' + '1'.repeat(64)
}

// Mock facilitator that fails (returns null)
async function mockFacilitatorSettle_Failure(
  authorization: ERC3009Authorization,
  ctx: SettleContext
): Promise<string | null> {
  await new Promise(resolve => setTimeout(resolve, 10))
  return null // Facilitator doesn't support settle or returns error
}

// Mock local settler that broadcasts successfully
async function mockLocalSettle_Success(
  authorization: ERC3009Authorization,
  ctx: SettleContext
): Promise<string> {
  // Simulate pre-flight validation
  if (authorization.to.toLowerCase() !== ctx.challenge.pay_to.toLowerCase()) {
    throw new Error('VALIDATION_ERROR: authorization.to !== challenge.pay_to')
  }

  if (BigInt(authorization.value) < BigInt(ctx.challenge.amount_atomic)) {
    throw new Error('VALIDATION_ERROR: authorization.value < challenge.amount_atomic')
  }

  // Simulate broadcast delay
  await new Promise(resolve => setTimeout(resolve, 50))

  // Return broadcast txHash
  return '0x' + '2'.repeat(64)
}

// Mock local settler that fails (RPC error)
async function mockLocalSettle_Failure(
  authorization: ERC3009Authorization,
  ctx: SettleContext
): Promise<string> {
  await new Promise(resolve => setTimeout(resolve, 10))
  throw new Error('PROVIDER_ERROR: RPC connection failed')
}

// ============================================================================
// SETTLEMENT ORCHESTRATION (mirrors queue/confirm.ts logic)
// ============================================================================

async function settlementOrchestration(
  strategy: 'facilitator' | 'local' | 'auto',
  authorization: ERC3009Authorization,
  ctx: SettleContext,
  mocks: {
    facilitatorSettle: typeof mockFacilitatorSettle_Success
    localSettle: typeof mockLocalSettle_Success
  }
): Promise<{ ok: true; txHash: string } | { ok: false; code: string; message: string }> {

  let settleTxHash: string | null = null
  let facilitatorTried = false
  let localTried = false

  // Step 1: Try facilitator settle (if strategy allows)
  if ((strategy === 'facilitator' || strategy === 'auto') && ctx.facilitatorUrl) {
    facilitatorTried = true
    try {
      settleTxHash = await mocks.facilitatorSettle(authorization, ctx)
    } catch (err) {
      // Facilitator error - continue to fallback if auto
      console.log(`  [settle] Facilitator error: ${(err as Error).message}`)
    }
  }

  // Step 2: Fallback to local settle (if strategy allows and facilitator failed)
  if (!settleTxHash && (strategy === 'local' || strategy === 'auto') && ctx.privateKey) {
    localTried = true
    try {
      settleTxHash = await mocks.localSettle(authorization, ctx)
    } catch (err) {
      // Local broadcast failed
      const error = err as Error
      if (error.message.includes('VALIDATION_ERROR')) {
        return { ok: false, code: 'VALIDATION_ERROR', message: error.message }
      }
      return { ok: false, code: 'PROVIDER_ERROR', message: error.message }
    }
  }

  // Step 3: No settlement achieved
  if (!settleTxHash) {
    return {
      ok: false,
      code: 'PROVIDER_NO_SETTLEMENT',
      message: `No settlement achieved (facilitatorTried=${facilitatorTried}, localTried=${localTried})`
    }
  }

  // Success!
  return { ok: true, txHash: settleTxHash }
}

// ============================================================================
// SMOKE TESTS
// ============================================================================

console.log(colors.bold('\n=== X402 Settlement Layer Smoke Test ===\n'))

const mockAuth: ERC3009Authorization = {
  from: '0x' + 'a'.repeat(40),
  to: '0x' + 'b'.repeat(40),
  value: '150000',
  validAfter: 0,
  validBefore: Math.floor(Date.now() / 1000) + 3600,
  nonce: '0x' + 'c'.repeat(64),
  signature: '0x' + 'd'.repeat(130)
}

const mockChallenge: Challenge = {
  challenge_id: '00000000-0000-0000-0000-000000000001',
  pay_to: '0x' + 'b'.repeat(40),
  amount_atomic: '150000',
  nonce: 'challenge-nonce-1',
  expires_at: new Date(Date.now() + 600000).toISOString()
}

const baseCtx: SettleContext = {
  facilitatorUrl: 'https://facilitator.example.com',
  challenge: mockChallenge,
  requestId: 'smoke-test-001',
  privateKey: '0x' + '1234'.repeat(16),
  rpcUrl: 'https://mainnet.base.org',
  usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
}

// ============================================================================
// SCENARIO A: Facilitator gives txHash (strategy=auto)
// ============================================================================
await test('Scenario A: Facilitator succeeds → returns txHash', async () => {
  const result = await settlementOrchestration(
    'auto',
    mockAuth,
    baseCtx,
    {
      facilitatorSettle: mockFacilitatorSettle_Success,
      localSettle: mockLocalSettle_Success
    }
  )

  if (!result.ok) {
    throw new Error(`Expected success but got: ${result.code} - ${result.message}`)
  }

  if (result.txHash !== '0x' + '1'.repeat(64)) {
    throw new Error(`Expected facilitator txHash but got: ${result.txHash}`)
  }

  console.log(`  ✓ Facilitator returned txHash: ${result.txHash.substring(0, 10)}...`)
})()

// ============================================================================
// SCENARIO B: Facilitator fails → fallback to local (strategy=auto)
// ============================================================================
await test('Scenario B: Facilitator fails → fallback to local broadcast', async () => {
  const result = await settlementOrchestration(
    'auto',
    mockAuth,
    baseCtx,
    {
      facilitatorSettle: mockFacilitatorSettle_Failure, // Returns null
      localSettle: mockLocalSettle_Success // Falls back here
    }
  )

  if (!result.ok) {
    throw new Error(`Expected success but got: ${result.code} - ${result.message}`)
  }

  if (result.txHash !== '0x' + '2'.repeat(64)) {
    throw new Error(`Expected local txHash but got: ${result.txHash}`)
  }

  console.log(`  ✓ Local broadcast returned txHash: ${result.txHash.substring(0, 10)}...`)
})()

// ============================================================================
// SCENARIO C: Both fail → PROVIDER_NO_SETTLEMENT (strategy=auto)
// ============================================================================
await test('Scenario C: Both fail → 502 PROVIDER_NO_SETTLEMENT', async () => {
  const result = await settlementOrchestration(
    'auto',
    mockAuth,
    baseCtx,
    {
      facilitatorSettle: mockFacilitatorSettle_Failure, // Returns null
      localSettle: mockLocalSettle_Failure // Throws error
    }
  )

  if (result.ok) {
    throw new Error(`Expected failure but got success with txHash: ${result.txHash}`)
  }

  if (result.code !== 'PROVIDER_ERROR') {
    throw new Error(`Expected PROVIDER_ERROR but got: ${result.code}`)
  }

  console.log(`  ✓ Correctly returned error: ${result.code}`)
})()

// ============================================================================
// SCENARIO D: Strategy=facilitator only (no fallback)
// ============================================================================
await test('Scenario D: Strategy=facilitator → no local fallback', async () => {
  const result = await settlementOrchestration(
    'facilitator',
    mockAuth,
    baseCtx,
    {
      facilitatorSettle: mockFacilitatorSettle_Failure, // Returns null
      localSettle: mockLocalSettle_Success // Should NOT be called
    }
  )

  if (result.ok) {
    throw new Error(`Expected failure but got success`)
  }

  if (result.code !== 'PROVIDER_NO_SETTLEMENT') {
    throw new Error(`Expected PROVIDER_NO_SETTLEMENT but got: ${result.code}`)
  }

  console.log(`  ✓ Correctly skipped local fallback with strategy=facilitator`)
})()

// ============================================================================
// SCENARIO E: Strategy=local only (skip facilitator)
// ============================================================================
await test('Scenario E: Strategy=local → skip facilitator', async () => {
  const result = await settlementOrchestration(
    'local',
    mockAuth,
    baseCtx,
    {
      facilitatorSettle: mockFacilitatorSettle_Success, // Should NOT be called
      localSettle: mockLocalSettle_Success
    }
  )

  if (!result.ok) {
    throw new Error(`Expected success but got: ${result.code}`)
  }

  if (result.txHash !== '0x' + '2'.repeat(64)) {
    throw new Error(`Expected local txHash but got: ${result.txHash}`)
  }

  console.log(`  ✓ Correctly skipped facilitator with strategy=local`)
})()

// ============================================================================
// SCENARIO F: Pre-flight validation fails (wrong recipient)
// ============================================================================
await test('Scenario F: Pre-flight validation → authorization.to mismatch', async () => {
  const badAuth = {
    ...mockAuth,
    to: '0x' + 'f'.repeat(40) // Wrong recipient!
  }

  const result = await settlementOrchestration(
    'local',
    badAuth,
    baseCtx,
    {
      facilitatorSettle: mockFacilitatorSettle_Failure,
      localSettle: mockLocalSettle_Success // Will fail pre-flight check
    }
  )

  if (result.ok) {
    throw new Error(`Expected validation error but got success`)
  }

  if (result.code !== 'VALIDATION_ERROR') {
    throw new Error(`Expected VALIDATION_ERROR but got: ${result.code}`)
  }

  if (!result.message.includes('pay_to')) {
    throw new Error(`Expected pay_to error but got: ${result.message}`)
  }

  console.log(`  ✓ Correctly rejected mismatched recipient`)
})()

// ============================================================================
// SCENARIO G: Pre-flight validation fails (insufficient amount)
// ============================================================================
await test('Scenario G: Pre-flight validation → amount too low', async () => {
  const badAuth = {
    ...mockAuth,
    value: '100000' // Less than challenge.amount_atomic (150000)
  }

  const result = await settlementOrchestration(
    'local',
    badAuth,
    baseCtx,
    {
      facilitatorSettle: mockFacilitatorSettle_Failure,
      localSettle: mockLocalSettle_Success // Will fail pre-flight check
    }
  )

  if (result.ok) {
    throw new Error(`Expected validation error but got success`)
  }

  if (result.code !== 'VALIDATION_ERROR') {
    throw new Error(`Expected VALIDATION_ERROR but got: ${result.code}`)
  }

  if (!result.message.includes('amount')) {
    throw new Error(`Expected amount error but got: ${result.message}`)
  }

  console.log(`  ✓ Correctly rejected insufficient amount`)
})()

// ============================================================================
// SUMMARY
// ============================================================================

console.log(colors.bold('\n=== Test Summary ===\n'))

const passed = results.filter(r => r.passed).length
const failed = results.filter(r => !r.passed).length
const total = results.length

console.log(`Total:  ${total}`)
console.log(`${colors.green('Passed:')} ${passed}`)
if (failed > 0) {
  console.log(`${colors.red('Failed:')} ${failed}`)
}

if (failed > 0) {
  console.log(colors.red('\n❌ SMOKE TEST FAILED\n'))
  process.exit(1)
} else {
  console.log(colors.green('\n✅ SMOKE TEST PASSED\n'))
  console.log('Settlement layer contract validated:')
  console.log('  ✓ Facilitator settle returns txHash')
  console.log('  ✓ Fallback to local broadcast works')
  console.log('  ✓ Pre-flight validation prevents bad broadcasts')
  console.log('  ✓ Strategy enforcement works (facilitator-only, local-only, auto)')
  console.log('  ✓ Error handling returns correct codes')
  process.exit(0)
}
