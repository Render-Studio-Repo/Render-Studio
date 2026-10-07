"""Owner-curated public showcases. Only published catalog metadata enters the page."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlsplit

from backend.database import get_conn
from backend.services import marketplace_catalog_service, profile_service

KINDS = {"model", "knowledge", "agent"}
MAX_PINS = 48


class RevisionConflict(ValueError):
    pass


def _schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS marketplace_profile_showcases (
        user_id TEXT PRIMARY KEY, document_json TEXT NOT NULL, revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL)""")


def defaults(owner: dict) -> dict:
    return {"title": str(owner.get("display_name") or "Creator"),
            "description": str(owner.get("bio") or ""), "social_links": [],
            "categories": [], "pins": [], "gallery_mode": "grid", "accent": "teal"}


def _text(raw, limit: int, label: str) -> str:
    if not isinstance(raw, str):
        raise ValueError(f"{label} must be text.")
    if len(raw) > limit:
        raise ValueError(f"{label} must be {limit} characters or fewer.")
    return raw.strip()


def _image_url(raw: Any) -> str:
    """Raster previews only; never turn a private project file into public media."""
    url = str(raw or "")
    if re.match(r"^data:image/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$", url) and len(url) <= 4_000_000:
        return url
    if len(url) > 2000 or any(c in url for c in "\r\n\\"):
        return ""
    parsed = urlsplit(url)
    if parsed.scheme == "https" and parsed.netloc and not parsed.username:
        # Public listing media can use a CDN, but not a Studio project endpoint.
        return "" if parsed.path.startswith(("/api/projects/", "/files/")) else url
    if url.startswith(("/assets/", "/images/", "/api/marketplace/", "/api/model-marketplace/", "/api/agent-marketplace/")):
        return url
    return ""


def _public_listing(item: dict) -> dict:
    media = []
    thumb = item.get("thumbnail_url") or (item.get("thumbnail") or {}).get("data_url")
    for entry in [thumb, *(item.get("gallery") or [])[:12]]:
        url = _image_url(entry.get("url") or entry.get("data_url") or entry.get("image_url")) if isinstance(entry, dict) else _image_url(entry)
        if url and url not in media:
            media.append(url)
    kind = str(item.get("kind") or "model")
    key = str(item.get("slug") or item["id"])
    return {"id": str(item["id"]), "kind": kind, "name": str(item.get("name") or "Untitled"),
            "tagline": str(item.get("tagline") or ""), "description": str(item.get("description") or "")[:4000],
            "price_cents": int(item.get("price_cents") or 0), "currency": str(item.get("currency") or "USD"),
            "category": str(item.get("category") or ""), "media": media,
            "thumbnail_url": media[0] if media else (f"/api/marketplace/product/model/{quote(str(item['id']), safe='')}/thumbnail" if kind == "model" else ""),
            "href": f"/m/{quote(kind, safe='')}/{quote(key, safe='')}"}


def public_listings(owner: dict) -> list[dict]:
    items = marketplace_catalog_service.list_catalog(seller=str(owner["id"]), include_hub=False)
    return [_public_listing(item) for item in items
            if str(item.get("created_by") or (item.get("owner") or {}).get("id")) == str(owner["id"])
            and item.get("status") == "approved" and item.get("kind") in KINDS]


