#!/usr/bin/env bash
# scripts/smoke-discord-start.sh
# Smoke test: Discord OAuth start endpoint (PKCE generation + state storage)
#
# Tests:
# 1. GET /api/session/whoami → ensures session cookie
# 2. GET /api/auth/discord/start (Accept: application/json) → returns authorizeUrl
# 3. Validates URL contains required OAuth params
# 4. Verifies PKCE parameters (state, code_challenge_method=S256, code_challenge)
#
# Prerequisites:
# - Dev server running on API_BASE (default: http://localhost:3001)
# - ENABLE_DISCORD_LINKING=true in .env
# - DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI configured
# - Migration 20250124_oauth_states applied
#
# Usage:
#   bash scripts/smoke-discord-start.sh
#   API_BASE=http://localhost:3001 bash scripts/smoke-discord-start.sh

set -euo pipefail

# Configuration
API_BASE="${API_BASE:-http://localhost:3001}"
COOKIE_FILE=$(mktemp)
trap "rm -f $COOKIE_FILE" EXIT

EXIT_CODE=0

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
  EXIT_CODE=1
}

log_section() {
  echo -e "${BLUE}=== $1 ===${NC}"
}

# Check if jq is available
if ! command -v jq &> /dev/null; then
  log_error "jq is required but not installed. Install with: apt-get install jq / brew install jq"
  exit 1
fi

echo ""
log_section "Discord OAuth Start Smoke Test"
log_info "Testing against: $API_BASE"
echo ""

# Test 1: Ensure session cookie exists
log_section "Test 1: Session Cookie Setup"
log_info "GET $API_BASE/api/session/whoami"

RESPONSE1=$(curl -s -w "\n%{http_code}" \
  -X GET \
  -H "Accept: application/json" \
  -c "$COOKIE_FILE" \
  "$API_BASE/api/session/whoami" 2>&1 || echo -e "\n000")

HTTP_CODE1=$(echo "$RESPONSE1" | tail -n1)
BODY1=$(echo "$RESPONSE1" | sed '$d')

if [[ "$HTTP_CODE1" =~ ^2[0-9]{2}$ ]]; then
  log_info "✓ Session endpoint responded: $HTTP_CODE1"

  # Check if session cookie was set
  if grep -q "session_id" "$COOKIE_FILE" 2>/dev/null || grep -q "sid" "$COOKIE_FILE" 2>/dev/null; then
    log_info "✓ Session cookie set"
  else
    log_warn "No session cookie found (may already exist from previous requests)"
  fi
else
  log_error "Session endpoint failed: $HTTP_CODE1"
  echo "$BODY1" | head -20
fi

echo ""

# Test 2: Discord OAuth start (JSON mode)
log_section "Test 2: Discord OAuth Start Endpoint"
log_info "GET $API_BASE/api/auth/discord/start (Accept: application/json)"

RESPONSE2=$(curl -s -w "\n%{http_code}" \
  -X GET \
  -H "Accept: application/json" \
  -b "$COOKIE_FILE" \
  "$API_BASE/api/auth/discord/start" 2>&1 || echo -e "\n000")

HTTP_CODE2=$(echo "$RESPONSE2" | tail -n1)
BODY2=$(echo "$RESPONSE2" | sed '$d')

if [ "$HTTP_CODE2" == "404" ]; then
  log_error "Got 404 - is ENABLE_DISCORD_LINKING=true in .env?"
  echo "$BODY2" | jq '.' 2>/dev/null || echo "$BODY2"
elif [ "$HTTP_CODE2" == "400" ]; then
  log_error "Got 400 - check DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI in .env"
  echo "$BODY2" | jq '.' 2>/dev/null || echo "$BODY2"
