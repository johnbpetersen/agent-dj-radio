-- Migration 010: User System MVP (FULL FILE, DROP-IN)
-- Adds multi-provider account linking, track attribution, and job pipeline
-- Safe to run on existing DB (guards included)

-- 0) EXTENSIONS --------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1) USER_ACCOUNTS: Multi-provider linking (Discord, wallet)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('discord', 'wallet')),
  provider_user_id TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_user_id ON public.user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_provider ON public.user_accounts(provider, provider_user_id);

COMMENT ON TABLE public.user_accounts IS 'Links users to external providers (Discord, wallets, etc.)';
COMMENT ON COLUMN public.user_accounts.provider IS 'Provider type: discord, wallet';
COMMENT ON COLUMN public.user_accounts.provider_user_id IS 'Unique ID from provider (discord_user_id or lowercased wallet address)';
COMMENT ON COLUMN public.user_accounts.meta IS 'Provider-specific metadata (username, avatar_hash, etc.)';

-- ============================================================================
-- 2) USERS: Add kind column for human vs agent distinction
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'kind'
  ) THEN
    ALTER TABLE public.users
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'
      CHECK (kind IN ('human', 'agent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_kind ON public.users(kind);
COMMENT ON COLUMN public.users.kind IS 'User type: human (default) or agent (AI DJ)';

-- ============================================================================
-- 3) TRACKS: Add attribution columns + AUGMENTING status
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'submitter_user_id'
  ) THEN
    ALTER TABLE public.tracks ADD COLUMN submitter_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'payer_user_id'
  ) THEN
    ALTER TABLE public.tracks ADD COLUMN payer_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'augmented_prompt'
  ) THEN
    ALTER TABLE public.tracks ADD COLUMN augmented_prompt TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tracks' AND column_name = 'payment_confirmation_id'
  ) THEN
    ALTER TABLE public.tracks ADD COLUMN payment_confirmation_id UUID REFERENCES public.payment_confirmations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tracks_submitter_user_id ON public.tracks(submitter_user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_payer_user_id ON public.tracks(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_status ON public.tracks(status);

COMMENT ON COLUMN public.tracks.submitter_user_id IS 'User who requested the track (guest or member)';
COMMENT ON COLUMN public.tracks.payer_user_id IS 'User who paid (resolved from wallet binding)';
COMMENT ON COLUMN public.tracks.augmented_prompt IS 'Enhanced prompt after augmentation step';
COMMENT ON COLUMN public.tracks.payment_confirmation_id IS 'Link to payment confirmation record';

-- Backfill submitter from existing user_id if present
UPDATE public.tracks
SET submitter_user_id = user_id
WHERE submitter_user_id IS NULL AND user_id IS NOT NULL;

-- Add AUGMENTING to status check (drop & re-add)
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.tracks DROP CONSTRAINT tracks_status_check;
  EXCEPTION WHEN undefined_object THEN
    -- no-op
    NULL;
  END;

  ALTER TABLE public.tracks ADD CONSTRAINT tracks_status_check CHECK (
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
END $$;

-- ============================================================================
-- 4) PAYMENT_CONFIRMATIONS: payer linkage + nullable tx_hash + backfill
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_confirmations' AND column_name='payer_user_id'
  ) THEN
    ALTER TABLE public.payment_confirmations ADD COLUMN payer_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_confirmations' AND column_name='payer_address'
  ) THEN
    ALTER TABLE public.payment_confirmations ADD COLUMN payer_address TEXT;
  END IF;

  -- Make tx_hash nullable if it exists and is NOT NULL
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_confirmations'
      AND column_name='tx_hash' AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.payment_confirmations ALTER COLUMN tx_hash DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_confirmations_payer_user_id ON public.payment_confirmations(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_payer_address ON public.payment_confirmations(payer_address);

COMMENT ON COLUMN public.payment_confirmations.payer_user_id IS 'Resolved user who paid (if wallet is linked)';
COMMENT ON COLUMN public.payment_confirmations.payer_address IS 'Wallet address that paid (lowercased)';

-- Backfill payer_address from token_from_address / tx_from_address
UPDATE public.payment_confirmations
SET payer_address = COALESCE(LOWER(token_from_address), LOWER(tx_from_address))
WHERE payer_address IS NULL
  AND (token_from_address IS NOT NULL OR tx_from_address IS NOT NULL);

-- ============================================================================
-- 5) PAYMENT_CHALLENGES: bound_address
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_challenges' AND column_name='bound_address'
  ) THEN
    ALTER TABLE public.payment_challenges ADD COLUMN bound_address TEXT;
  END IF;
END $$;

COMMENT ON COLUMN public.payment_challenges.bound_address IS 'Wallet address proven by user (enforces payer identity)';

-- ============================================================================
-- 6) JOBS: Augmentation / generation pipeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('augment', 'generate')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timeout')) DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  external_ref TEXT,
  error JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_track_id ON public.jobs(track_id);
CREATE INDEX IF NOT EXISTS idx_jobs_kind_status ON public.jobs(kind, status) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON public.jobs(created_at);

COMMENT ON TABLE public.jobs IS 'Tracks augmentation and generation pipeline jobs';
COMMENT ON COLUMN public.jobs.kind IS 'Job type: augment (prompt enhancement) or generate (audio synthesis)';
COMMENT ON COLUMN public.jobs.status IS 'Job status: queued, running, succeeded, failed, timeout';
COMMENT ON COLUMN public.jobs.attempts IS 'Number of processing attempts (for backoff/retry logic)';
COMMENT ON COLUMN public.jobs.max_attempts IS 'Maximum attempts before marking as failed (default 5)';
COMMENT ON COLUMN public.jobs.external_ref IS 'External job ID (e.g., ElevenLabs request_id)';
COMMENT ON COLUMN public.jobs.error IS 'Error details if job failed';

