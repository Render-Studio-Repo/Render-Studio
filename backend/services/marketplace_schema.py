"""Marketplace v2 SQLite tables. Additive — never drops live data."""

from __future__ import annotations

import sqlite3

from backend.database import get_conn

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS marketplace_listing_extras (
    listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    fulfillment TEXT NOT NULL DEFAULT 'digital',
    refunds_allowed INTEGER NOT NULL DEFAULT 1,
    refund_window_days INTEGER NOT NULL DEFAULT 14,
    ships_from TEXT NOT NULL DEFAULT '',
    weight_grams INTEGER,
    view_count INTEGER NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    rating_sum INTEGER NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    last_sale_at TEXT,
    inventory INTEGER,
    extras_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (listing_id, kind)
);

CREATE TABLE IF NOT EXISTS marketplace_reviews (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (listing_id, kind, user_id)
);

CREATE TABLE IF NOT EXISTS marketplace_cart_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, listing_id, kind)
);

CREATE TABLE IF NOT EXISTS marketplace_orders (
    id TEXT PRIMARY KEY,
    purchase_id TEXT,
    buyer_user_id TEXT NOT NULL,
    seller_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    fulfillment TEXT NOT NULL DEFAULT 'digital',
    shipping_name TEXT NOT NULL DEFAULT '',
    shipping_line1 TEXT NOT NULL DEFAULT '',
    shipping_line2 TEXT NOT NULL DEFAULT '',
    shipping_city TEXT NOT NULL DEFAULT '',
    shipping_region TEXT NOT NULL DEFAULT '',
    shipping_postal TEXT NOT NULL DEFAULT '',
    shipping_country TEXT NOT NULL DEFAULT '',
    tracking_carrier TEXT NOT NULL DEFAULT '',
    tracking_number TEXT NOT NULL DEFAULT '',
    shipped_at TEXT,
    delivered_at TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    listing_slug TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    qty INTEGER NOT NULL DEFAULT 1,
    price_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    FOREIGN KEY (order_id) REFERENCES marketplace_orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS marketplace_tickets (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    purchase_id TEXT,
    buyer_user_id TEXT NOT NULL,
    seller_user_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES marketplace_tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS marketplace_refunds (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL,
    order_id TEXT,
    buyer_user_id TEXT NOT NULL,
    seller_user_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    reason TEXT NOT NULL DEFAULT '',
    stripe_refund_id TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
);

CREATE TABLE IF NOT EXISTS marketplace_store_slugs (
    slug TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_profile_layout (
    user_id TEXT PRIMARY KEY,
    layout_json TEXT NOT NULL DEFAULT '[]',
    cover_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_hub_instances (
    instance_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    public_base_url TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL DEFAULT '',
    public_handle TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_hub_listings (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    origin_listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    ranking_score REAL NOT NULL DEFAULT 0,
    published_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (instance_id, origin_listing_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_mkt_cart_user ON marketplace_cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_buyer ON marketplace_orders(buyer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mkt_orders_seller ON marketplace_orders(seller_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mkt_tickets_buyer ON marketplace_tickets(buyer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mkt_tickets_seller ON marketplace_tickets(seller_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mkt_reviews_listing ON marketplace_reviews(listing_id, kind);
CREATE INDEX IF NOT EXISTS idx_mkt_hub_listings_score ON marketplace_hub_listings(ranking_score DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_store_slugs_user ON marketplace_store_slugs(user_id);
"""


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA_SQL)
        for sql in (
            "ALTER TABLE marketplace_boost_apps ADD COLUMN boost_kind TEXT NOT NULL DEFAULT 'sponsorship'",
            "ALTER TABLE marketplace_boost_apps ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE marketplace_boost_apps ADD COLUMN stripe_session_id TEXT",
            "ALTER TABLE marketplace_purchases ADD COLUMN receipt_sent_at TEXT",
            "ALTER TABLE marketplace_purchases ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none'",
            "ALTER TABLE marketplace_purchases ADD COLUMN order_id TEXT",
            "ALTER TABLE marketplace_purchases ADD COLUMN shipping_json TEXT NOT NULL DEFAULT '{}'",
            "ALTER TABLE marketplace_hub_instances ADD COLUMN public_handle TEXT",
        ):
            try:
                conn.execute(sql)
            except sqlite3.OperationalError:
                pass
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_hub_instance_handle ON marketplace_hub_instances(public_handle) WHERE public_handle IS NOT NULL AND public_handle != ''")
        conn.commit()
