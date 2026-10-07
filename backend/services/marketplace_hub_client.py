"""Instance client + in-process hub for the public marketplace network.

You do **not** need a special listings folder. Each Render instance keeps listings
in its own SQLite DB and talks to a Hub API.

Host the hub either:
  1. On this instance (``/api/marketplace/hub/v1``) — default for render3d.app
  2. As a separate service from ``services/marketplace-hub/``
     (suggested repo: ``render-marketplace-hub``)

Env on each instance:
  MARKETPLACE_HUB_URL   default https://render3d.app
  MARKETPLACE_HUB_TOKEN shared bearer token the hub issues (optional for pull)
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.config import settings
from backend.database import get_conn
from backend.services import marketplace_config_service
from backend.services.marketplace_schema import ensure_schema

logger = logging.getLogger("render3d.marketplace_hub")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hub_url() -> str:
    cfg = marketplace_config_service.load()
    return str(cfg.get("hub_url") or "https://render3d.app").rstrip("/")


def hub_is_self() -> bool:
    hub = _hub_url().lower().rstrip("/")
    base = (getattr(settings, "public_base_url", None) or "").strip().rstrip("/").lower()
    if hub and base and hub == base:
        return True
    if "render3d.app" in base and "render3d.app" in hub:
        return True
    return False


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_hub_request(authorization: str | None, instance_id: str | None) -> bool:
    """Authenticate a publisher with the official hub bearer credential."""
    bearer = ""
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    if not bearer or not instance_id:
        return False
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT token_hash FROM marketplace_hub_instances WHERE instance_id=?",
            (str(instance_id),),
        ).fetchone()
    if row and str(row["token_hash"] or ""):
        return secrets_equal(_hash_token(bearer), str(row["token_hash"]))
    legacy = str(getattr(settings, "marketplace_hub_token", "") or "").strip()
    return bool(legacy and secrets_equal(bearer, legacy))


def hosted_product_url(listing: dict[str, Any]) -> str:
    """Return the authoritative product page for a listing pulled from a hub."""
    kind = str(listing.get("kind") or "model").strip().lower()
    slug = str(listing.get("slug") or listing.get("id") or "").strip()
    if kind not in {"model", "agent", "knowledge"} or not slug:
        raise ValueError("Hub listing is missing its product identity.")
    from urllib.parse import quote

    return f"{_hub_url()}/marketplace.html?kind={quote(kind)}&listing={quote(slug)}"


def secrets_equal(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a.encode("utf-8"), b.encode("utf-8")):
        result |= x ^ y
    return result == 0


def register_instance(payload: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    instance_id = str(payload.get("instance_id") or uuid.uuid4()).strip()
    name = str(payload.get("name") or "Render instance")[:80]
    base = str(payload.get("public_base_url") or "")[:300]
    token = str(payload.get("instance_secret") or "").strip()
    if len(instance_id) < 8 or len(token) < 20:
        raise ValueError("A stable instance id and secret are required.")
    token_hash = _hash_token(token)
    now = _now()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT token_hash FROM marketplace_hub_instances WHERE instance_id=?",
            (instance_id,),
        ).fetchone()
        if existing and not secrets_equal(str(existing["token_hash"] or ""), token_hash):
            raise PermissionError("Instance identity is already registered.")
        conn.execute(
            """
            INSERT INTO marketplace_hub_instances (instance_id, name, public_base_url, token_hash, last_seen_at, created_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(instance_id) DO UPDATE SET
              name=excluded.name,
              public_base_url=excluded.public_base_url,
              last_seen_at=excluded.last_seen_at
            """,
            (instance_id, name, base, token_hash, now, now),
        )
        conn.commit()
    return {"instance_id": instance_id, "publishing": "enabled", "ok": True}


def upsert_hub_listing(instance_id: str, listing: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    if str(listing.get("visibility") or "").strip().lower() != "public":
        raise ValueError("Only explicitly public listings can enter the hub catalog.")
    origin_id = str(listing.get("id") or "")
    kind = str(listing.get("kind") or "model")
    if not origin_id:
        raise ValueError("listing.id required")
    row_id = f"{instance_id}:{kind}:{origin_id}"
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_hub_listings (
              id, instance_id, origin_listing_id, kind, slug, payload_json,
              ranking_score, published_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(instance_id, origin_listing_id, kind) DO UPDATE SET
              slug=excluded.slug,
              payload_json=excluded.payload_json,
              ranking_score=excluded.ranking_score,
              published_at=excluded.published_at,
              updated_at=excluded.updated_at
            """,
            (
                row_id,
                instance_id,
                origin_id,
                kind,
                str(listing.get("slug") or origin_id),
                json.dumps(listing, separators=(",", ":")),
                float(listing.get("ranking_score") or 0),
                listing.get("published_at"),
                now,
            ),
        )
        conn.commit()
    return {"id": row_id, "ok": True}


