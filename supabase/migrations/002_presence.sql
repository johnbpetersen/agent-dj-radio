-- Migration: Create presence table for ephemeral user session tracking
-- Tracks active user sessions for real-time presence functionality

-- Ensure we have the crypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create presence table for session tracking
CREATE TABLE IF NOT EXISTS presence (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index on last_seen_at for cleanup and active user queries (DESC for recent first)
CREATE INDEX IF NOT EXISTS presence_last_seen_at_idx ON presence(last_seen_at DESC);

-- Index on user_id for joining with users table
CREATE INDEX IF NOT EXISTS presence_user_id_idx ON presence(user_id);

-- Comments for clarity
COMMENT ON TABLE presence IS 'Tracks active user sessions for ephemeral user presence';
COMMENT ON COLUMN presence.session_id IS 'Unique session identifier generated client-side';
COMMENT ON COLUMN presence.user_id IS 'Reference to the ephemeral user';
COMMENT ON COLUMN presence.display_name IS 'Denormalized display name for efficient queries';
COMMENT ON COLUMN presence.last_seen_at IS 'Last activity timestamp, updated by presence ping';
COMMENT ON COLUMN presence.user_agent IS 'Client user agent string for debugging';
COMMENT ON COLUMN presence.ip IS 'Client IP address for security/debugging';