"""Per-user saved viewport split layouts (general Studio setting, not per-project)."""

from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.services import share_mode, share_preview

logger = logging.getLogger("render3d.viewport_layouts")

LAYOUT_SHARE_PROJECT = "__viewport_layout__"
LAYOUT_KIND = "viewport_layout"
_MAX_LAYOUTS = 48
_MAX_LINKS = 40
_NAME_MAX = 80
_DESC_MAX = 2000
_LABEL_MAX = 80
_ID_MAX = 48
_DIRECTIONS = frozenset({"up", "left", "down", "right"})

_TOKEN_RE = re.compile(r"[^A-Za-z0-9_\-]")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _data_root() -> Path:
    return Path(getattr(settings, "data_dir", None) or getattr(settings, "data_root", "data"))


def _user_path(user_id: str) -> Path:
    root = _data_root() / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    return root / "viewport_layouts.json"


def shares_dir() -> Path:
    root = _data_root() / "viewport_layout_shares"
    root.mkdir(parents=True, exist_ok=True)
    return root


def share_path(token: str) -> Path:
    clean = _TOKEN_RE.sub("", str(token or ""))[:80]
    return shares_dir() / f"{clean}.json"


def is_layout_share(share: dict[str, Any] | None) -> bool:
    return isinstance(share, dict) and str(share.get("kind") or "") == LAYOUT_KIND


