#!/bin/bash
# scripts/test-env-override.sh
# Test script to verify .env.local overrides .env correctly

set -e

echo "🧪 Testing .env.local override behavior"
echo ""

# Backup existing files
if [ -f .env.local ]; then
  echo "📦 Backing up existing .env.local to .env.local.bak"
  cp .env.local .env.local.bak
fi

# Test 1: Create .env.local with ENABLE_MOCK_PAYMENTS=false
echo "📝 Test 1: Create .env.local with ENABLE_MOCK_PAYMENTS=false"
cat > .env.local.test << 'EOF'
# Test override
ENABLE_MOCK_PAYMENTS=false
ENABLE_X402=true
EOF

mv .env.local.test .env.local

echo "✓ Created .env.local with:"
grep "ENABLE_" .env.local || true
echo ""

# Test 2: Check what health endpoint returns
echo "🔍 Test 2: Starting dev server and checking /api/health..."
echo "   (This will take a few seconds)"
echo ""

# Start dev server in background
npm run dev:api > /tmp/dev-server.log 2>&1 &
DEV_PID=$!

# Wait for server to start
sleep 3

# Check health endpoint
echo "📡 Fetching /api/health..."
HEALTH_RESPONSE=$(curl -s http://localhost:3001/api/health)

# Extract x402 flags
MOCK_ENABLED=$(echo $HEALTH_RESPONSE | grep -o '"mockEnabled":[^,}]*' | cut -d: -f2)
X402_ENABLED=$(echo $HEALTH_RESPONSE | grep -o '"enabled":[^,}]*' | cut -d: -f2)

echo ""
echo "Response from /api/health features.x402:"
echo "  enabled: $X402_ENABLED"
echo "  mockEnabled: $MOCK_ENABLED"
echo ""

# Kill dev server
kill $DEV_PID 2>/dev/null || true

# Verify results
if [ "$MOCK_ENABLED" = "false" ]; then
  echo "✅ SUCCESS: .env.local override working correctly!"
  echo "   mockEnabled is false (from .env.local)"
else
  echo "❌ FAILED: .env.local override not working"
  echo "   Expected mockEnabled=false, got mockEnabled=$MOCK_ENABLED"
  exit 1
fi

echo ""
echo "🧹 Cleanup: Restoring original .env.local"
if [ -f .env.local.bak ]; then
  mv .env.local.bak .env.local
  echo "✓ Restored .env.local from backup"
else
  rm -f .env.local
  echo "✓ Removed test .env.local"
fi

echo ""
echo "✨ All tests passed!"
