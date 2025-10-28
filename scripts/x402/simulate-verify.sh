#!/usr/bin/env bash
# scripts/x402/simulate-verify.sh
# Simulate x402 payment verification flow
# Usage: ./scripts/x402/simulate-verify.sh [base_url]
#
# This script demonstrates the /queue/confirm endpoint with various test cases.
# It does NOT perform real payments—use mock mode or provide test data.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BASE_URL="${1:-http://localhost:3000}"
CONFIRM_ENDPOINT="/api/queue/confirm"

echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🧪 x402 Payment Verification Simulation${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo "Base URL: $BASE_URL"
echo "Endpoint: $CONFIRM_ENDPOINT"
echo ""

# Check if server is reachable
echo -e "${YELLOW}Checking server connectivity...${NC}"
if ! curl -s --connect-timeout 5 "$BASE_URL/api/health" > /dev/null 2>&1; then
  echo -e "${RED}❌ Server not reachable at $BASE_URL${NC}"
  echo "   Make sure the server is running:"
  echo "   npm run dev"
  exit 1
fi
echo -e "${GREEN}✅ Server is reachable${NC}"
echo ""

# Test 1: Missing challengeId (validation error)
echo -e "${BLUE}[Test 1/5]${NC} Testing missing challengeId (validation error)"
echo "Request: {}"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$BASE_URL$CONFIRM_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_BODY=$(echo "$RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

echo "Status: $HTTP_CODE"
echo "Response: $HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"

if [ "$HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✅ Correctly returned 400 for missing challengeId${NC}"
else
  echo -e "${RED}❌ Expected 400, got $HTTP_CODE${NC}"
fi
echo ""

# Test 2: Invalid UUID format
echo -e "${BLUE}[Test 2/5]${NC} Testing invalid challengeId format"
echo "Request: {challengeId: 'not-a-uuid', txHash: '0xabcd...'}"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$BASE_URL$CONFIRM_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"challengeId":"not-a-uuid","txHash":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"}')

HTTP_BODY=$(echo "$RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

echo "Status: $HTTP_CODE"
echo "Response: $HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"

if [ "$HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✅ Correctly rejected invalid UUID${NC}"
else
  echo -e "${RED}❌ Expected 400, got $HTTP_CODE${NC}"
fi
echo ""

# Test 3: Valid UUID but nonexistent challenge
echo -e "${BLUE}[Test 3/5]${NC} Testing nonexistent challenge (NO_MATCH expected)"
FAKE_CHALLENGE_ID="00000000-0000-0000-0000-000000000000"
FAKE_TX_HASH="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
echo "Request: {challengeId: '$FAKE_CHALLENGE_ID', txHash: '$FAKE_TX_HASH'}"

RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$BASE_URL$CONFIRM_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"challengeId\":\"$FAKE_CHALLENGE_ID\",\"txHash\":\"$FAKE_TX_HASH\"}")

HTTP_BODY=$(echo "$RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

echo "Status: $HTTP_CODE"
echo "Response: $HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"

if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "404" ]; then
  echo -e "${GREEN}✅ Correctly returned error for nonexistent challenge${NC}"
else
  echo -e "${YELLOW}⚠️  Unexpected status: $HTTP_CODE${NC}"
fi
echo ""

# Test 4: Mock proof (only works if ENABLE_MOCK_PAYMENTS=true)
echo -e "${BLUE}[Test 4/5]${NC} Testing with mock proof (requires mock mode enabled)"
echo "Checking if mock-proofs endpoint is available..."

MOCK_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$BASE_URL/api/x402/mock-proofs" \
  -H "Content-Type: application/json" \
  -d '{"mode":"txHash"}')

MOCK_HTTP_CODE=$(echo "$MOCK_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$MOCK_HTTP_CODE" = "200" ]; then
  MOCK_BODY=$(echo "$MOCK_RESPONSE" | sed -n '1,/HTTP_STATUS/p' | sed '$d')
  MOCK_TX_HASH=$(echo "$MOCK_BODY" | jq -r '.txHash' 2>/dev/null || echo "")

  if [ -n "$MOCK_TX_HASH" ] && [ "$MOCK_TX_HASH" != "null" ]; then
    echo "Mock TX generated: $MOCK_TX_HASH"
    echo "Note: This TX will only work with a valid challengeId from your DB."
    echo "      To test end-to-end:"
    echo "      1. Submit a track: POST /api/queue/submit"
    echo "      2. Extract challengeId from 402 response"
    echo "      3. Use this mock TX with that challengeId"
    echo ""
    echo -e "${YELLOW}Skipping actual confirm (no real challengeId available)${NC}"
  else
    echo -e "${YELLOW}⚠️  Mock endpoint returned invalid response${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Mock mode not enabled (ENABLE_MOCK_PAYMENTS=false)${NC}"
  echo "   This is expected in production."
fi
echo ""

# Test 5: Method not allowed
echo -e "${BLUE}[Test 5/5]${NC} Testing incorrect HTTP method (GET instead of POST)"
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X GET "$BASE_URL$CONFIRM_ENDPOINT")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

echo "Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "405" ]; then
  echo -e "${GREEN}✅ Correctly returned 405 Method Not Allowed${NC}"
else
  echo -e "${RED}❌ Expected 405, got $HTTP_CODE${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 Simulation Complete${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo ""
echo "💡 To test a real payment flow:"
echo ""
echo "1. Enable x402 mode:"
echo "   export ENABLE_X402=true"
echo "   export X402_MODE=facilitator"
echo ""
echo "2. Submit a track to get a challenge:"
echo "   curl -X POST $BASE_URL/api/queue/submit \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"prompt\":\"test\",\"duration_seconds\":60,\"user_id\":\"<your_user_id>\"}'"
echo ""
echo "3. Extract challengeId and track_id from the 402 response"
echo ""
echo "4. Sign with wallet (use FE or manual EIP-712 signing)"
echo ""
echo "5. Confirm payment:"
echo "   curl -X POST $BASE_URL/api/queue/confirm \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"challengeId\":\"<uuid>\",\"authorization\":{...}}'"
echo ""
echo -e "${GREEN}✅ All simulation tests completed${NC}"
