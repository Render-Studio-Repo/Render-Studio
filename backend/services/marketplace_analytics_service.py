"""Best-effort Supabase marketplace analytics.

SQLite remains the transactional source for commerce. This append/rollup path
must never make browsing, downloads, or checkout fail when Supabase is offline.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services import supabase_client

logger = logging.getLogger("render3d.marketplace_analytics")

EVENTS = {"profile_view", "product_view", "download", "purchase", "sale", "refund"}


def record(
    event_type: str,
    *,
    actor_user_id: str | None = None,
    seller_user_id: str | None = None,
    kind: str | None = None,
    listing_id: str | None = None,
    purchase_id: str | None = None,
    quantity: int = 1,
    amount_cents: int = 0,
    currency: str = "USD",
    metadata: dict[str, Any] | None = None,
) -> bool:
    if event_type not in EVENTS or not supabase_client.configured():
        return False
    client = supabase_client.get_admin_client()
    if client is None:
        return False
    payload = {
        "p_event_type": event_type,
        "p_actor_user_id": str(actor_user_id or "") or None,
        "p_seller_user_id": str(seller_user_id or "") or None,
        "p_kind": kind if kind in {"model", "agent", "knowledge"} else None,
        "p_listing_id": str(listing_id or "") or None,
        "p_purchase_id": str(purchase_id or "") or None,
        "p_quantity": max(1, min(int(quantity or 1), 10000)),
        "p_amount_cents": max(0, int(amount_cents or 0)),
        "p_currency": str(currency or "USD").upper()[:8],
        "p_metadata": metadata if isinstance(metadata, dict) else {},
    }
    try:
        client.rpc("record_marketplace_event", payload).execute()
        return True
    except Exception:
        logger.warning("Supabase marketplace analytics write failed", exc_info=True)
        return False


def record_purchase(purchase: dict[str, Any], listing: dict[str, Any]) -> None:
    common = {
        "actor_user_id": purchase.get("buyer_user_id"),
        "seller_user_id": purchase.get("seller_user_id") or listing.get("created_by"),
        "kind": listing.get("kind") or purchase.get("kind") or "model",
        "listing_id": listing.get("id") or purchase.get("listing_id"),
        "purchase_id": purchase.get("id"),
        "amount_cents": int(purchase.get("price_cents") or 0),
        "currency": purchase.get("currency") or "USD",
        "metadata": {
            "platform_fee_cents": int(purchase.get("platform_fee_cents") or 0),
            "order_id": purchase.get("order_id"),
        },
    }
    record("purchase", **common)
    record("sale", **common)

