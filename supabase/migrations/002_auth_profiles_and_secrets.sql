-- Auth profiles + encrypted API-key vault.
-- Passwords live in Supabase Auth (GoTrue) — never in these tables.
-- API keys are stored ONLY as server-side Fernet ciphertext (never plaintext).
-- Run in Supabase Dashboard → SQL Editor after 001_security_trial_ledger.sql.

-- App profile mirror (id matches local users.id)
create table if not exists public.render_profiles (
  id text primary key,
  supabase_user_id uuid unique,
  email text not null unique,
  display_name text not null default '',
  handle text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_render_profiles_email
  on public.render_profiles (lower(email));

create index if not exists idx_render_profiles_supabase_user
  on public.render_profiles (supabase_user_id);

-- Encrypted BYOK vault (ciphertext only; decrypt key stays on app server)
create table if not exists public.render_user_secrets (
  id text primary key,
  user_id text not null,
  kind text not null default 'ai_key',
  provider text not null default 'openai',
  name text not null default '',
  model text not null default '',
  ciphertext text not null,
  key_hint text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_render_user_secrets_user
  on public.render_user_secrets (user_id, kind);

-- Lock down: no anon/authenticated access. Backend uses secret key (bypasses RLS).
alter table public.render_profiles enable row level security;
alter table public.render_user_secrets enable row level security;

revoke all on public.render_profiles from anon, authenticated;
revoke all on public.render_user_secrets from anon, authenticated;

grant all on public.render_profiles to service_role;
grant all on public.render_user_secrets to service_role;
