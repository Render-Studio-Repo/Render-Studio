-- Workspace, team keys, OAuth tokens, credits.
-- Origin uses service_role (bypasses RLS). Anon/authenticated cannot read tokens or keys.
-- App ids stay text (sqlite-compatible). Secrets are Fernet ciphertext.

create table if not exists public."Teams" (
  id text primary key,
  name text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  render_folder_provider text not null default 'render3d',
  render_folder_ref text,
  render_folder_label text,
  render_folder_connected_at timestamptz
);

create table if not exists public."TeamMembers" (
  team_id text not null references public."Teams"(id) on delete cascade,
  user_id text not null,
  role text not null default 'user',
  joined_at timestamptz not null default now(),
  can_invite boolean not null default false,
  access text not null default 'edit',
  can_export boolean not null default true,
  can_access_tools boolean not null default true,
  explorer_visible boolean not null default true,
  primary key (team_id, user_id)
);

create index if not exists idx_teammembers_user on public."TeamMembers" (user_id);

create table if not exists public."TeamInvites" (
  id text primary key,
  team_id text not null references public."Teams"(id) on delete cascade,
  email text not null,
  invited_by text not null,
  status text not null default 'pending',
  token text,
  grant_chatgpt boolean not null default false,
  grant_openai boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_teaminvites_email on public."TeamInvites" (lower(email), status);

create table if not exists public."ProjectAccess" (
  project_id text primary key,
  team_id text not null references public."Teams"(id) on delete cascade,
  folder_id text,
  sort_order integer not null default 0,
  is_public boolean not null default false,
  public_pinned boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_projectaccess_team on public."ProjectAccess" (team_id);

create table if not exists public."TeamKeys" (
  id text primary key,
  team_id text not null references public."Teams"(id) on delete cascade,
  name text not null,
  provider text not null,
  api_key_enc text not null,
  model text not null default '',
  shared_by text not null,
  enabled boolean not null default true,
  scope_type text not null default 'all',
  scope_project_id text,
  scope_label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_teamkeys_team on public."TeamKeys" (team_id);

create table if not exists public."TeamKeyGrants" (
  key_id text not null references public."TeamKeys"(id) on delete cascade,
  user_id text not null,
  granted boolean not null default false,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (key_id, user_id)
);

create index if not exists idx_teamkeygrants_user on public."TeamKeyGrants" (user_id);

create table if not exists public."UserTeamKeyOpts" (
  user_id text not null,
  key_id text not null references public."TeamKeys"(id) on delete cascade,
  use_key boolean not null default true,
  model text,
  daily_limit_usd double precision,
  daily_token_limit integer,
  allowed_models text,
  primary key (user_id, key_id)
);

create table if not exists public."OAuthTokens" (
  user_id text not null,
  provider text not null,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  provider_user_id text,
  provider_email text,
  provider_name text,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create index if not exists idx_oauthtokens_provider_uid
  on public."OAuthTokens" (provider, provider_user_id);

create table if not exists public."CreditAccounts" (
  user_id text primary key,
  balance_cents integer not null default 0,
  auto_refill_enabled boolean not null default false,
  auto_refill_threshold_cents integer not null default 500,
  auto_refill_amount_cents integer not null default 2000,
  use_platform_key boolean not null default false,
  platform_provider text not null default 'openai',
  platform_model text not null default '',
  trial_granted_at timestamptz,
  trial_popup_seen_at timestamptz,
  trial_email_sent_at timestamptz,
  trial_grant_ip text,
  trial_reclaimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public."CreditTransactions" (
  id text primary key,
  user_id text not null,
  kind text not null,
  amount_cents integer not null,
  balance_after_cents integer not null,
  provider text not null default '',
  model text not null default '',
  project_id text,
  stripe_session_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_tx_user
  on public."CreditTransactions" (user_id, created_at desc);

create unique index if not exists idx_credit_tx_stripe
  on public."CreditTransactions" (stripe_session_id)
  where stripe_session_id is not null and stripe_session_id <> '';

create or replace function public.debit_credit_account(p_user_id text, p_cents integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
  keep_key boolean;
begin
  if p_cents is null or p_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_amount');
  end if;
  update public."CreditAccounts"
     set balance_cents = balance_cents - p_cents,
         use_platform_key = case
           when balance_cents - p_cents <= 0 then false
           else use_platform_key
         end,
         updated_at = now()
   where user_id = p_user_id
     and balance_cents >= p_cents
  returning balance_cents, use_platform_key into new_balance, keep_key;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'insufficient');
  end if;
  return jsonb_build_object(
    'ok', true,
    'balance_cents', new_balance,
    'use_platform_key', keep_key
  );
end;
$$;

alter table public."Teams" enable row level security;
alter table public."TeamMembers" enable row level security;
alter table public."TeamInvites" enable row level security;
alter table public."ProjectAccess" enable row level security;
alter table public."TeamKeys" enable row level security;
alter table public."TeamKeyGrants" enable row level security;
alter table public."UserTeamKeyOpts" enable row level security;
alter table public."OAuthTokens" enable row level security;
alter table public."CreditAccounts" enable row level security;
alter table public."CreditTransactions" enable row level security;

revoke all on public."Teams" from anon, authenticated, public;
revoke all on public."TeamMembers" from anon, authenticated, public;
revoke all on public."TeamInvites" from anon, authenticated, public;
revoke all on public."ProjectAccess" from anon, authenticated, public;
revoke all on public."TeamKeys" from anon, authenticated, public;
revoke all on public."TeamKeyGrants" from anon, authenticated, public;
revoke all on public."UserTeamKeyOpts" from anon, authenticated, public;
revoke all on public."OAuthTokens" from anon, authenticated, public;
revoke all on public."CreditAccounts" from anon, authenticated, public;
revoke all on public."CreditTransactions" from anon, authenticated, public;

grant all on public."Teams" to service_role;
grant all on public."TeamMembers" to service_role;
grant all on public."TeamInvites" to service_role;
grant all on public."ProjectAccess" to service_role;
grant all on public."TeamKeys" to service_role;
grant all on public."TeamKeyGrants" to service_role;
grant all on public."UserTeamKeyOpts" to service_role;
grant all on public."OAuthTokens" to service_role;
grant all on public."CreditAccounts" to service_role;
grant all on public."CreditTransactions" to service_role;

revoke all on function public.debit_credit_account(text, integer) from public, anon, authenticated;
grant execute on function public.debit_credit_account(text, integer) to service_role;
