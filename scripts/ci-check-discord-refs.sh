#!/usr/bin/env bash
# scripts/ci-check-discord-refs.sh
# CI check to fail build if Discord/oauth_state/isDiscordLinked appear in runtime code

set -euo pipefail

echo "🔍 Checking for forbidden Discord references in runtime code..."

# Patterns to search for (case-insensitive)
PATTERNS="discord|oauth_state|isDiscordLinked"

# Allowlist: paths that are OK to mention Discord
ALLOWLIST=(
  "*.md"
  "docs/**"
  "CHANGELOG*"
  ".git/**"
  "package.json"
  "scripts/ci-check-discord-refs.sh"
  "scripts/smoke-baseline.sh"
  "scripts/acceptance-discord-removal.ts"
  "scripts/test-*.sh"
  "test-*.sh"
  "api/auth/discord/**"
  "api_handlers/auth/discord/**"
  "**/*.test.ts"
  "**/*.test.js"
  "**/*.bak"
  "supabase/migrations/**"
)

# Prefer ripgrep (rg) if available; fallback to grep
if command -v rg &> /dev/null; then
  SEARCH_CMD="rg"
else
  SEARCH_CMD="grep"
fi

# Run the search
if [ "$SEARCH_CMD" = "rg" ]; then
  # ripgrep: build exclude arguments
  EXCLUDE_ARGS=()
  for pattern in "${ALLOWLIST[@]}"; do
    EXCLUDE_ARGS+=("--glob" "!${pattern}")
  done

  # Run ripgrep (case-insensitive, print matches with line numbers)
  if rg -i "${EXCLUDE_ARGS[@]}" -n "$PATTERNS" . 2>/dev/null; then
    echo ""
    echo "❌ FAIL: Found forbidden Discord references in runtime code (see above)."
    echo "   Allowed locations: ${ALLOWLIST[*]}"
    exit 1
  else
    echo "✅ PASS: No forbidden Discord references found in runtime code."
    exit 0
  fi
else
  # grep fallback: recursively search, excluding allowlist paths
  TEMP_RESULTS=$(mktemp)

  find . -type f \
    ! -path "*.md" \
    ! -path "*/docs/*" \
    ! -path "CHANGELOG*" \
    ! -path "*/.git/*" \
    ! -path "package.json" \
    ! -path "scripts/ci-check-discord-refs.sh" \
    ! -path "scripts/smoke-baseline.sh" \
    ! -path "scripts/acceptance-discord-removal.ts" \
    ! -path "scripts/test-*.sh" \
    ! -path "test-*.sh" \
    ! -path "*/api/auth/discord/*" \
    ! -path "*/api_handlers/auth/discord/*" \
    ! -path "**/*.test.ts" \
    ! -path "**/*.test.js" \
    ! -path "**/*.bak" \
    ! -path "supabase/migrations/*" \
    -exec grep -niH -E "$PATTERNS" {} + > "$TEMP_RESULTS" 2>/dev/null || true

  if [ -s "$TEMP_RESULTS" ]; then
    cat "$TEMP_RESULTS"
    rm "$TEMP_RESULTS"
    echo ""
    echo "❌ FAIL: Found forbidden Discord references in runtime code (see above)."
    echo "   Allowed locations: ${ALLOWLIST[*]}"
    exit 1
  else
    rm "$TEMP_RESULTS"
    echo "✅ PASS: No forbidden Discord references found in runtime code."
    exit 0
  fi
fi
