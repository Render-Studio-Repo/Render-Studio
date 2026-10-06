-- Security ledger for free-trial anti-abuse (server uses secret key; RLS denies public).
-- Run in Supabase Dashboard → SQL Editor, then set SUPABASE_URL in server .env.

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

-- Lock down: no anon/authenticated access. Backend uses secret key (bypasses RLS).
alter table public.render_trial_ips enable row level security;
alter table public.render_trial_pool enable row level security;
alter table public.render_trial_waitlist enable row level security;
alter table public.render_trial_grants enable row level security;
alter table public.render_trial_reclaims enable row level security;

-- Explicit deny for publishable/anon role (defense in depth).
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
