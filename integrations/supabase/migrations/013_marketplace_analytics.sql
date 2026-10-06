-- Marketplace analytics ledger and rollups.
-- Raw events support audits. Rollups keep seller dashboards inexpensive.

alter table public.render_profiles
  add column if not exists public_profile_views bigint not null default 0,
  add column if not exists marketplace_product_views bigint not null default 0,
  add column if not exists marketplace_downloads bigint not null default 0,
  add column if not exists marketplace_purchases bigint not null default 0,
  add column if not exists marketplace_sales bigint not null default 0,
  add column if not exists marketplace_revenue_cents bigint not null default 0,
  add column if not exists last_marketplace_activity_at timestamptz;

create table if not exists public.marketplace_user_stats (
  user_id text primary key,
  profile_views bigint not null default 0,
  product_views bigint not null default 0,
  downloads bigint not null default 0,
  purchases bigint not null default 0,
  sales bigint not null default 0,
  gross_sales_cents bigint not null default 0,
  refunded_cents bigint not null default 0,
  net_sales_cents bigint not null default 0,
  last_event_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_listing_stats (
  kind text not null check (kind in ('model','agent','knowledge')),
  listing_id text not null,
  seller_user_id text,
  page_views bigint not null default 0,
  downloads bigint not null default 0,
  purchases bigint not null default 0,
  sales bigint not null default 0,
  gross_sales_cents bigint not null default 0,
  refunded_cents bigint not null default 0,
  net_sales_cents bigint not null default 0,
  last_view_at timestamptz,
  last_download_at timestamptz,
  last_sale_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (kind, listing_id)
);

create table if not exists public.marketplace_purchase_facts (
  purchase_id text primary key,
  buyer_user_id text,
  seller_user_id text,
  kind text not null check (kind in ('model','agent','knowledge')),
  listing_id text not null,
  quantity integer not null default 1 check (quantity > 0),
  gross_cents bigint not null default 0,
  platform_fee_cents bigint not null default 0,
  seller_net_cents bigint not null default 0,
  refunded_cents bigint not null default 0,
  currency text not null default 'USD',
  status text not null default 'paid',
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('profile_view','product_view','download','purchase','sale','refund')),
  actor_user_id text,
  seller_user_id text,
  kind text check (kind is null or kind in ('model','agent','knowledge')),
  listing_id text,
  purchase_id text,
  quantity integer not null default 1,
  amount_cents bigint not null default 0,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_marketplace_events_listing on public.marketplace_events (kind, listing_id, created_at desc);
create index if not exists idx_marketplace_events_actor on public.marketplace_events (actor_user_id, created_at desc);
create index if not exists idx_marketplace_events_seller on public.marketplace_events (seller_user_id, created_at desc);
create index if not exists idx_marketplace_purchase_buyer on public.marketplace_purchase_facts (buyer_user_id, paid_at desc);
create index if not exists idx_marketplace_purchase_seller on public.marketplace_purchase_facts (seller_user_id, paid_at desc);
create index if not exists idx_marketplace_listing_seller on public.marketplace_listing_stats (seller_user_id, updated_at desc);

create or replace function public.record_marketplace_event(
  p_event_type text,
  p_actor_user_id text default null,
  p_seller_user_id text default null,
  p_kind text default null,
  p_listing_id text default null,
  p_purchase_id text default null,
  p_quantity integer default 1,
  p_amount_cents bigint default 0,
  p_currency text default 'USD',
  p_metadata jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_qty integer := greatest(coalesce(p_quantity, 1), 1);
  v_amount bigint := greatest(coalesce(p_amount_cents, 0), 0);
begin
  if p_event_type not in ('profile_view','product_view','download','purchase','sale','refund') then
    raise exception 'Unsupported marketplace event';
  end if;

  insert into public.marketplace_events (
    event_type, actor_user_id, seller_user_id, kind, listing_id, purchase_id,
    quantity, amount_cents, currency, metadata
  ) values (
    p_event_type, nullif(p_actor_user_id,''), nullif(p_seller_user_id,''),
    nullif(p_kind,''), nullif(p_listing_id,''), nullif(p_purchase_id,''),
    v_qty, v_amount, upper(coalesce(nullif(p_currency,''),'USD')), coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  if p_event_type = 'profile_view' and nullif(p_seller_user_id,'') is not null then
    insert into public.marketplace_user_stats (user_id, profile_views, last_event_at)
    values (p_seller_user_id, 1, now())
    on conflict (user_id) do update set
      profile_views = marketplace_user_stats.profile_views + 1,
      last_event_at = now(), updated_at = now();
  end if;

  if p_event_type in ('product_view','download','sale','refund') and p_kind is not null and p_listing_id is not null then
    insert into public.marketplace_listing_stats (
      kind, listing_id, seller_user_id, page_views, downloads, sales,
      gross_sales_cents, refunded_cents, net_sales_cents,
      last_view_at, last_download_at, last_sale_at
    ) values (
      p_kind, p_listing_id, nullif(p_seller_user_id,''),
      case when p_event_type='product_view' then 1 else 0 end,
      case when p_event_type='download' then v_qty else 0 end,
      case when p_event_type='sale' then v_qty else 0 end,
      case when p_event_type='sale' then v_amount else 0 end,
      case when p_event_type='refund' then v_amount else 0 end,
      case when p_event_type='sale' then v_amount when p_event_type='refund' then -v_amount else 0 end,
      case when p_event_type='product_view' then now() end,
      case when p_event_type='download' then now() end,
      case when p_event_type='sale' then now() end
    )
    on conflict (kind, listing_id) do update set
      seller_user_id = coalesce(excluded.seller_user_id, marketplace_listing_stats.seller_user_id),
      page_views = marketplace_listing_stats.page_views + excluded.page_views,
      downloads = marketplace_listing_stats.downloads + excluded.downloads,
      sales = marketplace_listing_stats.sales + excluded.sales,
      gross_sales_cents = marketplace_listing_stats.gross_sales_cents + excluded.gross_sales_cents,
      refunded_cents = marketplace_listing_stats.refunded_cents + excluded.refunded_cents,
      net_sales_cents = marketplace_listing_stats.net_sales_cents + excluded.net_sales_cents,
      last_view_at = coalesce(excluded.last_view_at, marketplace_listing_stats.last_view_at),
      last_download_at = coalesce(excluded.last_download_at, marketplace_listing_stats.last_download_at),
      last_sale_at = coalesce(excluded.last_sale_at, marketplace_listing_stats.last_sale_at),
      updated_at = now();
  end if;

  if p_event_type in ('product_view','download','purchase') and nullif(p_actor_user_id,'') is not null then
    insert into public.marketplace_user_stats (
      user_id, product_views, downloads, purchases, last_event_at
    ) values (
      p_actor_user_id,
      case when p_event_type='product_view' then 1 else 0 end,
      case when p_event_type='download' then v_qty else 0 end,
      case when p_event_type='purchase' then v_qty else 0 end,
      now()
    )
    on conflict (user_id) do update set
      product_views = marketplace_user_stats.product_views + excluded.product_views,
      downloads = marketplace_user_stats.downloads + excluded.downloads,
      purchases = marketplace_user_stats.purchases + excluded.purchases,
      last_event_at = now(), updated_at = now();
  end if;

  if p_event_type in ('sale','refund') and nullif(p_seller_user_id,'') is not null then
    insert into public.marketplace_user_stats (
      user_id, sales, gross_sales_cents, refunded_cents, net_sales_cents, last_event_at
    ) values (
      p_seller_user_id,
      case when p_event_type='sale' then v_qty else 0 end,
      case when p_event_type='sale' then v_amount else 0 end,
      case when p_event_type='refund' then v_amount else 0 end,
      case when p_event_type='sale' then v_amount when p_event_type='refund' then -v_amount else 0 end,
      now()
    )
    on conflict (user_id) do update set
      sales = marketplace_user_stats.sales + excluded.sales,
      gross_sales_cents = marketplace_user_stats.gross_sales_cents + excluded.gross_sales_cents,
      refunded_cents = marketplace_user_stats.refunded_cents + excluded.refunded_cents,
      net_sales_cents = marketplace_user_stats.net_sales_cents + excluded.net_sales_cents,
      last_event_at = now(), updated_at = now();
  end if;

  if nullif(p_seller_user_id,'') is not null then
    update public.render_profiles set
      public_profile_views = public_profile_views + case when p_event_type='profile_view' then 1 else 0 end,
      marketplace_product_views = marketplace_product_views + case when p_event_type='product_view' then 1 else 0 end,
      marketplace_downloads = marketplace_downloads + case when p_event_type='download' then v_qty else 0 end,
      marketplace_sales = marketplace_sales + case when p_event_type='sale' then v_qty else 0 end,
      marketplace_revenue_cents = marketplace_revenue_cents
        + case when p_event_type='sale' then v_amount when p_event_type='refund' then -v_amount else 0 end,
      last_marketplace_activity_at = now(),
      updated_at = now()
    where id = p_seller_user_id;
  end if;

  if nullif(p_actor_user_id,'') is not null and p_event_type='purchase' then
    update public.render_profiles set
      marketplace_purchases = marketplace_purchases + v_qty,
      last_marketplace_activity_at = now(),
      updated_at = now()
    where id = p_actor_user_id;
  end if;

  if p_event_type in ('purchase','sale') and p_purchase_id is not null and p_kind is not null and p_listing_id is not null then
    insert into public.marketplace_purchase_facts (
      purchase_id, buyer_user_id, seller_user_id, kind, listing_id, quantity,
      gross_cents, platform_fee_cents, seller_net_cents, currency, status, paid_at
    ) values (
      p_purchase_id, nullif(p_actor_user_id,''), nullif(p_seller_user_id,''),
      p_kind, p_listing_id, v_qty, v_amount,
      greatest(coalesce((p_metadata->>'platform_fee_cents')::bigint,0),0),
      greatest(v_amount - coalesce((p_metadata->>'platform_fee_cents')::bigint,0),0),
      upper(coalesce(nullif(p_currency,''),'USD')), 'paid', now()
    )
    on conflict (purchase_id) do update set
      status='paid', paid_at=coalesce(marketplace_purchase_facts.paid_at,now()),
      gross_cents=excluded.gross_cents,
      platform_fee_cents=excluded.platform_fee_cents,
      seller_net_cents=excluded.seller_net_cents,
      updated_at=now();
  end if;

  return v_id;
end;
$$;

alter table public.marketplace_user_stats enable row level security;
alter table public.marketplace_listing_stats enable row level security;
alter table public.marketplace_purchase_facts enable row level security;
alter table public.marketplace_events enable row level security;

revoke all on public.marketplace_user_stats, public.marketplace_listing_stats,
  public.marketplace_purchase_facts, public.marketplace_events from anon, authenticated, public;
grant all on public.marketplace_user_stats, public.marketplace_listing_stats,
  public.marketplace_purchase_facts, public.marketplace_events to service_role;
revoke all on function public.record_marketplace_event(text,text,text,text,text,text,integer,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_marketplace_event(text,text,text,text,text,text,integer,bigint,text,jsonb) to service_role;

grant select on public.marketplace_user_stats to authenticated;
grant select on public.marketplace_purchase_facts to authenticated;

drop policy if exists marketplace_user_stats_select_own on public.marketplace_user_stats;
create policy marketplace_user_stats_select_own on public.marketplace_user_stats
  for select to authenticated
  using (user_id in (
    select id from public.render_profiles where supabase_user_id = auth.uid()
  ));

drop policy if exists marketplace_purchase_facts_select_party on public.marketplace_purchase_facts;
create policy marketplace_purchase_facts_select_party on public.marketplace_purchase_facts
  for select to authenticated
  using (
    buyer_user_id in (select id from public.render_profiles where supabase_user_id = auth.uid())
    or seller_user_id in (select id from public.render_profiles where supabase_user_id = auth.uid())
  );

