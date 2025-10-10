-- Migration 009: Add payment_authorizations table for ERC-3009 transferWithAuthorization
-- This table stores the full authorization details for facilitator-mode payments

-- Optional, but harmless if already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS payment_authorizations (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to payment challenge (one-to-one)
  challenge_id UUID NOT NULL UNIQUE REFERENCES payment_challenges(challenge_id) ON DELETE CASCADE,

  -- Authorization scheme
  scheme TEXT NOT NULL DEFAULT 'erc3009',

  -- Chain and token info
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,

  -- ERC-3009 TransferWithAuthorization fields
  from_address TEXT NOT NULL, -- payer (signer)
  to_address   TEXT NOT NULL, -- recipient (our receiving address)
  value_atomic BIGINT NOT NULL,
  valid_after  INTEGER NOT NULL,  -- unix timestamp
  valid_before INTEGER NOT NULL,  -- unix timestamp
  nonce        TEXT NOT NULL,     -- 32-byte hex string (0x + 64 hex)
  signature    TEXT NOT NULL,     -- EIP-712 signature hex

  -- Facilitator verdict
  facilitator_verdict JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_scheme         CHECK (scheme IN ('erc3009')),
  CONSTRAINT valid_chain_id       CHECK (chain_id > 0),
  CONSTRAINT valid_token_address  CHECK (token_address  ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT valid_from_address   CHECK (from_address   ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT valid_to_address     CHECK (to_address     ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT valid_value          CHECK (value_atomic > 0),
  CONSTRAINT valid_nonce          CHECK (nonce         ~ '^0x[a-fA-F0-9]{64}$'),
  CONSTRAINT valid_signature      CHECK (signature     ~ '^0x[a-fA-F0-9]+$'),

  -- Anti-replay: prevent signature reuse across challenges
  CONSTRAINT unique_authorization UNIQUE (token_address, from_address, nonce)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_payment_authorizations_challenge_id
  ON payment_authorizations(challenge_id);

CREATE INDEX IF NOT EXISTS idx_payment_authorizations_from_address
  ON payment_authorizations(from_address);

CREATE INDEX IF NOT EXISTS idx_payment_authorizations_created_at
  ON payment_authorizations(created_at DESC);

-- Index for anti-replay enforcement (supports UNIQUE constraint efficiently)
CREATE INDEX IF NOT EXISTS idx_payment_authorizations_replay_check
  ON payment_authorizations(token_address, from_address, nonce);

-- RLS policies
ALTER TABLE payment_authorizations ENABLE ROW LEVEL SECURITY;

-- Recreate policies deterministically (no IF NOT EXISTS support for policies)
DROP POLICY IF EXISTS "Service role can manage payment_authorizations"
  ON payment_authorizations;
DROP POLICY IF EXISTS "Users can view their own payment_authorizations"
  ON payment_authorizations;

-- Note: Supabase service_role bypasses RLS already, but this keeps intent explicit
CREATE POLICY "Service role can manage payment_authorizations"
  ON payment_authorizations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can SELECT their own rows via the linked challenge
CREATE POLICY "Users can view their own payment_authorizations"
  ON payment_authorizations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM payment_challenges pc
      WHERE pc.challenge_id = payment_authorizations.challenge_id
        AND pc.user_id = auth.uid()
    )
  );

-- Comments for documentation
COMMENT ON TABLE  payment_authorizations                         IS 'Stores ERC-3009 transferWithAuthorization signatures for facilitator-mode payments';
COMMENT ON COLUMN payment_authorizations.challenge_id            IS 'One-to-one reference to payment_challenges';
COMMENT ON COLUMN payment_authorizations.scheme                  IS 'Authorization scheme (currently only erc3009)';
COMMENT ON COLUMN payment_authorizations.from_address            IS 'Payer address (signer of the authorization)';
COMMENT ON COLUMN payment_authorizations.to_address              IS 'Recipient address (our receiving address)';
COMMENT ON COLUMN payment_authorizations.value_atomic            IS 'Amount in atomic units (e.g., USDC with 6 decimals)';
COMMENT ON COLUMN payment_authorizations.nonce                   IS '32-byte random nonce for replay protection';
COMMENT ON COLUMN payment_authorizations.signature               IS 'EIP-712 signature of the authorization';
COMMENT ON COLUMN payment_authorizations.facilitator_verdict     IS 'JSON response from facilitator verify/settle endpoints';

-- Verification query
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payment_authorizations'
  ) THEN
    RAISE NOTICE '✅ Migration 009: payment_authorizations table present';
  ELSE
    RAISE EXCEPTION '❌ Migration 009 failed: payment_authorizations table not found';
  END IF;
END $$;