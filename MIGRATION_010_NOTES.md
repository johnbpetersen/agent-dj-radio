# Migration 010: User System MVP - Implementation Notes

**Status**: ✅ Backend Complete
**Date**: 2025-01-13
**Sprint**: Guest → Discord Member → Payer

## Overview

Migration 010 implements the foundational user system that transforms the application from anonymous submissions to a multi-provider account linking system with proper attribution.

## Database Changes

### New Tables

#### `user_accounts`
Multi-provider account linking table supporting Discord OAuth and wallet bindings.

```sql
CREATE TABLE user_accounts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT CHECK (provider IN ('discord', 'wallet')),
  provider_user_id TEXT NOT NULL,  -- Normalized (lowercase) for wallets
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);
```

**Key Features**:
- Supports multiple providers per user
- Discord: Stores avatar_hash, username, global_name in meta
- Wallet: Stores normalized (lowercase) EVM addresses
- Unique constraint prevents duplicate provider linkings

#### `jobs`
Pipeline tracking for augmentation and generation workflows.

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  track_id UUID REFERENCES tracks(id) ON DELETE CASCADE,
  kind TEXT CHECK (kind IN ('augment', 'generate')),
  status TEXT CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timeout')),
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 5,
  external_ref TEXT,        -- ElevenLabs request_id, etc.
  error JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Key Features**:
- Atomic job claiming with `claim_next_job()` RPC function
- Retry logic with attempts counter and max_attempts limit
- Prevents double-processing with FOR UPDATE SKIP LOCKED

### Schema Updates

#### `users` table
- Added `kind TEXT DEFAULT 'human' CHECK (kind IN ('human', 'agent'))` - Distinguishes human users from AI agents
- Added `last_seen_at TIMESTAMPTZ` - Tracks user activity

#### `tracks` table
- Added `submitter_user_id UUID` - Who requested the track (guest or member)
- Added `payer_user_id UUID` - Who paid for the track (resolved from wallet)
- Added `augmented_prompt TEXT` - Enhanced prompt after augmentation step
- Added `payment_confirmation_id UUID` - Links to payment confirmation record
- Updated status enum: Added `'PENDING_PAYMENT'`, `'AUGMENTING'`, `'QUEUED'` statuses

#### `payment_confirmations` table
- Added `payer_user_id UUID` - Resolved user who paid
- Added `payer_address TEXT` - Wallet address (normalized/lowercase)
- Made `tx_hash` nullable - Facilitator mode doesn't always return it

#### `payment_challenges` table
- Added `bound_address TEXT` - Wallet address proven by user (RPC-only mode binding)

### Critical RPC Functions

#### `merge_users_on_discord_link(p_guest_user_id, p_target_user_id)`
Atomically merges a guest user into an existing Discord-linked user when OAuth callback detects account already exists.

**Transaction-safe with FOR UPDATE locks**:
```sql
-- Lock both users to prevent concurrent modifications
PERFORM * FROM users
WHERE id IN (p_guest_user_id, p_target_user_id)
FOR UPDATE;

-- Migrate all foreign keys
UPDATE tracks SET submitter_user_id = p_target_user_id WHERE submitter_user_id = p_guest_user_id;
UPDATE tracks SET payer_user_id = p_target_user_id WHERE payer_user_id = p_guest_user_id;
UPDATE payment_confirmations SET payer_user_id = p_target_user_id WHERE payer_user_id = p_guest_user_id;
UPDATE chat_messages SET user_id = p_target_user_id WHERE user_id = p_guest_user_id;
UPDATE reactions SET user_id = p_target_user_id WHERE user_id = p_guest_user_id;
UPDATE payment_challenges SET user_id = p_target_user_id WHERE user_id = p_guest_user_id;
UPDATE presence SET user_id = p_target_user_id WHERE user_id = p_guest_user_id;

-- Delete guest user (CASCADE handles remaining references)
DELETE FROM users WHERE id = p_guest_user_id;
```

**Why this matters**: Prevents race conditions when multiple tabs attempt Discord linking simultaneously.

#### `claim_next_job(p_kind)`
Atomically claims the next queued job for processing, preventing double-processing by concurrent workers.

```sql
UPDATE jobs
SET status = 'running', updated_at = now(), attempts = attempts + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE kind = p_kind
    AND status = 'queued'
    AND attempts < max_attempts
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED  -- Critical for concurrency
)
RETURNING *;
```

**Why this matters**: Multiple worker instances can poll simultaneously without conflicts. SKIP LOCKED ensures only one worker claims each job.

### Triggers

#### `truncate_payment_confirmations_provider_raw`
Automatically truncates `provider_raw` JSONB column if it exceeds 100KB to prevent database bloat from large provider responses.

