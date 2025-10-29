#!/usr/bin/env tsx
// scripts/smoke-payments.ts
// Smoke test for x402 payment response shapes (no network, pure validation)

// ============================================================================
// TYPES
// ============================================================================

type ConfirmPaymentSuccess = {
  ok: true
  trackId: string
  status: 'AUGMENTING'
  txHash?: string
  requestId: string
}

type ConfirmPaymentPending = {
  status: 'TX_PENDING'
  txHash: `0x${string}`
  message: string
  requestId: string
}

type ConfirmPaymentError = {
  error: {
    code: 'PROVIDER_NO_SETTLEMENT' | 'TX_FAILED' | 'NO_TRANSFER_EVENT' | 'UNDERPAID' | string
    message: string
  }
  requestId: string
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

function isTxHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && TX_HASH_REGEX.test(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

function isSuccessResponse(obj: unknown): obj is ConfirmPaymentSuccess {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as any

  if (o.ok !== true) return false
  if (o.status !== 'AUGMENTING') return false
  if (!isNonEmptyString(o.trackId)) return false
  if (!isNonEmptyString(o.requestId)) return false
  if (o.txHash !== undefined && !isTxHash(o.txHash)) return false

  return true
}

function isPendingResponse(obj: unknown): obj is ConfirmPaymentPending {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as any

  if (o.status !== 'TX_PENDING') return false
  if (!isTxHash(o.txHash)) return false
  if (!isNonEmptyString(o.message)) return false
  if (!isNonEmptyString(o.requestId)) return false

  return true
}

function isErrorResponse(obj: unknown): obj is ConfirmPaymentError {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as any

  if (!o.error || typeof o.error !== 'object') return false
  if (!isNonEmptyString(o.error.code)) return false
  if (!isNonEmptyString(o.error.message)) return false
  if (!isNonEmptyString(o.requestId)) return false

  return true
}

// ============================================================================
// TEST CASES
// ============================================================================

const successResponse: ConfirmPaymentSuccess = {
  ok: true,
  trackId: '00000000-0000-0000-0000-000000000001',
  status: 'AUGMENTING',
  txHash: '0x' + 'a'.repeat(64),
  requestId: 'req-001'
}

const pendingResponse: ConfirmPaymentPending = {
  status: 'TX_PENDING',
  txHash: ('0x' + 'b'.repeat(64)) as `0x${string}`,
  message: 'Transaction submitted, waiting for on-chain confirmation',
  requestId: 'req-002'
}

const errorResponse: ConfirmPaymentError = {
  error: {
    code: 'PROVIDER_NO_SETTLEMENT',
    message: 'Payment verification succeeded but settlement failed. No transaction broadcast.'
  },
  requestId: 'req-003'
}

// ============================================================================
// TEST RUNNER
// ============================================================================

function runTests(): void {
  const results: { name: string; passed: boolean; error?: string }[] = []

  console.log('X402 Payment Response Smoke Tests')
  console.log('==================================')

  // Case A: Success
  const successValid = isSuccessResponse(successResponse)
  if (successValid) {
    console.log('✅ Case A: Success (200) → valid shape')
    results.push({ name: 'Case A', passed: true })
  } else {
    console.log('❌ Case A: Success (200) → INVALID SHAPE')
    results.push({ name: 'Case A', passed: false, error: 'Shape validation failed' })
  }

  // Case B: Pending
  const pendingValid = isPendingResponse(pendingResponse)
  if (pendingValid) {
    console.log('✅ Case B: Pending (202) → valid shape')
    results.push({ name: 'Case B', passed: true })
  } else {
    console.log('❌ Case B: Pending (202) → INVALID SHAPE')
    results.push({ name: 'Case B', passed: false, error: 'Shape validation failed' })
  }

  // Case C: Error
  const errorValid = isErrorResponse(errorResponse)
  if (errorValid) {
    console.log('✅ Case C: Error (502) → valid shape')
    results.push({ name: 'Case C', passed: true })
  } else {
    console.log('❌ Case C: Error (502) → INVALID SHAPE')
    results.push({ name: 'Case C', passed: false, error: 'Shape validation failed' })
  }

  // Summary
  const passed = results.filter(r => r.passed).length
  const total = results.length

  console.log('')
  console.log(`Summary: ${passed}/${total} passed`)

  // Exit with appropriate code
  if (passed === total) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

// ============================================================================
// MAIN
// ============================================================================

runTests()
