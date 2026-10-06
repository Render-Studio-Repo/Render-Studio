"""Premium / sponsored posts: pay to boost or request sponsorship."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.database import get_conn
from backend.services import marketplace_catalog_service, marketplace_config_service, marketplace_payments_service
from backend.services.marketplace_schema import ensure_schema

VALID_REVIEW = {"approved", "rejected"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _kind_for_boost(kind: str) -> str:
    return "model" if kind == "knowledge" else kind


def request_sponsorship(user_id: str, kind: str, listing_id_or_slug: str, message: str = "") -> dict[str, Any]:
    cfg = marketplace_config_service.load()
    if not cfg.get("premium_posts_enabled") or not cfg.get("sponsorship_requests_enabled"):
        raise ValueError("Sponsorship requests are turned off on this instance.")
    listing = marketplace_catalog_service.get_product(kind, listing_id_or_slug, user_id=user_id, record=False)
    if not listing:
        raise ValueError("Listing not found.")
    if listing.get("created_by") != user_id:
        raise PermissionError("Only the seller can request a sponsorship.")
    ensure_schema()
    now = _now_iso()
    boost_id = str(uuid.uuid4())[:12]
    store_kind = _kind_for_boost(listing["kind"])
    with get_conn() as conn:
        existing = conn.execute(
            """
            SELECT id FROM marketplace_boost_apps
             WHERE listing_id=? AND user_id=? AND status='pending' AND boost_kind='sponsorship'
            """,
            (listing["id"], user_id),
        ).fetchone()
        if existing:
            raise ValueError("A sponsorship request is already pending.")
        conn.execute(
            """
            INSERT INTO marketplace_boost_apps
              (id, kind, listing_id, listing_slug, user_id, message, status, created_at, boost_kind, price_cents)
            VALUES (?,?,?,?,?,?,'pending',?,'sponsorship',0)
            """,
            (boost_id, store_kind, listing["id"], listing.get("slug"), user_id, str(message or "")[:2000], now),
        )
        if store_kind == "agent":
            conn.execute("UPDATE agent_app_listings SET boost_status='pending', updated_at=? WHERE id=?", (now, listing["id"]))
        else:
            conn.execute("UPDATE model_listings SET boost_status='pending', updated_at=? WHERE id=?", (now, listing["id"]))
        conn.commit()
    return get_boost(boost_id) or {"id": boost_id, "status": "pending", "boost_kind": "sponsorship"}


def start_paid_boost(user: dict[str, Any], kind: str, listing_id_or_slug: str, *, success_url: str, cancel_url: str) -> dict[str, Any]:
    cfg = marketplace_config_service.load()
    if not cfg.get("premium_posts_enabled") or not cfg.get("paid_boost_enabled"):
        raise ValueError("Paid boosts are turned off on this instance.")
    listing = marketplace_catalog_service.get_product(kind, listing_id_or_slug, user_id=user["id"], record=False)
    if not listing:
        raise ValueError("Listing not found.")
    if listing.get("created_by") != user["id"]:
        raise PermissionError("Only the seller can boost this listing.")
    price = int(cfg.get("paid_boost_price_cents") or 1500)
    days = int(cfg.get("paid_boost_days") or 14)
    ensure_schema()
    boost_id = str(uuid.uuid4())[:12]
    now = _now_iso()
    store_kind = _kind_for_boost(listing["kind"])
    stripe = marketplace_payments_service._stripe()
    if not stripe:
        apply_boost_window(listing, days=days, boost_kind="paid")
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO marketplace_boost_apps
                  (id, kind, listing_id, listing_slug, user_id, message, status, created_at, reviewed_at, boost_kind, price_cents)
                VALUES (?,?,?,?,?,?,'approved',?,?, 'paid', ?)
                """,
                (boost_id, store_kind, listing["id"], listing.get("slug"), user["id"], "Paid boost (demo)", now, now, price),
            )
            conn.commit()
        return {"demo": True, "url": success_url, "boost_id": boost_id, "days": days}

    metadata = {
        "kind": "marketplace_boost",
        "boost_id": boost_id,
        "listing_id": listing["id"],
        "listing_kind": listing["kind"],
        "user_id": user["id"],
        "days": str(days),
    }
    session = stripe.checkout.Session.create(
        mode="payment",
        success_url=success_url,
        cancel_url=cancel_url,
        customer_email=user.get("email") or None,
        line_items=[
            {
                "quantity": 1,
                "price_data": {
                    "currency": "usd",
                    "unit_amount": price,
                    "product_data": {
                        "name": f"Marketplace boost — {listing.get('name')}"[:120],
                        "description": f"{days}-day premium placement",
                    },
                },
            }
        ],
        payment_method_types=["card", "link"],
        metadata=metadata,
        payment_intent_data={"metadata": metadata},
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_boost_apps
              (id, kind, listing_id, listing_slug, user_id, message, status, created_at, boost_kind, price_cents, stripe_session_id)
            VALUES (?,?,?,?,?,?,'pending',?,'paid',?,?)
            """,
            (
                boost_id,
                store_kind,
                listing["id"],
                listing.get("slug"),
                user["id"],
                "Paid boost checkout",
                now,
                price,
                session["id"],
            ),
        )
        conn.commit()
    return {"url": session["url"], "session_id": session["id"], "boost_id": boost_id, "price_cents": price, "days": days}


def apply_boost_window(listing: dict[str, Any], *, days: int, boost_kind: str) -> None:
    until = (_now() + timedelta(days=max(1, int(days)))).isoformat()
    now = _now_iso()
    with get_conn() as conn:
        if listing.get("kind") == "agent" or listing.get("app_type") is not None:
            conn.execute(
                "UPDATE agent_app_listings SET boost_status='approved', boosted_until=?, updated_at=? WHERE id=?",
                (until, now, listing["id"]),
            )
        else:
            conn.execute(
                "UPDATE model_listings SET boost_status='approved', boosted_until=?, updated_at=? WHERE id=?",
                (until, now, listing["id"]),
            )
        conn.commit()


def fulfill_paid_boost(session_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM marketplace_boost_apps WHERE stripe_session_id=?",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        if row["status"] == "approved":
            return dict(row)
        cfg = marketplace_config_service.load()
        days = int(cfg.get("paid_boost_days") or 14)
        listing = marketplace_catalog_service.get_product(row["kind"], row["listing_id"], record=False)
        if listing:
            apply_boost_window(listing, days=days, boost_kind="paid")
        conn.execute(
            "UPDATE marketplace_boost_apps SET status='approved', reviewed_at=? WHERE id=?",
            (_now_iso(), row["id"]),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM marketplace_boost_apps WHERE id=?", (row["id"],)).fetchone()
    return dict(row) if row else None


def get_boost(boost_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM marketplace_boost_apps WHERE id=?", (boost_id,)).fetchone()
    return dict(row) if row else None


def list_boosts(*, status: str = "pending", boost_kind: str | None = None) -> list[dict[str, Any]]:
    ensure_schema()
    sql = "SELECT * FROM marketplace_boost_apps WHERE 1=1"
    params: list[Any] = []
    if status:
        sql += " AND status=?"
        params.append(status)
    if boost_kind:
        sql += " AND boost_kind=?"
        params.append(boost_kind)
    sql += " ORDER BY created_at DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    out = []
    for row in rows:
        data = dict(row)
        listing = marketplace_catalog_service.get_product(data.get("kind") or "model", data.get("listing_id") or "", record=False)
        data["listing"] = listing
        out.append(data)
    return out


def review_boost(boost_id: str, *, status: str, days: int | None = None) -> dict[str, Any]:
    status = str(status or "").strip().lower()
    if status not in VALID_REVIEW:
        raise ValueError("status must be approved or rejected")
    row = get_boost(boost_id)
    if not row:
        raise ValueError("Boost not found")
    cfg = marketplace_config_service.load()
    days = int(days if days is not None else cfg.get("sponsorship_boost_days") or 14)
    now = _now_iso()
    listing = marketplace_catalog_service.get_product(row.get("kind") or "model", row.get("listing_id") or "", record=False)
    with get_conn() as conn:
        conn.execute(
            "UPDATE marketplace_boost_apps SET status=?, reviewed_at=? WHERE id=?",
            (status, now, boost_id),
        )
        conn.commit()
    if status == "approved" and listing:
        apply_boost_window(listing, days=days, boost_kind=str(row.get("boost_kind") or "sponsorship"))
    elif status == "rejected" and listing:
        with get_conn() as conn:
            table = "agent_app_listings" if listing.get("kind") == "agent" else "model_listings"
            conn.execute(
                f"UPDATE {table} SET boost_status='rejected', updated_at=? WHERE id=?",
                (now, listing["id"]),
            )
            conn.commit()
    return get_boost(boost_id) or row
