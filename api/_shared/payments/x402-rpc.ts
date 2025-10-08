// api/_shared/payments/x402-rpc.ts
// RPC fallback verifier for Base Sepolia ERC-20 payments
// Used when facilitator service is unavailable

import { serverEnv } from '../../../src/config/env.server.js'
import { maskTxHash, maskAddress, normalizeAddress } from '../../../src/lib/crypto-utils.js'
import { incrementCounter, recordLatency } from '../../../src/lib/metrics.js'
import type { VerifyResult } from './x402-facilitator.js'

// ERC-20 Transfer event signature
// Transfer(address indexed from, address indexed to, uint256 value)
const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const RPC_TIMEOUT_MS = 1500

interface TransactionReceipt {
  transactionHash: string
  from?: string
  status?: string
  logs?: Array<{
    address: string
    topics: string[]
    data: string
  }>
}

/**
 * Decode address from indexed topic (32 bytes, address in last 20 bytes)
 */
function decodeAddressFromTopic(topic: string): string {
  if (!topic || topic.length !== 66) return '' // 0x + 64 hex chars
  // Address is last 40 hex chars (20 bytes)
  return '0x' + topic.slice(-40)
}

/**
 * Decode uint256 from data field (32 bytes hex)
 */
function decodeUint256(data: string): bigint {
  if (!data || data.length < 2) return 0n
  // Remove 0x prefix if present
  const hex = data.startsWith('0x') ? data.slice(2) : data
  // Pad to 64 chars if needed
  const paddedHex = hex.padStart(64, '0')
  return BigInt('0x' + paddedHex)
}

/**
 * Fetch transaction receipt from Base Sepolia RPC
 */
async function fetchReceipt(txHash: string): Promise<TransactionReceipt | null> {
  const rpcUrl = serverEnv.BASE_SEPOLIA_RPC_URL
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash]
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn('[x402-rpc] RPC returned non-OK status', { status: response.status })
      return null
    }

    const json = await response.json()

    if (json.error) {
      console.warn('[x402-rpc] RPC returned error', { error: json.error })
      return null
    }

    return json.result || null
  } catch (error: any) {
    clearTimeout(timeoutId)

    if (error.name === 'AbortError') {
      console.warn('[x402-rpc] RPC request timeout')
      return null
    }

    console.warn('[x402-rpc] RPC fetch failed', { error: error.message })
    return null
  }
}

/**
 * Verify ERC-20 payment via RPC fallback
 * Fetches transaction receipt and validates Transfer event
 */
