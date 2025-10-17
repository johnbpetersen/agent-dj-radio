#!/usr/bin/env bash
# scripts/smoke-link-unlink.sh - Verify dev provider link/unlink lifecycle
# Usage: ./scripts/smoke-link-unlink.sh [base-url]

set -euo pipefail

BASE="${BASE_URL:-${1:-http://localhost:3001}}"
COOKIE_FILE="/tmp/smoke-link-unlink-cookie.txt"

echo "=== Dev Provider Link/Unlink Smoke Test ==="
echo "Testing against: $BASE"
echo ""

# Cleanup old cookie file
rm -f "$COOKIE_FILE"

echo "1. Creating new guest session via /api/session/whoami..."
WHOAMI_1=$(curl -s -c "$COOKIE_FILE" "$BASE/api/session/whoami")
echo "$WHOAMI_1" | jq '.'

USER_ID=$(echo "$WHOAMI_1" | jq -r '.userId')
EPHEMERAL_1=$(echo "$WHOAMI_1" | jq -r '.ephemeral')
CAN_CHAT_1=$(echo "$WHOAMI_1" | jq -r '.capabilities.canChat')

echo ""
echo "userId: $USER_ID"
echo "ephemeral: $EPHEMERAL_1 (should be true)"
echo "canChat: $CAN_CHAT_1 (should be false)"
echo ""

# Verify guest state
if [ "$EPHEMERAL_1" != "true" ] || [ "$CAN_CHAT_1" != "false" ]; then
  echo "❌ FAIL: Initial guest state incorrect"
  exit 1
fi

echo "2. Attempting to post chat message as guest (should fail with 403)..."
CHAT_1=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/api/chat/post" \
  -d '{"message":"guest chat attempt"}')

HTTP_STATUS_1=$(echo "$CHAT_1" | grep "HTTP_STATUS:" | cut -d: -f2)
CHAT_BODY_1=$(echo "$CHAT_1" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS_1"
echo "$CHAT_BODY_1" | jq '.'
echo ""

if [ "$HTTP_STATUS_1" != "403" ]; then
  echo "❌ FAIL: Expected 403 for guest chat, got $HTTP_STATUS_1"
  exit 1
fi

echo "✅ Guest chat correctly blocked"
echo ""

echo "3. Linking dev provider via POST /api/auth/link/dev..."
LINK_1=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b "$COOKIE_FILE" \
  -X POST "$BASE/api/auth/link/dev")