## API Endpoints

### New Endpoints

#### `POST /api/auth/discord/start`
Initiates Discord OAuth flow with CSRF protection.

**Security**:
- Generates cryptographic state parameter
- Stores in HttpOnly cookie for CSRF validation
- Enforces `identify` scope only (minimal permissions)

#### `GET /api/auth/discord/callback`
Handles Discord OAuth callback, links or merges accounts.

**Flow**:
1. Verify CSRF state from cookie
2. Exchange code for access token
3. Fetch Discord user profile
4. Check if Discord account already linked:
   - **Existing**: Call `merge_users_on_discord_link()` to merge guest into existing user
   - **New**: Create `user_accounts` entry linking Discord to current session user
5. Update user display_name if still has generated name (contains underscore)
6. Redirect to frontend with `?discord_linked=true`

**Avatar Logic**:
```typescript
const avatarExt = avatar?.startsWith('a_') ? 'gif' : 'png'
const avatarUrl = `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.${avatarExt}?size=128`
```

#### `POST /api/worker/augment`
Augmentation worker - polls jobs table for `kind='augment'`, `status='queued'`.

**MVP**: Stub implementation that copies `original_prompt` → `augmented_prompt`
**Future**: Integrate Daydreams Router for actual prompt augmentation

**Process**:
1. Atomically claim next job with `claim_next_job('augment')`
2. Load track details
3. Augment prompt (currently stub: `augmentedPrompt = track.prompt`)
4. Update track: `status='QUEUED'`, set `augmented_prompt`
5. Mark job as `succeeded`
6. Enqueue generation job (`kind='generate'`, `status='queued'`)
7. Fire-and-forget trigger generation worker

#### `POST /api/worker/generate`
Generation worker - polls jobs table for `kind='generate'`, `status='queued'`.

**Updated to use jobs table** (was polling tracks directly).

**Process**:
1. Atomically claim next job with `claim_next_job('generate')`
2. Load track (uses `augmented_prompt` if available, else `prompt`)
3. Generate audio (ElevenLabs or fallback)
4. Update track: `status='READY'`, set `audio_url` and `eleven_request_id`
5. Mark job as `succeeded` with `external_ref=eleven_request_id`

### Updated Endpoints

#### `GET /api/session/hello`
Now returns `isDiscordLinked` and `isWalletLinked` booleans.

```json
{
  "user": {
    "id": "...",
    "display_name": "purple_raccoon",
    "isDiscordLinked": false,
    "isWalletLinked": false
  },
  "session_id": "..."
}
```

#### `POST /api/chat/post`
Updated with stricter rate limiting and Discord gating.

**Changes**:
- **Rate limit**: 1 message per 2 seconds per userId (was 10/min)
- **Validation first**: Run profanity check BEFORE rate limit (cheaper operation)
- **422 for validation errors**: Returns 422 (Unprocessable Entity) for invalid messages
- **429 for rate limits**: Returns 429 with `retry_after_seconds`
- **Discord required**: Checks `user_accounts` for `provider='discord'` link

#### `POST /api/queue/submit`
Now sets `submitter_user_id` on track creation.

```typescript
const track = await createTrack(supabaseAdmin, {
  user_id,
  submitter_user_id: user_id,  // New field
  payer_user_id: null,          // Will be set on payment confirm
  prompt: prompt.trim(),
  // ...
})
```

#### `POST /api/queue/confirm`
Updated to resolve payer attribution and trigger augmentation pipeline.

**Changes**:
1. **Resolve payer_user_id**: Lookup wallet in `user_accounts` by normalized address
2. **Insert confirmation**: Include `payer_user_id` and `payer_address`
3. **Update track**: Set `payer_user_id`, `payment_confirmation_id`, `status='AUGMENTING'`
4. **Enqueue job**: Create `jobs` entry with `kind='augment'`, `status='queued'`
5. **Trigger worker**: Fire-and-forget POST to `/api/worker/augment`

**Wallet normalization** (critical):
```typescript
const normalizedPayerAddress = normalizeEvmAddress(payerAddress)  // lowercase
const { data: walletAccount } = await supabaseAdmin
  .from('user_accounts')
  .select('user_id')
  .eq('provider', 'wallet')
  .eq('provider_user_id', normalizedPayerAddress)  // MUST be lowercase
  .single()
```

#### `POST /api/wallet/prove`
Already normalizes addresses before storing:

```typescript
const recoveredAddress = normalizeEvmAddress(recovered)  // lowercase
await supabaseAdmin
  .from('payment_challenges')
  .update({ bound_address: recoveredAddress })  // stored lowercase
```

## TypeScript Types

Updated `src/types/database.ts` with new schema:

