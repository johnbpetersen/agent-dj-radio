# OAuth Flow & Chat Gating

## Overview

Agent DJ Radio uses Discord OAuth for user authentication. This document describes the OAuth flow, session management, and how chat features are gated for authenticated users.

## Architecture

```
┌─────────┐      ┌──────────┐      ┌─────────┐      ┌──────────┐
│ Client  │─────▶│ /start   │─────▶│ Discord │─────▶│ /callback│
│         │      │ (POST)   │      │  OAuth  │      │  (GET)   │
└─────────┘      └──────────┘      └─────────┘      └──────────┘
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │ 302 Redirect │
                                                    │ to /?discord │
                                                    │  _linked=1   │
                                                    └──────────────┘
                                                           │
                                                           ▼
                                                    ┌──────────────┐
                                                    │ Client Hook  │
                                                    │ - Refresh    │
                                                    │   session    │
                                                    │ - Strip param│
                                                    └──────────────┘
```

## Flow Breakdown

### 1. OAuth Start (`POST /api/auth/discord/start`)

**Client action:**
```typescript
// User clicks "Sign in with Discord" button
const res = await apiFetch('/api/auth/discord/start', { method: 'POST' })
const { redirectUrl } = await res.json()
window.location.href = redirectUrl
```

**Server response:**
- Generates CSRF state token
- Encodes session ID in state parameter
- Sets `discord_state` cookie
- Returns Discord OAuth authorization URL

**State parameter format:**
```typescript
const state = {
  csrf: randomUUID(),
  sid: sessionId
}
const encoded = base64url(JSON.stringify(state))
```

### 2. Discord Authorization

User is redirected to Discord where they:
1. Review permissions requested
2. Approve or deny access
3. Get redirected back to callback URL

### 3. OAuth Callback (`GET /api/auth/discord/callback`)

**Query parameters:**
- `code` - Authorization code from Discord
- `state` - CSRF + session ID (base64url encoded)

**Server actions:**
1. **Verify CSRF state** - Compare state param with `discord_state` cookie
2. **Exchange code for token** - Call Discord `/oauth2/token` endpoint
3. **Fetch user profile** - Call Discord `/users/@me` endpoint
4. **Link or merge account**:
   - If Discord account already exists → merge guest user into existing user
   - If new Discord account → link to current session user
5. **Update display name** - Use Discord username/global_name
6. **Store user_accounts row** - Link Discord ID to user ID

**Success response:**
```
HTTP 302 Found
Location: https://example.com/?discord_linked=1
```

**Error response:**
```
HTTP 302 Found
Location: https://example.com/?discord_error=access_denied
```

### 4. Client Session Refresh (useEphemeralUser hook)

**Automatic param handling:**
```typescript
// In useEphemeralUser.ts:86-101
if (params.get('discord_linked') === '1') {
  try {
    // Re-fetch session to pick up isDiscordLinked: true
    await initializeWithServer(currentSessionId)
  } finally {
    // Clean the URL (one-shot parameter)
    params.delete('discord_linked')
    const newUrl = window.location.pathname + (params.toString() ? `?${params}` : '')
    window.history.replaceState({}, '', newUrl)
  }
}
```

**What happens:**
1. Hook detects `?discord_linked=1` param
2. Calls `POST /api/session/hello` to refresh session
3. Server returns updated user with `isDiscordLinked: true`
4. Client updates local state
5. URL param is stripped (prevents loop)

## Chat Gating

### Frontend Gating (ChatPanel.tsx)

**Hydration-safe rendering:**
```typescript
const isDiscordLinked = !loading && (user?.isDiscordLinked ?? false)

// During loading - show neutral state
{loading ? (
  <div>Loading session...</div>
) : isDiscordLinked ? (
  // Discord user - show full chat input
  <input type="text" ... />
) : (
  // Guest - show CTA to sign in
  <button onClick={handleDiscordLogin}>
    Sign in with Discord
  </button>
)}
```

**Key principles:**
- Never render input before `loading === false`
- Only enable POST when `isDiscordLinked === true`
- Guests see read-only chat + Discord CTA

### Backend Gating (api/chat/post.ts)

**Strict enforcement order:**
```typescript
// 1. Validate session exists
const presence = await getPresence(sessionId)

// 2. Check Discord account FIRST (before any side effects)
const discordAccount = await getUserAccount(presence.user_id, 'discord')

if (!discordAccount) {
  return res.status(403).json({
    error: 'discord_required',
    message: 'Please sign in with Discord to use chat'
  })
}

// 3. ONLY THEN check ban status (after Discord verified)
if (presence.user.banned) {
  return res.status(403).json({ error: 'User is banned' })
}

// 4. Check rate limits (only for Discord users)
// 5. Validate message content
// 6. Insert chat message
```

**Why this order matters:**
- Guests never consume rate limit quota
- Guests never trigger presence updates
- Guests never reach profanity validation
- Early return minimizes DB queries for guests

## Security Considerations

### CSRF Protection

**State verification:**
```typescript
const cookieState = parseCookie(req.headers.cookie, 'discord_state')
if (!cookieState || cookieState !== state) {
  throw httpError.badRequest('Invalid state parameter (CSRF check failed)')
}
```

**State format:**
- Generated on `/start`, stored in HttpOnly cookie
- Verified on `/callback`, then cookie is cleared
- Contains both CSRF token and session ID

