#!/usr/bin/env bash
# smoke-prod-oauth.sh
# Smoke test for Discord OAuth and linked-only chat in production
#
# Usage:
#   ./scripts/smoke-prod-oauth.sh <base_url>
#
# Example:
#   ./scripts/smoke-prod-oauth.sh https://agent-dj-radio.vercel.app

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -ne 1 ]; then
  echo -e "${RED}Error: Base URL required${NC}"
  echo "Usage: $0 <base_url>"
  echo "Example: $0 https://agent-dj-radio.vercel.app"
  exit 1
fi

BASE_URL="$1"

# Validate BASE_URL format
if [[ ! "$BASE_URL" =~ ^https?:// ]]; then
  echo -e "${RED}Error: BASE_URL must start with http:// or https://${NC}"
  exit 1
fi

# Strip trailing slash
BASE_URL="${BASE_URL%/}"

# Cookie jar for session persistence
COOKIE_JAR=$(mktemp)
trap "rm -f $COOKIE_JAR" EXIT

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🧪 Discord OAuth + Linked-Only Chat Smoke Test${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo "Base URL: $BASE_URL"
echo "Session cookies: $COOKIE_JAR"
echo ""

# Helper function to run test
run_test() {
  local name="$1"
  local expected_status="$2"
  local actual_status="$3"
  local extra_check="${4:-}"

  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  if [ "$actual_status" -eq "$expected_status" ]; then
    # Check extra validation if provided
    if [ -n "$extra_check" ]; then
      if eval "$extra_check"; then
        echo -e "${GREEN}✅ PASS${NC}: $name"
        PASSED_TESTS=$((PASSED_TESTS + 1))
      else
        echo -e "${RED}❌ FAIL${NC}: $name (status OK but validation failed)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
      fi
    else
      echo -e "${GREEN}✅ PASS${NC}: $name"
      PASSED_TESTS=$((PASSED_TESTS + 1))
    fi
  else
    echo -e "${RED}❌ FAIL${NC}: $name (expected $expected_status, got $actual_status)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
}

# Test 1: GET /api/session/whoami
echo -e "${YELLOW}Test 1: GET /api/session/whoami${NC}"
RESPONSE=$(curl -si -c "$COOKIE_JAR" \
  -H "Accept: application/json" \
  "$BASE_URL/api/session/whoami" 2>/dev/null)
STATUS=$(echo "$RESPONSE" | grep -i "^HTTP" | tail -n1 | awk '{print $2}')
BODY=$(echo "$RESPONSE" | sed '1,/^\r$/d')
echo "Status: $STATUS"
echo "Response: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Check if session was created (should have set-cookie)
HAS_SESSION_COOKIE=$(echo "$RESPONSE" | grep -ic "set-cookie" || true)
run_test "whoami returns 200" 200 "$STATUS" "[ $HAS_SESSION_COOKIE -gt 0 ]"
echo ""

# Test 2: GET /api/auth/discord/start
echo -e "${YELLOW}Test 2: GET /api/auth/discord/start${NC}"
RESPONSE=$(curl -si -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -H "Accept: application/json" \
  "$BASE_URL/api/auth/discord/start" 2>/dev/null)
STATUS=$(echo "$RESPONSE" | grep -i "^HTTP" | tail -n1 | awk '{print $2}')
BODY=$(echo "$RESPONSE" | sed '1,/^\r$/d')
echo "Status: $STATUS"
echo "Response: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Check if authorizeUrl is present
HAS_AUTHORIZE_URL=0
if echo "$BODY" | jq -e '.authorizeUrl' > /dev/null 2>&1; then
  HAS_AUTHORIZE_URL=1
fi
run_test "discord/start returns 200 with authorizeUrl" 200 "$STATUS" "[ $HAS_AUTHORIZE_URL -eq 1 ]"
echo ""

# Test 3: GET /api/chat/recent
echo -e "${YELLOW}Test 3: GET /api/chat/recent${NC}"
RESPONSE=$(curl -si -b "$COOKIE_JAR" \
  -H "Accept: application/json" \
  "$BASE_URL/api/chat/recent" 2>/dev/null)
STATUS=$(echo "$RESPONSE" | grep -i "^HTTP" | tail -n1 | awk '{print $2}')
BODY=$(echo "$RESPONSE" | sed '1,/^\r$/d')
echo "Status: $STATUS"
echo "Response: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

run_test "chat/recent returns 200" 200 "$STATUS"
echo ""

# Test 4: POST /api/chat/post (ephemeral user should get 403)
echo -e "${YELLOW}Test 4: POST /api/chat/post (ephemeral user)${NC}"
RESPONSE=$(curl -si -b "$COOKIE_JAR" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"message":"Smoke test message"}' \
  "$BASE_URL/api/chat/post" 2>/dev/null)
STATUS=$(echo "$RESPONSE" | grep -i "^HTTP" | tail -n1 | awk '{print $2}')
BODY=$(echo "$RESPONSE" | sed '1,/^\r$/d')
echo "Status: $STATUS"
echo "Response: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Check if error code is CHAT_REQUIRES_LINKED
HAS_CORRECT_ERROR=0
if echo "$BODY" | jq -e '.error.code == "CHAT_REQUIRES_LINKED"' > /dev/null 2>&1; then
  HAS_CORRECT_ERROR=1
fi
run_test "chat/post returns 403 CHAT_REQUIRES_LINKED for ephemeral user" 403 "$STATUS" "[ $HAS_CORRECT_ERROR -eq 1 ]"
echo ""

# Summary
echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 Test Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════${NC}"
echo "Total tests: $TOTAL_TESTS"
echo -e "Passed: ${GREEN}$PASSED_TESTS${NC}"
echo -e "Failed: ${RED}$FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
  echo -e "${GREEN}✅ All smoke tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some smoke tests failed${NC}"
  exit 1
fi
