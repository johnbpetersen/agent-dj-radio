# Database Migrations

## Required Migrations

Apply these SQL migrations in order to support the payment and user features.

### 1. x402 Payment Columns

**File:** `supabase/schema-x402-audit.sql`

Adds payment challenge storage and audit tables.

**SQL to run:**
```sql
-- Add x402 challenge columns to tracks table
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS x402_challenge_nonce TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS x402_challenge_amount TEXT; 
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS x402_challenge_asset TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS x402_challenge_chain TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS x402_challenge_pay_to TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS x402_challenge_expires_at TIMESTAMPTZ;

-- Payment audit trail table
CREATE TABLE IF NOT EXISTS payment_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'submitted' | 'confirmed' | 'failed'
  payment_proof TEXT,
  transaction_hash TEXT,
  correlation_id TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_audit_track_id_idx ON payment_audit(track_id);
CREATE INDEX IF NOT EXISTS payment_audit_event_type_idx ON payment_audit(event_type);
CREATE INDEX IF NOT EXISTS payment_audit_created_at_idx ON payment_audit(created_at);
```

### 2. User Display Name Uniqueness

**File:** `supabase/schema-user-unique-names.sql`

Prevents duplicate display names (case-insensitive).

**SQL to run:**
```sql
-- Add unique constraint on display names
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique_idx 
ON public.users (lower(display_name));
```

### 3. Storage Bucket Setup

Ensure the `tracks` bucket exists with proper permissions:

```sql
-- Create bucket (if not exists)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('tracks', 'tracks', true) 
ON CONFLICT (id) DO NOTHING;

-- Allow uploads from service role
CREATE POLICY IF NOT EXISTS "Service role can upload" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'tracks');
```

## Migration Verification

### Check x402 columns exist:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tracks' 
  AND column_name LIKE 'x402_%';
```

Expected output:
```
x402_challenge_nonce     | text
x402_challenge_amount    | text  
x402_challenge_asset     | text
x402_challenge_chain     | text
x402_challenge_pay_to    | text
x402_challenge_expires_at| timestamp with time zone
```

### Check user uniqueness constraint:
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'users' 
  AND indexname = 'users_display_name_unique_idx';
```

### Check payment audit table:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_name = 'payment_audit';
```

### Check storage bucket:
```sql
SELECT name, public FROM storage.buckets WHERE id = 'tracks';
```

## Rollback Procedures

If you need to rollback these migrations:

```sql
-- Remove x402 columns
ALTER TABLE tracks DROP COLUMN IF EXISTS x402_challenge_nonce;
ALTER TABLE tracks DROP COLUMN IF EXISTS x402_challenge_amount;
ALTER TABLE tracks DROP COLUMN IF EXISTS x402_challenge_asset;
ALTER TABLE tracks DROP COLUMN IF EXISTS x402_challenge_chain;
ALTER TABLE tracks DROP COLUMN IF EXISTS x402_challenge_pay_to;
ALTER TABLE tracks DROP COLUMN IF EXISTS x402_challenge_expires_at;

-- Remove audit table
DROP TABLE IF EXISTS payment_audit;

-- Remove user constraint (data will remain)
DROP INDEX IF EXISTS users_display_name_unique_idx;
```

**Warning:** Rollback will lose all payment challenge and audit data.