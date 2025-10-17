# ADR 001: Durable Session-Based Identity

**Status:** Implemented
**Date:** 2025-10-17
**Authors:** Claude Code
**Related Migration:** `012_durable_sessions.sql`

## Context

Previously, guest user identity was implicitly tied to the `presence` table, which has a short TTL (~5 minutes). When presence expired, the same browser cookie would create a **duplicate user** on the next request because there was no durable mapping from `session_id` (cookie value) to `user_id`.

This caused poor UX:
- Users lost their identity between visits
- Chat history was fragmented across duplicate user accounts
- Session cookies were technically 30-day but practically ephemeral due to presence TTL gating

**Key constraint:** Discord OAuth has been fully removed. Identity must now be cookie-based only, with no external providers in this phase.

## Decision

We introduce a **durable sessions table** as the authoritative source of session→user identity mappings:

```sql
CREATE TABLE public.sessions (
  session_id uuid PRIMARY KEY,          -- Client cookie value
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
```

### Key Principles

1. **Source of Truth:** The `sessions` table is the **only** source of identity. Presence is ephemeral metadata only.
2. **Idempotent Requests:** `/api/session/hello` can be called repeatedly with the same cookie and will always return the same `user_id`.
3. **Presence Never Queried for Identity:** When `sid` cookie exists, we lookup `sessions` table first. Presence is upserted (write-only from identity perspective).
4. **30-Day Durability:** Sessions persist for 30 days (cookie `Max-Age`). Identity survives presence expiry and browser closures.

## Implementation

### Cookie Contract

- Name: `sid` (session ID)
- Value: UUIDv4 (generated via `generateCorrelationId()`)
- Attributes: `HttpOnly; SameSite=Lax; Secure (HTTPS only); Path=/; Max-Age=2592000` (30 days)
- Set once per new session; not refreshed on every request

**Cross-Runtime Cookie Setting:**
The `setSessionCookie()` helper supports three response object types to work across different runtime environments:
1. **Node.js ServerResponse** (Vercel prod) - uses `setHeader`/`getHeader` methods
2. **Fetch-style Response** (Vercel dev, edge runtime) - uses `headers.append` method
3. **Plain object bag** (test environments) - mutates `headers` property directly

The `Secure` flag is applied conservatively: only when `x-forwarded-proto === 'https'` (primary check) or `NODE_ENV === 'production'` (fallback). This ensures cookies work correctly in both local HTTP development and production HTTPS deployments.

### Request Flow (`ensureSession()`)

```typescript
// api/_shared/session-helpers.ts : ensureSession()

1. Extract sid from cookie or X-Session-Id header
2. Validate sid is valid UUIDv4 (reject malformed)

3. IF sid exists:
   a. Lookup sessions table: SELECT user_id FROM sessions WHERE session_id = sid
   b. IF found:
      - Update sessions.last_seen_at = now()
      - Fetch users.display_name
      - UPSERT presence (ephemeral, NOT read for identity)
      - Return { userId, sessionId, shouldSetCookie: false }
   c. IF NOT found (session mapping lost):
      - Log WARNING: "session-mapping-missing"
      - Fall through to create new user (cannot recover old identity)

4. IF no sid OR sid invalid OR session not found:
   a. Generate new sid (or reuse orphaned sid if present)
   b. Create new guest user with collision-safe name (createGuestUserWithUniqueName)
   c. INSERT INTO sessions (session_id, user_id, created_at, last_seen_at)
   d. UPSERT presence
   e. Return { userId, sessionId, shouldSetCookie: true }
```

### Race Safety

**Concurrent first requests:**
If two requests with the same new `sid` race:
- First insert wins (PK constraint on `session_id`)
- Second insert gets `23505` error → reads winning row → uses winner's `user_id`
- Both requests converge to same `user_id` (no duplicate users)

**Presence expiry:**
- Does NOT affect identity (sessions table remains intact)
- Presence is recreated on next `/api/session/hello` call

### Migration Strategy

**Forward:**
```sql
-- Create sessions table with indexes
-- Enable RLS (no policies - service-role only)
```

**Rollback:**
```sql
-- Drop sessions table
-- Revert api_handlers/session/hello.ts to use presence-based identity
```

