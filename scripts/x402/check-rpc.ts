#!/usr/bin/env tsx
// scripts/x402/check-rpc.ts
// Verify Base Sepolia RPC connectivity
// Usage: npm run x402:check-rpc

import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'

console.log('🔍 Checking Base Sepolia RPC connectivity...')
console.log(`Endpoint: ${RPC_URL}`)
console.log('')

async function main() {
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL, {
        timeout: 10_000 // 10 second timeout
      })
    })

    // Test 1: Get chain ID
    console.log('[1/3] Fetching chain ID...')
    const chainId = await client.getChainId()
    const expectedChainId = 84532 // Base Sepolia

    if (chainId === expectedChainId) {
      console.log(`✅ Chain ID: ${chainId} (Base Sepolia)`)
    } else {
      console.error(`❌ Unexpected chain ID: ${chainId} (expected ${expectedChainId})`)
      process.exit(1)
    }

    // Test 2: Get latest block number
    console.log('[2/3] Fetching latest block...')
    const blockNumber = await client.getBlockNumber()
    console.log(`✅ Latest block: ${blockNumber}`)

    // Test 3: Get block details
    console.log('[3/3] Fetching block details...')
    const block = await client.getBlock({ blockNumber })
    const blockAge = Date.now() / 1000 - Number(block.timestamp)

    console.log(`✅ Block timestamp: ${new Date(Number(block.timestamp) * 1000).toISOString()}`)
    console.log(`   Block age: ${Math.round(blockAge)}s`)

    if (blockAge > 60) {
      console.warn(`⚠️  Warning: Block is ${Math.round(blockAge)}s old (may be stale)`)
    }

    console.log('')
    console.log('✅ RPC connection successful!')
    process.exit(0)

  } catch (error: any) {
    console.error('')
    console.error('❌ RPC connection failed:')
    console.error(`   ${error.message}`)

    if (error.message?.includes('timeout')) {
      console.error('')
      console.error('💡 Troubleshooting:')
      console.error('   - Check your internet connection')
      console.error('   - Verify BASE_SEPOLIA_RPC_URL is correct')
      console.error('   - Try a different RPC provider (Alchemy, Infura)')
    } else if (error.message?.includes('ENOTFOUND')) {
      console.error('')
      console.error('💡 DNS resolution failed. Check the RPC URL.')
    }

    process.exit(1)
  }
}

main()
