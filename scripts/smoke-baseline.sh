#!/usr/bin/env bash
# scripts/smoke-baseline.sh
# Smoke test: Verify Discord routes are gone and /api/session/hello works
#
# Prerequisites:
# - Dev server must be running on BASE_URL (default: http://localhost:3001)
# - No router test suite exists yet (future work)
#
# Expected results:
# - POST /api/session/hello → 2xx
# - GET  /api/auth/discord/start → 404 or 410
# - GET  /api/auth/discord/callback → 404 or 410

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
EXIT_CODE=0

echo "🧪 Running baseline smoke tests against $BASE_URL"
echo ""

# Test 1: Session hello endpoint
echo "Test 1: POST $BASE_URL/api/session/hello"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/session/hello" || echo -e "\n000")
STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$STATUS" =~ ^2[0-9]{2}$ ]]; then
  echo "  ✅ PASS: Got $STATUS (expected 2xx)"
else
  echo "  ❌ FAIL: Got $STATUS (expected 2xx)"
  echo "  Response body:"
  echo "$BODY" | head -20
  EXIT_CODE=1
fi
echo ""

# Test 2: Discord start (tombstone)
echo "Test 2: GET $BASE_URL/api/auth/discord/start"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/discord/start" || echo "000")
if [[ "$STATUS" == "404" || "$STATUS" == "410" ]]; then
  echo "  ✅ PASS: Got $STATUS (expected 404 or 410)"
else
  echo "  ❌ FAIL: Got $STATUS (expected 404 or 410)"
  EXIT_CODE=1
fi
echo ""

# Test 3: Discord callback (tombstone)
echo "Test 3: GET $BASE_URL/api/auth/discord/callback"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/discord/callback" || echo "000")
if [[ "$STATUS" == "404" || "$STATUS" == "410" ]]; then
  echo "  ✅ PASS: Got $STATUS (expected 404 or 410)"
else
  echo "  ❌ FAIL: Got $STATUS (expected 404 or 410)"
  EXIT_CODE=1
fi
echo ""

# Summary
if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ All smoke tests passed"
else
  echo "❌ Some smoke tests failed"
fi

exit $EXIT_CODE
