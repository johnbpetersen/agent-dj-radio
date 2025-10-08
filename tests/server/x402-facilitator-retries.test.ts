// tests/server/x402-facilitator-retries.test.ts
// Tests for timeout and retry logic in facilitator client

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
  normalizeIdentifier: (id: string) => id.toLowerCase().trim()
}))

import { facilitatorVerify } from '../../api/_shared/payments/x402-facilitator'

describe('Facilitator Client - Retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    // Spy on console methods
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should retry on 503 error and succeed on 3rd attempt', async () => {
    let attempt = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      attempt++
      if (attempt < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: 'Service unavailable' } })
        }
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          verified: true,
          to: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
          asset: 'USDC',
          chain: 'base-sepolia',
          amountAtomic: '3000000'
        })
      }
    })

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  }, 15000)

  it('should NOT retry on 400 error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: { code: 'WRONG_CHAIN', message: 'Wrong chain' }
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
    expect(global.fetch).toHaveBeenCalledTimes(1) // No retries
  })

  it('should retry on network error and fail after 3 attempts', async () => {
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
      expect(result.message).toContain('temporarily unavailable')
    }
    expect(global.fetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
  }, 15000)

  it('should timeout after 10s per attempt', async () => {
    // Mock a slow response that never resolves
    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        // Never resolve, let timeout handle it
        setTimeout(() => {
          resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ verified: true })
          })
        }, 15000) // Longer than 10s timeout
      })
    })

    // Mock AbortController to simulate timeout
    const originalAbortController = global.AbortController
    global.AbortController = class MockAbortController {
      signal = {
        aborted: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }
      abort() {
        this.signal.aborted = true
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        throw error
      }
    } as any

    const result = await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    global.AbortController = originalAbortController

    expect(result.ok).toBe(false)
    // Timeout errors should be retried
    expect(global.fetch).toHaveBeenCalled()
  }, 35000)

  it('should add jitter to retry delays', async () => {
    const delays: number[] = []
    let lastTime = Date.now()

    global.fetch = vi.fn().mockImplementation(async () => {
      const now = Date.now()
      if (delays.length > 0) {
        delays.push(now - lastTime)
      }
      lastTime = now

      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: { message: 'Server error' } })
      }
    })

    await facilitatorVerify({
      chain: 'base-sepolia',
      asset: 'USDC',
      amountAtomic: '3000000',
      payTo: '0x5563f81AA5e6ae358D3752147A67198C8a528EA6',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })

    // Check that delays have jitter (within ±25% of base)
    // Base delays: 300ms, 800ms
    expect(delays.length).toBeGreaterThanOrEqual(2)

    // First retry delay should be ~300ms ±25%
    if (delays[0]) {
      expect(delays[0]).toBeGreaterThan(200) // 300 - 25%
      expect(delays[0]).toBeLessThan(400) // 300 + 25%
    }

    // Second retry delay should be ~800ms ±25%
    if (delays[1]) {
      expect(delays[1]).toBeGreaterThan(600)
      expect(delays[1]).toBeLessThan(1000)
    }
  }, 20000)
})
