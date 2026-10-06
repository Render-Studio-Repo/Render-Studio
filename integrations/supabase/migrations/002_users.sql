-- Render Studio Users (multi-tenant). REST path: /rest/v1/Users
-- App user ids stay text (sqlite-compatible). Passwords are bcrypt hashes only.
-- AI keys / OAuth tokens are ciphertext (Fernet) — never plaintext.
-- Backend uses the service_role / secret key (bypasses RLS). Anon has no access.

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

-- Existing helpers used by supabase_auth_service / supabase_secrets_store.
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

-- Authenticated users may read/update their own non-secret columns.
grant select (
  id, email, username, display_name, role, created_at, updated_at,
  last_login_at, last_seen_at, avatar_url, bio, stats,
  project_count, model_count, prompt_count, success_count, error_count,
  credits_balance_cents, total_spend_cents, last_model_created_at,
  owned_project_ids, ai_provider, ai_model
) on public."Users" to authenticated;

grant update (
  display_name, username, avatar_url, bio, last_seen_at, last_login_at
) on public."Users" to authenticated;

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
