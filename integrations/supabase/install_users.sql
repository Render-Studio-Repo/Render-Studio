-- Render Studio — install this on YOUR Supabase project (SQL Editor).
-- Placeholders only. Never paste someone else's service_role / PAT / user hashes.
-- Project URL looks like: https://YOUR_PROJECT_REF.supabase.co
-- After this SQL: put SUPABASE_URL + service_role on the origin .env (never in the browser).

-- ── 1. Trial / security ledger ───────────────────────────────────────────────

create table if not exists public.render_trial_ips (
  ip text primary key,
  user_id text not null,
  granted_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.render_trial_pool (
  id int primary key check (id = 1),
  balance_cents int not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now()
);

insert into public.render_trial_pool (id, balance_cents)
values (1, 0)
on conflict (id) do nothing;

create table if not exists public.render_trial_waitlist (
  user_id text primary key,
  ip text,
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.render_trial_grants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  amount_cents int not null,
  from_pool boolean not null default false,
  client_ip text,
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_render_trial_grants_created
  on public.render_trial_grants (created_at desc);

create index if not exists idx_render_trial_grants_user
  on public.render_trial_grants (user_id, created_at desc);

create table if not exists public.render_trial_reclaims (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  amount_cents int not null,
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

alter table public.render_trial_ips enable row level security;
alter table public.render_trial_pool enable row level security;
alter table public.render_trial_waitlist enable row level security;
alter table public.render_trial_grants enable row level security;
alter table public.render_trial_reclaims enable row level security;

revoke all on public.render_trial_ips from anon, authenticated;
revoke all on public.render_trial_pool from anon, authenticated;
revoke all on public.render_trial_waitlist from anon, authenticated;
revoke all on public.render_trial_grants from anon, authenticated;
revoke all on public.render_trial_reclaims from anon, authenticated;

grant all on public.render_trial_ips to service_role;
grant all on public.render_trial_pool to service_role;
grant all on public.render_trial_waitlist to service_role;
grant all on public.render_trial_grants to service_role;
grant all on public.render_trial_reclaims to service_role;

-- ── 2. Users + secret vaults ─────────────────────────────────────────────────

create table if not exists public."Users" (
  id text primary key,
  email text not null,
  username text,
  display_name text,
  password_hash text,
  role text not null default 'user',
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  last_seen_at timestamptz,
  supabase_user_id uuid,
  avatar_url text,
  bio text,
  active_ai_key_id text,
  ai_provider text,
  ai_model text,
  ai_keys jsonb not null default '[]'::jsonb,
  oauth_secrets jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  project_count integer not null default 0,
  model_count integer not null default 0,
  prompt_count integer not null default 0,
  success_count integer not null default 0,
  error_count integer not null default 0,
  credits_balance_cents integer not null default 0,
  total_spend_cents integer not null default 0,
  last_model_created_at timestamptz,
  owned_project_ids jsonb not null default '[]'::jsonb,
  constraint users_email_unique unique (email)
);

create index if not exists idx_users_username on public."Users" (username);
create index if not exists idx_users_role on public."Users" (role);
create index if not exists idx_users_supabase_user_id on public."Users" (supabase_user_id);
create index if not exists idx_users_last_seen on public."Users" (last_seen_at desc);

create table if not exists public.render_profiles (
  id text primary key,
  email text not null,
  display_name text,
  handle text,
  supabase_user_id uuid,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_render_profiles_email on public.render_profiles (email);

create table if not exists public.render_user_secrets (
  id text primary key,
  user_id text not null,
  kind text not null default 'ai_key',
  provider text,
  name text,
  model text,
  ciphertext text not null,
  key_hint text,
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_render_user_secrets_user on public.render_user_secrets (user_id);

alter table public."Users" enable row level security;
alter table public.render_profiles enable row level security;
alter table public.render_user_secrets enable row level security;

revoke all on public."Users" from anon, authenticated, public;
revoke all on public.render_profiles from anon, authenticated, public;
revoke all on public.render_user_secrets from anon, authenticated, public;

grant all on public."Users" to service_role;
grant all on public.render_profiles to service_role;
grant all on public.render_user_secrets to service_role;

revoke select (password_hash, ai_keys, oauth_secrets) on public."Users" from anon, authenticated, public;

grant select (
  id, email, username, display_name, role, created_at, updated_at,
  last_login_at, last_seen_at, avatar_url, bio, stats,
  project_count, model_count, prompt_count, success_count, error_count,
  credits_balance_cents, total_spend_cents, last_model_created_at,
  owned_project_ids, ai_provider, ai_model,
  cloud_compute_interest, cloud_compute_interest_at,
  suggestions_count, submitted_suggestions,
  render_agent_questions_count, chats_sent_count, bug_requests_count
) on public."Users" to authenticated;

grant update (
  display_name, username, avatar_url, bio, last_seen_at, last_login_at
) on public."Users" to authenticated;

drop policy if exists users_anon_all on public."Users";
drop policy if exists "Enable read access for all users" on public."Users";
drop policy if exists users_select_all on public."Users";

drop policy if exists users_select_own on public."Users";
create policy users_select_own on public."Users"
  for select to authenticated
  using (
    supabase_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists users_update_own on public."Users";
create policy users_update_own on public."Users"
  for update to authenticated
  using (
    supabase_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (
    supabase_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists render_profiles_select_own on public.render_profiles;
create policy render_profiles_select_own on public.render_profiles
  for select to authenticated
  using (
    supabase_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Additive Users extras (idempotent for existing projects).
alter table public."Users" add column if not exists cloud_compute_interest boolean not null default false;
alter table public."Users" add column if not exists cloud_compute_interest_at timestamptz;
alter table public."Users" add column if not exists suggestions_count integer not null default 0;
alter table public."Users" add column if not exists submitted_suggestions boolean not null default false;
alter table public."Users" add column if not exists render_agent_questions_count integer not null default 0;
alter table public."Users" add column if not exists chats_sent_count integer not null default 0;
alter table public."Users" add column if not exists bug_requests_count integer not null default 0;
alter table public."Users" add column if not exists x_consumer_key text;
alter table public."Users" add column if not exists x_consumer_secret text;
revoke select (x_consumer_key, x_consumer_secret) on public."Users" from anon, authenticated, public;
revoke update (x_consumer_key, x_consumer_secret) on public."Users" from anon, authenticated, public;
alter table public."Users" add column if not exists github_pat text;
revoke select (github_pat) on public."Users" from anon, authenticated, public;
revoke update (github_pat) on public."Users" from anon, authenticated, public;

-- ── 3. Teams / membership / project access / team keys / OAuth / credits ─────
-- Same as migrations/005_workspace_oauth_credits.sql (idempotent).

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
