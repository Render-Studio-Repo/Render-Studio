"""3D model product marketplace listings, members, downloads, and boost apps."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.database import get_conn

VALID_STATUSES = {"pending", "approved", "rejected", "archived"}
VALID_ACCESS = {"free", "paid", "view_only"}
VALID_LICENSES = {
    "cc0",
    "cc-by",
    "cc-by-sa",
    "cc-by-nc",
    "proprietary",
    "custom",
    "royalty-free",
    "editorial",
}
VALID_BOOST = {"none", "pending", "approved", "rejected"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:80] or f"model-{str(uuid.uuid4())[:8]}"


def _json_list(raw: str | None) -> list[Any]:
    try:
        parsed = json.loads(raw or "[]")
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _json_obj(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _unique_slug(conn, base: str) -> str:
    slug = _slugify(base)
    candidate = slug
    i = 2
    while conn.execute("SELECT 1 FROM model_listings WHERE slug = ?", (candidate,)).fetchone():
        suffix = f"-{i}"
        candidate = f"{slug[: 80 - len(suffix)]}{suffix}"
        i += 1
    return candidate


def _row_to_listing(row: Any, *, owner: dict[str, Any] | None = None) -> dict[str, Any]:
    thumb_raw = row["thumbnail_json"] or ""
    thumbnail = _json_obj(thumb_raw) if thumb_raw.startswith("{") else ({"data_url": thumb_raw} if thumb_raw else None)
    return {
        "id": row["id"],
        "slug": row["slug"],
        "name": row["name"],
        "tagline": row["tagline"],
        "description": row["description"],
        "body_md": row["body_md"] or "",
        "category": row["category"],
        "thumbnail": thumbnail,
        "gallery": _json_list(row["gallery_json"]),
        "files": _json_list(row["files_json"]),
        "members": _json_list(row["members_json"]),
        "license": row["license"] or "proprietary",
        "access_mode": row["access_mode"] or "free",
        "download_enabled": bool(row["download_enabled"]),
        "price_cents": int(row["price_cents"] or 0),
        "currency": row["currency"] or "USD",
        "status": row["status"],
        "featured": bool(row["featured"]),
        "boost_status": row["boost_status"] or "none",
        "boosted_until": row["boosted_until"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "published_at": row["published_at"],
        "owner": owner,
        "can_download": bool(row["download_enabled"]) and (row["access_mode"] or "free") != "view_only",
    }


def list_listings(*, user_id: str | None = None, include_pending: bool = False, mine_only: bool = False) -> list[dict[str, Any]]:
    where: list[str] = []
    params: list[Any] = []
    if mine_only:
        where.append("l.created_by = ?")
        params.append(user_id)
    elif not include_pending:
        where.append("l.status = 'approved'")
    sql = """
        SELECT l.*, u.display_name AS owner_name, u.email AS owner_email, u.avatar_url AS owner_avatar_url
        FROM model_listings l
        LEFT JOIN users u ON u.id = l.created_by
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += """
        ORDER BY
          CASE WHEN l.boost_status = 'approved' AND (l.boosted_until IS NULL OR l.boosted_until > ?) THEN 0 ELSE 1 END,
          l.featured DESC,
          l.published_at DESC,
          l.updated_at DESC
    """
    params.append(_now())
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [
        _row_to_listing(
            row,
            owner={
                "id": row["created_by"],
                "name": row["owner_name"],
                "email": row["owner_email"],
                "avatar_url": row["owner_avatar_url"],
            }
            if row["owner_name"] or row["owner_email"]
            else None,
        )
        for row in rows
    ]


