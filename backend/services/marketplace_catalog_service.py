"""Unified marketplace catalog: models, knowledge, agents + stats/search."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services import agent_marketplace_service, marketplace_ranking, model_marketplace_service
from backend.services.marketplace_schema import ensure_schema

CATEGORIES = (
    "robots",
    "fixtures",
    "toolheads",
    "parts",
    "electronics",
    "architecture",
    "knowledge",
    "agents",
    "other",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def infer_kind(listing: dict[str, Any], *, explicit: str | None = None) -> str:
    if explicit in {"model", "knowledge", "agent"}:
        return explicit
    files = listing.get("files") or []
    if any(isinstance(f, dict) and f.get("product_type") == "knowledge_base" for f in files):
        return "knowledge"
    cat = str(listing.get("category") or "").lower()
    if "knowledge" in cat:
        return "knowledge"
    if listing.get("app_type") or listing.get("installs") is not None:
        return "agent"
    return "model"


def _thumb_url(listing: dict[str, Any], *, kind: str | None = None) -> str | None:
    thumb = listing.get("thumbnail")
    if isinstance(thumb, dict):
        url = thumb.get("data_url") or thumb.get("url") or None
    else:
        url = thumb if isinstance(thumb, str) and thumb else None
    if isinstance(url, str) and url.startswith("data:image/svg+xml;base64,"):
        from urllib.parse import quote
        return f"/api/marketplace/product/{infer_kind(listing, explicit=kind)}/{quote(str(listing.get('id') or ''), safe='')}/thumbnail"
    return url


def extras_for(listing_id: str, kind: str) -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM marketplace_listing_extras WHERE listing_id=? AND kind=?",
            (listing_id, kind),
        ).fetchone()
    if not row:
        return {
            "fulfillment": "digital",
            "refunds_allowed": True,
            "refund_window_days": 14,
            "ships_from": "",
            "weight_grams": None,
            "view_count": 0,
            "sales_count": 0,
            "rating_sum": 0,
            "rating_count": 0,
            "rating_avg": 0.0,
            "last_sale_at": None,
            "inventory": None,
        }
    data = dict(row)
    count = int(data.get("rating_count") or 0)
    total = float(data.get("rating_sum") or 0)
    data["rating_avg"] = round(total / count, 2) if count else 0.0
    data["refunds_allowed"] = bool(data.get("refunds_allowed"))
    return data


def upsert_extras(listing_id: str, kind: str, patch: dict[str, Any] | None = None) -> dict[str, Any]:
    ensure_schema()
    current = extras_for(listing_id, kind)
    patch = patch or {}
    fulfillment = str(patch.get("fulfillment") or current.get("fulfillment") or "digital").strip().lower()
    if fulfillment not in {"digital", "shippable", "both"}:
        fulfillment = "digital"
    refunds_allowed = bool(patch["refunds_allowed"]) if "refunds_allowed" in patch else bool(current.get("refunds_allowed", True))
    try:
        window = int(patch.get("refund_window_days") if "refund_window_days" in patch else current.get("refund_window_days") or 14)
    except (TypeError, ValueError):
        window = 14
    window = max(0, min(365, window))
    ships_from = str(patch.get("ships_from") if "ships_from" in patch else current.get("ships_from") or "")[:120]
    inventory = current.get("inventory")
    if "inventory" in patch:
        try:
            inventory = None if patch["inventory"] in (None, "", "unlimited") else max(0, int(patch["inventory"]))
        except (TypeError, ValueError):
            inventory = current.get("inventory")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_listing_extras (
              listing_id, kind, fulfillment, refunds_allowed, refund_window_days,
              ships_from, weight_grams, view_count, sales_count, rating_sum, rating_count,
              last_sale_at, inventory, extras_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, '{}')
            ON CONFLICT(listing_id, kind) DO UPDATE SET
              fulfillment=excluded.fulfillment,
              refunds_allowed=excluded.refunds_allowed,
              refund_window_days=excluded.refund_window_days,
              ships_from=excluded.ships_from,
              inventory=excluded.inventory
            """,
            (
                listing_id,
                kind,
                fulfillment,
                1 if refunds_allowed else 0,
                window,
                ships_from,
                current.get("weight_grams"),
                int(current.get("view_count") or 0),
                int(current.get("sales_count") or 0),
                int(current.get("rating_sum") or 0),
                int(current.get("rating_count") or 0),
                current.get("last_sale_at"),
                inventory,
            ),
        )
        conn.commit()
    return extras_for(listing_id, kind)