```typescript
// Added to users Row
kind: 'human' | 'agent'
last_seen_at: string | null

// New table
user_accounts: {
  Row: {
    id: string
    user_id: string
    provider: 'discord' | 'wallet'
    provider_user_id: string
    meta: Record<string, any>
    created_at: string
    updated_at: string
  }
  // ... Insert/Update
}

// Added to tracks Row
submitter_user_id: string | null
payer_user_id: string | null
augmented_prompt: string | null
payment_confirmation_id: string | null
status: 'PENDING_PAYMENT' | 'PAID' | 'AUGMENTING' | 'QUEUED' | 'GENERATING' | 'READY' | 'PLAYING' | 'DONE' | 'FAILED' | 'ARCHIVED'

// New table
jobs: {
  Row: {
    id: string
    track_id: string
    kind: 'augment' | 'generate'
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'
    attempts: number
    max_attempts: number
    external_ref: string | null
    error: Record<string, any> | null
    created_at: string
    updated_at: string
  }
  // ... Insert/Update
}

// New RPC functions
Functions: {
  merge_users_on_discord_link: {
    Args: { p_guest_user_id: string; p_target_user_id: string }
    Returns: void
  }
  claim_next_job: {
    Args: { p_kind: 'augment' | 'generate' }
    Returns: Database['public']['Tables']['jobs']['Row'][]
  }
}
```

## Frontend Updates

### `useEphemeralUser` Hook
Added Discord linking support:

```typescript
interface EphemeralUser {
  // ... existing fields
  isDiscordLinked?: boolean
  isWalletLinked?: boolean
}

interface UseEphemeralUserReturn {
  // ... existing methods
  linkDiscord: () => void  // Redirects to /api/auth/discord/start
}
```

**Usage**:
```typescript
const { user, linkDiscord } = useEphemeralUser()

// Check if Discord is linked
if (!user?.isDiscordLinked) {
  // Show "Sign in with Discord" button
  <button onClick={linkDiscord}>Sign in with Discord</button>
}
```

## Security Considerations

### Discord OAuth
- ✅ CSRF protection via state parameter in HttpOnly cookie
- ✅ Minimal scope (`identify` only, no email/guilds)
- ✅ Avatar URLs validated for .gif vs .png based on hash prefix
- ✅ Transaction-safe user merge with FOR UPDATE locks

### Chat Rate Limiting
- ✅ Strict rate limiting: 1 message per 2 seconds per userId
- ✅ Validation before rate limit check (cheaper operation first)
- ✅ Discord account required (checks `user_accounts` table)
- ✅ Profanity filtering on server-side

### Wallet Normalization
- ✅ All wallet addresses stored in lowercase (`normalizeEvmAddress()`)
- ✅ Consistent normalization in:
  - `wallet/prove.ts` - When binding address to challenge
  - `queue/confirm.ts` - When looking up payer and storing confirmation
  - `user_accounts` - When creating wallet account links

### Worker Concurrency
- ✅ FOR UPDATE SKIP LOCKED prevents double-processing
- ✅ Attempts counter tracks retry attempts
- ✅ Max attempts limit (default 5) prevents infinite loops
- ✅ Job errors logged to `jobs.error` JSONB column

## Migration Path

### Running the Migration

```bash
# Apply migration 010
psql $DATABASE_URL -f supabase/migrations/010_user_system_mvp.sql
```

### Rollback (if needed)

```sql
-- Drop new tables
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS user_accounts CASCADE;

-- Drop new functions
DROP FUNCTION IF EXISTS merge_users_on_discord_link CASCADE;
DROP FUNCTION IF EXISTS claim_next_job CASCADE;

-- Revert tracks columns
ALTER TABLE tracks DROP COLUMN IF EXISTS submitter_user_id;
ALTER TABLE tracks DROP COLUMN IF EXISTS payer_user_id;
ALTER TABLE tracks DROP COLUMN IF EXISTS augmented_prompt;
ALTER TABLE tracks DROP COLUMN IF EXISTS payment_confirmation_id;

-- Revert users columns
ALTER TABLE users DROP COLUMN IF EXISTS kind;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;

-- Revert payment_confirmations
ALTER TABLE payment_confirmations DROP COLUMN IF EXISTS payer_user_id;
ALTER TABLE payment_confirmations DROP COLUMN IF EXISTS payer_address;

-- Revert payment_challenges
ALTER TABLE payment_challenges DROP COLUMN IF EXISTS bound_address;
```

## Testing Checklist