def list_hub_listings(*, q: str = "", kind: str | None = None, limit: int = 80) -> list[dict[str, Any]]:
    ensure_schema()
    sql = "SELECT payload_json FROM marketplace_hub_listings"
    params: list[Any] = []
    where: list[str] = []
    if kind:
        where.append("kind=?")
        params.append(kind)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY ranking_score DESC, updated_at DESC LIMIT ?"
    params.append(max(1, min(200, int(limit))))
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    out: list[dict[str, Any]] = []
    needle = str(q or "").strip().lower()
    for row in rows:
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        if needle:
            blob = " ".join(str(payload.get(k) or "") for k in ("name", "tagline", "description", "slug")).lower()
            if needle not in blob:
                continue
        payload["from_hub"] = True
        out.append(payload)
    return out


def pull_listings() -> list[dict[str, Any]]:
    cfg = marketplace_config_service.load()
    if not cfg.get("hub_pull_enabled") or cfg.get("mode") == "private":
        return []
    if hub_is_self():
        return list_hub_listings()
    url = f"{_hub_url()}/api/marketplace/hub/v1/listings"
    try:
        import httpx

        with httpx.Client(timeout=12.0) as client:
            res = client.get(url, headers=marketplace_config_service.hub_auth_headers())
            res.raise_for_status()
            data = res.json()
        return list(data.get("listings") or [])
    except Exception as exc:
        logger.info("Hub pull skipped: %s", type(exc).__name__)
        return []


def enroll_instance(*, public_network: bool = False) -> dict[str, Any]:
    """Register this stable identity with the hub without sending project data."""
    cfg = marketplace_config_service.ensure_instance_identity()
    if not cfg.get("enabled") or cfg.get("mode") != "public":
        return {"ok": False, "disabled": True}
    public_base = ""
    configured_base = str(getattr(settings, "public_base_url", None) or "").strip().rstrip("/")
    if public_network and configured_base.startswith("https://"):
        public_base = configured_base
    payload = {
        "instance_id": str(cfg.get("instance_id") or ""),
        "instance_secret": str(cfg.get("instance_secret") or ""),
        "name": str(cfg.get("instance_name") or "Render Studio instance")[:80],
        "public_base_url": public_base,
    }
    if hub_is_self():
        return register_instance(payload)
    try:
        import httpx

        with httpx.Client(timeout=8.0) as client:
            response = client.post(f"{_hub_url()}/api/marketplace/hub/v1/instances", json=payload)
            response.raise_for_status()
            data = response.json()
        return data if isinstance(data, dict) else {"ok": True}
    except Exception as exc:
        logger.info("Hub enrollment unavailable: %s", type(exc).__name__)
        return {"ok": False, "offline": True}


def publish_listing(listing: dict[str, Any]) -> dict[str, Any]:
    cfg = marketplace_config_service.ensure_instance_identity()
    if not cfg.get("hub_publish_enabled") or cfg.get("mode") == "private":
        return {"ok": False, "error": "publish_disabled"}
    if str(listing.get("status") or "").strip().lower() != "approved":
        return {"ok": False, "error": "listing_not_public"}
    from backend.services import marketplace_catalog_service

    public_base = str(getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")
    payload = marketplace_catalog_service.to_hub_payload(
        listing, instance_id=cfg["instance_id"], public_base=public_base
    )
    if hub_is_self():
        return upsert_hub_listing(cfg["instance_id"], payload)
    url = f"{_hub_url()}/api/marketplace/hub/v1/listings"
    try:
        import httpx

        with httpx.Client(timeout=12.0) as client:
            res = client.post(url, headers=marketplace_config_service.hub_auth_headers(), json={"listing": payload})
            res.raise_for_status()
            return res.json()
    except Exception as exc:
        logger.info("Hub publish failed: %s", exc)
        return {"ok": False, "error": str(exc)}


def publish_approved_listing(listing: dict[str, Any]) -> None:
    try:
        if str(listing.get("status") or "") != "approved":
            return
        publish_listing(listing)
    except Exception:
        logger.info("Hub publish hook failed", exc_info=True)
