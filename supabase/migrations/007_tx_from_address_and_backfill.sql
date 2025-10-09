-- Migration 007: Add tx_from_address to payment_confirmations
-- Enables WRONG_PAYER detection for reused transaction hashes
-- Also backfills existing records from RPC (best-effort)

-- Step 1: Add tx_from_address column (nullable initially for backfill)
ALTER TABLE payment_confirmations
ADD COLUMN IF NOT EXISTS tx_from_address TEXT NULL;

-- Step 2: Index for efficient lookups during reuse checks
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_tx_from_address
ON payment_confirmations(tx_from_address)
WHERE tx_from_address IS NOT NULL;

-- Step 3: Comment for documentation
COMMENT ON COLUMN payment_confirmations.tx_from_address IS 'Lowercase EVM address that sent the transaction (for reuse/mismatch detection)';

-- Step 4: Verification - Check column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='payment_confirmations' AND column_name='tx_from_address'
  ) THEN
    RAISE EXCEPTION 'Migration failed: tx_from_address column not created';
  END IF;
END $$;

-- Step 5: Backfill note
-- BACKFILL: In production, run a background job to fetch tx_from_address via RPC
-- for existing confirmations. This is best-effort and not critical for forward operation.
--
-- Example backfill script (run server-side):
-- ```
-- SELECT id, tx_hash FROM payment_confirmations WHERE tx_from_address IS NULL;
-- FOR EACH row:
--   receipt = eth_getTransactionReceipt(tx_hash)
--   UPDATE payment_confirmations SET tx_from_address = lower(receipt.from) WHERE id = row.id
-- ```