elif [ "$HTTP_CODE2" == "200" ]; then
  log_info "✓ Endpoint responded: 200 OK"

  # Parse authorizeUrl from JSON
  AUTHORIZE_URL=$(echo "$BODY2" | jq -r '.authorizeUrl // empty')

  if [ -z "$AUTHORIZE_URL" ]; then
    log_error "Response missing 'authorizeUrl' field"
    echo "$BODY2" | jq '.'
  else
    log_info "✓ Received authorizeUrl (${#AUTHORIZE_URL} chars)"
    echo ""

    # Test 3: Validate URL structure
    log_section "Test 3: Authorize URL Validation"
    log_info "URL: $AUTHORIZE_URL"
    echo ""

    # Extract query parameters
    if [[ "$AUTHORIZE_URL" =~ discord\.com/api/oauth2/authorize ]]; then
      log_info "✓ URL points to Discord OAuth endpoint"
    else
      log_error "URL does not match Discord OAuth endpoint pattern"
    fi

    # Check for required parameters using grep
    MISSING_PARAMS=()

    if echo "$AUTHORIZE_URL" | grep -q "client_id="; then
      CLIENT_ID=$(echo "$AUTHORIZE_URL" | grep -oP 'client_id=\K[^&]+')
      log_info "✓ client_id: $CLIENT_ID"
    else
      log_error "✗ Missing client_id parameter"
      MISSING_PARAMS+=("client_id")
    fi

    if echo "$AUTHORIZE_URL" | grep -q "redirect_uri="; then
      REDIRECT_URI=$(echo "$AUTHORIZE_URL" | grep -oP 'redirect_uri=\K[^&]+' | head -1)
      # URL decode for display
      REDIRECT_URI_DECODED=$(printf '%b' "${REDIRECT_URI//%/\\x}")
      log_info "✓ redirect_uri: $REDIRECT_URI_DECODED"
    else
      log_error "✗ Missing redirect_uri parameter"
      MISSING_PARAMS+=("redirect_uri")
    fi

    if echo "$AUTHORIZE_URL" | grep -q "state="; then
      STATE=$(echo "$AUTHORIZE_URL" | grep -oP 'state=\K[^&]+')
      log_info "✓ state: ${STATE:0:16}... (${#STATE} chars)"
    else
      log_error "✗ Missing state parameter"
      MISSING_PARAMS+=("state")
    fi

    if echo "$AUTHORIZE_URL" | grep -q "scope=identify"; then
      log_info "✓ scope: identify"
    else
      log_error "✗ Missing or incorrect scope parameter (expected 'identify')"
      MISSING_PARAMS+=("scope=identify")
    fi

    if echo "$AUTHORIZE_URL" | grep -q "code_challenge_method=S256"; then
      log_info "✓ code_challenge_method: S256"
    else
      log_error "✗ Missing or incorrect code_challenge_method (expected 'S256')"
      MISSING_PARAMS+=("code_challenge_method=S256")
    fi

    if echo "$AUTHORIZE_URL" | grep -q "code_challenge="; then
      CODE_CHALLENGE=$(echo "$AUTHORIZE_URL" | grep -oP 'code_challenge=\K[^&]+')
      log_info "✓ code_challenge: ${CODE_CHALLENGE:0:16}... (${#CODE_CHALLENGE} chars)"

      # Validate code_challenge looks like base64url (alphanumeric + - and _)
      if [[ "$CODE_CHALLENGE" =~ ^[A-Za-z0-9_-]+$ ]]; then
        log_info "✓ code_challenge is valid base64url format"
      else
        log_error "✗ code_challenge contains invalid characters (not base64url)"
      fi
    else
      log_error "✗ Missing code_challenge parameter"
      MISSING_PARAMS+=("code_challenge")
    fi

    if echo "$AUTHORIZE_URL" | grep -q "response_type=code"; then
      log_info "✓ response_type: code"
    else
      log_error "✗ Missing or incorrect response_type (expected 'code')"
      MISSING_PARAMS+=("response_type=code")
    fi

    echo ""

    if [ ${#MISSING_PARAMS[@]} -eq 0 ]; then
      log_info "✓ All required OAuth parameters present"
    else
      log_error "Missing parameters: ${MISSING_PARAMS[*]}"
    fi
  fi
else
  log_error "Unexpected status code: $HTTP_CODE2"
  echo "$BODY2" | jq '.' 2>/dev/null || echo "$BODY2"
fi

echo ""

# Test 4: HTML redirect mode (optional - just verify it doesn't crash)
log_section "Test 4: HTML Redirect Mode"
log_info "GET $API_BASE/api/auth/discord/start (Accept: text/html)"

RESPONSE4=$(curl -s -w "\n%{http_code}" \
  -X GET \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
  -b "$COOKIE_FILE" \
  -o /dev/null \
  "$API_BASE/api/auth/discord/start" 2>&1 || echo "000")

HTTP_CODE4=$(echo "$RESPONSE4" | tail -n1)

if [ "$HTTP_CODE4" == "302" ]; then
  log_info "✓ Returns 302 redirect for HTML requests"
elif [ "$HTTP_CODE4" == "404" ]; then
  log_warn "Got 404 (feature flag may be disabled)"
elif [ "$HTTP_CODE4" == "400" ]; then
  log_warn "Got 400 (env config issue)"
else
  log_error "Expected 302 redirect, got: $HTTP_CODE4"
fi

echo ""

# Summary
log_section "Summary"
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ All smoke tests PASSED${NC}"
  echo ""
  log_info "Discord OAuth start endpoint is working correctly"
  log_info "Next steps:"
  log_info "  1. Copy the authorizeUrl and visit it in a browser"
  log_info "  2. Implement the callback handler to complete the OAuth flow"
  echo ""
else
  echo -e "${RED}❌ Some smoke tests FAILED${NC}"
  echo ""
  log_error "Check the errors above and verify:"
  log_error "  - Dev server is running"
  log_error "  - ENABLE_DISCORD_LINKING=true in .env"
  log_error "  - DISCORD_CLIENT_ID and DISCORD_REDIRECT_URI are set"
  log_error "  - Migration 20250124_oauth_states.sql has been applied"
  echo ""
fi

exit $EXIT_CODE
