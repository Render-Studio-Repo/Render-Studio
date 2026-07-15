"""User feedback / bug report queue for management review."""

from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

MAX_ITEMS = 500
MAX_SCREENSHOTS = 5


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _root() -> Path:
    root = Path(settings.data_dir) / "feedback_requests"
    root.mkdir(parents=True, exist_ok=True)
    (root / "screenshots").mkdir(parents=True, exist_ok=True)
    return root


def _queue_path() -> Path:
    return _root() / "requests.json"


def _load() -> dict[str, Any]:
    path = _queue_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"items": []}
    if not isinstance(data.get("items"), list):
        data["items"] = []
    return data


def _save(data: dict[str, Any]) -> None:
    data["items"] = list(data.get("items") or [])[-MAX_ITEMS:]
    _queue_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def _safe_ext(filename: str, content_type: str | None = None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        return suffix
    ctype = (content_type or "").lower()
    if "png" in ctype:
        return ".png"
    if "webp" in ctype:
        return ".webp"
    if "gif" in ctype:
        return ".gif"
    return ".jpg" if "jpeg" in ctype or "jpg" in ctype else ".png"


def save_screenshot(upload: Any, *, request_id: str, index: int) -> dict[str, Any] | None:
    filename = getattr(upload, "filename", "") or f"screenshot-{index}.png"
    content_type = getattr(upload, "content_type", "") or ""
    if content_type and not content_type.lower().startswith("image/"):
        return None
    ext = _safe_ext(filename, content_type)
    safe_request = re.sub(r"[^a-zA-Z0-9_-]+", "-", request_id)[:40] or "request"
    name = f"{safe_request}-{index}{ext}"
    path = _root() / "screenshots" / name
    with path.open("wb") as out:
        shutil.copyfileobj(upload.file, out)
    return {
        "filename": filename[:180],
        "content_type": content_type or "image/png",
        "size": path.stat().st_size,
        "url": f"/api/feedback/screenshots/{name}",
        "stored_name": name,
    }


def add_request(
    *,
    kind: str,
    message: str,
    user: dict[str, Any],
    project_id: str | None = None,
    project_name: str | None = None,
    prompt_id: str | None = None,
    prompt_label: str | None = None,
    trace_id: str | None = None,
    page_url: str | None = None,
    context: dict[str, Any] | None = None,
    screenshots: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    data = _load()
    item = {
        "id": str(uuid.uuid4())[:10],
        "kind": "bug" if str(kind).lower() == "bug" else "suggestion",
        "status": "open",
        "unread": True,
        "created_at": _now(),
        "updated_at": _now(),
        "user_id": user.get("id"),
        "user_name": user.get("display_name") or user.get("email"),
        "user_email": user.get("email"),
        "message": (message or "").strip()[:6000],
        "project_id": (project_id or "").strip()[:80] or None,
        "project_name": (project_name or "").strip()[:160] or None,
        "prompt_id": (prompt_id or "").strip()[:80] or None,
        "prompt_label": (prompt_label or "").strip()[:500] or None,
        "trace_id": (trace_id or "").strip()[:80] or None,
        "page_url": (page_url or "").strip()[:1000] or None,
        "context": context or {},
        "screenshots": list(screenshots or [])[:MAX_SCREENSHOTS],
    }
    data["items"].append(item)
    _save(data)
    return item


def list_requests(*, status: str | None = None, kind: str | None = None, limit: int = 120) -> list[dict[str, Any]]:
    items = list(_load().get("items") or [])
    status_norm = (status or "").strip().lower()
    kind_norm = (kind or "").strip().lower()
    if status_norm and status_norm != "all":
        items = [item for item in items if str(item.get("status") or "").lower() == status_norm]
    if kind_norm and kind_norm != "all":
        items = [item for item in items if str(item.get("kind") or "").lower() == kind_norm]
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[: max(1, min(int(limit or 120), 300))]


def summary() -> dict[str, Any]:
    items = list(_load().get("items") or [])
    open_items = [item for item in items if item.get("status") == "open"]
    unread = [item for item in items if item.get("unread")]
    return {
        "total_count": len(items),
        "open_count": len(open_items),
        "unread_count": len(unread),
        "bug_count": sum(1 for item in open_items if item.get("kind") == "bug"),
        "suggestion_count": sum(1 for item in open_items if item.get("kind") == "suggestion"),
        "latest": max((item.get("created_at") or "" for item in items), default=None),
    }


def set_status(item_id: str, status: str, *, reviewer: dict[str, Any] | None = None, note: str | None = None) -> dict[str, Any] | None:
    status_norm = (status or "").strip().lower()
    if status_norm not in {"open", "checked", "approved", "denied"}:
        raise ValueError("status must be open, checked, approved, or denied")
    data = _load()
    for item in data.get("items") or []:
        if item.get("id") != item_id:
            continue
        item["status"] = status_norm
        item["unread"] = False
        item["updated_at"] = _now()
        item["reviewed_at"] = _now()
        if reviewer:
            item["reviewed_by_id"] = reviewer.get("id")
            item["reviewed_by_name"] = reviewer.get("display_name") or reviewer.get("email")
        if note:
            item["review_note"] = note[:1000]
        _save(data)
        return item
    return None


def mark_read(item_id: str | None = None) -> int:
    data = _load()
    count = 0
    for item in data.get("items") or []:
        if item_id and item.get("id") != item_id:
            continue
        if item.get("unread"):
            item["unread"] = False
            item["updated_at"] = _now()
            count += 1
    if count:
        _save(data)
    return count


def screenshot_path(stored_name: str) -> Path | None:
    safe = Path(stored_name).name
    path = _root() / "screenshots" / safe
    return path if path.is_file() else None
