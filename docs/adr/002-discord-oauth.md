# ADR 002: Discord OAuth Account Linking

**Status:** Implemented
**Date:** 2025-10-27
**Authors:** Claude Code
**Related Migrations:** `013_user_accounts.sql`, `014_oauth_states.sql`

## Context

Users need a persistent identity beyond ephemeral guest sessions. Discord OAuth provides a trusted, widely-used authentication mechanism that allows users to:
- Link their Discord account to establish persistent identity
- Access features requiring verified accounts (e.g., chat)
- Maintain consistent display names across sessions

**Design constraints:**
- Must work within Vercel Hobby tier (single catch-all serverless function)
- Feature-flagged for gradual rollout
- Session-based identity remains primary; OAuth is opt-in linking
- Idempotent operations to handle retries and race conditions

## Decision

We implement Discord OAuth 2.0 with PKCE as an **account linking** flow (not primary authentication). Users start as ephemeral guests and can optionally link Discord to gain persistent identity.

### Architecture

```
┌─────────────────┐
│ Ephemeral User  │
│ (cookie-based)  │
└────────┬────────┘
         │
         │ Click "Link Discord"
         ▼
┌─────────────────┐
│ OAuth Flow      │
│ (PKCE)          │
└────────┬────────┘
         │
         │ Success
         ▼
┌─────────────────┐
│ Linked User     │
│ (ephemeral=f)   │
└─────────────────┘
```

### Key Tables

```sql
-- Stores linked external accounts
CREATE TABLE user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,  -- 'discord'
  provider_user_id text NOT NULL,  -- Discord user ID
  meta jsonb,  -- {id, username, discriminator, global_name, avatar, linked_at}
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)  -- One Discord account = one user
);

-- Stores temporary OAuth state (PKCE)
CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  provider text NOT NULL,  -- 'discord'
  state text NOT NULL UNIQUE,  -- Random state parameter
  code_verifier text NOT NULL,  -- PKCE code_verifier
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## Implementation

### Endpoints

All endpoints are routed through `api/[...all].ts` (single serverless function).

#### 1. GET `/api/auth/discord/start`

**Purpose:** Initiate Discord OAuth flow
**Feature flag:** `ENABLE_DISCORD_LINKING=true`

**Request:**
- Cookie: `sid` (session ID)
- Header: `Accept: application/json` (optional, for JSON response)

**Response (JSON mode):**
```json
{
  "authorizeUrl": "https://discord.com/oauth2/authorize?..."
}
```

**Response (HTML mode):**
- 302 redirect to Discord authorize URL

**Rate Limiting:**
- Session-scoped cooldown: 3 seconds between calls
- Returns 429 if called too frequently

**Error Codes:**
- `404` - Feature disabled (`ENABLE_DISCORD_LINKING !== 'true'`)
- `429` - Too many requests (3s cooldown)
- `500` - Internal error

**State Management:**
- Generates cryptographically random `state` and `code_verifier` (PKCE)
- Stores in `oauth_states` with 10-minute TTL
- Links to current session for CSRF protection

#### 2. GET `/api/auth/discord/callback`

**Purpose:** Complete OAuth flow and link account
**Feature flag:** `ENABLE_DISCORD_LINKING=true`

**Request:**
- Query params: `code`, `state` (from Discord)
- Cookie: `sid` (must match session from `/start`)

**Success Response (HTML mode):**
- 302 redirect to SPA with `?discord_linked=1`

**Success Response (JSON mode):**
```json
{
  "success": true,
  "userId": "uuid",
  "provider": "discord",
  "discordUser": {
    "id": "123456789",
    "username": "cooluser",
    "global_name": "Cool User"
  }
}
```

**Error Response (HTML mode):**
- 302 redirect to SPA with `?discord_error=ERROR_CODE`

**Error Response (JSON mode):**
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  },
  "requestId": "correlation-id"
}
```

**Error Codes:**
- `INVALID_STATE` - State parameter invalid or expired
- `EXPIRED_STATE` - OAuth state older than TTL (10 minutes)
- `WRONG_SESSION` - State belongs to different session (CSRF)
- `ACCOUNT_IN_USE` - Discord account already linked to another user
- `OAUTH_FAILED` - Discord API returned 4xx error
- `OAUTH_UNAVAILABLE` - Discord API returned 5xx error or network error

**Idempotency:**
- Uses "insert-first" pattern for `user_accounts`
- If unique constraint violated, checks if same user (idempotent) or different user (conflict)
- Allows re-linking same Discord account to same user (no-op)
- Rejects linking Discord account already linked to different user