## Consequences

### Positive

✅ **Persistent Guest Identity:** Users keep the same ID across visits (30-day window)
✅ **Simpler Identity Model:** Single source of truth (sessions table), not derived from presence TTL
✅ **Better UX:** Chat messages, reactions, and user state persist across sessions
✅ **Explicit Lifecycle:** Sessions have clear created_at/last_seen_at timestamps for cleanup
✅ **Future-Ready:** Foundation for wallet linking (flip `ephemeral` flag on link)

### Negative

⚠️ **Data Loss Scenario:** If `sessions` row is deleted but cookie persists, old identity is **unrecoverable** (new guest user created)
⚠️ **Orphaned Users:** If user clears cookies frequently, may accumulate stale guest users (mitigated by cleanup job based on `last_seen_at`)
⚠️ **Storage Cost:** Small increase (~50 bytes/session × active users)

### Neutral

🔹 **No Behavioral Change for New Users:** First-visit flow identical
🔹 **No New Required Env Vars:** Uses existing Supabase service role
🔹 **Backward Incompatible with Old Cookies:** Pre-migration cookies with no `sessions` mapping will create new users (acceptable for early beta)

## Testing

**Unit Tests:** `tests/api/session/durable-identity.test.ts`
- Scenario 1: New visitor → creates user + session + cookie
- Scenario 2: Existing cookie after presence expiry → SAME `user_id` (key invariant)
- Scenario 3: Orphaned cookie (no session row) → new user + warning
- Edge: Invalid UUID → treated as missing
- Edge: Concurrent inserts → no duplicate users

**Smoke Test:** `scripts/smoke-sessions.sh` (manual verification)

## Alternatives Considered

**A1: Keep presence as identity source, increase TTL**
❌ Rejected: Doesn't solve fundamental issue (still expires), just delays it

**A2: Store session→user mapping in cookie value**
❌ Rejected: Cookies are client-controlled, not trustworthy for identity binding

**A3: Use Supabase Auth with anonymous users**
❌ Rejected: Adds dependency, overkill for simple guest sessions

## Future Work

- **Session Cleanup Job:** Delete `sessions` where `last_seen_at < now() - interval '30 days'`
- **User Cleanup Job:** Delete `users` where `ephemeral = true AND id NOT IN (SELECT user_id FROM sessions)`
- **Wallet Linking:** When user links wallet, flip `users.ephemeral = false` and bind via `user_accounts` table
- **Session Analytics:** Track session duration, return visit rate via `created_at` / `last_seen_at`

## Read-Only Identity Endpoint

**Endpoint:** `GET /api/session/whoami`

Returns current user identity derived from durable session (no writes except presence telemetry):

```typescript
// Response shape
{
  userId: string
  displayName: string
  ephemeral: boolean
  kind: 'human' | 'agent'
  banned: boolean
  createdAt: string
  capabilities: {
    canChat: boolean
  }
  sessionId?: string // Only included when DEBUG_AUTH=1
}
```

**Key behaviors:**
- **GET-only endpoint** (POST returns 405)
- Idempotent read operation - safe to call repeatedly
- Uses `ensureSession()` - may create new session if cookie missing/invalid
- Sets cookie on first visit or when came from header
- Fetches identity from `sessions → users` (never queries `presence`)
- Only includes `sessionId` in response when `DEBUG_AUTH=1` env var is set

**Use cases:**
- Client-side identity hydration on page load (`getWhoAmI()` helper)
- Debugging session state with DEBUG_AUTH=1
- Checking ban/ephemeral status before actions

## Rename Endpoint

**Endpoint:** `POST /api/users/rename`

Allows guest users to change their display name with collision safety:

```typescript
// Request body
{
  displayName: string  // 3-24 chars, lowercase/digits/underscores only
}

// Response (200)
{
  userId: string
  displayName: string
}
```

**Validation Rules:**
- Pattern: `^[a-z0-9_]{3,24}$` (lowercase letters, digits, underscores)
- No leading/trailing whitespace
- Length: 3-24 characters

