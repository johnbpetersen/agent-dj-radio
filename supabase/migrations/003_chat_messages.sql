-- Migration: Create chat messages table for ephemeral chat functionality
-- Behind ENABLE_CHAT_ALPHA feature flag

-- Ensure we have the crypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create chat_messages table for alpha chat feature
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES presence(session_id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  message text NOT NULL CHECK (length(message) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index on created_at for recent messages queries (DESC for newest first)
CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages(created_at DESC);

-- Index on session_id for user-specific queries
CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id);

-- Index on user_id for cleanup operations
CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx ON chat_messages(user_id);

-- Comments for clarity
COMMENT ON TABLE chat_messages IS 'Ephemeral chat messages (alpha feature behind ENABLE_CHAT_ALPHA flag)';
COMMENT ON COLUMN chat_messages.session_id IS 'Session that posted the message (nullable for cleanup)';
COMMENT ON COLUMN chat_messages.user_id IS 'User that posted the message (nullable for cleanup)';
COMMENT ON COLUMN chat_messages.display_name IS 'Denormalized display name snapshot at time of posting';
COMMENT ON COLUMN chat_messages.message IS 'Chat message content (max 200 chars)';
COMMENT ON CONSTRAINT chat_messages_message_check ON chat_messages IS 'Enforce maximum message length of 200 characters';