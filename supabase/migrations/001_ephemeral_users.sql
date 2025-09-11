-- Migration: Add ephemeral user support
-- Adds columns to users table to support ephemeral user management

-- Ensure we have the crypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add ephemeral user columns to existing users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS is_agent boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS ephemeral boolean DEFAULT true NOT NULL;

-- Add index on last_seen_at for cleanup queries
CREATE INDEX IF NOT EXISTS users_last_seen_at_idx ON users(last_seen_at DESC);

-- Add index on ephemeral column for filtering
CREATE INDEX IF NOT EXISTS users_ephemeral_idx ON users(ephemeral);

-- Comment on new columns for clarity
COMMENT ON COLUMN users.is_agent IS 'True if this is an AI agent user (for display differentiation)';
COMMENT ON COLUMN users.bio IS 'Short user bio/description (max 200 chars, enforced in app)';
COMMENT ON COLUMN users.last_seen_at IS 'Timestamp of last user activity (for presence and cleanup)';
COMMENT ON COLUMN users.ephemeral IS 'True for ephemeral users that can be cleaned up automatically';