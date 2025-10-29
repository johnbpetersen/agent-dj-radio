#!/usr/bin/env tsx
// scripts/derive-settler.ts
// Derive Ethereum address from SETTLER_PRIVATE_KEY

import 'dotenv/config'
import { privateKeyToAccount } from 'viem/accounts'

const pk = (process.env.SETTLER_PRIVATE_KEY ?? '').trim()

if (!pk) {
  console.error('❌ SETTLER_PRIVATE_KEY missing in environment')
  process.exit(1)
}

try {
  const account = privateKeyToAccount(pk as `0x${string}`)
  console.log(account.address)
} catch (err) {
  console.error('❌ Invalid SETTLER_PRIVATE_KEY format:', (err as Error).message)
  process.exit(1)
}