def record_view(listing_id: str, kind: str) -> None:
    ensure_schema()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_listing_extras (listing_id, kind, view_count)
            VALUES (?, ?, 1)
            ON CONFLICT(listing_id, kind) DO UPDATE SET view_count = view_count + 1
            """,
            (listing_id, kind),
        )
        conn.commit()


def record_sale(listing_id: str, kind: str, qty: int = 1) -> None:
    ensure_schema()
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_listing_extras (listing_id, kind, sales_count, last_sale_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(listing_id, kind) DO UPDATE SET
              sales_count = sales_count + excluded.sales_count,
              last_sale_at = excluded.last_sale_at,
              inventory = CASE
                WHEN marketplace_listing_extras.inventory IS NULL THEN NULL
                ELSE MAX(0, marketplace_listing_extras.inventory - excluded.sales_count)
              END
            """,
            (listing_id, kind, max(1, int(qty)), now),
        )
        conn.commit()


def add_review(user_id: str, listing_id: str, kind: str, rating: int, body: str = "") -> dict[str, Any]:
    ensure_schema()
    rating = max(1, min(5, int(rating)))
    review_id = str(uuid.uuid4())[:12]
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_reviews (id, listing_id, kind, user_id, rating, body, created_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(listing_id, kind, user_id) DO UPDATE SET rating=excluded.rating, body=excluded.body
            """,
            (review_id, listing_id, kind, user_id, rating, str(body or "")[:2000], now),
        )
        agg = conn.execute(
            "SELECT SUM(rating) AS s, COUNT(*) AS c FROM marketplace_reviews WHERE listing_id=? AND kind=?",
            (listing_id, kind),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO marketplace_listing_extras (listing_id, kind, rating_sum, rating_count)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(listing_id, kind) DO UPDATE SET rating_sum=excluded.rating_sum, rating_count=excluded.rating_count
            """,
            (listing_id, kind, int(agg["s"] or 0), int(agg["c"] or 0)),
        )
        conn.commit()
    return extras_for(listing_id, kind)


