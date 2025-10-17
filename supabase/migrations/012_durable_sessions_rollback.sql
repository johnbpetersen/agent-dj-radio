-- Rollback migration 012: Durable session-based identity
-- Removes sessions table and reverts to presence-only identity

-- Drop indexes first
DROP INDEX IF EXISTS public.idx_sessions_last_seen_at;
DROP INDEX IF EXISTS public.idx_sessions_user_id;

-- Drop sessions table (CASCADE removes any dependent constraints)
DROP TABLE IF EXISTS public.sessions CASCADE;