def get_listing(listing_id_or_slug: str, *, user_id: str | None = None, include_pending: bool = False) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT l.*, u.display_name AS owner_name, u.email AS owner_email, u.avatar_url AS owner_avatar_url
            FROM model_listings l
            LEFT JOIN users u ON u.id = l.created_by
            WHERE l.id = ? OR l.slug = ?
            """,
            (listing_id_or_slug, listing_id_or_slug),
        ).fetchone()
    if not row:
        return None
    if row["status"] != "approved" and not include_pending and row["created_by"] != user_id:
        return None
    return _row_to_listing(
        row,
        owner={
            "id": row["created_by"],
            "name": row["owner_name"],
            "email": row["owner_email"],
            "avatar_url": row["owner_avatar_url"],
        }
        if row["owner_name"] or row["owner_email"]
        else None,
    )


def create_listing(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    tagline = str(data.get("tagline") or "").strip()
    description = str(data.get("description") or "").strip()
    if not name:
        raise ValueError("Product name is required.")
    if not tagline:
        raise ValueError("Tagline is required.")
    if not description:
        raise ValueError("Description is required.")

    access_mode = str(data.get("access_mode") or "free").strip().lower()
    if access_mode not in VALID_ACCESS:
        raise ValueError("access_mode must be free, paid, or view_only.")
    license_key = str(data.get("license") or "proprietary").strip().lower()
    if license_key not in VALID_LICENSES:
        raise ValueError("Unsupported license.")

    price_cents = max(0, int(data.get("price_cents") or 0))
    if access_mode == "paid" and price_cents <= 0:
        price_cents = max(price_cents, 100)
    if access_mode != "paid":
        price_cents = 0 if access_mode in {"free", "view_only"} else price_cents

    download_enabled = bool(data.get("download_enabled", True))
    if access_mode == "view_only":
        download_enabled = False

    members = data.get("members") if isinstance(data.get("members"), list) else []
    gallery = data.get("gallery") if isinstance(data.get("gallery"), list) else []
    files = data.get("files") if isinstance(data.get("files"), list) else []
    thumbnail = data.get("thumbnail") if isinstance(data.get("thumbnail"), dict) else None
    body_md = str(data.get("body_md") or data.get("description") or "").strip()[:20000]

    now = _now()
    listing_id = str(uuid.uuid4())[:12]
    with get_conn() as conn:
        slug = _unique_slug(conn, str(data.get("slug") or name))
        # Ensure creator is a member
        member_rows = []
        seen = set()
        for m in members[:20]:
            mid = str((m or {}).get("id") or (m or {}).get("user_id") or "").strip()
            if not mid or mid in seen:
                continue
            seen.add(mid)
            member_rows.append(
                {
                    "id": mid,
                    "email": (m or {}).get("email"),
                    "display_name": (m or {}).get("display_name") or (m or {}).get("name"),
                    "role": (m or {}).get("role") or "member",
                }
            )
        if user_id not in seen:
            member_rows.insert(0, {"id": user_id, "role": "owner"})
        conn.execute(
            """
            INSERT INTO model_listings
              (id, slug, name, tagline, description, body_md, category, thumbnail_json, gallery_json,
               files_json, members_json, license, access_mode, download_enabled, price_cents, currency,
               status, featured, boost_status, created_by, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,'none',?,?,?)
            """,
            (
                listing_id,
                slug,
                name,
                tagline,
                description[:4000],
                body_md,
                str(data.get("category") or "models").strip()[:80],
                json.dumps(thumbnail or {}, sort_keys=True),
                json.dumps(gallery[:12], sort_keys=True),
                json.dumps(files[:8], sort_keys=True),
                json.dumps(member_rows, sort_keys=True),
                license_key,
                access_mode,
                1 if download_enabled else 0,
                price_cents,
                str(data.get("currency") or "USD").strip().upper()[:8],
                user_id,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM model_listings WHERE id = ?", (listing_id,)).fetchone()
    return _row_to_listing(row)


def review_listing(listing_id_or_slug: str, *, status: str, featured: bool | None = None) -> dict[str, Any]:
    status = (status or "").strip().lower()
    if status not in VALID_STATUSES:
        raise ValueError("Invalid listing status.")
    now = _now()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM model_listings WHERE id = ? OR slug = ?",
            (listing_id_or_slug, listing_id_or_slug),
        ).fetchone()
        if not row:
            raise ValueError("Listing not found.")
        next_featured = int(bool(featured)) if featured is not None else int(row["featured"] or 0)
        conn.execute(
            """
            UPDATE model_listings
               SET status=?, featured=?, updated_at=?, published_at=CASE WHEN ?='approved' THEN COALESCE(published_at, ?) ELSE published_at END
             WHERE id=?
            """,
            (status, next_featured, now, status, now, row["id"]),
        )
        row = conn.execute("SELECT * FROM model_listings WHERE id = ?", (row["id"],)).fetchone()
    return _row_to_listing(row)


def apply_boost(user_id: str, listing_id_or_slug: str, message: str = "") -> dict[str, Any]:
    listing = get_listing(listing_id_or_slug, user_id=user_id, include_pending=True)
    if not listing:
        raise ValueError("Listing not found.")
    if listing["created_by"] != user_id:
        raise PermissionError("Only the product owner can apply for a boost.")
    now = _now()
    boost_id = str(uuid.uuid4())[:12]
    with get_conn() as conn:
        existing = conn.execute(
            """
            SELECT id FROM marketplace_boost_apps
             WHERE kind='model' AND listing_id=? AND user_id=? AND status='pending'
            """,
            (listing["id"], user_id),
        ).fetchone()
        if existing:
            raise ValueError("A boost application is already pending.")
        conn.execute(
            """
            INSERT INTO marketplace_boost_apps
              (id, kind, listing_id, listing_slug, user_id, message, status, created_at)
            VALUES (?,?,?,?,?,?,'pending',?)
            """,
            (boost_id, "model", listing["id"], listing["slug"], user_id, (message or "").strip()[:2000], now),
        )
        conn.execute(
            "UPDATE model_listings SET boost_status='pending', updated_at=? WHERE id=?",
            (now, listing["id"]),
        )
    return {"id": boost_id, "status": "pending", "listing_id": listing["id"]}


def review_boost(boost_id: str, *, status: str, days: int = 14) -> dict[str, Any]:
    status = (status or "").strip().lower()
    if status not in {"approved", "rejected"}:
        raise ValueError("Boost status must be approved or rejected.")
    now = _now()
    boosted_until = (datetime.now(timezone.utc) + timedelta(days=max(1, min(days, 90)))).isoformat() if status == "approved" else None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM marketplace_boost_apps WHERE id=?", (boost_id,)).fetchone()
        if not row:
            raise ValueError("Boost application not found.")
        conn.execute(
            "UPDATE marketplace_boost_apps SET status=?, reviewed_at=? WHERE id=?",
            (status, now, boost_id),
        )
        if row["kind"] == "model":
            conn.execute(
                """
                UPDATE model_listings
                   SET boost_status=?, boosted_until=?, featured=CASE WHEN ?= 'approved' THEN 1 ELSE featured END, updated_at=?
                 WHERE id=?
                """,
                (status, boosted_until, status, now, row["listing_id"]),
            )
        elif row["kind"] == "agent":
            conn.execute(
                """
                UPDATE agent_app_listings
                   SET boost_status=?, boosted_until=?, featured=CASE WHEN ?= 'approved' THEN 1 ELSE featured END, updated_at=?
                 WHERE id=?
                """,
                (status, boosted_until, status, now, row["listing_id"]),
            )
    return {"id": boost_id, "status": status, "boosted_until": boosted_until}


def list_boost_apps(*, kind: str | None = None, status: str = "pending") -> list[dict[str, Any]]:
    with get_conn() as conn:
        if kind:
            rows = conn.execute(
                "SELECT * FROM marketplace_boost_apps WHERE kind=? AND status=? ORDER BY created_at DESC",
                (kind, status),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM marketplace_boost_apps WHERE status=? ORDER BY created_at DESC",
                (status,),
            ).fetchall()
    return [dict(r) for r in rows]
