-- OAuth state tracking for PKCE flow
-- Used for Discord OAuth and future OAuth providers

create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  provider text not null check (provider in ('discord')),
  state text not null unique,
  code_verifier text not null,
  created_at timestamptz not null default now()
);

-- Index for session lookup
create index if not exists idx_oauth_states_session
  on public.oauth_states(session_id);

-- Index for provider + state lookup (callback verification)
create index if not exists idx_oauth_states_provider_state
  on public.oauth_states(provider, state);

-- Comments for documentation
comment on table public.oauth_states is
  'OAuth PKCE state storage for secure authorization flows';
comment on column public.oauth_states.state is
  'Unique OAuth state parameter (32 bytes base64url)';
comment on column public.oauth_states.code_verifier is
  'PKCE code verifier (32 bytes base64url, never sent to client)';
comment on column public.oauth_states.created_at is
  'Timestamp for TTL enforcement (cleaned up after callback or expiry)';
