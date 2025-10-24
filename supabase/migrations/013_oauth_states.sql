-- Migration 013: OAuth state tracking for PKCE flow
-- Used for Discord OAuth and future OAuth providers
--
-- Context:
-- Implements RFC 7636 PKCE (Proof Key for Code Exchange) for secure OAuth flows.
-- Stores state parameter and code_verifier tied to the current session.
-- State is used to prevent CSRF; verifier is kept secret and used in token exchange.
--
-- Changes:
-- - Create public.oauth_states table
-- - Add indexes for session lookup and provider+state verification
-- - Enable RLS (service-role only access)

create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(session_id) on delete cascade,
  provider text not null check (provider in ('discord')),
  state text not null unique,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

-- Index for session lookup (cleanup, debugging)
create index if not exists idx_oauth_states_session
  on public.oauth_states(session_id);

-- Index for provider + state lookup (callback verification)
create index if not exists idx_oauth_states_provider_state
  on public.oauth_states(provider, state);

-- Enable RLS: oauth_states are service-role only (no direct client access)
alter table public.oauth_states enable row level security;

-- No RLS policies needed - service role bypasses RLS
-- Explicitly document that this table is server-only

-- Comments for documentation
comment on table public.oauth_states is
  'OAuth PKCE state storage for secure authorization flows. Service-role only access.';

comment on column public.oauth_states.state is
  'Unique OAuth state parameter (32 bytes base64url) for CSRF protection';

comment on column public.oauth_states.code_verifier is
  'PKCE code verifier (32 bytes base64url, never sent to client). Used in token exchange.';

comment on column public.oauth_states.created_at is
  'Timestamp for TTL enforcement (states expire after 10 minutes, cleaned up after callback)';

comment on column public.oauth_states.session_id is
  'Session that initiated this OAuth flow. Cascade deletes when session is removed.';
