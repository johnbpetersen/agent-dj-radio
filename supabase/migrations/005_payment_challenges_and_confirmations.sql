-- Migration: Payment challenges and confirmations tables
-- Creates dedicated tables for x402 payment flow with idempotency guarantees

-- payment_challenges: One challenge per track submission
CREATE TABLE IF NOT EXISTS payment_challenges (
  challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pay_to TEXT NOT NULL,
  asset TEXT NOT NULL,
  chain TEXT NOT NULL,
  amount_atomic BIGINT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

-- payment_confirmations: One confirmation per successful payment
-- Enforces idempotency via unique constraints on challenge_id and tx_hash
CREATE TABLE IF NOT EXISTS payment_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL UNIQUE REFERENCES payment_challenges(challenge_id) ON DELETE CASCADE,
  tx_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  amount_paid_atomic BIGINT NOT NULL,
  provider_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_payment_challenges_track_id ON payment_challenges(track_id);
CREATE INDEX IF NOT EXISTS idx_payment_challenges_user_id ON payment_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_challenges_expires_at ON payment_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_tx_hash ON payment_confirmations(tx_hash);

-- RLS policies: server-only writes (aligns with existing admin/server patterns)
ALTER TABLE payment_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_confirmations ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (server-side only)
CREATE POLICY IF NOT EXISTS "Service role can manage payment_challenges"
  ON payment_challenges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can manage payment_confirmations"
  ON payment_confirmations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Optional: Allow users to read their own challenges (for debugging/UI)
CREATE POLICY IF NOT EXISTS "Users can view their own payment_challenges"
  ON payment_challenges
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can view their own payment_confirmations"
  ON payment_confirmations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payment_challenges pc
      WHERE pc.challenge_id = payment_confirmations.challenge_id
      AND pc.user_id = auth.uid()
    )
  );