export async function verifyViaRPC(params: {
  txHash: string
  tokenAddress: string
  payTo: string
  amountAtomic: number
  chainId: number
}): Promise<VerifyResult> {
  const startTime = Date.now()
  const { txHash, tokenAddress, payTo, amountAtomic, chainId } = params
  const maskedTx = maskTxHash(txHash)
  const maskedAddr = maskAddress(payTo)

  console.log('[x402-rpc] RPC fallback verification started', {
    txHash: maskedTx,
    tokenAddress: maskAddress(tokenAddress),
    payTo: maskedAddr,
    amountAtomic,
    chainId
  })

  // Only support Base Sepolia for now
  if (chainId !== 84532) {
    const durationMs = Date.now() - startTime
    incrementCounter('x402_rpc_verify_total', { chainId: String(chainId), code: 'WRONG_CHAIN' })
    recordLatency('x402_rpc_verify_latency_ms', { chainId: String(chainId) }, durationMs)

    return {
      ok: false,
      code: 'WRONG_CHAIN',
      message: 'RPC fallback only supports Base Sepolia',
      detail: `chainId ${chainId} not supported`
    }
  }

  // Fetch transaction receipt
  const receipt = await fetchReceipt(txHash)

  if (!receipt) {
    const durationMs = Date.now() - startTime
    incrementCounter('x402_rpc_verify_total', { chainId: String(chainId), code: 'NO_MATCH' })
    recordLatency('x402_rpc_verify_latency_ms', { chainId: String(chainId) }, durationMs)

    return {
      ok: false,
      code: 'NO_MATCH',
      message: 'Transaction not found on blockchain',
      detail: 'RPC returned null receipt'
    }
  }

  // Check transaction status
  if (receipt.status !== '0x1') {
    const durationMs = Date.now() - startTime
    console.warn('[x402-rpc] Transaction failed or pending', { txHash: maskedTx, status: receipt.status })

    incrementCounter('x402_rpc_verify_total', { chainId: String(chainId), code: 'NO_MATCH' })
    recordLatency('x402_rpc_verify_latency_ms', { chainId: String(chainId) }, durationMs)

    return {
      ok: false,
      code: 'NO_MATCH',
      message: 'Transaction failed or not confirmed',
      detail: `Transaction status: ${receipt.status || 'unknown'}`
    }
  }

  // Find Transfer logs matching our token
  const logs = receipt.logs || []
  const normalizedToken = normalizeAddress(tokenAddress)
  const normalizedPayTo = normalizeAddress(payTo)

  let foundMatchingToken = false
  let foundMatchingRecipient = false

  for (const log of logs) {
    // Check if this is a Transfer event
    if (log.topics[0] !== TRANSFER_TOPIC0) continue

    // Check if from our expected token
    const logTokenAddr = normalizeAddress(log.address)
    if (logTokenAddr !== normalizedToken) continue

    foundMatchingToken = true

    // Decode 'to' address from topics[2]
    if (log.topics.length < 3) continue

    const toAddress = normalizeAddress(decodeAddressFromTopic(log.topics[2]))

    if (toAddress !== normalizedPayTo) continue

    foundMatchingRecipient = true

    // Decode amount from data
    const transferAmount = decodeUint256(log.data)

    // Check if amount is sufficient
    if (transferAmount < BigInt(amountAtomic)) {
      const durationMs = Date.now() - startTime
      console.warn('[x402-rpc] Insufficient amount', {
        txHash: maskedTx,
        expected: amountAtomic,
        actual: transferAmount.toString()
      })

      incrementCounter('x402_rpc_verify_total', { chainId: String(chainId), code: 'WRONG_AMOUNT' })
      recordLatency('x402_rpc_verify_latency_ms', { chainId: String(chainId) }, durationMs)

      return {
        ok: false,
        code: 'WRONG_AMOUNT',
        message: 'Payment amount is insufficient',
        detail: `Expected ${amountAtomic}, got ${transferAmount}`
      }
    }

    // Success!
    const durationMs = Date.now() - startTime
    console.log('[x402-rpc] RPC verification successful', {
      txHash: maskedTx,
      amountPaid: transferAmount.toString(),
      txFrom: receipt.from ? maskAddress(receipt.from) : '(not available)',
      durationMs
    })

    incrementCounter('x402_rpc_verify_total', { chainId: String(chainId), code: 'success' })
    recordLatency('x402_rpc_verify_latency_ms', { chainId: String(chainId) }, durationMs)

    return {
      ok: true,
      amountPaidAtomic: transferAmount.toString(),
      txFrom: receipt.from, // Transaction sender for wallet binding verification
      providerRaw: { source: 'rpc-fallback', receipt }
    }
  }

  // Determine specific error based on what we found
  const durationMs = Date.now() - startTime
  let code: 'WRONG_ASSET' | 'NO_MATCH'
  let message: string

  if (foundMatchingToken && !foundMatchingRecipient) {
    code = 'NO_MATCH'
    message = 'Payment sent to wrong address'
    console.warn('[x402-rpc] Wrong recipient', { txHash: maskedTx })
  } else if (!foundMatchingToken) {
    code = 'WRONG_ASSET'
    message = 'Wrong token used for payment'
    console.warn('[x402-rpc] Wrong token', { txHash: maskedTx })
  } else {
    code = 'NO_MATCH'
    message = 'No matching transfer found in transaction'
    console.warn('[x402-rpc] No matching transfer', { txHash: maskedTx })
  }

  incrementCounter('x402_rpc_verify_total', { chainId: String(chainId), code })
  recordLatency('x402_rpc_verify_latency_ms', { chainId: String(chainId) }, durationMs)

  return {
    ok: false,
    code,
    message,
    detail: `Found ${logs.length} logs, ${foundMatchingToken ? 'token matched' : 'no token match'}`
  }
}
