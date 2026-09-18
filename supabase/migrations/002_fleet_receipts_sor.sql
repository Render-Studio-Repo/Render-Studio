-- Fleet receipts source-of-record tables for update/fix workflows.
-- Service role writes; authenticated admin/Sam readers can inspect receipts.

create extension if not exists pgcrypto;

create or replace function public.fleet_prefixed_id(prefix text)
returns text
language sql
volatile
as $$
  select prefix || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
$$;

create or replace function public.fleet_receipts_reader()
returns boolean
language sql
stable
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email'),
    lower(auth.jwt() -> 'user_metadata' ->> 'email'),
    lower(auth.jwt() -> 'app_metadata' ->> 'email'),
    ''
  ) = any (
    array[
      'a1projects@protonmail.com',
      'a1projects.usa@gmail.com',
      'sam@render3d.app',
      'sam@smartcallusa.com',
      'samwins.stead@gmail.com',
      'mtgraytech@gmail.com'
    ]
  );
$$;

create or replace function public.fleet_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.fleet_failures (
  failure_id text primary key
    default public.fleet_prefixed_id('FAIL-')
    check (failure_id ~ '^FAIL-[A-Z0-9]{16}$'),
  summary text not null,
  area text not null,
  pointer text not null,
  ask text not null,
  status text not null default 'open'
    check (status in ('open', 'in_pr', 'fixed', 'wontfix')),
  opened_by text not null,
  pr_url text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fleet_update_receipts (
  receipt_id text primary key
    default public.fleet_prefixed_id('RCPT-')
    check (receipt_id ~ '^RCPT-[A-Z0-9]{16}$'),
  log_id text not null,
  pr_url text,
  pr_number integer,
  color text not null default 'unset'
    check (color in ('unset', 'green', 'yellow', 'red')),
  guard_note text not null default '',
  mule_hop text not null default '',
  rmq text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_guard', 'ready', 'blocked')),
  failure_id text references public.fleet_failures (failure_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fleet_fix_receipts (
  fix_id text primary key
    default public.fleet_prefixed_id('FIX-')
    check (fix_id ~ '^FIX-[A-Z0-9]{16}$'),
  was text not null,
  root_cause text not null,
  fix text not null,
  verify text not null,
  pointer text not null,
  verified_by text,
  verified_at timestamptz,
  receipt_id text references public.fleet_update_receipts (receipt_id) on delete set null,
  pr_url text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fleet_failures_status_created
  on public.fleet_failures (status, created_at desc);

create index if not exists idx_fleet_update_receipts_status_created
  on public.fleet_update_receipts (status, created_at desc);

create index if not exists idx_fleet_update_receipts_failure_id
  on public.fleet_update_receipts (failure_id);

create index if not exists idx_fleet_fix_receipts_receipt_id
  on public.fleet_fix_receipts (receipt_id, verified_at desc nulls last);

drop trigger if exists fleet_failures_touch_updated_at on public.fleet_failures;
create trigger fleet_failures_touch_updated_at
before update on public.fleet_failures
for each row execute function public.fleet_touch_updated_at();

drop trigger if exists fleet_update_receipts_touch_updated_at on public.fleet_update_receipts;
create trigger fleet_update_receipts_touch_updated_at
before update on public.fleet_update_receipts
for each row execute function public.fleet_touch_updated_at();

drop trigger if exists fleet_fix_receipts_touch_updated_at on public.fleet_fix_receipts;
create trigger fleet_fix_receipts_touch_updated_at
before update on public.fleet_fix_receipts
for each row execute function public.fleet_touch_updated_at();

alter table public.fleet_failures enable row level security;
alter table public.fleet_update_receipts enable row level security;
alter table public.fleet_fix_receipts enable row level security;

revoke all on public.fleet_failures from anon;
revoke all on public.fleet_update_receipts from anon;
revoke all on public.fleet_fix_receipts from anon;

revoke all on public.fleet_failures from authenticated;
revoke all on public.fleet_update_receipts from authenticated;
revoke all on public.fleet_fix_receipts from authenticated;

grant select on public.fleet_failures to authenticated;
grant select on public.fleet_update_receipts to authenticated;
grant select on public.fleet_fix_receipts to authenticated;

grant all on public.fleet_failures to service_role;
grant all on public.fleet_update_receipts to service_role;
grant all on public.fleet_fix_receipts to service_role;

drop policy if exists fleet_failures_admin_read on public.fleet_failures;
create policy fleet_failures_admin_read
  on public.fleet_failures
  for select
  to authenticated
  using (public.fleet_receipts_reader());

drop policy if exists fleet_update_receipts_admin_read on public.fleet_update_receipts;
create policy fleet_update_receipts_admin_read
  on public.fleet_update_receipts
  for select
  to authenticated
  using (public.fleet_receipts_reader());

drop policy if exists fleet_fix_receipts_admin_read on public.fleet_fix_receipts;
create policy fleet_fix_receipts_admin_read
  on public.fleet_fix_receipts
  for select
  to authenticated
  using (public.fleet_receipts_reader());

drop policy if exists fleet_failures_service_write on public.fleet_failures;
create policy fleet_failures_service_write
  on public.fleet_failures
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists fleet_update_receipts_service_write on public.fleet_update_receipts;
create policy fleet_update_receipts_service_write
  on public.fleet_update_receipts
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists fleet_fix_receipts_service_write on public.fleet_fix_receipts;
create policy fleet_fix_receipts_service_write
  on public.fleet_fix_receipts
  for all
  to service_role
  using (true)
  with check (true);
