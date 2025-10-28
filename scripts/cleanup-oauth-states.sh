#!/usr/bin/env bash
# cleanup-oauth-states.sh
# Calls the admin cleanup endpoint to delete stale OAuth states (older than 1 day)
#
# Usage:
#   ADMIN_TOKEN=<secret> ./scripts/cleanup-oauth-states.sh <base_url>
#
# Example:
#   ADMIN_TOKEN=my-secret ./scripts/cleanup-oauth-states.sh https://agent-dj-radio.vercel.app

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -ne 1 ]; then
  echo -e "${RED}Error: Base URL required${NC}"
  echo "Usage: ADMIN_TOKEN=<secret> $0 <base_url>"
  echo "Example: ADMIN_TOKEN=my-secret $0 https://agent-dj-radio.vercel.app"
  exit 1
fi

BASE_URL="$1"

# Validate BASE_URL format
if [[ ! "$BASE_URL" =~ ^https?:// ]]; then
  echo -e "${RED}Error: BASE_URL must start with http:// or https://${NC}"
  exit 1
fi

# Check for ADMIN_TOKEN
if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo -e "${RED}Error: ADMIN_TOKEN environment variable is required${NC}"
  echo "Usage: ADMIN_TOKEN=<secret> $0 $BASE_URL"
  exit 1
fi

# Endpoint URL
ENDPOINT="${BASE_URL}/api/admin/cleanup/oauth-states"

echo -e "${YELLOW}🧹 Cleaning up stale OAuth states...${NC}"
echo "Endpoint: $ENDPOINT"
echo ""

# Call the cleanup endpoint
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -H "Accept: application/json" \
  "$ENDPOINT")

# Split response body and status code
HTTP_BODY=$(echo "$RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

echo "HTTP Status: $HTTP_CODE"
echo "Response:"
echo "$HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"
echo ""

# Check status code
if [ "$HTTP_CODE" -eq 200 ]; then
  DELETED=$(echo "$HTTP_BODY" | jq -r '.deleted' 2>/dev/null || echo "unknown")
  echo -e "${GREEN}✅ Success: Deleted $DELETED stale OAuth state(s)${NC}"
  exit 0
elif [ "$HTTP_CODE" -eq 401 ]; then
  echo -e "${RED}❌ Unauthorized: Invalid or missing admin token${NC}"
  exit 1
else
  echo -e "${RED}❌ Error: Cleanup failed with status $HTTP_CODE${NC}"
  exit 1
fi