-- ============================================================================
-- 7) RLS POLICIES (No IF NOT EXISTS — use DROP IF EXISTS then CREATE)
-- ============================================================================

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Service role full access
DROP POLICY IF EXISTS "Service role can manage user_accounts" ON public.user_accounts;
CREATE POLICY "Service role can manage user_accounts"
  ON public.user_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage jobs" ON public.jobs;
CREATE POLICY "Service role can manage jobs"
  ON public.jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can read their own account links
DROP POLICY IF EXISTS "Users can view their own accounts" ON public.user_accounts;
CREATE POLICY "Users can view their own accounts"
  ON public.user_accounts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can read their own job status (depends on tracks.submitter_user_id added above)
DROP POLICY IF EXISTS "Users can view their own jobs" ON public.jobs;
CREATE POLICY "Users can view their own jobs"
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tracks t
      WHERE t.id = public.jobs.track_id
        AND t.submitter_user_id = auth.uid()
    )
  );

-- ============================================================================
-- 8) HELPER FUNCTIONS
-- ============================================================================

-- Robust Discord avatar helper (uses provider_user_id + avatar_hash in meta)
CREATE OR REPLACE FUNCTION public.get_discord_avatar_url(user_uuid UUID, size INT DEFAULT 128)
RETURNS TEXT AS $$
DECLARE
  discord_id   TEXT;
  avatar_hash  TEXT;
BEGIN
  SELECT ua.provider_user_id,
         ua.meta->>'avatar_hash'
  INTO discord_id, avatar_hash
  FROM public.user_accounts ua
  WHERE ua.user_id = user_uuid
    AND ua.provider = 'discord'
  LIMIT 1;

  IF discord_id IS NULL OR avatar_hash IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN format('https://cdn.discordapp.com/avatars/%s/%s.png?size=%s', discord_id, avatar_hash, size);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION public.get_discord_avatar_url(UUID, INT) IS
  'Constructs Discord CDN avatar URL from user_accounts metadata';

-- Atomic user merge when linking Discord
CREATE OR REPLACE FUNCTION public.merge_users_on_discord_link(
  p_guest_user_id UUID,
  p_target_user_id UUID
) RETURNS VOID AS $$
BEGIN
  -- Lock both users to prevent concurrent modifications
  PERFORM 1 FROM public.users
  WHERE id IN (p_guest_user_id, p_target_user_id)
  FOR UPDATE;

  -- Migrate tracks (submitter)
  UPDATE public.tracks
  SET submitter_user_id = p_target_user_id
  WHERE submitter_user_id = p_guest_user_id;

  -- Migrate tracks (payer)
  UPDATE public.tracks
  SET payer_user_id = p_target_user_id
  WHERE payer_user_id = p_guest_user_id;

  -- Migrate payment confirmations
  UPDATE public.payment_confirmations
  SET payer_user_id = p_target_user_id
  WHERE payer_user_id = p_guest_user_id;

  -- Migrate chat messages
  UPDATE public.chat_messages
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Migrate reactions
  UPDATE public.reactions
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Migrate payment challenges
  UPDATE public.payment_challenges
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Update presence to point to target user
  UPDATE public.presence
  SET user_id = p_target_user_id
  WHERE user_id = p_guest_user_id;

  -- Delete guest user (cascade handles remaining refs)
  DELETE FROM public.users WHERE id = p_guest_user_id;

  RAISE NOTICE 'Merged user % into %', p_guest_user_id, p_target_user_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.merge_users_on_discord_link(UUID, UUID) IS
  'Atomically merges guest user into existing Discord-linked user with FOR UPDATE locks';

-- Claim next job (FOR UPDATE SKIP LOCKED) to avoid double processing
CREATE OR REPLACE FUNCTION public.claim_next_job(p_kind TEXT)
RETURNS SETOF public.jobs AS $$
  UPDATE public.jobs
  SET
    status = 'running',
    updated_at = now(),
    attempts = attempts + 1
  WHERE id = (
    SELECT id
    FROM public.jobs
    WHERE kind = p_kind
      AND status = 'queued'
      AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$ LANGUAGE sql;

COMMENT ON FUNCTION public.claim_next_job(TEXT) IS
  'Atomically claims next job with FOR UPDATE SKIP LOCKED to prevent concurrent processing';

-- ============================================================================
-- 9) TRIGGER: Truncate large provider_raw on payment_confirmations (defensive)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.truncate_large_provider_raw() RETURNS TRIGGER AS $$
BEGIN
  -- If table has no provider_raw column, just return NEW safely
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='payment_confirmations' AND column_name='provider_raw'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.provider_raw IS NOT NULL AND pg_column_size(NEW.provider_raw) > 102400 THEN
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

COMMENT ON FUNCTION public.truncate_large_provider_raw() IS
  'Truncates provider_raw JSONB if exceeds 100KB to prevent bloat';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='payment_confirmations'
  ) THEN
    -- Drop and recreate trigger idempotently
    IF EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = 'truncate_payment_confirmations_provider_raw'
    ) THEN
      DROP TRIGGER truncate_payment_confirmations_provider_raw ON public.payment_confirmations;
    END IF;

    CREATE TRIGGER truncate_payment_confirmations_provider_raw
      BEFORE INSERT OR UPDATE ON public.payment_confirmations
      FOR EACH ROW
      EXECUTE FUNCTION public.truncate_large_provider_raw();
  END IF;
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
