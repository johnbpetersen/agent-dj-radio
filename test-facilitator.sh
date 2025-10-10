#!/bin/bash
# Quick test to see if x402 facilitator endpoint is responding

echo "Testing x402 facilitator endpoint..."
echo ""

# Test 1: Basic connectivity
echo "=== Test 1: Basic POST to /verify ==="
curl -v -X POST https://x402.org/facilitator/verify \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{}'
echo ""
echo ""

# Test 2: Minimal valid-looking payload
echo "=== Test 2: Minimal canonical payload (dummy data) ==="
curl -v -X POST https://x402.org/facilitator/verify \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
  "scheme": "erc3009",
  "chainId": 8453,
  "tokenAddress": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "payTo": "0x1234567890123456789012345678901234567890",
  "amountAtomic": "10000",
  "authorization": {
    "from": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "to": "0x1234567890123456789012345678901234567890",
    "value": "10000",
    "validAfter": "1",
    "validBefore": "9999999999",
    "nonce": "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480",
    "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
  }
}'
echo ""
echo ""

echo "=== Tests complete ==="