HTTP_STATUS_LINK=$(echo "$LINK_1" | grep "HTTP_STATUS:" | cut -d: -f2)
LINK_BODY=$(echo "$LINK_1" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS_LINK"
echo "$LINK_BODY" | jq '.'
echo ""

if [ "$HTTP_STATUS_LINK" != "201" ]; then
  echo "❌ FAIL: Expected 201 for link, got $HTTP_STATUS_LINK"
  exit 1
fi

EPHEMERAL_AFTER_LINK=$(echo "$LINK_BODY" | jq -r '.ephemeral')
if [ "$EPHEMERAL_AFTER_LINK" != "false" ]; then
  echo "❌ FAIL: Expected ephemeral=false after link, got $EPHEMERAL_AFTER_LINK"
  exit 1
fi

echo "✅ Dev provider linked successfully"
echo ""

echo "4. Verifying identity after link via /api/session/whoami..."
WHOAMI_2=$(curl -s -b "$COOKIE_FILE" "$BASE/api/session/whoami")
echo "$WHOAMI_2" | jq '.'

USER_ID_2=$(echo "$WHOAMI_2" | jq -r '.userId')
EPHEMERAL_2=$(echo "$WHOAMI_2" | jq -r '.ephemeral')
CAN_CHAT_2=$(echo "$WHOAMI_2" | jq -r '.capabilities.canChat')

echo ""
echo "userId: $USER_ID_2 (should match: $USER_ID)"
echo "ephemeral: $EPHEMERAL_2 (should be false)"
echo "canChat: $CAN_CHAT_2 (should be true)"
echo ""

if [ "$USER_ID" != "$USER_ID_2" ]; then
  echo "❌ FAIL: userId changed after link"
  exit 1
fi

if [ "$EPHEMERAL_2" != "false" ] || [ "$CAN_CHAT_2" != "true" ]; then
  echo "❌ FAIL: State after link incorrect"
  exit 1
fi

echo "✅ Identity preserved, capabilities updated"
echo ""

echo "5. Attempting to post chat message as linked user (should succeed)..."
CHAT_2=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/api/chat/post" \
  -d '{"message":"linked user chat"}')

HTTP_STATUS_2=$(echo "$CHAT_2" | grep "HTTP_STATUS:" | cut -d: -f2)
CHAT_BODY_2=$(echo "$CHAT_2" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS_2"
echo "$CHAT_BODY_2" | jq '.'
echo ""

if [ "$HTTP_STATUS_2" != "201" ]; then
  echo "❌ FAIL: Expected 201 for linked user chat, got $HTTP_STATUS_2"
  exit 1
fi

echo "✅ Linked user chat allowed"
echo ""

echo "6. Attempting to link again (should fail with 409)..."
LINK_2=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b "$COOKIE_FILE" \
  -X POST "$BASE/api/auth/link/dev")

HTTP_STATUS_LINK_2=$(echo "$LINK_2" | grep "HTTP_STATUS:" | cut -d: -f2)
LINK_BODY_2=$(echo "$LINK_2" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS_LINK_2"
echo "$LINK_BODY_2" | jq '.'
echo ""

if [ "$HTTP_STATUS_LINK_2" != "409" ]; then
  echo "❌ FAIL: Expected 409 for duplicate link, got $HTTP_STATUS_LINK_2"
  exit 1
fi

echo "✅ Duplicate link correctly rejected with 409"
echo ""

echo "7. Unlinking dev provider via POST /api/auth/unlink/dev..."
UNLINK_1=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b "$COOKIE_FILE" \
  -X POST "$BASE/api/auth/unlink/dev")

HTTP_STATUS_UNLINK=$(echo "$UNLINK_1" | grep "HTTP_STATUS:" | cut -d: -f2)
UNLINK_BODY=$(echo "$UNLINK_1" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS_UNLINK"
echo "$UNLINK_BODY" | jq '.'
echo ""

if [ "$HTTP_STATUS_UNLINK" != "200" ]; then
  echo "❌ FAIL: Expected 200 for unlink, got $HTTP_STATUS_UNLINK"
  exit 1
fi

EPHEMERAL_AFTER_UNLINK=$(echo "$UNLINK_BODY" | jq -r '.ephemeral')
if [ "$EPHEMERAL_AFTER_UNLINK" != "true" ]; then
  echo "❌ FAIL: Expected ephemeral=true after unlink, got $EPHEMERAL_AFTER_UNLINK"
  exit 1
fi

echo "✅ Dev provider unlinked successfully"
echo ""

echo "8. Verifying identity after unlink via /api/session/whoami..."
WHOAMI_3=$(curl -s -b "$COOKIE_FILE" "$BASE/api/session/whoami")
echo "$WHOAMI_3" | jq '.'

USER_ID_3=$(echo "$WHOAMI_3" | jq -r '.userId')
EPHEMERAL_3=$(echo "$WHOAMI_3" | jq -r '.ephemeral')
CAN_CHAT_3=$(echo "$WHOAMI_3" | jq -r '.capabilities.canChat')

echo ""
echo "userId: $USER_ID_3 (should match: $USER_ID)"
echo "ephemeral: $EPHEMERAL_3 (should be true)"
echo "canChat: $CAN_CHAT_3 (should be false)"
echo ""

if [ "$USER_ID" != "$USER_ID_3" ]; then
  echo "❌ FAIL: userId changed after unlink"
  exit 1
fi

if [ "$EPHEMERAL_3" != "true" ] || [ "$CAN_CHAT_3" != "false" ]; then
  echo "❌ FAIL: State after unlink incorrect"
  exit 1
fi

echo "✅ Identity preserved, capabilities reverted"
echo ""

echo "9. Attempting to post chat message after unlink (should fail with 403)..."
CHAT_3=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/api/chat/post" \
  -d '{"message":"guest chat after unlink"}')

HTTP_STATUS_3=$(echo "$CHAT_3" | grep "HTTP_STATUS:" | cut -d: -f2)
CHAT_BODY_3=$(echo "$CHAT_3" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS_3"
echo "$CHAT_BODY_3" | jq '.'
echo ""

if [ "$HTTP_STATUS_3" != "403" ]; then
  echo "❌ FAIL: Expected 403 for guest chat after unlink, got $HTTP_STATUS_3"
  exit 1
fi

echo "✅ Chat correctly blocked after unlink"
echo ""

echo "10. Unlinking again (idempotency check - should succeed with 200)..."
UNLINK_2=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b "$COOKIE_FILE" \
  -X POST "$BASE/api/auth/unlink/dev")

HTTP_STATUS_UNLINK_2=$(echo "$UNLINK_2" | grep "HTTP_STATUS:" | cut -d: -f2)

echo "HTTP Status: $HTTP_STATUS_UNLINK_2"
echo "$UNLINK_2" | grep -v "HTTP_STATUS:" | jq '.'
echo ""

if [ "$HTTP_STATUS_UNLINK_2" != "200" ]; then
  echo "❌ FAIL: Expected 200 for idempotent unlink, got $HTTP_STATUS_UNLINK_2"
  exit 1
fi

echo "✅ Idempotent unlink works"
echo ""

# Cleanup
rm -f "$COOKIE_FILE"

echo "=== ALL TESTS PASSED ==="
echo ""
echo "Summary:"
echo "  ✅ Guest session created (ephemeral=true, canChat=false)"
echo "  ✅ Guest chat blocked with 403"
echo "  ✅ Dev provider linked (ephemeral=false, canChat=true)"
echo "  ✅ Linked user chat allowed"
echo "  ✅ Duplicate link rejected with 409"
echo "  ✅ Dev provider unlinked (ephemeral=true, canChat=false)"
echo "  ✅ Chat blocked after unlink"
echo "  ✅ Idempotent unlink works"
echo "  ✅ userId preserved throughout lifecycle: $USER_ID"
echo ""