**Key behaviors:**
- **POST-only endpoint** - body must be JSON with `displayName` field
- Uses `ensureSession()` to get userId from durable sessions (NOT presence)
- **Collision handling:** Returns **409 Conflict** with `{ code: "NAME_TAKEN" }` if name taken
  - No auto-suffixing (user must choose different name manually)
  - Different from first-visit flow which does auto-suffix
- **No-op handling:** Returns **200 OK** if renaming to current name (no DB write)
- **Banned users:** Returns **403 Forbidden** - banned users cannot rename
- **Rate limiting:** Optional dev-only limit (1/min) when `ENABLE_RENAME_RL=true` (default: off)
  - Returns **429 Too Many Requests** with `{ code: "RATE_LIMITED" }`

**Error Responses:**
- 400: Invalid displayName (empty, too short/long, bad chars, whitespace)
- 403: User is banned
- 409: Name already taken (`NAME_TAKEN` code)
- 429: Rate limited (if enabled)

**Use cases:**
- Guest users personalizing their randomly-assigned names
- Changing name before linking wallet (preserves identity)
- Testing name availability without auto-suffix fallback

## Guest Capabilities & Chat Gate

**Feature Flag:** `REQUIRE_LINKED_FOR_CHAT` (default: `false`)

Controls whether guest (ephemeral) users can post chat messages:

```typescript
// Capability computation logic
function computeCanChat(user: { banned: boolean; ephemeral: boolean }): boolean {
  // Banned users can never chat
  if (user.banned) return false

  // If flag is not set or 'false', everyone can chat
  if (process.env.REQUIRE_LINKED_FOR_CHAT !== 'true') return true

  // If flag is 'true', only non-ephemeral users can chat
  return !user.ephemeral
}
```

**Capability Exposure:**

The `canChat` capability is exposed via `/api/session/whoami` response:

```typescript
{
  userId: "...",
  displayName: "cosmic_dolphin",
  ephemeral: true,
  banned: false,
  capabilities: {
    canChat: true  // Computed from user state + feature flag
  }
}
```

**Chat Gate Enforcement:**

The `POST /api/chat/post` endpoint enforces the chat gate:

1. Fetches user from durable sessions (via `ensureSession()`)
2. Computes `canChat` capability using same logic as whoami
3. If `canChat === false`:
   - **Banned users:** Returns **403 Forbidden** with generic "User is banned" message
   - **Guest with flag ON:** Returns **403 Forbidden** with error code `CHAT_REQUIRES_LINKED`
4. If `canChat === true`: Proceeds with message validation and insertion

**Error Response (guest gated):**

```json
{
  "error": {
    "code": "CHAT_REQUIRES_LINKED",
    "message": "Chat requires a linked account"
  },
  "requestId": "..."
}
```

**Use Cases:**

- **Flag OFF (default):** All users (guest + linked) can chat (current behavior)
- **Flag ON:** Only linked accounts can chat, guests can listen only
- Gradual rollout strategy: test with flag OFF, flip to ON when ready
- Client can preemptively disable chat input by checking `capabilities.canChat`

**Key Behaviors:**

- **Fail-safe default:** Flag OFF means guests can chat (no lockout on misconfiguration)
- **Consistent computation:** Same `computeCanChat()` logic used in whoami and chat gate
- **Explicit error code:** `CHAT_REQUIRES_LINKED` allows client to show link prompt
- **No presence reads:** Identity and capabilities derived entirely from sessions → users

**Testing:**

- `tests/api/session/whoami-capabilities.test.ts` - Capability computation in whoami
- `tests/api/chat/chat-auth.test.ts` - Chat gate enforcement in post handler

**Environment Variable:**

```bash
# .env.local.example
REQUIRE_LINKED_FOR_CHAT=false  # Default: guests can chat
```

## References

- Migration: `supabase/migrations/012_durable_sessions.sql`
- Implementation: `api/_shared/session-helpers.ts::ensureSession()`
- Endpoints:
  - `api_handlers/session/hello.ts` (session creation)
  - `api_handlers/session/whoami.ts` (read-only identity)
- Types: `src/types/database.ts` (added `sessions` table)
- Client helper: `src/lib/api.ts::getWhoAmI()`
