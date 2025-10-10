// api/_shared/payments/facilitator/transport.test.ts
// Micro tests for joinUrl function

import { joinUrl } from './transport.js'

/**
 * Micro test suite for joinUrl
 * Run with: npx tsx api/_shared/payments/facilitator/transport.test.ts
 */

function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  ${(error as Error).message}`)
    process.exit(1)
  }
}

function assertEquals(actual: string, expected: string, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message || `Expected "${expected}", got "${actual}"`
    )
  }
}

// Run tests
console.log('Running joinUrl tests...\n')

test('joinUrl with base ending in path (no slash)', () => {
  const result = joinUrl('https://x402.org/facilitator', 'verify')
  assertEquals(result, 'https://x402.org/facilitator/verify')
})

test('joinUrl with base ending in path (with slash)', () => {
  const result = joinUrl('https://x402.org/facilitator/', 'verify')
  assertEquals(result, 'https://x402.org/facilitator/verify')
})

test('joinUrl with base at root', () => {
  const result = joinUrl('https://x402.org', 'verify')
  assertEquals(result, 'https://x402.org/verify')
})

test('joinUrl with base at root (with slash)', () => {
  const result = joinUrl('https://x402.org/', 'verify')
  assertEquals(result, 'https://x402.org/verify')
})

test('joinUrl with path starting with slash', () => {
  const result = joinUrl('https://x402.org/facilitator', '/verify')
  assertEquals(result, 'https://x402.org/facilitator/verify')
})

test('joinUrl with deeply nested base path', () => {
  const result = joinUrl('https://x402.org/api/v1/facilitator', 'verify')
  assertEquals(result, 'https://x402.org/api/v1/facilitator/verify')
})

console.log('\n✅ All tests passed!')
