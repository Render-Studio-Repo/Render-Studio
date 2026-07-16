"""Agent app marketplace listings and installs."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn


VALID_STATUSES = {"pending", "approved", "rejected", "archived"}
VALID_APP_TYPES = {"skill", "script", "workflow", "connector", "tool"}
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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug[:80] or f"agent-app-{str(uuid.uuid4())[:8]}"


def _json_loads(raw: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _json_list(raw: str | None) -> list[Any]:
    try:
        parsed = json.loads(raw or "[]")
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _row_get(row: Any, key: str, default: Any = None) -> Any:
    try:
        keys = row.keys()
        if key in keys:
            val = row[key]
            return default if val is None else val
    except Exception:
        pass
    return default


def _row_to_listing(row: Any, *, installed: bool = False, owner: dict[str, Any] | None = None) -> dict[str, Any]:
    access_mode = str(_row_get(row, "access_mode", "free") or "free")
    download_enabled = bool(int(_row_get(row, "download_enabled", 1) or 0))
    price_cents = int(_row_get(row, "price_cents", 0) or 0)
    premium = bool(_row_get(row, "premium", 0))
    if premium and access_mode == "free" and price_cents > 0:
        access_mode = "paid"
    return {
        "id": row["id"],
        "slug": row["slug"],
        "name": row["name"],
        "tagline": row["tagline"],
        "description": row["description"],
        "body_md": _row_get(row, "body_md", "") or "",
        "category": row["category"],
        "app_type": row["app_type"],
        "manifest": _json_loads(row["manifest_json"]),
        "source_url": row["source_url"],
        "icon_url": row["icon_url"],
        "price_cents": price_cents,
        "currency": row["currency"] or "USD",
        "premium": premium,
        "license": _row_get(row, "license", "proprietary") or "proprietary",
        "access_mode": access_mode,
        "download_enabled": download_enabled,
        "members": _json_list(_row_get(row, "members_json", "[]")),
        "boost_status": _row_get(row, "boost_status", "none") or "none",
        "boosted_until": _row_get(row, "boosted_until"),
        "status": row["status"],
        "featured": bool(row["featured"]),
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "published_at": row["published_at"],
        "installed": installed,
        "owner": owner,
        "can_download": download_enabled and access_mode != "view_only",
    }


def _unique_slug(conn, base: str) -> str:
    slug = _slugify(base)
    candidate = slug
    i = 2
    while conn.execute("SELECT 1 FROM agent_app_listings WHERE slug = ?", (candidate,)).fetchone():
        suffix = f"-{i}"
        candidate = f"{slug[:80 - len(suffix)]}{suffix}"
        i += 1
    return candidate


def list_listings(*, user_id: str | None = None, include_pending: bool = False, mine_only: bool = False) -> list[dict[str, Any]]:
    where: list[str] = []
    params: list[Any] = []
    if mine_only:
        where.append("l.created_by = ?")
        params.append(user_id)
    elif not include_pending:
        where.append("l.status = 'approved'")
    sql = """
        SELECT l.*, u.display_name AS owner_name, u.email AS owner_email, u.avatar_url AS owner_avatar_url,
               i.user_id AS installed_user_id
        FROM agent_app_listings l
        LEFT JOIN users u ON u.id = l.created_by
        LEFT JOIN agent_app_installs i ON i.app_id = l.id AND i.user_id = ?
    """
    params = [user_id, *params]
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += """
        ORDER BY
          CASE WHEN COALESCE(l.boost_status,'none') = 'approved' AND (l.boosted_until IS NULL OR l.boosted_until > ?) THEN 0 ELSE 1 END,
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
            installed=bool(row["installed_user_id"]),
            owner={
                "id": row["created_by"],
                "name": row["owner_name"],
                "email": row["owner_email"],
                "avatar_url": row["owner_avatar_url"],
            } if row["owner_name"] or row["owner_email"] else None,
        )
        for row in rows
    ]


