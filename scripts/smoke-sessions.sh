#!/usr/bin/env bash
# smoke-sessions.sh - Manual smoke test for durable session-based identity
#
# Tests the 3 key scenarios:
# 1. First visit (no cookie) → new user + session
# 2. Second visit (same cookie) → SAME user_id (proves durability)
# 3. Orphaned cookie (delete session row) → new user + warning
#
# Usage:
#   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> bash scripts/smoke-sessions.sh
#
# Prerequisites:
#   - Local dev server running: npm run dev:api
#   - Migration 012 applied: sessions table exists
#   - ENABLE_EPHEMERAL_USERS=true in .env

set -euo pipefail

# Configuration
API_BASE="${API_BASE:-http://localhost:3001}"
COOKIE_FILE=$(mktemp)
trap "rm -f $COOKIE_FILE" EXIT

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Scenario 1: First visit (no cookie) → new user + session
log_info "=== Scenario 1: First visit (no cookie) ==="
log_info "Calling /api/session/hello without any cookie..."

RESPONSE1=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -c "$COOKIE_FILE" \
  "$API_BASE/api/session/hello")

HTTP_CODE1=$(echo "$RESPONSE1" | tail -n1)
BODY1=$(echo "$RESPONSE1" | sed '$d')

if [ "$HTTP_CODE1" != "200" ] && [ "$HTTP_CODE1" != "201" ]; then
  log_error "Expected 200/201, got $HTTP_CODE1"
  echo "$BODY1" | jq '.'
  exit 1
fi

USER_ID_1=$(echo "$BODY1" | jq -r '.user.id')
SESSION_ID_1=$(echo "$BODY1" | jq -r '.session_id')
DISPLAY_NAME_1=$(echo "$BODY1" | jq -r '.user.display_name')

log_info "✓ Received new user: $USER_ID_1 ($DISPLAY_NAME_1)"
log_info "✓ Session ID: $SESSION_ID_1"

# Check cookie was set
if grep -q "sid=$SESSION_ID_1" "$COOKIE_FILE"; then
  log_info "✓ Cookie set correctly: sid=$SESSION_ID_1"
else
  log_error "Cookie not set properly"
  cat "$COOKIE_FILE"
  exit 1
fi

# Verify session row exists in DB (optional - requires DB access)
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  log_info "Verifying session row in database..."
  SESSION_CHECK=$(curl -s \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    "$SUPABASE_URL/rest/v1/sessions?session_id=eq.$SESSION_ID_1&select=user_id")

  DB_USER_ID=$(echo "$SESSION_CHECK" | jq -r '.[0].user_id // empty')

  if [ "$DB_USER_ID" == "$USER_ID_1" ]; then
    log_info "✓ Session row exists in DB: session_id=$SESSION_ID_1 → user_id=$USER_ID_1"
  else
    log_error "Session row not found or mismatched in DB"
    echo "$SESSION_CHECK"
    exit 1
  fi
fi

echo ""

# Scenario 2: Second visit (same cookie) → SAME user_id
log_info "=== Scenario 2: Second visit (same cookie) ==="
log_info "Calling /api/session/hello WITH the cookie from Scenario 1..."
log_info "Expected: SAME user_id ($USER_ID_1)"

sleep 1  # Brief pause to simulate time passing

RESPONSE2=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -b "$COOKIE_FILE" \
  "$API_BASE/api/session/hello")

HTTP_CODE2=$(echo "$RESPONSE2" | tail -n1)
BODY2=$(echo "$RESPONSE2" | sed '$d')

if [ "$HTTP_CODE2" != "200" ]; then
  log_error "Expected 200, got $HTTP_CODE2"
  echo "$BODY2" | jq '.'
  exit 1
fi

USER_ID_2=$(echo "$BODY2" | jq -r '.user.id')
SESSION_ID_2=$(echo "$BODY2" | jq -r '.session_id')

if [ "$USER_ID_2" == "$USER_ID_1" ] && [ "$SESSION_ID_2" == "$SESSION_ID_1" ]; then
  log_info "✓ PASS: Identity persisted! user_id=$USER_ID_2 (matches Scenario 1)"
  log_info "✓ PASS: session_id also matches: $SESSION_ID_2"
else
  log_error "FAIL: user_id or session_id changed!"
  log_error "  Scenario 1: user_id=$USER_ID_1, session_id=$SESSION_ID_1"
  log_error "  Scenario 2: user_id=$USER_ID_2, session_id=$SESSION_ID_2"
  exit 1
fi

echo ""

# Scenario 3 (optional - requires DB access): Orphaned cookie
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  log_info "=== Scenario 3: Orphaned cookie (session row deleted) ==="
  log_info "Deleting session row from DB (simulating data loss)..."

  DELETE_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: return=minimal" \
    "$SUPABASE_URL/rest/v1/sessions?session_id=eq.$SESSION_ID_1")

  DELETE_CODE=$(echo "$DELETE_RESPONSE" | tail -n1)

  if [ "$DELETE_CODE" == "204" ]; then
    log_info "✓ Session row deleted successfully"
  else
    log_warn "Could not delete session row (code $DELETE_CODE)"
  fi

  log_info "Calling /api/session/hello again with orphaned cookie..."
  log_info "Expected: NEW user_id (cannot recover old identity)"

  sleep 1

  RESPONSE3=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -b "$COOKIE_FILE" \
    "$API_BASE/api/session/hello")

  HTTP_CODE3=$(echo "$RESPONSE3" | tail -n1)
  BODY3=$(echo "$RESPONSE3" | sed '$d')

  if [ "$HTTP_CODE3" != "200" ] && [ "$HTTP_CODE3" != "201" ]; then
    log_error "Expected 200/201, got $HTTP_CODE3"
    echo "$BODY3" | jq '.'
    exit 1
  fi

  USER_ID_3=$(echo "$BODY3" | jq -r '.user.id')
  SESSION_ID_3=$(echo "$BODY3" | jq -r '.session_id')

  if [ "$USER_ID_3" != "$USER_ID_1" ]; then
    log_info "✓ PASS: New user created (old identity unrecoverable): $USER_ID_3"
    log_info "  Session ID reused: $SESSION_ID_3"
  else
    log_error "FAIL: user_id should have changed (got same user_id as Scenario 1)"
    exit 1
  fi

  log_warn "Check server logs for '[session-mapping-missing]' warning"
else
  log_warn "Skipping Scenario 3 (requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)"
fi

echo ""
log_info "=== All smoke tests PASSED ✓ ==="
log_info "Summary:"
log_info "  Scenario 1: Created user=$USER_ID_1, session=$SESSION_ID_1"
log_info "  Scenario 2: Identity persisted (same user_id)"
if [ -n "${USER_ID_3:-}" ]; then
  log_info "  Scenario 3: Orphaned cookie → new user=$USER_ID_3"
fi
