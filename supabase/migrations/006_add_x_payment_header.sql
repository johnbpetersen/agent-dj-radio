-- Migration: Add x_payment_header to payment_challenges
-- Stores the raw X-PAYMENT header string for facilitator verification

ALTER TABLE payment_challenges
ADD COLUMN IF NOT EXISTS x_payment_header TEXT;

-- Comment for documentation
COMMENT ON COLUMN payment_challenges.x_payment_header IS 'Raw X-PAYMENT header string for facilitator verification';
