#!/bin/bash
# scripts/ci-check-discord-refs.sh
# CI check to fail build if Discord/oauth_state/isDiscordLinked appear in runtime code

set -euo pipefail

echo "🔍 Checking for Discord references in runtime code..."

# Patterns to search for (case-insensitive)
PATTERNS="discord|oauth_state|isDiscordLinked"

# Files to search (runtime code only - exclude docs, tests, migrations)
SEARCH_PATHS=(
  "api/**/*.ts"
  "api_handlers/**/*.ts"
  "src/**/*.ts"
  "src/**/*.tsx"
)

# Explicitly allowed exceptions (files that are OK to have references)
ALLOWED_EXCEPTIONS=(
  "api/auth/discord/start.ts"        # Tombstone handler (intentional)
  "api/auth/discord/callback.ts"     # Tombstone handler (intentional)
  "api_handlers/auth/discord/start.ts"    # Tombstone handler (intentional)
  "api_handlers/auth/discord/callback.ts" # Tombstone handler (intentional)
  "scripts/acceptance-discord-removal.ts" # Test script (intentional)
  "scripts/ci-check-discord-refs.sh"      # This file (intentional)
)

# Build ripgrep command with glob patterns
RG_GLOBS=""
for pattern in "${SEARCH_PATHS[@]}"; do
  RG_GLOBS="$RG_GLOBS --glob '$pattern'"
done

# Run ripgrep and capture results
echo "Running: rg -i '$PATTERNS' $RG_GLOBS -S --no-heading --with-filename"
MATCHES=$(eval "rg -i '$PATTERNS' $RG_GLOBS -S --no-heading --with-filename" || true)

if [ -z "$MATCHES" ]; then
  echo "✅ No Discord references found in runtime code"
  exit 0
fi

# Filter out allowed exceptions
FILTERED_MATCHES=""
while IFS= read -r line; do
  if [ -z "$line" ]; then
    continue
  fi

  # Extract filename from line (format: "file:line:content")
  FILE=$(echo "$line" | cut -d':' -f1)

  # Check if file is in allowed exceptions
  IS_ALLOWED=false
  for exception in "${ALLOWED_EXCEPTIONS[@]}"; do
    if [ "$FILE" = "$exception" ]; then
      IS_ALLOWED=true
      break
    fi
  done

  if [ "$IS_ALLOWED" = false ]; then
    FILTERED_MATCHES="$FILTERED_MATCHES$line"$'\n'
  fi
done <<< "$MATCHES"

if [ -z "$FILTERED_MATCHES" ]; then
  echo "✅ No Discord references found in runtime code (allowed exceptions filtered)"
  exit 0
fi

# Found forbidden references
echo "❌ Found Discord references in runtime code:"
echo "$FILTERED_MATCHES"
echo ""
echo "Per CTO requirement: runtime code must not contain discord|oauth_state|isDiscordLinked"
echo "If these are intentional, add them to ALLOWED_EXCEPTIONS in this script."
exit 1
