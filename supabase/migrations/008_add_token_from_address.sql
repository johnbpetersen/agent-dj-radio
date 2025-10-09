-- Migration 008: Add token_from_address to payment_confirmations
-- Enables proper payer detection for relayed/router transactions
-- The ERC-20 Transfer event 'from' address is the authoritative payer
-- (whereas tx_from_address is the transaction sender, which may be a relayer)

-- Step 1: Add token_from_address column (nullable for backward compatibility)
ALTER TABLE payment_confirmations
ADD COLUMN IF NOT EXISTS token_from_address TEXT NULL;

-- Step 2: Index for efficient lookups during binding checks
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_token_from_address
ON payment_confirmations(token_from_address)
WHERE token_from_address IS NOT NULL;

-- Step 3: Comment for documentation
COMMENT ON COLUMN payment_confirmations.token_from_address IS
  'Lowercase EVM address from ERC-20 Transfer event (authoritative payer for binding enforcement)';

-- Step 4: Verification - Check column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_confirmations' AND column_name='token_from_address'
  ) THEN
    RAISE EXCEPTION 'Migration failed: token_from_address column not created';
  END IF;
END $$;

-- Notes:
-- - token_from_address is the ERC-20 Transfer event 'from' address (the actual payer)
-- - tx_from_address is the transaction sender (may be a relayer/router)
-- - For binding enforcement, we prefer token_from_address ?? tx_from_address
-- - Existing records will have NULL token_from_address (gracefully handled by code)
