#!/usr/bin/env bash
# scripts/smoke-chat.sh - Verify unconditional chat gate
# Usage: ./scripts/smoke-chat.sh [base-url]

set -e

BASE_URL="${1:-http://localhost:3001}"

echo "=== Chat Gate Smoke Test ==="
echo "Testing against: $BASE_URL"
echo ""

# 1. Get session cookie (creates guest user)
echo "1. Creating guest session via /api/session/whoami..."
RESPONSE=$(curl -s -c /tmp/smoke-chat-cookie.txt "$BASE_URL/api/session/whoami")
echo "Response:"
echo "$RESPONSE" | jq '.'

# Extract userId and canChat
USER_ID=$(echo "$RESPONSE" | jq -r '.userId')
CAN_CHAT=$(echo "$RESPONSE" | jq -r '.capabilities.canChat')
echo ""
echo "userId: $USER_ID"
echo "canChat: $CAN_CHAT"
echo ""

# 2. Try to post as guest → expect 403 CHAT_REQUIRES_LINKED
echo "2. Guest POST /api/chat/post (should fail with 403)..."
POST_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -b /tmp/smoke-chat-cookie.txt \
  -X POST "$BASE_URL/api/chat/post" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello from smoke test"}')

HTTP_STATUS=$(echo "$POST_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=$(echo "$POST_RESPONSE" | grep -v "HTTP_STATUS:")

echo "HTTP Status: $HTTP_STATUS"
echo "Response Body:"
echo "$BODY" | jq '.'
echo ""

# Verify expected behavior
if [ "$CAN_CHAT" = "false" ] && [ "$HTTP_STATUS" = "403" ]; then
  ERROR_CODE=$(echo "$BODY" | jq -r '.error.code // empty')
  if [ "$ERROR_CODE" = "CHAT_REQUIRES_LINKED" ]; then
    echo "✅ PASS: Guest correctly denied with CHAT_REQUIRES_LINKED"
  else
    echo "❌ FAIL: Expected error.code=CHAT_REQUIRES_LINKED, got: $ERROR_CODE"
    exit 1
  fi
elif [ "$CAN_CHAT" = "true" ] && [ "$HTTP_STATUS" = "201" ]; then
  echo "✅ PASS: Linked user allowed to chat (ephemeral=false)"
else
  echo "❌ FAIL: Unexpected behavior"
  echo "  canChat=$CAN_CHAT, HTTP_STATUS=$HTTP_STATUS"
  exit 1
fi

echo ""
echo "=== Manual Test Instructions ==="
echo "To test linked user flow:"
echo "1. Find user in database: psql> SELECT * FROM users WHERE id='$USER_ID';"
echo "2. Flip ephemeral flag: psql> UPDATE users SET ephemeral=false WHERE id='$USER_ID';"
echo "3. Re-run this script"
echo "4. Expected: whoami shows canChat=true, POST returns 201"
echo ""

# Cleanup
rm -f /tmp/smoke-chat-cookie.txt

echo "✅ Smoke test complete"