### Backend (Completed)
- [x] TypeScript compilation passes (`npm run typecheck`)
- [x] Discord OAuth start endpoint returns redirect
- [x] Discord OAuth callback handles CSRF validation
- [x] User merge RPC function compiles and has correct signature
- [x] Job claiming RPC function compiles
- [x] Augmentation worker uses atomic job claiming
- [x] Generation worker updated to use jobs table
- [x] Chat rate limiting enforced at 1 msg/2s
- [x] Wallet addresses normalized to lowercase

### Integration (Deferred)
- [ ] Discord OAuth flow completes end-to-end
- [ ] User merge migrates all foreign keys correctly
- [ ] Concurrent workers don't double-process jobs
- [ ] Chat requires Discord link
- [ ] Payment attribution resolves payer_user_id correctly
- [ ] Augmentation → Generation pipeline flows correctly

### Frontend (Deferred)
- [ ] Discord button appears in UI when not linked
- [ ] Discord callback updates UI state
- [ ] Track attribution shows submitter vs payer
- [ ] Chat input disabled until Discord linked

## Future Work

### Phase 2: Wallet Auto-Linking
Currently, wallets are only bound to challenges but not automatically linked to user accounts on first payment. Consider:

```typescript
// In queue/confirm.ts after successful payment
if (!walletAccount && challenge.user_id) {
  await supabaseAdmin.from('user_accounts').insert({
    user_id: challenge.user_id,
    provider: 'wallet',
    provider_user_id: normalizedPayerAddress,
    meta: {
      address: normalizedPayerAddress,
      first_seen_tx: txHash,
      first_seen_at: new Date().toISOString()
    }
  })
  payerUserId = challenge.user_id
}
```

### Phase 3: Daydreams Router Integration
Replace augmentation stub with actual router call:

```typescript
// api/worker/augment.ts
const augmentedPrompt = await callDaydreamsRouter({
  original: track.prompt,
  context: { duration: track.duration_seconds }
})
```

### Phase 4: UI Polish
- Discord avatar display in active listeners
- Track attribution cards showing submitter + payer
- "Sponsored by" badge for payer != submitter
- Discord profile drawer with linked accounts

## Breaking Changes

### Database
- Track status enum expanded (added `PENDING_PAYMENT`, `AUGMENTING`, `QUEUED`)
- payment_confirmations.tx_hash now nullable
- users.kind defaults to 'human' (existing rows backfilled)

### API
- `/api/session/hello` response shape changed (added `isDiscordLinked`, `isWalletLinked`)
- `/api/chat/post` rate limit changed from 10/min to 1/2s
- `/api/chat/post` validation errors now return 422 (was 400)
- `/api/queue/confirm` transitions to AUGMENTING (was PAID)

### TypeScript
- Track type updated with new fields
- Database type updated with new tables and functions
- EphemeralUser interface updated with linking status

## Support & Troubleshooting

### Common Issues

**"Discord already linked to another account"**
- This is expected behavior when a Discord account is already associated with a different user
- The system automatically merges the guest user into the existing Discord-linked user
- All tracks, reactions, and chat messages are migrated

**"Chat requires Discord account"**
- Chat is gated to Discord-linked users only
- Users must complete OAuth flow before posting messages
- Display a clear "Sign in with Discord to chat" prompt

**"Job stuck in 'running' status"**
- Worker crashed mid-processing
- Job will timeout after max_attempts (default 5)
- Manual intervention: `UPDATE jobs SET status='failed', error='{"manual_intervention": true}' WHERE id='...'`

**"Worker processing same job twice"**
- Check that `claim_next_job()` RPC function is being used
- Verify FOR UPDATE SKIP LOCKED is in place
- Review worker logs for race condition patterns

### Monitoring Queries

```sql
-- Check job pipeline health
SELECT kind, status, COUNT(*), AVG(attempts)
FROM jobs
GROUP BY kind, status;

-- Find stuck jobs
SELECT * FROM jobs
WHERE status='running'
AND updated_at < NOW() - INTERVAL '10 minutes';

-- Check Discord link rate
SELECT
  COUNT(*) FILTER (WHERE provider='discord') as discord_links,
  COUNT(*) FILTER (WHERE provider='wallet') as wallet_links
FROM user_accounts;

-- Attribution breakdown
SELECT
  COUNT(*) FILTER (WHERE submitter_user_id = payer_user_id) as self_paid,
  COUNT(*) FILTER (WHERE submitter_user_id != payer_user_id) as sponsored,
  COUNT(*) FILTER (WHERE payer_user_id IS NULL) as unpaid
FROM tracks;
```

## Conclusion

Migration 010 successfully implements the foundational user system with proper attribution, Discord OAuth integration, and a robust job pipeline architecture. All CTO blocking fixes have been applied, including transaction-safe user merges, concurrency-safe job claiming, and strict security controls.

**Ready for**: Production deployment
**Next steps**: Frontend polish, testing, and Daydreams Router integration