def _read_user(user_id: str) -> dict[str, Any]:
    path = _user_path(user_id)
    if not path.is_file():
        return {"v": 1, "layouts": [], "extraLinks": [], "lastId": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
        return data if isinstance(data, dict) else {"v": 1, "layouts": [], "extraLinks": [], "lastId": ""}
    except Exception as exc:
        logger.debug("viewport layouts read failed: %s", exc)
        return {"v": 1, "layouts": [], "extraLinks": [], "lastId": ""}


def _write_user(user_id: str, store: dict[str, Any]) -> dict[str, Any]:
    path = _user_path(user_id)
    path.write_text(json.dumps(store, indent=2), encoding="utf-8")
    return store


def _clamp_ratio(raw: Any) -> float:
    try:
        n = float(raw)
    except (TypeError, ValueError):
        n = 0.5
    if n != n:
        n = 0.5
    return max(0.22, min(0.78, n))


def _sanitize_leaf(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {"type": "leaf", "pane": "viewport", "kind": "viewport", "id": "__viewport__", "label": "Viewport"}
    kind = str(raw.get("kind") or raw.get("pane") or "file")[:32] or "file"
    pane = str(raw.get("pane") or ("viewport" if kind in {"viewport", "3d"} else "doc"))[:24]
    label = (str(raw.get("label") or raw.get("name") or kind).strip() or "Pane")[:_LABEL_MAX]
    node_id = str(raw.get("id") or "")[:_ID_MAX]
    if pane == "viewport" and not node_id:
        node_id = "__viewport__"
        kind = "viewport"
        label = label or "Viewport"
    return {
        "type": "leaf",
        "pane": "viewport" if pane == "viewport" or kind == "viewport" else "doc",
        "kind": kind if kind != "3d" else "viewport",
        "id": node_id,
        "label": label,
        "missing": bool(raw.get("missing")),
    }


def sanitize_tree(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return _sanitize_leaf({})
    if str(raw.get("type") or "") == "split" or raw.get("direction"):
        direction = str(raw.get("direction") or "").lower()
        if direction not in _DIRECTIONS:
            return _sanitize_leaf(raw.get("a") or raw.get("viewport") or raw)
        left = raw.get("a") if isinstance(raw.get("a"), dict) else raw.get("first")
        right = raw.get("b") if isinstance(raw.get("b"), dict) else raw.get("second")
        if not isinstance(left, dict):
            left = raw.get("doc") if direction in {"left", "up"} else raw.get("viewport")
        if not isinstance(right, dict):
            right = raw.get("viewport") if direction in {"left", "up"} else raw.get("doc")
        return {
            "type": "split",
            "direction": direction,
            "ratio": _clamp_ratio(raw.get("ratio")),
            "a": sanitize_tree(left),
            "b": sanitize_tree(right),
        }
    return _sanitize_leaf(raw)


def _sanitize_layout(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    layout_id = str(raw.get("id") or "").strip()[:_ID_MAX]
    if not layout_id:
        layout_id = secrets.token_hex(8)
    name = (str(raw.get("name") or "").strip() or "Untitled layout")[:_NAME_MAX]
    description = str(raw.get("description") or "")[:_DESC_MAX]
    tabs_in = raw.get("tabs") if isinstance(raw.get("tabs"), list) else []
    tabs = []
    for row in tabs_in[:24]:
        if not isinstance(row, dict):
            continue
        tab_id = str(row.get("id") or "")[:_ID_MAX]
        if not tab_id:
            continue
        tabs.append(
            {
                "id": tab_id,
                "kind": str(row.get("kind") or "file")[:32],
                "label": str(row.get("label") or row.get("customLabel") or tab_id)[:_LABEL_MAX],
            }
        )
    share_token = _TOKEN_RE.sub("", str(raw.get("shareToken") or raw.get("share_token") or ""))[:80]
    listing_id = str(raw.get("listingId") or raw.get("listing_id") or "")[:40]
    return {
        "id": layout_id,
        "name": name,
        "description": description,
        "tree": sanitize_tree(raw.get("tree") or raw.get("split") or raw),
        "tabs": tabs,
        "shareToken": share_token,
        "listingId": listing_id,
        "createdAt": str(raw.get("createdAt") or raw.get("created_at") or "")[:40] or _now(),
        "updatedAt": str(raw.get("updatedAt") or raw.get("updated_at") or "")[:40] or _now(),
    }


def _sanitize_link(raw: Any) -> str:
    value = str(raw or "").strip()[:500]
    if not value:
        return ""
    if value.startswith("/") or value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("{") and "tree" in value:
        return value[:8000]
    if re.fullmatch(r"[A-Za-z0-9_\-]{8,80}", value):
        return f"/share/{value}"
    return ""


def load_layouts(user_id: str) -> dict[str, Any]:
    data = _read_user(user_id)
    layouts = []
    for row in data.get("layouts") or []:
        clean = _sanitize_layout(row)
        if clean:
            layouts.append(clean)
    layouts = layouts[:_MAX_LAYOUTS]
    links = []
    for row in data.get("extraLinks") or data.get("extra_links") or []:
        link = _sanitize_link(row if not isinstance(row, dict) else (row.get("url") or row.get("href")))
        if link and link not in links:
            links.append(link)
    links = links[:_MAX_LINKS]
    last_id = str(data.get("lastId") or "")
    if last_id and not any(item["id"] == last_id for item in layouts):
        last_id = layouts[0]["id"] if layouts else ""
    return {"v": 1, "layouts": layouts, "extraLinks": links, "lastId": last_id}


def save_layouts(user_id: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    incoming = payload if isinstance(payload, dict) else {}
    layouts = []
    for row in incoming.get("layouts") or []:
        clean = _sanitize_layout(row)
        if clean:
            layouts.append(clean)
    layouts = layouts[:_MAX_LAYOUTS]
    links = []
    for row in incoming.get("extraLinks") or incoming.get("extra_links") or []:
        link = _sanitize_link(row if not isinstance(row, dict) else (row.get("url") or row.get("href")))
        if link and link not in links:
            links.append(link)
    links = links[:_MAX_LINKS]
    last_id = str(incoming.get("lastId") or "")
    if last_id and not any(item["id"] == last_id for item in layouts):
        last_id = layouts[0]["id"] if layouts else ""
    return _write_user(user_id, {"v": 1, "layouts": layouts, "extraLinks": links, "lastId": last_id})


def upsert_layout(user_id: str, layout: dict[str, Any]) -> dict[str, Any]:
    store = load_layouts(user_id)
    clean = _sanitize_layout(layout)
    if not clean:
        raise ValueError("Layout is required")
    found = False
    next_layouts = []
    for row in store["layouts"]:
        if row["id"] == clean["id"]:
            clean["createdAt"] = row.get("createdAt") or clean["createdAt"]
            clean["updatedAt"] = _now()
            next_layouts.append(clean)
            found = True
        else:
            next_layouts.append(row)
    if not found:
        next_layouts.insert(0, clean)
    store["layouts"] = next_layouts[:_MAX_LAYOUTS]
    store["lastId"] = clean["id"]
    return save_layouts(user_id, store)


# Official Import templates (no analytics). Tokens match frontend POPULAR_LAYOUT_TEMPLATES.
SHIPPED_LAYOUT_SHARES: dict[str, dict[str, Any]] = {
    "vpl-wiring-right": {
        "name": "Viewport + Wiring",
        "description": "3D on the left, schematic on the right.",
        "tree": {
            "type": "split",
            "direction": "right",
            "ratio": 0.5,
            "a": {"kind": "viewport", "label": "Viewport"},
            "b": {"id": "__wiring__", "kind": "wiring", "label": "Wiring"},
        },
    },
    "vpl-mcmaster-right": {
        "name": "Viewport + McMaster",
        "description": "Parts catalog docked beside 3D — not a popup.",
        "tree": {
            "type": "split",
            "direction": "right",
            "ratio": 0.5,
            "a": {"kind": "viewport", "label": "Viewport"},
            "b": {"id": "mcmaster", "kind": "mcmaster", "label": "McMaster"},
        },
    },
    "vpl-parts-down": {
        "name": "Viewport + Parts List",
        "description": "BOM under the 3D view.",
        "tree": {
            "type": "split",
            "direction": "down",
            "ratio": 0.55,
            "a": {"kind": "viewport", "label": "Viewport"},
            "b": {"id": "__parts_list__", "kind": "parts", "label": "Parts List"},
        },
    },
    "vpl-canvas-right": {
        "name": "Viewport + Canvas",
        "description": "Sketch beside the 3D view.",
        "tree": {
            "type": "split",
            "direction": "right",
            "ratio": 0.5,
            "a": {"kind": "viewport", "label": "Viewport"},
            "b": {"id": "__canvas__", "kind": "canvas", "label": "Canvas"},
        },
    },
    "vpl-quad-left-down": {
        "name": "Quad · Left + Down",
        "description": "2×2: Canvas, Viewport, Wiring, Parts List. One WebGL viewport.",
        "tree": {
            "type": "split",
            "direction": "left",
            "ratio": 0.5,
            "a": {
                "type": "split",
                "direction": "down",
                "ratio": 0.5,
                "a": {"id": "__canvas__", "kind": "canvas", "label": "Canvas"},
                "b": {"id": "__wiring__", "kind": "wiring", "label": "Wiring"},
            },
            "b": {
                "type": "split",
                "direction": "down",
                "ratio": 0.5,
                "a": {"kind": "viewport", "label": "Viewport"},
                "b": {"id": "__parts_list__", "kind": "parts", "label": "Parts List"},
            },
        },
    },
}


def shipped_share(token: str) -> dict[str, Any] | None:
    clean = _TOKEN_RE.sub("", str(token or ""))[:80]
    raw = SHIPPED_LAYOUT_SHARES.get(clean)
    if not raw:
        return None
    layout = _sanitize_layout({"id": clean, **raw})
    if not layout:
        return None
    return {
        "kind": LAYOUT_KIND,
        "token": clean,
        "created_by": "render-studio",
        "created_at": "2026-09-16T00:00:00+00:00",
        "updated_at": "2026-09-16T00:00:00+00:00",
        "layout": layout,
        "comments": [],
        "markup_revisions": [],
        "share_mode": "remix",
        "allow_download": True,
        "allow_remix": True,
        "allow_edit": False,
        "shipped": True,
    }


def load_share(token: str) -> dict[str, Any] | None:
    path = share_path(token)
    if not path.is_file():
        return shipped_share(token)
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
    except Exception:
        return None
    if not isinstance(data, dict) or str(data.get("kind") or "") != LAYOUT_KIND:
        return None
    return data


def save_share(token: str, share: dict[str, Any]) -> dict[str, Any]:
    path = share_path(token)
    path.write_text(json.dumps(share, indent=2), encoding="utf-8")
    return share


def create_share(user_id: str, layout: dict[str, Any], *, origin: str = "") -> dict[str, Any]:
    clean = _sanitize_layout(layout)
    if not clean:
        raise ValueError("Layout is required")
    token = secrets.token_urlsafe(18).replace("-", "")[:24]
    share = {
        "kind": LAYOUT_KIND,
        "token": token,
        "created_by": str(user_id or ""),
        "created_at": _now(),
        "updated_at": _now(),
        "layout": clean,
        "comments": [],
        "markup_revisions": [],
        "share_mode": "remix",
        "allow_download": True,
        "allow_remix": True,
        "allow_edit": False,
    }
    save_share(token, share)
    stored = load_layouts(user_id)
    for row in stored["layouts"]:
        if row["id"] == clean["id"]:
            row["shareToken"] = token
            row["updatedAt"] = _now()
    save_layouts(user_id, stored)
    base = str(origin or "").rstrip("/")
    share_url = f"{base}/share/{token}" if base else f"/share/{token}"
    return {"token": token, "share_url": share_url, "layout": clean, "kind": LAYOUT_KIND}


def client_metadata(token: str, share: dict[str, Any], origin: str = "") -> dict[str, Any]:
    layout = _sanitize_layout((share or {}).get("layout") or share) or _sanitize_layout({})
    flags = share_mode.share_client_flags(share if isinstance(share, dict) else {})
    base = str(origin or "").rstrip("/")
    share_url = f"{base}/share/{token}" if base else f"/share/{token}"
    name = layout.get("name") or "Viewport layout"
    description = str(layout.get("description") or "").strip() or f"{name} — viewport split layout on Render Studio"
    return {
        "token": token,
        "project_id": LAYOUT_SHARE_PROJECT,
        "project_name": name,
        "filename": "viewport-layout.json",
        "viewer_filename": "",
        "viewer_url": "",
        "kind": LAYOUT_KIND,
        "layout": layout,
        "share_title": name,
        "share_description": description,
        "preview_image_url": share_preview.brand_og_url(base),
        "preview_width": share_preview.BRAND_OG_WIDTH,
        "preview_height": share_preview.BRAND_OG_HEIGHT,
        "preview_type": share_preview.BRAND_OG_TYPE,
        "comments": share_mode.list_share_comments(share),
        "markup_revisions": share_mode.list_markup_revisions(share),
        "share_url": share_url,
        "exports": [],
        "visible_filenames": [],
        "hidden_filenames": [],
        **flags,
        "allow_join": False,
        "can_manage": False,
    }


def layout_from_listing_files(files: Any) -> dict[str, Any] | None:
    rows = files if isinstance(files, list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("product_type") or row.get("kind") or "") == LAYOUT_KIND:
            payload = row.get("layout") or row.get("config") or row
            clean = _sanitize_layout(payload if isinstance(payload, dict) else None)
            if clean:
                return clean
        nested = row.get("layout")
        if isinstance(nested, dict) and (nested.get("tree") or nested.get("name")):
            clean = _sanitize_layout(nested)
            if clean:
                return clean
    return None
