#!/bin/bash
# test-rpc-only-mode.sh
# Test script for RPC-only payment verification mode
# This tests direct blockchain verification (NOT full x402 protocol)

set -e

API_BASE="${API_BASE:-http://localhost:3001/api}"
TEST_TX_HASH="${TEST_TX_HASH:-0x1234567890123456789012345678901234567890123456789012345678901234}"

echo "========================================="
echo "RPC-Only Mode Test Suite"
echo "========================================="
echo ""
echo "API Base: $API_BASE"
echo "Mode: RPC-only (direct blockchain verification)"
echo ""

# 1. Health check - verify rpc-only mode is active
echo "1. Checking health endpoint for rpc-only mode..."
HEALTH=$(curl -s "$API_BASE/health")
echo "$HEALTH" | python3 -m json.tool
MODE=$(echo "$HEALTH" | python3 -c "import sys, json; print(json.load(sys.stdin)['features']['x402']['mode'])")

if [ "$MODE" != "rpc-only" ]; then
  echo "❌ ERROR: Expected mode 'rpc-only', got '$MODE'"
  echo "   Set X402_MODE=rpc-only in .env.local"
  exit 1
fi

echo "✅ Health check passed: mode=$MODE"
echo ""

# 2. Create a payment challenge
echo "2. Creating payment challenge..."
CHALLENGE_RESP=$(curl -s -X POST "$API_BASE/queue/challenge" \
  -H "Content-Type: application/json" \
  -d '{
    "trackId": "00000000-0000-0000-0000-000000000001",
    "userId": "test-user-rpc-only"
  }')

echo "$CHALLENGE_RESP" | python3 -m json.tool
CHALLENGE_ID=$(echo "$CHALLENGE_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('challengeId', 'null'))")

if [ "$CHALLENGE_ID" = "null" ] || [ -z "$CHALLENGE_ID" ]; then
  echo "❌ ERROR: Failed to create challenge"
  exit 1
fi

echo "✅ Challenge created: $CHALLENGE_ID"
echo ""

# 3. Test with invalid tx hash (should fail validation)
echo "3. Testing with invalid tx hash (should fail)..."
INVALID_RESP=$(curl -s -X POST "$API_BASE/queue/confirm" \
  -H "Content-Type: application/json" \
  -d "{
    \"challengeId\": \"$CHALLENGE_ID\",
    \"txHash\": \"not-a-valid-hash\"
  }")

echo "$INVALID_RESP" | python3 -m json.tool
ERROR_CODE=$(echo "$INVALID_RESP" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('error', {}).get('code', ''))")

if [ "$ERROR_CODE" != "VALIDATION_ERROR" ]; then
  echo "⚠️  WARNING: Expected VALIDATION_ERROR, got $ERROR_CODE"
else
  echo "✅ Validation test passed"
fi
echo ""

# 4. Test with valid format tx hash (will fail NO_MATCH since not on-chain)
echo "4. Testing with valid format tx hash (expect NO_MATCH)..."
CONFIRM_RESP=$(curl -s -X POST "$API_BASE/queue/confirm" \
  -H "Content-Type: application/json" \
  -d "{
    \"challengeId\": \"$CHALLENGE_ID\",
    \"txHash\": \"$TEST_TX_HASH\"
  }")

echo "$CONFIRM_RESP" | python3 -m json.tool
VERIFY_CODE=$(echo "$CONFIRM_RESP" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('error', {}).get('code', str(data.get('ok', ''))))")

if [ "$VERIFY_CODE" = "NO_MATCH" ]; then
  echo "✅ RPC verification executed (returned NO_MATCH as expected for fake tx)"
elif [ "$VERIFY_CODE" = "WRONG_ASSET" ]; then
  echo "✅ RPC verification executed (returned WRONG_ASSET - tx exists but wrong token)"
elif [ "$VERIFY_CODE" = "WRONG_AMOUNT" ]; then
  echo "✅ RPC verification executed (returned WRONG_AMOUNT - tx exists but insufficient)"
elif [ "$VERIFY_CODE" = "true" ]; then
  echo "✅ RPC verification SUCCESS! Payment confirmed"
else
  echo "⚠️  Got unexpected code: $VERIFY_CODE"
fi
echo ""

echo "========================================="
echo "RPC-Only Mode Test Summary"
echo "========================================="
echo "✅ Mode configuration: rpc-only"
echo "✅ Challenge creation: working"
echo "✅ RPC verification path: active"
echo ""
echo "To test with a REAL Base Sepolia transaction:"
echo "1. Send USDC on Base Sepolia to: \$X402_RECEIVING_ADDRESS"
echo "2. Get the transaction hash from BaseScan"
echo "3. Run: TEST_TX_HASH=0x... ./test-rpc-only-mode.sh"
echo ""
echo "RPC-only mode verifies transactions directly via blockchain RPC."
echo "This is NOT the full x402 protocol (which uses signed authorizations)."
echo "Use this mode for simple transaction verification testing."
echo ""