def get_listing(app_id_or_slug: str, *, user_id: str | None = None, include_pending: bool = False) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT l.*, u.display_name AS owner_name, u.email AS owner_email, u.avatar_url AS owner_avatar_url,
                   i.user_id AS installed_user_id
            FROM agent_app_listings l
            LEFT JOIN users u ON u.id = l.created_by
            LEFT JOIN agent_app_installs i ON i.app_id = l.id AND i.user_id = ?
            WHERE l.id = ? OR l.slug = ?
            """,
            (user_id, app_id_or_slug, app_id_or_slug),
        ).fetchone()
    if not row:
        return None
    if row["status"] != "approved" and not include_pending and row["created_by"] != user_id:
        return None
    return _row_to_listing(
        row,
        installed=bool(row["installed_user_id"]),
        owner={
            "id": row["created_by"],
            "name": row["owner_name"],
            "email": row["owner_email"],
            "avatar_url": row["owner_avatar_url"],
        } if row["owner_name"] or row["owner_email"] else None,
    )


def create_listing(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    tagline = str(data.get("tagline") or "").strip()
    description = str(data.get("description") or "").strip()
    if not name:
        raise ValueError("App name is required.")
    if not tagline:
        raise ValueError("Tagline is required.")
    if not description:
        raise ValueError("Description is required.")

    app_type = str(data.get("app_type") or "skill").strip().lower()
    if app_type not in VALID_APP_TYPES:
        raise ValueError(f"Unsupported app_type '{app_type}'.")
    manifest = data.get("manifest") if isinstance(data.get("manifest"), dict) else {}
    access_mode = str(data.get("access_mode") or ("paid" if data.get("premium") or data.get("price_cents") else "free")).strip().lower()
    if access_mode not in VALID_ACCESS:
        access_mode = "free"
    license_key = str(data.get("license") or "proprietary").strip().lower()
    if license_key not in VALID_LICENSES:
        license_key = "proprietary"
    download_enabled = bool(data.get("download_enabled", True))
    if access_mode == "view_only":
        download_enabled = False
    members = data.get("members") if isinstance(data.get("members"), list) else []
    body_md = str(data.get("body_md") or "").strip()[:20000]
    price_cents = max(0, int(data.get("price_cents") or 0))
    premium = bool(data.get("premium")) or access_mode == "paid" or price_cents > 0
    now = _now()
    app_id = str(uuid.uuid4())[:12]
    with get_conn() as conn:
        slug = _unique_slug(conn, str(data.get("slug") or name))
        conn.execute(
            """
            INSERT INTO agent_app_listings
              (id, slug, name, tagline, description, category, app_type, manifest_json,
               source_url, icon_url, price_cents, currency, premium, status, featured,
               body_md, license, access_mode, download_enabled, members_json, boost_status,
               created_by, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,?,?,?,?,'none',?,?,?)
            """,
            (
                app_id,
                slug,
                name,
                tagline,
                description,
                str(data.get("category") or "agent").strip()[:80],
                app_type,
                json.dumps(manifest, sort_keys=True),
                str(data.get("source_url") or "").strip() or None,
                str(data.get("icon_url") or "").strip() or None,
                price_cents,
                str(data.get("currency") or "USD").strip().upper()[:8],
                1 if premium else 0,
                body_md,
                license_key,
                access_mode,
                1 if download_enabled else 0,
                json.dumps(members[:20], sort_keys=True),
                user_id,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM agent_app_listings WHERE id = ?", (app_id,)).fetchone()
    return _row_to_listing(row)


def review_listing(app_id_or_slug: str, *, status: str, featured: bool | None = None) -> dict[str, Any]:
    status = (status or "").strip().lower()
    if status not in VALID_STATUSES:
        raise ValueError("Invalid listing status.")
    now = _now()
    published_at = now if status == "approved" else None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM agent_app_listings WHERE id = ? OR slug = ?",
            (app_id_or_slug, app_id_or_slug),
        ).fetchone()
        if not row:
            raise ValueError("Listing not found.")
        next_featured = int(bool(featured)) if featured is not None else int(row["featured"] or 0)
        conn.execute(
            """
            UPDATE agent_app_listings
               SET status = ?, featured = ?, updated_at = ?,
                   published_at = CASE WHEN ? = 'approved' THEN COALESCE(published_at, ?) ELSE published_at END
             WHERE id = ?
            """,
            (status, next_featured, now, status, published_at, row["id"]),
        )
        out = conn.execute("SELECT * FROM agent_app_listings WHERE id = ?", (row["id"],)).fetchone()
    return _row_to_listing(out)


def install_listing(user_id: str, app_id_or_slug: str) -> dict[str, Any]:
    listing = get_listing(app_id_or_slug, user_id=user_id)
    if not listing:
        raise ValueError("Listing not found.")
    if listing.get("access_mode") == "view_only":
        raise PermissionError("This listing is view-only and cannot be installed.")
    paid = listing.get("access_mode") == "paid" or listing["premium"] or listing["price_cents"] > 0
    if paid:
        from backend.services import marketplace_payments_service as payments

        owner_id = listing.get("created_by") or (listing.get("owner") or {}).get("id")
        if owner_id != user_id and not payments.has_entitlement(user_id, "agent", listing["id"]):
            raise PermissionError("Purchase is required before installing this app.")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO agent_app_installs (user_id, app_id, installed_at, status)
            VALUES (?, ?, ?, 'installed')
            ON CONFLICT(user_id, app_id) DO UPDATE SET status='installed', installed_at=excluded.installed_at
            """,
            (user_id, listing["id"], _now()),
        )
    return get_listing(listing["id"], user_id=user_id, include_pending=True) or listing


def uninstall_listing(user_id: str, app_id_or_slug: str) -> None:
    listing = get_listing(app_id_or_slug, user_id=user_id, include_pending=True)
    if not listing:
        raise ValueError("Listing not found.")
    with get_conn() as conn:
        conn.execute(
            "UPDATE agent_app_installs SET status='uninstalled' WHERE user_id = ? AND app_id = ?",
            (user_id, listing["id"]),
        )


def apply_boost(user_id: str, app_id_or_slug: str, message: str = "") -> dict[str, Any]:
    listing = get_listing(app_id_or_slug, user_id=user_id, include_pending=True)
    if not listing:
        raise ValueError("Listing not found.")
    if listing["created_by"] != user_id:
        raise PermissionError("Only the app owner can apply for a boost.")
    now = _now()
    boost_id = str(uuid.uuid4())[:12]
    with get_conn() as conn:
        existing = conn.execute(
            """
            SELECT id FROM marketplace_boost_apps
             WHERE kind='agent' AND listing_id=? AND user_id=? AND status='pending'
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
            (boost_id, "agent", listing["id"], listing["slug"], user_id, (message or "").strip()[:2000], now),
        )
        try:
            conn.execute(
                "UPDATE agent_app_listings SET boost_status='pending', updated_at=? WHERE id=?",
                (now, listing["id"]),
            )
        except Exception:
            pass
    return {"id": boost_id, "status": "pending", "listing_id": listing["id"]}