### Session Security

**Session ID transmission:**
- Sent via `X-Session-Id` header (API calls)
- Stored in `x_session_id` cookie (OAuth flow)
- Session-scoped (not persistent across browser restarts)

**No persistent tokens:**
- Discord access tokens NOT stored in client
- Discord refresh tokens stored server-side only
- Client only has ephemeral session ID

### Error Handling

**Never expose internal details:**
```typescript
// BAD
res.status(500).json({ error: error.message }) // Exposes stack traces

// GOOD
res.status(500).json({
  error: 'Internal server error',
  correlationId
})
```

**Correlation IDs:**
- All errors include `correlationId` for debugging
- Logs contain full error details + correlationId
- Client only sees sanitized error + correlationId

## Redirect Implementation

### Safe Redirect Helper (api/_shared/http.ts)

**Multiple strategies for compatibility:**
```typescript
// Strategy 1: Vercel/Express style (preferred)
res.status(302).setHeader('Location', url).end()

// Strategy 2: Node.js writeHead
res.writeHead(302, { Location: url }).end()

// Strategy 3: statusCode + setHeader
res.statusCode = 302
res.setHeader('Location', url)
res.end()

// Fallback: HTML meta refresh (last resort)
res.status(200).send(`<meta http-equiv="refresh" content="0;url=${url}">`)
```

**Why multiple strategies:**
- Vercel Functions use custom response object
- Local dev uses Node.js http.ServerResponse
- Testing uses mock response objects
- HTML fallback ensures redirect always works

### One-Shot Parameter Pattern

**Prevent redirect loops:**
```typescript
// 1. Detect param
if (params.get('discord_linked') === '1') {

  // 2. Do side effect (refresh session)
  await refreshSession()

  // 3. Strip param IMMEDIATELY
  params.delete('discord_linked')
  window.history.replaceState({}, '', newUrl)
}
```

**Never:**
- Refresh page on param detection (causes loop)
- Keep param in URL after handling
- Rely on param for state (use session instead)

## Testing

### Unit Tests (tests/helpers/safe-redirect.test.ts)

**Coverage:**
- All redirect strategies (Vercel, Node, Express)
- HTML fallback behavior
- URL escaping for XSS prevention
- OAuth callback scenarios

### API Tests (tests/api/chat-post.test.ts)

**Coverage:**
- Guest returns 403 with `discord_required`
- Discord user returns 201 success
- Banned user blocked AFTER Discord check
- Validation errors (empty, too long, etc.)
- Session errors (missing, not found)
- Presence TDZ regression test

### Manual Testing

**Acceptance criteria:**
1. Guest sees Discord CTA in chat panel
2. Clicking CTA opens Discord OAuth
3. After approval, lands on `/?discord_linked=1`
4. Session refreshes, param disappears
5. Chat input becomes enabled
6. Can post message successfully

## Troubleshooting

### "Session not found" after OAuth

**Cause:** Session cookie not propagated to callback
**Fix:** Ensure `x_session_id` cookie has `SameSite=Lax; Path=/`

### Redirect loop on callback

**Cause:** `discord_linked=1` param not being stripped
**Fix:** Check `history.replaceState` is called after refresh

### 403 discord_required for linked user

**Cause:** Session not refreshed after OAuth
**Fix:** Verify `initializeWithServer()` is called on param detection

### HTML page instead of 302 redirect

**Cause:** Redirect strategy not compatible with runtime
**Fix:** Check logs for "safeRedirect: 302 via..." to see which strategy worked

## Environment Variables

**Required for OAuth:**
```bash
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_REDIRECT_URI=https://example.com/api/auth/discord/callback
VITE_SITE_URL=https://example.com
```

**Optional feature flags:**
```bash
ENABLE_EPHEMERAL_USERS=true  # Required for session management
ENABLE_CHAT_ALPHA=true       # Required for chat feature
DEBUG_AUTH_OVERLAY=false     # Set to true for debug overlay (dev only)
```

## Related Files

**Frontend:**
- `src/hooks/useEphemeralUser.ts` - Session management + OAuth param handling
- `src/components/ui/turntable/ChatPanel.tsx` - Chat UI with Discord gating
- `src/lib/api.ts` - API fetch wrapper with session headers

**Backend:**
- `api/auth/discord/start.ts` - OAuth start endpoint
- `api/auth/discord/callback.ts` - OAuth callback handler
- `api/auth/discord/unlink.ts` - Discord unlink endpoint
- `api/chat/post.ts` - Chat post with guest gating
- `api/_shared/http.ts` - Safe redirect helper
- `api/_shared/session.ts` - Session ID extraction

**Tests:**
- `tests/helpers/safe-redirect.test.ts` - Redirect helper tests
- `tests/api/chat-post.test.ts` - Chat gating tests

## Monitoring

**Key metrics:**
- OAuth callback success rate
- CSRF verification failures
- Guest 403 rate on chat endpoint
- Session refresh failures
- Redirect strategy fallback rate

**Structured logs:**
```typescript
logger.info('OAuth callback success', {
  event: 'oauth_callback_success',
  userId,
  discordUserId,
  correlationId,
  durationMs
})
```

**Alert on:**
- High CSRF failure rate (possible attack)
- Callback errors > 5% (Discord API issues)
- Redirect fallback to HTML > 10% (runtime mismatch)