**State Cleanup:**
- OAuth states are one-time use (deleted in `finally` block after validation)
- Stale states cleaned up by admin endpoint (see below)

#### 3. POST `/api/auth/discord/unlink`

**Purpose:** Unlink Discord account
**Feature flag:** `ALLOW_DISCORD_UNLINK=true`

**Request:**
- Cookie: `sid`
- Header: `Accept: application/json`

**Response:**
```json
{
  "success": true,
  "ephemeral": true
}
```

**Behavior:**
- Deletes row from `user_accounts` where `provider='discord'` and `user_id=current_user`
- Recomputes `ephemeral` flag: `true` if no remaining linked accounts, else `false`
- Returns updated `ephemeral` status

**Error Codes:**
- `404` - Feature disabled
- `404` - No Discord account to unlink
- `500` - Internal error

#### 4. GET `/api/admin/cleanup/oauth-states`

**Purpose:** Delete stale OAuth states (TTL cleanup)
**Auth:** Requires `x-admin-token` header matching `ADMIN_TOKEN` env var

**Response:**
```json
{
  "deleted": 42
}
```

**Behavior:**
- Deletes `oauth_states` rows where `created_at < now() - interval '1 day'`
- Intended for scheduled cron job or manual cleanup
- Returns count of deleted rows

**Error Codes:**
- `401` - Missing or invalid admin token

### Environment Variables & Guardrails

**Required for production (`STAGE=prod`):**
```bash
ENABLE_DISCORD_LINKING=true           # Feature flag (FAIL if false in prod)
DISCORD_CLIENT_ID=<oauth_client_id>   # From Discord Developer Portal (FAIL if missing)
DISCORD_REDIRECT_URI=https://...      # Callback URL (FAIL if missing)
DISCORD_CLIENT_SECRET=<secret>        # Optional for PKCE (WARN if missing)
```

**Recommended for production:**
```bash
REQUIRE_LINKED_FOR_CHAT=true         # Enforce linked-only chat (WARN if false)
OAUTH_STATE_TTL_SEC=600              # Default 10 minutes
DISCORD_API_BASE=https://discord.com/api  # Default Discord API
```

**Development/Debug:**
```bash
DEBUG_AUTH=1                         # Include sessionId in whoami (WARN if enabled in prod)
```

**Admin:**
```bash
ADMIN_TOKEN=<secure_random_string>   # For cleanup endpoint
```

**Guardrails (enforced by `scripts/check-env.ts`):**
- In `STAGE=prod`: FAIL if Discord OAuth not properly configured
- WARN if `DEBUG_AUTH=1` in production
- WARN if `REQUIRE_LINKED_FOR_CHAT !== 'true'` (we ship with linked-only chat)

### Display Name Precedence

When a user links Discord, their display name is computed by `getPreferredDisplayName(userId)`:

