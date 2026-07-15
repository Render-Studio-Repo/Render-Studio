"""User-generated Getting Started guides + developer suggestions queue."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

MAX_PENDING = 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _root() -> Path:
    root = Path(settings.data_dir) / "getting_started_feedback"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _path(name: str) -> Path:
    return _root() / name


def _load(name: str) -> dict[str, Any]:
    path = _path(name)
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"items": []}
    if not isinstance(data.get("items"), list):
        data["items"] = []
    return data


def _save(name: str, data: dict[str, Any]) -> None:
    data["items"] = list(data.get("items") or [])[-MAX_PENDING:]
    _path(name).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _slug(text: str, fallback: str = "guide") -> str:
    clean = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return (clean[:48] or fallback)


def add_developer_suggestion(
    *,
    user: dict[str, Any],
    message: str,
    thread_id: str | None = None,
    share_url: str | None = None,
    sms_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = _load("developer_suggestions.json")
    item = {
        "id": str(uuid.uuid4())[:10],
        "created_at": _now(),
        "status": "open",
        "user_id": user.get("id"),
        "user_name": user.get("display_name") or user.get("email"),
        "user_email": user.get("email"),
        "message": (message or "").strip()[:4000],
        "thread_id": thread_id,
        "share_url": share_url,
        "sms": sms_result or {},
    }
    data["items"].append(item)
    _save("developer_suggestions.json", data)
    return item


def list_developer_suggestions(limit: int = 80) -> list[dict[str, Any]]:
    items = list(_load("developer_suggestions.json").get("items") or [])
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[: max(1, min(limit, 200))]


def add_pending_guide(
    *,
    user: dict[str, Any],
    question: str,
    guide: dict[str, Any],
    matched_existing: bool,
    thread_id: str | None = None,
    share_url: str | None = None,
) -> dict[str, Any] | None:
    """Queue a user-generated guide for Getting Started approval when not already covered."""
    if matched_existing:
        return None
    data = _load("pending_guides.json")
    title = str(guide.get("title") or question or "Untitled guide").strip()[:120]
    item = {
        "id": str(uuid.uuid4())[:10],
        "created_at": _now(),
        "status": "pending",
        "user_id": user.get("id"),
        "user_name": user.get("display_name") or user.get("email"),
        "user_email": user.get("email"),
        "question": (question or "").strip()[:2000],
        "thread_id": thread_id,
        "share_url": share_url,
        "guide": {
            "id": _slug(title, f"user-{str(uuid.uuid4())[:6]}"),
            "title": title,
            "summary": str(guide.get("summary") or "")[:500],
            "steps": list(guide.get("steps") or [])[:12],
            "gif": guide.get("gif") or "/docs/media/ai-generate.gif?v=20260715-real",
            "ask": str(guide.get("ask") or question or "")[:500],
            "keywords": list(guide.get("keywords") or [])[:24],
            "demo": guide.get("demo") or "generate",
            "show_me": guide.get("show_me") or {},
        },
    }
    data["items"].append(item)
    _save("pending_guides.json", data)
    return item


def list_pending_guides(*, status: str | None = "pending", limit: int = 80) -> list[dict[str, Any]]:
    items = list(_load("pending_guides.json").get("items") or [])
    if status:
        items = [i for i in items if i.get("status") == status]
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items[: max(1, min(limit, 200))]


def set_pending_guide_status(item_id: str, status: str, *, note: str | None = None) -> dict[str, Any] | None:
    data = _load("pending_guides.json")
    for item in data.get("items") or []:
        if item.get("id") == item_id:
            item["status"] = status
            item["reviewed_at"] = _now()
            if note:
                item["review_note"] = note[:500]
            _save("pending_guides.json", data)
            return item
    return None
