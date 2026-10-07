"""Public Docs / Updates copy stored like site_settings (data/site_pages.json)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ALLOWED_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_BYTES = 8 * 1024 * 1024

DEFAULT_BANNERS = [
    {
        "id": "roadmap",
        "src": "/docs/media/render-studio-roadmap-robotics.jpg?v=20260915-updban1",
        "alt": (
            "Render Studio — from 3D rendering to collaborative robotics. "
            "Available: Model Rendering, Realistic Scenes. Up next: Textures. "
            "Planned robotics: Shared VR, Live Wiring, VR Overlay, Teach Robots."
        ),
        "title": "From 3D rendering to collaborative robotics",
    },
]

DEFAULT_FOUNDER = {
    "kicker": "Hello World",
    "title": "A first note from Render Studio",
    "body": (
        "This will probably be one of the few posts here that is hand written. "
        "I created this page for people who want to follow Render Studio more closely "
        "and see what we are building as the project evolves.\n\n"
        "Render Studio is a browser-based 3D workspace for generating, editing, sharing, "
        "and collaborating on CAD models. The goal is to make mechanical design feel more "
        "direct: describe a part, revise it, inspect the component tree, simulate robot motion "
        "when URDF/SRDF data is available, and open shared models back into editable projects.\n\n"
        "We are building toward opening Render Studio as an open-source project in August or "
        "September. Until then, this updates page will collect the bigger product changes, "
        "experiments, and workflow improvements so people can track where the platform is headed."
    ),
}

DEFAULT_UPDATES_HERO = {
    "kicker": "Docs",
    "title": "Recent Updates",
    "lead": "Milestone features and tools that change how you work in Render Studio — not polish-only UI tweaks.",
}

DEFAULT_GS_HERO = {
    "kicker": "Getting Started",
    "title": "Render Studio",
    "lead": "Watch a short demo, follow the steps, then ask Render Agent — a movable help panel opens on the right.",
    "banner": "",
}

DEFAULT_DOCS_HERO = {
    "kicker": "Documentation",
    "title": "Render Studio CAD Visualizer",
    "lead": (
        "Complete product documentation for Studio — AI CAD, modeling, sketch, rigging/URDF, "
        "wiring, cloud sync, collaboration, and more — with how-tos and demo GIFs."
    ),
    "banner": "",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pages_path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "site_pages.json"


def media_dir() -> Path:
    path = Path(settings.data_dir) / "site_pages" / "media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\-]+", "-", str(value or "").strip().lower()).strip("-")
    return (cleaned or "item")[:80]


def _text_block(value: Any, limit: int = 12000) -> str:
    return str(value or "").replace("\r\n", "\n").strip()[:limit]


def _banner(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    src = _clip(raw.get("src") or raw.get("url") or "", 600)
    if not src:
        return None
    bid = _slug(str(raw.get("id") or Path(src.split("?")[0]).stem or "banner"))
    return {
        "id": bid,
        "src": src,
        "alt": _clip(raw.get("alt") or "", 240),
        "title": _clip(raw.get("title") or "", 160),
    }


def _banner_list(raw: Any, *, fallback_default: bool) -> list[dict[str, str]]:
    """Empty src/rows are deletions. Only missing banners fall back to defaults."""
    if fallback_default and not isinstance(raw, list):
        return [dict(item) for item in DEFAULT_BANNERS]
    items = raw if isinstance(raw, list) else []
    return [item for item in (_banner(row) for row in items) if item]


def _hero(raw: Any, defaults: dict[str, str]) -> dict[str, str]:
    data = dict(defaults)
    if isinstance(raw, dict):
        if "kicker" in raw:
            data["kicker"] = _clip(raw.get("kicker"), 80)
        if "title" in raw:
            data["title"] = _clip(raw.get("title"), 160) or defaults["title"]
        if "lead" in raw:
            data["lead"] = _text_block(raw.get("lead"), 800) or defaults["lead"]
        if "banner" in raw:
            data["banner"] = _clip(raw.get("banner"), 600)
    return data


def _founder(raw: Any) -> dict[str, str]:
    data = dict(DEFAULT_FOUNDER)
    if isinstance(raw, dict):
        if "kicker" in raw:
            data["kicker"] = _clip(raw.get("kicker"), 80)
        if "title" in raw:
            data["title"] = _clip(raw.get("title"), 200) or DEFAULT_FOUNDER["title"]
        if "body" in raw:
            data["body"] = _text_block(raw.get("body"), 12000) or DEFAULT_FOUNDER["body"]
    return data


def _post(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    pid = _slug(str(raw.get("id") or ""))
    title = _clip(raw.get("title"), 200)
    if not pid or not title:
        return None
    kind = str(raw.get("kind") or "feature").strip().lower()
    if kind not in {"feature", "tool"}:
        kind = "feature"
    published = raw.get("published")
    if published is None:
        published = True
    keywords = raw.get("keywords") if isinstance(raw.get("keywords"), list) else []
    return {
        "id": pid,
        "date": _clip(raw.get("date"), 32) or _now()[:10],
        "kind": kind,
        "title": title,
        "summary": _text_block(raw.get("summary"), 2000),
        "href": _clip(raw.get("href"), 400),
        "visual": _clip(raw.get("visual") or raw.get("banner") or "", 600),
        "published": bool(published),
        "keywords": [_clip(k, 40) for k in keywords[:24] if str(k).strip()],
    }


def _template_map(raw: Any) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    if not isinstance(raw, dict):
        return out
    for key, item in raw.items():
        if not isinstance(item, dict):
            continue
        sid = _slug(str(key))
        patch: dict[str, str] = {}
        if item.get("title"):
            patch["title"] = _clip(item.get("title"), 200)
        if item.get("summary"):
            patch["summary"] = _text_block(item.get("summary"), 800)
        if item.get("gif") or item.get("image") or item.get("banner"):
            patch["gif"] = _clip(item.get("gif") or item.get("image") or item.get("banner"), 600)
        if patch:
            out[sid] = patch
    return out


def _normalize(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    updates = data.get("updates") if isinstance(data.get("updates"), dict) else {}
    docs = data.get("docs") if isinstance(data.get("docs"), dict) else {}
    banners = _banner_list(
        updates.get("banners"),
        fallback_default="banners" not in updates,
    )
    posts = [_post(item) for item in (updates.get("posts") or [])]
    return {
        "updated_at": _clip(data.get("updated_at"), 64) or _now(),
        "updates": {
            "hero": _hero(updates.get("hero"), DEFAULT_UPDATES_HERO),
            "founder": _founder(updates.get("founder")),
            "banners": banners,
            "posts": [item for item in posts if item],
        },
        "docs": {
            "hero": _hero(docs.get("hero"), DEFAULT_DOCS_HERO),
            "getting_started": _hero(docs.get("getting_started"), DEFAULT_GS_HERO),
            "guides": _template_map(docs.get("guides")),
            "features": _template_map(docs.get("features")),
        },
    }


def load() -> dict[str, Any]:
    path = _pages_path()
    stored: dict[str, Any] = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                stored = loaded
        except Exception:
            stored = {}
    return _normalize(stored)


def save(patch: dict[str, Any] | None) -> dict[str, Any]:
    current = load()
    incoming = patch if isinstance(patch, dict) else {}
    if "updates" in incoming and isinstance(incoming.get("updates"), dict):
        u = incoming["updates"]
        if "hero" in u:
            current["updates"]["hero"] = _hero(u.get("hero"), current["updates"]["hero"])
        if "founder" in u:
            current["updates"]["founder"] = _founder({**current["updates"]["founder"], **(u.get("founder") or {})})
        if "banners" in u:
            current["updates"]["banners"] = _banner_list(u.get("banners"), fallback_default=False)
        if "posts" in u:
            posts = [_post(item) for item in (u.get("posts") or [])]
            current["updates"]["posts"] = [item for item in posts if item]
    if "docs" in incoming and isinstance(incoming.get("docs"), dict):
        d = incoming["docs"]
        if "hero" in d:
            current["docs"]["hero"] = _hero(d.get("hero"), current["docs"]["hero"])
        if "getting_started" in d:
            current["docs"]["getting_started"] = _hero(d.get("getting_started"), current["docs"]["getting_started"])
        if "guides" in d:
            current["docs"]["guides"] = _template_map({**current["docs"]["guides"], **(d.get("guides") or {})})
        if "features" in d:
            current["docs"]["features"] = _template_map({**current["docs"]["features"], **(d.get("features") or {})})
    current["updated_at"] = _now()
    _pages_path().write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current


def public_payload() -> dict[str, Any]:
    return load()


def save_media(filename: str, content: bytes, content_type: str = "") -> dict[str, str]:
    if not content:
        raise ValueError("empty image")
    if len(content) > MAX_BYTES:
        raise ValueError("image must be under 8 MB")
    mime = (content_type or "").split(";")[0].strip().lower()
    ext = ALLOWED_MIME.get(mime)
    if not ext:
        ext = Path(filename or "").suffix.lower()
        if ext == ".jpeg":
            ext = ".jpg"
        if ext not in ALLOWED_EXT:
            raise ValueError("use PNG, JPEG, WebP, or GIF")
    name = f"{uuid.uuid4().hex}{ext}"
    dest = media_dir() / name
    dest.write_bytes(content)
    return {
        "filename": name,
        "src": f"/api/site/pages/media/{name}",
        "url": f"/api/site/pages/media/{name}",
    }


def media_file(filename: str) -> Path | None:
    name = Path(str(filename or "")).name
    if not re.match(r"^[a-f0-9]{32}\.(png|jpg|jpeg|webp|gif)$", name, re.I):
        return None
    path = (media_dir() / name).resolve()
    try:
        path.relative_to(media_dir().resolve())
    except ValueError:
        return None
    return path if path.is_file() else None
