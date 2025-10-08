// tests/server/x402-facilitator-validation.test.ts
// Tests for strict field validation in facilitator responses

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock dependencies before importing
vi.mock('../../src/config/env.server.js', () => ({
  serverEnv: {
    X402_FACILITATOR_URL: 'https://x402.org/facilitator',
    X402_MODE: 'facilitator',
    ENABLE_X402: true
  }
}))

vi.mock('../../src/lib/metrics.js', () => ({
  incrementCounter: vi.fn(),
  recordLatency: vi.fn()
}))

vi.mock('../../src/lib/crypto-utils.js', () => ({
  maskTxHash: (tx: string) => tx.substring(0, 10) + '...',
  maskAddress: (addr: string) => addr.substring(0, 6) + '...',
  normalizeAddress: (addr: string) => addr.toLowerCase().trim(),
  normalizeIdentifier: (id: string) => id.toLowerCase().trim().replace(/\s+/g, '-')
}))

import { facilitatorVerify } from '../../api/_shared/payments/x402-facilitator'

describe('Facilitator Client - Strict Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should reject payment to wrong address', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0xWRONGADDRESS1234567890123456789012345678', // Wrong address
        asset: 'USDC',
        chain: 'base-sepolia',
        amountAtomic: '3000000'
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
      expect(result.message).toContain('wrong address')
    }
  })

  it('should reject payment on wrong chain', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'USDC',
        chain: 'ethereum-mainnet', // Wrong chain
        amountAtomic: '3000000'
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
      expect(result.message).toContain('wrong blockchain network')
    }
  })

  it('should reject payment with wrong asset', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'ETH', // Wrong asset
        chain: 'base-sepolia',
        amountAtomic: '3000000'
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
      expect(result.code).toBe('WRONG_ASSET')
      expect(result.message).toContain('Wrong cryptocurrency')
    }
  })

  it('should reject insufficient payment amount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'USDC',
        chain: 'base-sepolia',
        amountAtomic: '2000000' // Less than required 3000000
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
      expect(result.code).toBe('WRONG_AMOUNT')
      expect(result.message).toContain('insufficient')
    }
  })

  it('should accept payment with exact amount', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'USDC',
        chain: 'base-sepolia',
        amountAtomic: '3000000'
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
  })

  it('should accept payment with overpayment', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'USDC',
        chain: 'base-sepolia',
        amountAtomic: '5000000' // More than required
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
  })

  it('should handle field name variations (payTo vs to)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6', // Alternative field name
        asset: 'USDC',
        chain: 'base-sepolia',
        amountAtomic: '3000000'
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
  })

  it('should handle field name variations (symbol vs asset)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        symbol: 'USDC', // Alternative field name
        chain: 'base-sepolia',
        amountAtomic: '3000000'
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
  })

  it('should handle field name variations (network vs chain)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'USDC',
        network: 'base-sepolia', // Alternative field name
        amountAtomic: '3000000'
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
  })

  it('should handle field name variations (amount vs amountAtomic)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'USDC',
        chain: 'base-sepolia',
        amount: '3000000' // Alternative field name
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
  })

  it('should reject response missing required fields', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'USDC'
        // Missing chain and amount
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
      expect(result.message).toContain('missing required fields')
    }
  })

  it('should normalize addresses for comparison (case insensitive)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0X5563F81AA5E6AE358D3752147A67198C8A528EA6', // Uppercase
        asset: 'USDC',
        chain: 'base-sepolia',
        amountAtomic: '3000000'
      })
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81aa5e6ae358d3752147a67198c8a528ea6', // Lowercase
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(true)
  })

  it('should normalize chain/asset names for comparison (case insensitive)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        verified: true,
        to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
        asset: 'usdc', // Lowercase
        chain: 'Base-Sepolia', // Mixed case
        amountAtomic: '3000000'
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
  })
})
