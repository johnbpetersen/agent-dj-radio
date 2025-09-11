#!/bin/bash

# Manual test script for ephemeral user functionality
# Run this after starting the development server with ENABLE_EPHEMERAL_USERS=true

set -e

BASE_URL="http://localhost:3001"
SESSION_ID=$(uuidgen)

echo "🧪 Testing Ephemeral User Management System"
echo "Session ID: $SESSION_ID"
echo ""

# Test 1: Session Hello - Create new ephemeral user
echo "1️⃣ Testing session creation..."
HELLO_RESPONSE=$(curl -s -X POST "$BASE_URL/api/session/hello" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"display_name": "test_user_123"}')

echo "Response: $HELLO_RESPONSE"

# Extract user ID from response
USER_ID=$(echo "$HELLO_RESPONSE" | grep -o '"id":"[^"]*"' | sed 's/"id":"//' | sed 's/"//')
echo "User ID: $USER_ID"
echo ""

# Test 2: Presence Ping
echo "2️⃣ Testing presence ping..."
PING_RESPONSE=$(curl -s -X POST "$BASE_URL/api/presence/ping" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{}')

echo "Response: $PING_RESPONSE"
echo ""

# Test 3: Active Users List
echo "3️⃣ Testing active users list..."
ACTIVE_RESPONSE=$(curl -s "$BASE_URL/api/users/active?window_secs=120")
echo "Response: $ACTIVE_RESPONSE"
echo ""

# Test 4: User Rename
echo "4️⃣ Testing user rename..."
RENAME_RESPONSE=$(curl -s -X POST "$BASE_URL/api/users/rename" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"new_name": "renamed_test_user"}')

echo "Response: $RENAME_RESPONSE"
echo ""

# Test 5: Bio Update
echo "5️⃣ Testing bio update..."
BIO_RESPONSE=$(curl -s -X POST "$BASE_URL/api/users/bio" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"bio": "This is a test bio for ephemeral user testing"}')

echo "Response: $BIO_RESPONSE"
echo ""

# Test 6: Chat functionality (if enabled)
echo "6️⃣ Testing chat functionality..."
CHAT_POST_RESPONSE=$(curl -s -X POST "$BASE_URL/api/chat/post" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"message": "Hello from test script!"}' \
  2>/dev/null || echo '{"error": "Chat not enabled"}')

echo "Chat post response: $CHAT_POST_RESPONSE"

CHAT_RECENT_RESPONSE=$(curl -s "$BASE_URL/api/chat/recent?limit=10" 2>/dev/null || echo '{"error": "Chat not enabled"}')
echo "Recent messages: $CHAT_RECENT_RESPONSE"
echo ""

# Test 7: Rate Limiting (rename)
echo "7️⃣ Testing rate limiting..."
echo "Attempting rapid renames (should get rate limited)..."

for i in {1..3}; do
  RATE_TEST=$(curl -s -X POST "$BASE_URL/api/users/rename" \
    -H "Content-Type: application/json" \
    -H "X-Session-Id: $SESSION_ID" \
    -d "{\"new_name\": \"rate_test_$i\"}")
  
  echo "Attempt $i: $RATE_TEST"
done
echo ""

# Test 8: Validation Errors
echo "8️⃣ Testing validation errors..."

# Empty display name
EMPTY_NAME=$(curl -s -X POST "$BASE_URL/api/users/rename" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"new_name": ""}')
echo "Empty name test: $EMPTY_NAME"

# Too long bio
LONG_BIO=$(curl -s -X POST "$BASE_URL/api/users/bio" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"bio": "'$(printf 'x%.0s' {1..201})'"}')
echo "Long bio test: $LONG_BIO"
echo ""

# Test 9: Invalid Session ID
echo "9️⃣ Testing invalid session ID..."
INVALID_SESSION=$(curl -s -X POST "$BASE_URL/api/presence/ping" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: invalid-session-id" \
  -d '{}')
echo "Invalid session response: $INVALID_SESSION"
echo ""

# Test 10: Cleanup Worker
echo "🔟 Testing cleanup worker..."
CLEANUP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/worker/cleanup-ephemeral" \
  -H "Content-Type: application/json" \
  -d '{}')
echo "Cleanup response: $CLEANUP_RESPONSE"
echo ""

echo "✅ Test script completed!"
echo ""
echo "📋 Manual UI Testing Steps:"
echo "1. Open browser to http://localhost:5173"
echo "2. Check that ActiveListeners component shows your user"
echo "3. Open ProfileDrawer and test rename/bio functionality"
echo "4. If ENABLE_CHAT_ALPHA=true, test ChatBox component"
echo "5. Submit a track and verify ephemeral user ID is used"
echo "6. Close tab and verify user disappears from ActiveListeners after ~5 minutes"