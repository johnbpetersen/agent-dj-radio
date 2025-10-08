// tests/server/x402-facilitator.test.ts
// Tests for x402 facilitator REST API verification

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { facilitatorVerify } from '../../api/_shared/payments/x402-facilitator'

// Mock serverEnv
vi.mock('../../src/config/env.server.js', () => ({
  serverEnv: {
    X402_FACILITATOR_URL: 'https://x402.org/facilitator',
    X402_MODE: 'facilitator',
    ENABLE_X402: true
  }
}))

describe('x402 Facilitator Verification', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.restoreAllMocks()
  })

  it('should verify successful payment', async () => {
    // Mock successful fetch response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        amountPaidAtomic: '3000000',
        chain: 'base-sepolia',
        asset: 'USDC'
      })
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.amountPaidAtomic).toBe('3000000')
      expect(result.providerRaw).toBeDefined()
    }

    expect(global.fetch).toHaveBeenCalledWith(
      'https://x402.org/facilitator/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      })
    )
  })

  it('should handle WRONG_CHAIN error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: {
          code: 'WRONG_CHAIN',
          message: 'Payment sent on wrong blockchain network'
        }
      })
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('WRONG_CHAIN')
      expect(result.message).toBe('Payment sent on wrong blockchain network')
    }
  })

  it('should handle NO_MATCH error (404)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({
        error: {
          code: 'NO_MATCH',
          message: 'Transaction not found on blockchain'
        }
      })
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('NO_MATCH')
      expect(result.message).toBe('Transaction not found on blockchain')
    }
  })

  it('should handle network errors as PROVIDER_ERROR', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'))

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('PROVIDER_ERROR')
      expect(result.message).toBe('Verification service unreachable')
      expect(result.detail).toContain('fetch failed')
    }
  })

  it('should handle 5xx errors as PROVIDER_ERROR', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({
        error: {
          message: 'Service temporarily unavailable'
        }
      })
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('PROVIDER_ERROR')
      expect(result.message).toContain('Service temporarily unavailable')
    }
  })

  it('should handle malformed JSON responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not valid json'
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('NO_MATCH')
    }
  })

  it('should handle trailing slashes in facilitator URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        amountPaidAtomic: '3000000'
      })
    })

    await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    // URL should be normalized without trailing slash
    expect(global.fetch).toHaveBeenCalledWith(
      'https://x402.org/facilitator/verify',
      expect.any(Object)
    )
  })

  it('should send correct payload format', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ verified: true, amountPaidAtomic: '3000000' })
    })

    await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: 3000000, // Pass as number
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    const fetchCall = (global.fetch as any).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)

    expect(body).toEqual({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000', // Should be stringified
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })
  })

  it('should use fallback amountPaidAtomic if not in response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true
        // no amountPaidAtomic field
      })
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.amountPaidAtomic).toBe('3000000')
    }
  })
})