def normalize(raw: dict, listings: list[dict]) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("Profile layout must be an object.")
    title = _text(raw.get("title", ""), 120, "Title")
    if not title:
        raise ValueError("Add a profile title.")
    description = _text(raw.get("description", ""), 2400, "Description")
    categories = raw.get("categories", [])
    if not isinstance(categories, list) or len(categories) > 12:
        raise ValueError("Use up to 12 collection categories.")
    categories = list(dict.fromkeys(_text(c, 48, "Category") for c in categories if c))
    links = raw.get("social_links", [])
    if not isinstance(links, list) or len(links) > 8:
        raise ValueError("Use up to 8 social links.")
    social_links = []
    for link in links:
        if not isinstance(link, dict):
            raise ValueError("Invalid social link.")
        label = _text(link.get("label", ""), 40, "Social label")
        url = _text(link.get("url", ""), 500, "Social URL")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or any(c in url for c in "\r\n\\"):
            raise ValueError("Social links must be valid https:// URLs.")
        social_links.append({"label": label or parsed.hostname, "url": url})
    raw_pins = raw.get("pins", [])
    if not isinstance(raw_pins, list) or len(raw_pins) > MAX_PINS:
        raise ValueError(f"Use up to {MAX_PINS} pinned items.")
    available = {(i["kind"], i["id"]): i for i in listings}
    pins, seen = [], set()
    for pin in raw_pins:
        if not isinstance(pin, dict):
            raise ValueError("Invalid pinned item.")
        kind = _text(pin.get("kind", "model"), 20, "Item type")
        listing_id = _text(pin.get("listing_id", ""), 100, "Listing ID")
        key = (kind, listing_id)
        if key not in available:
            raise ValueError("Only your published marketplace products can be pinned. Remove unavailable items before saving.")
        if key in seen:
            continue
        seen.add(key)
        category = _text(pin.get("category", ""), 48, "Category")
        if category and category not in categories:
            raise ValueError("Choose a category from your profile collections.")
        display = pin.get("display", "product")
        if display not in {"product", "image", "code"}:
            raise ValueError("Choose product, image, or code display.")
        image_index = pin.get("image_index", 0)
        if not isinstance(image_index, int) or isinstance(image_index, bool) or not 0 <= image_index <= 12:
            raise ValueError("Invalid gallery image.")
        if image_index and image_index >= len(available[key]["media"]):
            raise ValueError("That product image is no longer available.")
        pins.append({"kind": kind, "listing_id": listing_id, "category": category, "display": display,
                     "image_index": image_index, "caption": _text(pin.get("caption", ""), 200, "Caption"),
                     "code": _text(pin.get("code", ""), 6000, "Code example"),
                     "language": _text(pin.get("language", ""), 24, "Code language")})
    gallery_mode = raw.get("gallery_mode", "grid")
    if gallery_mode not in {"grid", "slideshow"}:
        raise ValueError("Choose grid or slideshow gallery.")
    accent = raw.get("accent", "teal")
    if accent not in {"teal", "violet", "amber", "slate"}:
        raise ValueError("Choose a supported accent color.")
    return {"title": title, "description": description, "social_links": social_links,
            "categories": categories, "pins": pins, "gallery_mode": gallery_mode, "accent": accent}


def load(owner: dict) -> tuple[dict, int]:
    with get_conn() as conn:
        _schema(conn)
        row = conn.execute("SELECT document_json, revision FROM marketplace_profile_showcases WHERE user_id=?", (owner["id"],)).fetchone()
    if row:
        return json.loads(row["document_json"]), int(row["revision"])
    return defaults(owner), 0


def payload(owner: dict, *, viewer: dict | None = None) -> dict:
    document, revision = load(owner)
    listings = public_listings(owner)
    available = {(i["kind"], i["id"]): i for i in listings}
    # Publication can be revoked after pinning. Filter every read, including owner reads.
    document = {**document, "pins": [p for p in document["pins"] if (p["kind"], p["listing_id"]) in available]}
    return {"showcase": document, "revision": revision, "listings": listings,
            "is_self": bool(viewer and str(viewer["id"]) == str(owner["id"])),
            "profile_url": f"/u/{quote(str(owner.get('handle') or ''), safe='')}"}


def save(owner: dict, raw: dict, revision: int) -> dict:
    cleaned = normalize(raw, public_listings(owner))
    with get_conn() as conn:
        _schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT revision FROM marketplace_profile_showcases WHERE user_id=?", (owner["id"],)).fetchone()
        current = int(row["revision"]) if row else 0
        if current != revision:
            raise RevisionConflict("This profile changed in another tab. Reload before saving your layout.")
        conn.execute("""INSERT INTO marketplace_profile_showcases (user_id, document_json, revision, updated_at)
            VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET document_json=excluded.document_json,
            revision=excluded.revision, updated_at=excluded.updated_at""",
            (owner["id"], json.dumps(cleaned), current + 1, datetime.now(timezone.utc).isoformat()))
        conn.commit()
    return payload(owner, viewer=owner)


def pin(owner: dict, kind: str, listing_id: str, category: str = "") -> dict:
    data = payload(owner, viewer=owner)
    document = data["showcase"]
    if category and category not in document["categories"]:
        document["categories"].append(category)
    existing = next((p for p in document["pins"] if p["kind"] == kind and p["listing_id"] == listing_id), None)
    if existing:
        if category:
            existing["category"] = category
    else:
        document["pins"].append({"kind": kind, "listing_id": listing_id, "category": category})
    result = save(owner, document, data["revision"])
    result["profile_url"] += "?edit=1"
    return result
