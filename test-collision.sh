#!/bin/bash
# Manual test script for display_name collision handling
# Tests that /api/auth/discord/start handles 23505 gracefully

set -e

echo "=== Display Name Collision Test ==="
echo ""
echo "Prerequisites:"
echo "  1. Local dev server running: npm run dev"
echo "  2. DATABASE_URL env var set (for psql access)"
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set. Export it from .env.local:"
  echo "   export DATABASE_URL='postgresql://...'"
  exit 1
fi

# Pre-insert a user to force collision
echo "Step 1: Pre-inserting user with common name 'purple_raccoon'..."
psql "$DATABASE_URL" -c "
  INSERT INTO users (id, display_name, ephemeral, banned, created_at)
  VALUES (gen_random_uuid(), 'purple_raccoon', true, false, now())
  ON CONFLICT (display_name) DO NOTHING;
" > /dev/null

echo "✅ User 'purple_raccoon' inserted"
echo ""

# Hit /start endpoint
echo "Step 2: Testing /api/auth/discord/start endpoint..."
echo ""

response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3001/api/auth/discord/start)
status=$(echo "$response" | grep "HTTP_STATUS" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_STATUS/d')

echo "Response status: $status"
echo ""

if [ "$status" = "302" ]; then
  echo "✅ SUCCESS: Endpoint returned 302 (redirect to Discord)"
  echo "   Collision was handled gracefully with suffix"

  # Check for Set-Cookie headers
  headers=$(curl -si http://localhost:3001/api/auth/discord/start | grep -i "set-cookie")
  if echo "$headers" | grep -q "sid="; then
    echo "✅ Set-Cookie: sid found"
  else
    echo "⚠️  Set-Cookie: sid NOT found (unexpected)"
  fi

  if echo "$headers" | grep -q "oauth_state="; then
    echo "✅ Set-Cookie: oauth_state found"
  else
    echo "⚠️  Set-Cookie: oauth_state NOT found (unexpected)"
  fi

  echo ""
  echo "=== TEST PASSED ==="
  exit 0

elif [ "$status" = "500" ]; then
  echo "❌ FAILURE: Endpoint returned 500 (internal server error)"
  echo "   Collision was NOT handled"
  echo ""
  echo "Response body:"
  echo "$body"
  echo ""
  echo "=== TEST FAILED ==="
  exit 1

else
  echo "⚠️  UNEXPECTED: Endpoint returned $status"
  echo ""
  echo "Response body:"
  echo "$body"
  echo ""
  echo "=== TEST INCONCLUSIVE ==="
  exit 1
fi
