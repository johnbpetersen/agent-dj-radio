-- Migration 012: Durable session-based identity
-- Creates authoritative sessions table to decouple identity from presence TTL
--
-- Context:
-- Previously, guest identity was tied to presence table rows with ~5min TTL.
-- If presence expired, the same cookie would create a new user on next request.
-- This migration introduces a durable sessions table as the authoritative source
-- of session_id → user_id mapping, independent of presence lifetime.
--
-- Changes:
-- - Create public.sessions table with immutable session_id → user_id binding
-- - Add indexes for lookups and cleanup queries
-- - Enable RLS (no policies - service-role only access)

-- Sessions table: authoritative mapping of session_id → user_id
CREATE TABLE IF NOT EXISTS public.sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Index for lookups by user_id (useful for debugging, user cleanup)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);

-- Index for cleanup queries (finding stale sessions older than 30 days)
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_at ON public.sessions(last_seen_at);

-- Enable RLS: sessions are service-role only (no direct client access)
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed - service role bypasses RLS
-- Explicitly document that this table is server-only

-- Table comments
COMMENT ON TABLE public.sessions IS 
  'Authoritative session_id → user_id mapping for durable guest identity. Server-only access via service role.';

COMMENT ON COLUMN public.sessions.session_id IS 
  'Client cookie value (uuid v4); immutable after creation; primary key';

COMMENT ON COLUMN public.sessions.user_id IS 
  'Guest user this session is bound to; immutable after creation (never reassigned)';

COMMENT ON COLUMN public.sessions.last_seen_at IS 
  'Last time this session was used; updated on each /api/session/hello request';

COMMENT ON COLUMN public.sessions.created_at IS 
  'When this session was first created; immutable';
