"""Public store slugs, profile layout, and storefront HTML with OG tags."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi.responses import HTMLResponse

from backend.config import settings
from backend.database import get_conn
from backend.services import marketplace_catalog_service, profile_service
from backend.services.marketplace_schema import ensure_schema

COVER_MAX_BYTES = 2_500_000

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")

RESERVED_SLUGS = {
    "api",
    "u",
    "s",
    "m",
    "oauth",
    "files",
    "images",
    "assets",
    "static",
    "marketplace",
    "admin",
    "admin-dashboard",
    "foundry",
    "docs",
    "skills",
    "updates",
    "privacy",
    "roadmap",
    "getting-started",
    "model-store",
    "agent-store",
    "knowledge-store",
    "setup-marketplace",
    "login",
    "signup",
    "projects",
    "ws",
    "health",
    "og",
    "store",
    "storefront",
    "index",
    "app",
    "studio",
    "social",
    "vr",
    "share",
    "setup",
    "credits",
    "credits.html",
    "cover",
    "me",
}

DEFAULT_LAYOUT = [
    {"id": "hero", "type": "hero", "visible": True, "label": "Hero"},
    {"id": "featured", "type": "featured_models", "visible": True, "label": "Featured models"},
    {"id": "catalog", "type": "models", "visible": True, "label": "All models"},
    {"id": "about", "type": "about", "visible": True, "label": "About"},
]


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return slug[:48] or ""


def validate_slug(slug: str) -> str:
    cleaned = _slugify(slug)
    if not SLUG_RE.match(cleaned):
        raise ValueError("Store URL must be 2–48 characters: lowercase letters, numbers, dashes.")
    if cleaned in RESERVED_SLUGS:
        raise ValueError("That store URL is reserved.")
    return cleaned


def get_slug_for_user(user_id: str) -> str | None:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute("SELECT slug FROM marketplace_store_slugs WHERE user_id=?", (user_id,)).fetchone()
    return row["slug"] if row else None


def get_user_for_slug(slug: str) -> dict[str, Any] | None:
    ensure_schema()
    cleaned = _slugify(slug)
    if not cleaned:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT user_id FROM marketplace_store_slugs WHERE slug=?", (cleaned,)).fetchone()
    if not row:
        return None
    return profile_service.get_user_row(row["user_id"])


def set_slug(user_id: str, slug: str) -> str:
    ensure_schema()
    cleaned = validate_slug(slug)
    with get_conn() as conn:
        taken = conn.execute(
            "SELECT user_id FROM marketplace_store_slugs WHERE slug=? AND user_id!=?",
            (cleaned, user_id),
        ).fetchone()
        if taken:
            raise ValueError("That store URL is already taken.")
        now = _now()
        conn.execute(
            """
            INSERT INTO marketplace_store_slugs (slug, user_id, created_at, updated_at)
            VALUES (?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET slug=excluded.slug, updated_at=excluded.updated_at
            """,
            (cleaned, user_id, now, now),
        )
        conn.commit()
    return cleaned


def ensure_default_slug(user: dict[str, Any]) -> str:
    existing = get_slug_for_user(user["id"])
    if existing:
        return existing
    handle = str(user.get("handle") or profile_service.slugify_handle(user.get("display_name") or "store"))
    try:
        return set_slug(user["id"], handle)
    except ValueError:
        return set_slug(user["id"], f"{handle}-store")


def get_layout(user_id: str) -> list[dict[str, Any]]:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute("SELECT layout_json FROM marketplace_profile_layout WHERE user_id=?", (user_id,)).fetchone()
    if not row:
        return [dict(b) for b in DEFAULT_LAYOUT]
    try:
        parsed = json.loads(row["layout_json"] or "[]")
    except Exception:
        parsed = []
    if not isinstance(parsed, list) or not parsed:
        return [dict(b) for b in DEFAULT_LAYOUT]
    return normalize_layout(parsed)


def normalize_layout(layout: Any) -> list[dict[str, Any]]:
    """Keep custom store content inside a small, inert section schema."""
    allowed = {"hero", "featured_models", "models", "about", "gallery", "slideshow", "categories", "code"}
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in (layout if isinstance(layout, list) else [])[:24]:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("type") or raw.get("id") or "")
        if kind not in allowed:
            continue
        bid = re.sub(r"[^a-zA-Z0-9_-]", "", str(raw.get("id") or kind))[:40]
        if not bid or bid in seen:
            continue
        seen.add(bid)
        block = {"id": bid, "type": kind, "visible": raw.get("visible") is not False,
                 "label": str(raw.get("label") or kind.replace("_", " "))[:80]}
        for key, size in (("title", 120), ("subtitle", 240), ("body", 8000), ("code", 12000)):
            if key in raw:
                block[key] = str(raw.get(key) or "")[:size]
        if isinstance(raw.get("style"), str) and raw.get("style") in {"grid", "spotlight", "compact", "editorial"}:
            block["style"] = raw["style"]
        if isinstance(raw.get("tone"), str) and raw.get("tone") in {"white", "mist", "dark", "accent"}:
            block["tone"] = raw["tone"]
        if isinstance(raw.get("kind"), str) and raw.get("kind") in {"model", "knowledge", "agent"}:
            block["kind"] = raw["kind"]
        if "category" in raw:
            block["category"] = str(raw.get("category") or "")[:80]
        if re.fullmatch(r"#[0-9a-fA-F]{6}", str(raw.get("accent") or "")):
            block["accent"] = raw["accent"]
        for key, lo, hi in (("columns", 2, 4), ("limit", 1, 48), ("interval", 3, 15)):
            try:
                if key in raw:
                    block[key] = max(lo, min(hi, int(raw[key])))
            except (TypeError, ValueError, OverflowError):
                pass
        ids = raw.get("listing_ids")
        if isinstance(ids, list):
            block["listing_ids"] = list(dict.fromkeys(str(x)[:100] for x in ids if isinstance(x, str) and x))[:48]
        cleaned.append(block)
    return cleaned or [dict(b) for b in DEFAULT_LAYOUT]


def save_layout(user_id: str, layout: list[dict[str, Any]], cover: dict[str, Any] | None = None) -> dict[str, Any]:
    ensure_schema()
    cleaned = normalize_layout(layout)
    if cover is None:
        cover_obj = get_cover(user_id)
    else:
        cover_obj = normalize_cover(cover)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_profile_layout (user_id, layout_json, cover_json, updated_at)
            VALUES (?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET layout_json=excluded.layout_json, cover_json=excluded.cover_json, updated_at=excluded.updated_at
            """,
            (user_id, json.dumps(cleaned), json.dumps(cover_obj), _now()),
        )
        conn.commit()
    return {"layout": cleaned, "cover": cover_obj}