def _boost_kind_for(listing_id: str, kind: str) -> str:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT boost_kind FROM marketplace_boost_apps
             WHERE listing_id=? AND kind=? AND status='approved'
             ORDER BY created_at DESC LIMIT 1
            """,
            (listing_id, kind if kind != "knowledge" else "model"),
        ).fetchone()
    if not row:
        return "sponsorship"
    return str(row["boost_kind"] or "sponsorship")


def decorate(listing: dict[str, Any], *, kind: str | None = None) -> dict[str, Any]:
    from backend.services.marketplace_thumbnail_service import public_project_thumbnail
    kind = infer_kind(listing, explicit=kind)
    extras = extras_for(listing["id"], kind)
    owner = listing.get("owner") or {}
    handle = None
    if listing.get("created_by"):
        with get_conn() as conn:
            user = conn.execute(
                "SELECT handle, display_name, avatar_url FROM users WHERE id=?",
                (listing["created_by"],),
            ).fetchone()
        if user:
            handle = user["handle"]
            owner = {
                "id": listing["created_by"],
                "name": user["display_name"],
                "handle": user["handle"],
                "avatar_url": user["avatar_url"],
            }
    row = {
        **listing,
        **extras,
        "kind": kind,
        "thumbnail_url": _thumb_url(listing, kind=kind) or public_project_thumbnail(listing),
        "owner": owner,
        "owner_handle": handle,
        "boost_kind": _boost_kind_for(listing["id"], kind),
        "href": f"/marketplace.html#/p/{kind}/{listing.get('slug') or listing['id']}",
        "public_path": f"/m/{kind}/{listing.get('slug') or listing['id']}",
    }
    return row


def _matches_query(listing: dict[str, Any], q: str) -> bool:
    if not q:
        return True
    blob = " ".join(
        str(listing.get(k) or "")
        for k in ("name", "tagline", "description", "category", "license")
    ).lower()
    owner = listing.get("owner") or {}
    blob += " " + str(owner.get("name") or "").lower()
    blob += " " + str(owner.get("handle") or listing.get("owner_handle") or "").lower()
    terms = [t for t in re.split(r"\s+", q.lower()) if t]
    return all(t in blob for t in terms)


def list_catalog(
    *,
    user_id: str | None = None,
    include_pending: bool = False,
    mine_only: bool = False,
    kind: str | None = None,
    q: str = "",
    category: str = "",
    access: str = "",
    license_key: str = "",
    seller: str = "",
    boosted: bool | None = None,
    fulfillment: str = "",
    sort: str = "rank",
    include_hub: bool = True,
) -> list[dict[str, Any]]:
    from backend.services import marketplace_config_service, marketplace_hub_client

    items: list[dict[str, Any]] = []
    want_kind = str(kind or "").strip().lower() or None
    if want_kind not in {None, "model", "knowledge", "agent"}:
        want_kind = None

    if want_kind in {None, "model", "knowledge"}:
        models = model_marketplace_service.list_listings(
            user_id=user_id, include_pending=include_pending, mine_only=mine_only
        )
        for listing in models:
            k = infer_kind(listing)
            if want_kind and k != want_kind:
                continue
            items.append(decorate(listing, kind=k))
    if want_kind in {None, "agent"}:
        apps = agent_marketplace_service.list_listings(
            user_id=user_id, include_pending=include_pending, mine_only=mine_only
        )
        for listing in apps:
            items.append(decorate(listing, kind="agent"))

    cfg = marketplace_config_service.load()
    if include_hub and not mine_only and cfg.get("enabled") and cfg.get("hub_pull_enabled") and cfg.get("mode") != "private":
        try:
            remote = marketplace_hub_client.pull_listings()
            seen = {(i.get("id"), i.get("kind")) for i in items}
            for listing in remote:
                key = (listing.get("id"), listing.get("kind"))
                if key in seen:
                    continue
                listing["from_hub"] = True
                items.append(listing)
                seen.add(key)
        except Exception:
            pass

    q = str(q or "").strip()
    category = str(category or "").strip().lower()
    access = str(access or "").strip().lower()
    license_key = str(license_key or "").strip().lower()
    seller = str(seller or "").strip().lstrip("@").lower()
    fulfillment = str(fulfillment or "").strip().lower()

    filtered: list[dict[str, Any]] = []
    for item in items:
        if q and not _matches_query(item, q):
            continue
        if category and category not in {"all", ""}:
            item_cat = str(item.get("category") or "").lower()
            mode = str(item.get("access_mode") or "")
            if category == "featured" and not item.get("featured"):
                continue
            elif category == "boosted" and item.get("boost_status") != "approved":
                continue
            elif category in {"free", "paid", "view_only"}:
                if mode != category:
                    continue
            elif category not in {item_cat, str(item.get("kind") or "")}:
                continue
        if access and access != "all" and str(item.get("access_mode") or "") != access:
            continue
        if license_key and license_key != "all" and str(item.get("license") or "").lower() != license_key:
            continue
        if seller:
            handle = str(item.get("owner_handle") or "").lower()
            owner_id = str((item.get("owner") or {}).get("id") or item.get("created_by") or "").lower()
            if seller not in {handle, owner_id}:
                continue
        if boosted and not (item.get("boost_status") == "approved"):
            continue
        if fulfillment and fulfillment != "all":
            if str(item.get("fulfillment") or "digital") not in {fulfillment, "both"}:
                continue
        if not include_pending and not mine_only:
            allowed = marketplace_config_service.allowed_kinds(cfg)
            kind_val = str(item.get("kind") or infer_kind(item))
            if kind_val not in allowed:
                continue
            cats = [c.strip() for c in str(cfg.get("hub_categories") or "").split(",") if c.strip()]
            if cats:
                item_cat = str(item.get("category") or "").lower()
                if item_cat not in cats and kind_val not in cats:
                    continue
        filtered.append(item)

    if sort == "new":
        filtered.sort(key=lambda r: str(r.get("published_at") or r.get("created_at") or ""), reverse=True)
        return filtered
    if sort == "price":
        filtered.sort(key=lambda r: int(r.get("price_cents") or 0))
        return filtered
    return marketplace_ranking.rank_listings(filtered)


def get_product(kind: str, listing_id_or_slug: str, *, user_id: str | None = None, record: bool = True) -> dict[str, Any] | None:
    kind = infer_kind({}, explicit=str(kind or "model").lower())
    listing = None
    if kind == "agent":
        listing = agent_marketplace_service.get_listing(listing_id_or_slug, user_id=user_id, include_pending=False)
    else:
        listing = model_marketplace_service.get_listing(listing_id_or_slug, user_id=user_id, include_pending=False)
        if listing:
            kind = infer_kind(listing, explicit=kind)
    if not listing:
        return None
    if record:
        record_view(listing["id"], kind)
    row = decorate(listing, kind=kind)
    row["ranking_score"] = marketplace_ranking.score_listing(row)
    return row


def listing_payload_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["id", "slug", "name", "kind", "price_cents", "currency", "access_mode"],
        "properties": {
            "id": {"type": "string"},
            "slug": {"type": "string"},
            "name": {"type": "string"},
            "tagline": {"type": "string"},
            "description": {"type": "string"},
            "kind": {"enum": ["model", "knowledge", "agent"]},
            "category": {"type": "string"},
            "license": {"type": "string"},
            "access_mode": {"enum": ["free", "paid", "view_only"]},
            "price_cents": {"type": "integer"},
            "currency": {"type": "string"},
            "thumbnail_url": {"type": "string"},
            "fulfillment": {"enum": ["digital", "shippable", "both"]},
            "refunds_allowed": {"type": "boolean"},
            "refund_window_days": {"type": "integer"},
            "view_count": {"type": "integer"},
            "sales_count": {"type": "integer"},
            "rating_avg": {"type": "number"},
            "instance_id": {"type": "string", "description": "Origin Render instance"},
            "origin_url": {"type": "string"},
        },
    }


def to_hub_payload(listing: dict[str, Any], *, instance_id: str, public_base: str) -> dict[str, Any]:
    kind = infer_kind(listing)
    extras = extras_for(listing["id"], kind)
    return {
        "id": listing["id"],
        "slug": listing.get("slug"),
        "name": listing.get("name"),
        "tagline": listing.get("tagline"),
        "description": listing.get("description"),
        "kind": kind,
        "category": listing.get("category"),
        "license": listing.get("license"),
        "access_mode": listing.get("access_mode"),
        "price_cents": int(listing.get("price_cents") or 0),
        "currency": listing.get("currency") or "USD",
        "thumbnail_url": _thumb_url(listing),
        "featured": bool(listing.get("featured")),
        "boost_status": listing.get("boost_status"),
        "boosted_until": listing.get("boosted_until"),
        "published_at": listing.get("published_at"),
        "owner": listing.get("owner"),
        "origin_url": f"{public_base.rstrip('/')}/m/{kind}/{listing.get('slug') or listing['id']}",
        "instance_id": instance_id,
        **extras,
        "ranking_score": marketplace_ranking.score_listing({**listing, **extras}),
    }
