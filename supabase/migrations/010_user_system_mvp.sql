-- Migration 010: User System MVP
-- Adds multi-provider account linking, track attribution, and job pipeline
-- Sprint: Guest → Discord Member → Payer

-- ============================================================================
-- 1. USER_ACCOUNTS: Multi-provider linking (Discord, wallet)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('discord', 'wallet')),
  provider_user_id TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_provider ON user_accounts(provider, provider_user_id);

COMMENT ON TABLE user_accounts IS 'Links users to external providers (Discord, wallets, etc.)';
COMMENT ON COLUMN user_accounts.provider IS 'Provider type: discord, wallet';
COMMENT ON COLUMN user_accounts.provider_user_id IS 'Unique ID from provider (discord_user_id or lowercased wallet address)';
COMMENT ON COLUMN user_accounts.meta IS 'Provider-specific metadata (username, avatar_hash, etc.)';

-- ============================================================================
-- 2. USERS: Add kind column for human vs agent distinction
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'human' CHECK (kind IN ('human', 'agent'));
CREATE INDEX IF NOT EXISTS idx_users_kind ON users(kind);

COMMENT ON COLUMN users.kind IS 'User type: human (default) or agent (AI DJ)';

-- ============================================================================
-- 3. TRACKS: Add attribution columns
-- ============================================================================

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS submitter_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS payer_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS augmented_prompt TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS payment_confirmation_id UUID REFERENCES payment_confirmations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracks_submitter_user_id ON tracks(submitter_user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_payer_user_id ON tracks(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);

COMMENT ON COLUMN tracks.submitter_user_id IS 'User who requested the track (guest or member)';
COMMENT ON COLUMN tracks.payer_user_id IS 'User who paid (resolved from wallet binding)';
COMMENT ON COLUMN tracks.augmented_prompt IS 'Enhanced prompt after augmentation step';
COMMENT ON COLUMN tracks.payment_confirmation_id IS 'Link to payment confirmation record';

-- Backfill existing tracks: submitter = existing user_id
UPDATE tracks
SET submitter_user_id = user_id
WHERE submitter_user_id IS NULL AND user_id IS NOT NULL;

-- ============================================================================
-- 4. PAYMENT_CONFIRMATIONS: Add user linkage and nullable tx_hash
-- ============================================================================

ALTER TABLE payment_confirmations ADD COLUMN IF NOT EXISTS payer_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payment_confirmations ADD COLUMN IF NOT EXISTS payer_address TEXT;

-- Make tx_hash nullable (facilitator mode doesn't always return it)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_confirmations'
    AND column_name = 'tx_hash'
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE payment_confirmations ALTER COLUMN tx_hash DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_confirmations_payer_user_id ON payment_confirmations(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_payer_address ON payment_confirmations(payer_address);

COMMENT ON COLUMN payment_confirmations.payer_user_id IS 'Resolved user who paid (if wallet is linked)';
COMMENT ON COLUMN payment_confirmations.payer_address IS 'Wallet address that paid (lowercased)';

-- Backfill payer_address from existing tx_from_address (prefer token_from_address)
UPDATE payment_confirmations
SET payer_address = COALESCE(
  LOWER(token_from_address),
  LOWER(tx_from_address)
)
WHERE payer_address IS NULL
AND (token_from_address IS NOT NULL OR tx_from_address IS NOT NULL);

-- ============================================================================
-- 5. PAYMENT_CHALLENGES: Add bound_address if not exists (wallet binding)
-- ============================================================================

ALTER TABLE payment_challenges ADD COLUMN IF NOT EXISTS bound_address TEXT;

COMMENT ON COLUMN payment_challenges.bound_address IS 'Wallet address proven by user (enforces payer identity)';

-- ============================================================================
-- 6. JOBS: Augmentation/generation pipeline tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('augment', 'generate')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timeout')) DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  external_ref TEXT,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_track_id ON jobs(track_id);
CREATE INDEX IF NOT EXISTS idx_jobs_kind_status ON jobs(kind, status) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

COMMENT ON TABLE jobs IS 'Tracks augmentation and generation pipeline jobs';
COMMENT ON COLUMN jobs.kind IS 'Job type: augment (prompt enhancement) or generate (audio synthesis)';
COMMENT ON COLUMN jobs.status IS 'Job status: queued, running, succeeded, failed, timeout';
COMMENT ON COLUMN jobs.attempts IS 'Number of processing attempts (for backoff/retry logic)';
COMMENT ON COLUMN jobs.max_attempts IS 'Maximum attempts before marking as failed (default 5)';
COMMENT ON COLUMN jobs.external_ref IS 'External job ID (e.g., ElevenLabs request_id)';
COMMENT ON COLUMN jobs.error IS 'Error details if job failed';

-- ============================================================================
-- 7. RLS POLICIES
-- ============================================================================

ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Service role (server-side) has full access
CREATE POLICY IF NOT EXISTS "Service role can manage user_accounts"
  ON user_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage jobs"
  ON jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can read their own account links (for debugging/UI)
CREATE POLICY IF NOT EXISTS "Users can view their own accounts"
  ON user_accounts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can read their own job status
CREATE POLICY IF NOT EXISTS "Users can view their own jobs"
  ON jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tracks t
      WHERE t.id = jobs.track_id
      AND t.submitter_user_id = auth.uid()
    )
  );

-- ============================================================================
-- 8. HELPER FUNCTIONS
-- ============================================================================

-- Function to get user's Discord avatar URL
CREATE OR REPLACE FUNCTION get_discord_avatar_url(user_uuid UUID, size INT DEFAULT 128)
RETURNS TEXT AS $$
DECLARE
  discord_data JSONB;
  discord_id TEXT;
  avatar_hash TEXT;
BEGIN
  SELECT meta INTO discord_data
  FROM user_accounts
  WHERE user_id = user_uuid
  AND provider = 'discord'
  LIMIT 1;

  IF discord_data IS NULL THEN
    RETURN NULL;
  END IF;

  discord_id := discord_data->>'id';
  avatar_hash := discord_data->>'avatar_hash';

  IF discord_id IS NULL OR avatar_hash IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN format('https://cdn.discordapp.com/avatars/%s/%s.png?size=%s', discord_id, avatar_hash, size);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_discord_avatar_url IS 'Constructs Discord CDN avatar URL from user_accounts metadata';

-- ============================================================================
-- 9. TRACK STATUS UPDATES (Add AUGMENTING status)
-- ============================================================================

-- Drop existing constraint if it exists
DO $$
BEGIN
  ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_status_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Add new constraint with AUGMENTING status
ALTER TABLE tracks ADD CONSTRAINT tracks_status_check CHECK (
  status IN (
    'PENDING_PAYMENT',
    'PAID',
    'AUGMENTING',
    'QUEUED',
    'GENERATING',
    'READY',
    'PLAYING',
    'DONE',
    'FAILED',
    'ARCHIVED'
  )
);

-- ============================================================================
-- 10. CRITICAL FUNCTIONS FOR CONCURRENCY & TRANSACTIONS
-- ============================================================================

-- Function: Atomic user merge on Discord link (prevents race conditions)
CREATE OR REPLACE FUNCTION merge_users_on_discord_link(
  p_guest_user_id UUID,
  p_target_user_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Lock both users to prevent concurrent modifications
  PERFORM * FROM users
  WHERE id IN (p_guest_user_id, p_target_user_id)
  FOR UPDATE;

  -- Migrate tracks (submitter)
  UPDATE tracks
  SET submitter_user_id = p_target_user_id
  WHERE submitter_user_id = p_guest_user_id;

  -- Migrate tracks (payer)
  UPDATE tracks
  SET payer_user_id = p_target_user_id
  WHERE payer_user_id = p_guest_user_id;

  -- Migrate payment confirmations
  UPDATE payment_confirmations
  SET payer_user_id = p_target_user_id
  WHERE payer_user_id = p_guest_user_id;

  -- Migrate chat messages
  UPDATE chat_messages
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Migrate reactions
  UPDATE reactions
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Migrate payment challenges
  UPDATE payment_challenges
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Update presence to point to target user
  UPDATE presence
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Delete guest user (cascade will handle remaining references)
  DELETE FROM users WHERE id = p_guest_user_id;

  RAISE NOTICE 'Merged user % into %', p_guest_user_id, p_target_user_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION merge_users_on_discord_link IS 'Atomically merges guest user into existing Discord-linked user with FOR UPDATE locks';

-- Function: Claim next job for processing (prevents double-processing)
CREATE OR REPLACE FUNCTION claim_next_job(p_kind TEXT)
RETURNS SETOF jobs AS $$
  UPDATE jobs
  SET
    status = 'running',
    updated_at = now(),
    attempts = attempts + 1
  WHERE id = (
    SELECT id FROM jobs
    WHERE kind = p_kind
      AND status = 'queued'
      AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;

COMMENT ON FUNCTION claim_next_job IS 'Atomically claims next job with FOR UPDATE SKIP LOCKED to prevent concurrent processing';

-- ============================================================================
-- 11. TRIGGERS FOR DATA INTEGRITY
-- ============================================================================

-- Trigger: Truncate provider_raw if >100KB (defensive against large responses)
CREATE OR REPLACE FUNCTION truncate_large_provider_raw() RETURNS TRIGGER AS $$
BEGIN
  IF pg_column_size(NEW.provider_raw) > 102400 THEN
    NEW.provider_raw = jsonb_build_object(
      'truncated', true,
      'original_size_bytes', pg_column_size(NEW.provider_raw),
      'message', 'Provider response exceeded 100KB and was truncated',
      'timestamp', now()
    );
    RAISE NOTICE 'Truncated provider_raw for confirmation % (original size: % bytes)',
      NEW.id, pg_column_size(NEW.provider_raw);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER truncate_payment_confirmations_provider_raw
  BEFORE INSERT OR UPDATE ON payment_confirmations
  FOR EACH ROW
  EXECUTE FUNCTION truncate_large_provider_raw();

COMMENT ON FUNCTION truncate_large_provider_raw IS 'Truncates provider_raw JSONB if exceeds 100KB to prevent bloat';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