1. **Discord linked:** Return `formatDiscordHandle(meta)`
   - Prefer `meta.global_name` (Discord's new display name system)
   - Fallback to `username#discriminator` (legacy format, if `discriminator !== '0'`)
   - Fallback to `username` (new format with discriminator='0')
2. **No Discord link:** Return `users.display_name` (ephemeral guest name)
3. **Fallback:** Return `'anon'` if all else fails

**Usage:**
- `/api/session/whoami` - Returns preferred display name in response
- `/api/chat/post` - Stamps `display_name` column with preferred name
- UI components - Consume `identity.displayName` from whoami response

### Rate Limiting

**Start endpoint (`/api/auth/discord/start`):**
- Session-scoped cooldown: 1 call per 3 seconds
- Prevents OAuth state table spam
- Returns 429 with `Retry-After` header if violated

**Chat endpoint (`/api/chat/post`):**
- User-scoped: 1 message per 2 seconds (existing, unchanged)

### Linked-Only Chat

**Server enforcement:**
```typescript
canChat = !user.banned && !user.ephemeral
```

- Guest users (`ephemeral=true`) cannot post chat messages
- Server returns 403 with code `CHAT_REQUIRES_LINKED`
- UI shows "Link Discord to chat" CTA button

**Client gating:**
- Chat composer disabled for ephemeral users
- Shows "Link Discord" button that navigates to `/api/auth/discord/start`
- Auto-enables after successful link (listens for `user-identity-refresh` event)

## Troubleshooting

### INVALID_STATE or EXPIRED_STATE

**Symptoms:** Callback fails with 302 redirect to `?discord_error=INVALID_STATE`

**Causes:**
- OAuth state expired (TTL > 10 minutes)
- User navigated away and came back after TTL
- State already consumed (one-time use)

**Resolution:**
- Click "Link Discord" again to start fresh flow
- States are cleaned up automatically on use or via admin endpoint

### ACCOUNT_IN_USE

**Symptoms:** Callback fails with banner "This Discord account is already linked to a different user"

**Causes:**
- Discord account already linked to another session/user
- Common when user has multiple browser sessions

**Resolution:**
- Unlink from other session first
- Or use the already-linked session

### 429 Too Many Requests (Start Endpoint)

**Symptoms:** Clicking "Link Discord" returns 429

**Causes:**
- Clicked multiple times within 3 seconds

**Resolution:**
- Wait 3 seconds and try again
- Client should debounce button clicks

### 403 Forbidden (Chat)

**Symptoms:** Cannot send chat messages, get 403 error

**Causes:**
- User is ephemeral (not linked to Discord)
- User is banned

**Resolution:**
- Link Discord account via "Link Discord" button
- If banned, contact admin

### Missing authorizeUrl in Start Response

**Symptoms:** Start endpoint returns 404 or error

**Causes:**
- `ENABLE_DISCORD_LINKING !== 'true'`
- Missing `DISCORD_CLIENT_ID` or `DISCORD_REDIRECT_URI`

**Resolution:**
- Check environment variables are set correctly
- Run `scripts/check-env.ts` to verify configuration

## Testing

**Unit tests:**
- `tests/api/auth/discord/start.test.ts` - Start endpoint, rate limiting
- `tests/api/auth/discord/callback.test.ts` - Callback success, errors, idempotency
- `tests/api/auth/discord/unlink.test.ts` - Unlink flow
- `tests/api/admin/cleanup.test.ts` - Cleanup endpoint
- `tests/api/session/whoami.test.ts` - Display name preference
- `tests/api/chat/post-authz.test.ts` - Linked-only enforcement

**Integration tests:**
- `tests/api/auth/link-unlink-dev.test.ts` - Full flow (link → unlink → relink)

**Manual smoke testing:**
```bash
# Run against production
./scripts/smoke-prod-oauth.sh https://agent-dj-radio.vercel.app

# Expected:
# 1. whoami → 200 (ephemeral user)
# 2. start → 200 (authorizeUrl present)
# 3. chat recent → 200
# 4. chat post → 403 (ephemeral user blocked)
```

**Cleanup script:**
```bash
# Delete stale OAuth states (1 day old)
ADMIN_TOKEN=<secret> ./scripts/cleanup-oauth-states.sh https://agent-dj-radio.vercel.app
```

## Security Considerations

1. **PKCE:** Code exchange uses PKCE (RFC 7636) to prevent authorization code interception
2. **State CSRF:** OAuth state parameter tied to session, validated on callback
3. **One-time Use:** OAuth states deleted after validation (consumed or expired)
4. **TTL:** States expire after 10 minutes to limit window of attack
5. **Session Verification:** Callback requires same session that initiated flow
6. **Rate Limiting:** Start endpoint limited to prevent state table spam
7. **Idempotency:** Duplicate link attempts handled gracefully (no data corruption)
8. **Conflict Detection:** Prevents account hijacking via ACCOUNT_IN_USE error
9. **Admin Protection:** Cleanup endpoint requires secure token authentication

## Monitoring

**Key metrics to track:**
- OAuth start calls (should match callback attempts)
- Callback success rate (target >90%)
- Error breakdown (INVALID_STATE, ACCOUNT_IN_USE, etc.)
- Average flow completion time
- Stale state accumulation (should be cleaned up)

**Structured logging:**
- All endpoints log with `correlationId` for request tracing
- Errors logged with error code, status, and context
- No tokens or secrets in logs (only ID prefixes)

## Future Enhancements

- **Multiple providers:** GitHub, Google, Twitter OAuth
- **Account merging:** Link multiple providers to same user
- **Unlink restrictions:** Require at least one linked account before unlinking
- **OAuth refresh:** Store and refresh access tokens for API calls
- **Scope expansion:** Request additional Discord permissions (guilds, email)

## References

- Discord OAuth2 Docs: https://discord.com/developers/docs/topics/oauth2
- RFC 7636 (PKCE): https://datatracker.ietf.org/doc/html/rfc7636
- ADR 001: Durable Session-Based Identity