def normalize_cover(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    url = str(raw.get("image_url") or "").strip()[:500]
    lowered = url.lower()
    if lowered.startswith("javascript:") or lowered.startswith("data:"):
        url = ""
    if url and not (url.startswith("/") or lowered.startswith("https://") or lowered.startswith("http://")):
        url = ""
    if "enabled" in raw:
        enabled = bool(raw.get("enabled"))
    else:
        enabled = bool(url)
    if not url:
        enabled = False
    return {"enabled": enabled, "image_url": url}


def public_cover(cover: dict[str, Any] | None, *, is_self: bool = False) -> dict[str, Any]:
    cleaned = normalize_cover(cover)
    if is_self:
        return cleaned
    if cleaned.get("enabled") and cleaned.get("image_url"):
        return {"enabled": True, "image_url": cleaned["image_url"]}
    return {"enabled": False, "image_url": ""}


def get_cover(user_id: str) -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT cover_json FROM marketplace_profile_layout WHERE user_id=?",
            (user_id,),
        ).fetchone()
    if not row:
        return normalize_cover({})
    try:
        parsed = json.loads(row["cover_json"] or "{}")
    except Exception:
        parsed = {}
    return normalize_cover(parsed)


def set_cover(user_id: str, patch: dict[str, Any] | None) -> dict[str, Any]:
    current = get_cover(user_id)
    incoming = patch if isinstance(patch, dict) else {}
    merged = {
        "image_url": incoming["image_url"] if "image_url" in incoming else current.get("image_url") or "",
        "enabled": incoming["enabled"] if "enabled" in incoming else current.get("enabled"),
    }
    cleaned = normalize_cover(merged)
    ensure_schema()
    now = _now()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT layout_json FROM marketplace_profile_layout WHERE user_id=?",
            (user_id,),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE marketplace_profile_layout SET cover_json=?, updated_at=? WHERE user_id=?",
                (json.dumps(cleaned), now, user_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO marketplace_profile_layout (user_id, layout_json, cover_json, updated_at)
                VALUES (?,?,?,?)
                """,
                (user_id, json.dumps([dict(b) for b in DEFAULT_LAYOUT]), json.dumps(cleaned), now),
            )
        conn.commit()
    return cleaned


def partition_listings(
    listings: list[dict[str, Any]] | None,
    featured_ids: list[Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items = [item for item in (listings or []) if isinstance(item, dict)]
    wanted = {str(x).strip() for x in (featured_ids or []) if str(x).strip()}
    featured = [item for item in items if str(item.get("id") or "") in wanted or bool(item.get("featured"))]
    featured_seen = {str(item.get("id") or "") for item in featured}
    catalog = [item for item in items if str(item.get("id") or "") not in featured_seen]
    return featured, catalog


def _safe_user_id(user_id: str) -> str:
    return "".join(ch for ch in str(user_id) if ch.isalnum() or ch in {"-", "_"})[:80]


def _cover_dir() -> Path:
    path = Path(settings.data_dir) / "store-covers"
    path.mkdir(parents=True, exist_ok=True)
    return path


def cover_image_file(user_id: str) -> tuple[Path, str] | None:
    safe = _safe_user_id(user_id)
    if not safe:
        return None
    for ext, media in (("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg")):
        path = _cover_dir() / f"{safe}.{ext}"
        if path.is_file():
            return path, media
    return None


def save_cover_image(user_id: str, data: bytes, content_type: str = "") -> dict[str, Any]:
    media = (content_type or "").lower()
    ext = "png" if media == "image/png" else "jpg" if media in {"image/jpeg", "image/jpg"} else ""
    payload = data or b""
    if not ext:
        if payload.startswith(b"\x89PNG\r\n\x1a\n"):
            ext = "png"
        elif payload.startswith(b"\xff\xd8"):
            ext = "jpg"
        else:
            raise ValueError("Upload a PNG or JPEG image.")
    if not payload:
        raise ValueError("Uploaded image is empty.")
    if len(payload) > COVER_MAX_BYTES:
        raise ValueError("Banner image must be under 2.5 MB.")
    if ext == "png" and not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Invalid PNG image.")
    if ext == "jpg" and not payload.startswith(b"\xff\xd8"):
        raise ValueError("Invalid JPEG image.")
    safe = _safe_user_id(user_id)
    if not safe:
        raise ValueError("Invalid user.")
    folder = _cover_dir()
    for old_ext in ("png", "jpg", "jpeg"):
        old = folder / f"{safe}.{old_ext}"
        if old.is_file():
            old.unlink()
    (folder / f"{safe}.{ext}").write_bytes(payload)
    from time import time

    url = f"/api/marketplace/store/cover/{safe}?v={int(time())}"
    return set_cover(user_id, {"enabled": True, "image_url": url})


def delete_cover_image(user_id: str) -> dict[str, Any]:
    safe = _safe_user_id(user_id)
    if safe:
        folder = _cover_dir()
        for ext in ("png", "jpg", "jpeg"):
            path = folder / f"{safe}.{ext}"
            if path.is_file():
                path.unlink()
    return set_cover(user_id, {"enabled": False, "image_url": ""})


def storefront_payload(user: dict[str, Any], *, viewer: dict[str, Any] | None = None) -> dict[str, Any]:
    profile = profile_service.public_profile(user["id"], viewer=viewer)
    slug = get_slug_for_user(user["id"]) or ensure_default_slug(user)
    listings = marketplace_catalog_service.list_catalog(
        seller=str(user.get("handle") or user["id"]),
        include_hub=False,
        mine_only=False,
    )
    # seller filter uses handle; also include by id
    if not listings:
        listings = [
            item
            for item in marketplace_catalog_service.list_catalog(include_hub=False)
            if str(item.get("created_by") or "") == user["id"]
        ]
    # Public stores carry product metadata; downloadable files remain behind entitlement checks.
    from backend.services.marketplace_product_page_service import public_listing
    listings = [public_listing(item) for item in listings]
    featured_ids = (profile.get("store") or {}).get("featured_listing_ids") or []
    featured, catalog = partition_listings(listings, featured_ids)
    is_self = bool(profile.get("is_self"))
    base = str(getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")
    store_path = f"/{slug}"
    return {
        "profile": profile,
        "slug": slug,
        "store_path": store_path,
        "store_url": f"{base}{store_path}",
        "profile_url": f"{base}/u/{profile.get('handle')}",
        "og_image": f"{base}/api/marketplace/og/store/{slug}.png",
        "share_x": (
            "https://twitter.com/intent/tweet?"
            + f"text={_quote(profile.get('display_name') or 'My Render store')}&"
            + f"url={_quote(base + store_path)}"
        ),
        "layout": get_layout(user["id"]),
        "listings": listings,
        "featured": featured,
        "catalog": catalog,
        "cover": public_cover(get_cover(user["id"]), is_self=is_self),
    }


def _quote(value: str) -> str:
    from urllib.parse import quote

    return quote(str(value or ""), safe="")


def resolve_public_path(full_path: str) -> dict[str, Any] | None:
    parts = [p for p in str(full_path or "").strip("/").split("/") if p]
    if not parts:
        return None
    head = parts[0].lower()
    if "." in Path(parts[-1]).name and head not in {"u", "s", "m"}:
        return None
    if head in RESERVED_SLUGS and head not in {"u", "s", "m"}:
        return None
    if head == "u" and len(parts) >= 2:
        return {"view": "profile", "handle": parts[1]}
    if head == "s" and len(parts) >= 2:
        return {"view": "store", "slug": parts[1]}
    if head == "m" and len(parts) >= 3:
        return {"view": "product", "kind": parts[1], "slug": parts[2]}
    if len(parts) == 1:
        slug = _slugify(parts[0])
        if slug and slug not in RESERVED_SLUGS and get_user_for_slug(slug):
            return {"view": "store", "slug": slug}
    return None


def html_response(frontend: Path, hit: dict[str, Any]) -> HTMLResponse:
    if hit.get("view") == "product":
        page = frontend / "pages" / "marketplace.html"
        title = "Marketplace — Render Studio"
        desc = "Buy and sell 3D models, knowledge packs, and agent apps."
        image = f"{_base()}/render-logo-gear-og.png?oglogo=20260916-1"
        url = f"{_base()}/m/{hit.get('kind')}/{hit.get('slug')}"
        product = marketplace_catalog_service.get_product(str(hit.get("kind") or "model"), str(hit.get("slug") or ""), record=False)
        if product:
            title = f"{product.get('name')} — Render Marketplace"
            desc = str(product.get("tagline") or product.get("description") or desc)[:180]
            image = f"{_base()}/api/marketplace/og/listing/{product.get('kind')}/{product.get('slug')}.png"
        html = page.read_text(encoding="utf-8")
        return HTMLResponse(_inject_og(html, title=title, desc=desc, image=image, url=url))

    page = frontend / "pages" / "storefront.html"
    if not page.is_file():
        page = frontend / "pages" / "marketplace.html"
    user = None
    if hit.get("view") == "profile":
        user = profile_service.get_user_row(handle=str(hit.get("handle") or ""))
    else:
        user = get_user_for_slug(str(hit.get("slug") or ""))
    title = "Render Studio store"
    desc = "Creator store on Render Studio."
    image = f"{_base()}/render-logo-gear-og.png?oglogo=20260916-1"
    url = _base()
    if user:
        data = storefront_payload(user)
        title = f"{data['profile'].get('display_name') or 'Creator'} — {data['slug']}"
        desc = str((data["profile"].get("store") or {}).get("store_tagline") or data["profile"].get("bio") or desc)[:180]
        image = data["og_image"]
        url = data["store_url"] if hit.get("view") == "store" else data["profile_url"]
    html = page.read_text(encoding="utf-8")
    return HTMLResponse(_inject_og(html, title=title, desc=desc, image=image, url=url))


def _base() -> str:
    return str(getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")


def _inject_og(html: str, *, title: str, desc: str, image: str, url: str) -> str:
    tags = f"""
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Render Studio: All-in-one robotics collaborative workspace" />
  <meta property="og:title" content="{_esc(title)}" />
  <meta property="og:description" content="{_esc(desc)}" />
  <meta property="og:url" content="{_esc(url)}" />
  <meta property="og:image" content="{_esc(image)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{_esc(title)}" />
  <meta name="twitter:description" content="{_esc(desc)}" />
  <meta name="twitter:image" content="{_esc(image)}" />
"""
    if "<!--OG-->" in html:
        return html.replace("<!--OG-->", tags)
    if "</head>" in html:
        return html.replace("</head>", tags + "</head>", 1)
    return html


def _esc(value: str) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
