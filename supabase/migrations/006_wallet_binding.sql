-- Migration 006: Wallet Binding for RPC-Only Mode
-- Adds ability to bind a wallet address to a payment challenge
-- Prevents tx-hash sniping by requiring payment from bound wallet

-- Add wallet binding columns to payment_challenges
ALTER TABLE payment_challenges
ADD COLUMN bound_address TEXT NULL,
ADD COLUMN bound_at TIMESTAMPTZ NULL,
ADD COLUMN bound_message TEXT NULL,
ADD COLUMN bound_signature TEXT NULL;

-- Index for bound address lookups (improve query performance)
CREATE INDEX idx_payment_challenges_bound_address
ON payment_challenges(bound_address)
WHERE bound_address IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN payment_challenges.bound_address IS 'Lowercase EVM address authorized to confirm this payment (prevents tx-hash sniping)';
COMMENT ON COLUMN payment_challenges.bound_at IS 'Timestamp when wallet was bound via signature';
COMMENT ON COLUMN payment_challenges.bound_message IS 'Original signed message (audit trail)';
COMMENT ON COLUMN payment_challenges.bound_signature IS 'Signature bytes hex (audit trail)';

-- Verification: Check columns exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_challenges' AND column_name='bound_address'
  ) THEN
    RAISE EXCEPTION 'Migration failed: bound_address column not created';
  END IF;
END $$;
