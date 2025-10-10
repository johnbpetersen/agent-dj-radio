//api/_shared/payments/facilitator/variants.test.ts
// Unit tests for payload variant builders

import { buildCanonical, buildCompat, buildLegacy, type PayloadParams } from './variants.js'

/**
 * Minimal test runner (no dependencies)
 * Run with: npx tsx api/_shared/payments/facilitator/variants.test.ts
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

function assertEquals(actual: any, expected: any, message?: string): void {
  const actualStr = JSON.stringify(actual)
  const expectedStr = JSON.stringify(expected)
  if (actualStr !== expectedStr) {
    throw new Error(
      message || `Expected ${expectedStr}, got ${actualStr}`
    )
  }
}

function assertType(value: any, type: string, message?: string): void {
  if (typeof value !== type) {
    throw new Error(
      message || `Expected type ${type}, got ${typeof value}`
    )
  }
}

// Fixed test data
const testParams: PayloadParams = {
  chain: 'base-sepolia',
  asset: 'usdc',
  chainId: 84532,
  tokenAddress: '0x036CBD53842c5426634e7929541eC2318f3dCF7e', // Mixed case (will be normalized)
  payTo: '0x1234567890123456789012345678901234567890',
  amountAtomic: '10000',
  authorization: {
    from: '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD', // Mixed case (will be normalized)
    to: '0x1234567890123456789012345678901234567890',
    value: '10000',
    validAfter: '1740672089',
    validBefore: '1740672154',
    nonce: '0xF3746613C2D920B5FDABC0856F2AEB2D4F88EE6037B8CC5D04A71A4462F13480', // Mixed case
    signature: '0x1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12' // Mixed case, 132 chars
  }
}

console.log('Running facilitator variant tests...\n')

// Test buildCanonical
test('buildCanonical: returns correct schema', () => {
  const payload = buildCanonical(testParams)

  // Check top-level fields
  assertEquals(payload.scheme, 'erc3009')
  assertType(payload.chainId, 'number', 'chainId must be number')
  assertEquals(payload.chainId, 84532)
  assertEquals(payload.tokenAddress, '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 'tokenAddress must be lowercase')
  assertEquals(payload.payTo, '0x1234567890123456789012345678901234567890')
  assertEquals(payload.amountAtomic, '10000')

  // Check authorization exists
  if (!payload.authorization) {
    throw new Error('authorization must exist')
  }

  // Check authorization fields
  assertEquals(payload.authorization.from, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', 'from must be lowercase')
  assertEquals(payload.authorization.to, '0x1234567890123456789012345678901234567890')
  assertEquals(payload.authorization.value, '10000')
  assertEquals(payload.authorization.validAfter, '1740672089')
  assertEquals(payload.authorization.validBefore, '1740672154')
  assertEquals(payload.authorization.nonce.length, 66, 'nonce must be 66 chars')
  assertEquals(payload.authorization.nonce, '0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480', 'nonce must be lowercase')
  assertEquals(payload.authorization.signature.length, 132, 'signature must be 132 chars')
  assertEquals(payload.authorization.signature.substring(0, 4), '0x12', 'signature must start with 0x and be lowercase')
})

test('buildCanonical: no extra fields at top level', () => {
  const payload = buildCanonical(testParams)
  const keys = Object.keys(payload)
  const expected = ['scheme', 'chainId', 'tokenAddress', 'payTo', 'amountAtomic', 'authorization']

  for (const key of keys) {
    if (!expected.includes(key)) {
      throw new Error(`Unexpected field: ${key}`)
    }
  }

  if (keys.length !== expected.length) {
    throw new Error(`Expected ${expected.length} fields, got ${keys.length}`)
  }
})

test('buildCanonical: signature only in authorization', () => {
  const payload = buildCanonical(testParams) as any

  if ('signature' in payload) {
    throw new Error('signature should not be at top level')
  }

  if (!payload.authorization.signature) {
    throw new Error('signature must be in authorization')
  }
})

// Test buildCompat
test('buildCompat: chainId should be number (FIXED)', () => {
  const payload = buildCompat(testParams)

  // After fix, chainId should be number
  assertType(payload.chainId, 'number', 'chainId must be number (was string in old compat)')
  assertEquals(payload.chainId, 84532)
})

test('buildCompat: has signature at top level AND in authorization', () => {
  const payload = buildCompat(testParams) as any

  if (!payload.signature) {
    throw new Error('signature should be at top level in compat variant')
  }

  if (!payload.authorization.signature) {
    throw new Error('signature must also be in authorization')
  }

  assertEquals(payload.signature, payload.authorization.signature, 'signatures must match')
})

// Test buildLegacy
test('buildLegacy: uses legacy field names', () => {
  const payload = buildLegacy(testParams) as any

  // Check legacy fields exist
  if (!payload.chain) throw new Error('chain field must exist')
  if (!payload.asset) throw new Error('asset field must exist')
  if (!payload.token) throw new Error('token field must exist')
  if (!payload.recipient) throw new Error('recipient field must exist')
  if (!payload.amount) throw new Error('amount field must exist')

  assertEquals(payload.chain, 'base-sepolia')
  assertEquals(payload.asset, 'usdc')
  assertEquals(payload.token, '0x036cbd53842c5426634e7929541ec2318f3dcf7e')
  assertEquals(payload.recipient, '0x1234567890123456789012345678901234567890')
  assertEquals(payload.amount, '10000')
})

test('buildLegacy: chainId is string', () => {
  const payload = buildLegacy(testParams)

  assertType(payload.chainId, 'string', 'chainId must be string in legacy')
  assertEquals(payload.chainId, '84532')
})

// Test normalization
test('all variants: normalize hex to lowercase', () => {
  const canonical = buildCanonical(testParams)
  const compat = buildCompat(testParams)
  const legacy = buildLegacy(testParams)

  // Check addresses are lowercase
  assertEquals(canonical.tokenAddress, canonical.tokenAddress.toLowerCase())
  assertEquals(compat.tokenAddress, compat.tokenAddress.toLowerCase())
  assertEquals(legacy.token, legacy.token.toLowerCase())

  // Check authorization nonce/signature are lowercase
  assertEquals(canonical.authorization.nonce, canonical.authorization.nonce.toLowerCase())
  assertEquals(canonical.authorization.signature, canonical.authorization.signature.toLowerCase())
})

test('all variants: strip leading zeros from amountAtomic', () => {
  const paramsWithLeadingZeros: PayloadParams = {
    ...testParams,
    amountAtomic: '0010000' // Has leading zeros
  }

  const canonical = buildCanonical(paramsWithLeadingZeros)
  const compat = buildCompat(paramsWithLeadingZeros)
  const legacy = buildLegacy(paramsWithLeadingZeros)

  // All should strip leading zeros
  assertEquals(canonical.amountAtomic, '10000')
  assertEquals(compat.amountAtomic, '10000')
  assertEquals(legacy.amount, '10000')
})

test('all variants: value matches amountAtomic', () => {
  const canonical = buildCanonical(testParams)
  const compat = buildCompat(testParams)
  const legacy = buildLegacy(testParams)

  assertEquals(canonical.authorization.value, canonical.amountAtomic)
  assertEquals(compat.authorization.value, compat.amountAtomic)
  assertEquals(legacy.authorization.value, legacy.amount)
})

console.log('\n✅ All tests passed!')
console.log('\n📊 Test Summary:')
console.log('  - buildCanonical: ✅ Matches spec (number chainId, correct fields, no extras)')
console.log('  - buildCompat: ⚠️  Duplicate signature (not in spec, but harmless)')
console.log('  - buildLegacy: ❌ Wrong field names (will fail with standard facilitator)')
console.log('\n💡 Recommendation: Use buildCanonical as primary variant')
