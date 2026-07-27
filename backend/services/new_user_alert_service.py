"""Admin-facing alerts for newly registered users."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

MAX_ITEMS = 1000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _root() -> Path:
    root = Path(settings.data_dir) / "admin_alerts"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _queue_path() -> Path:
    return _root() / "new_users.json"


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


def add_new_user(user: dict[str, Any], *, source: str = "email") -> dict[str, Any]:
    data = _load()
    user_id = str(user.get("id") or "")
    for item in data.get("items") or []:
        if user_id and item.get("user_id") == user_id:
            item["updated_at"] = _now()
            _save(data)
            return item
    item = {
        "id": str(uuid.uuid4())[:10],
        "kind": "new_user",
        "status": "new",
        "unread": True,
        "created_at": user.get("created_at") or _now(),
        "updated_at": _now(),
        "user_id": user_id,
        "user_name": user.get("display_name") or user.get("email") or "New user",
        "user_email": user.get("email") or "",
        "source": source,
    }
    data["items"].append(item)
    _save(data)
    try:
        from backend.services.sam_alert_email_service import notify_new_signup_async

        notify_new_signup_async(user, source=source)
    except Exception:
        pass
    return item


def list_alerts(*, status: str | None = None, limit: int = 120) -> list[dict[str, Any]]:
    items = list(_load().get("items") or [])
    status_norm = (status or "").strip().lower()
    if status_norm and status_norm != "all":
        items = [item for item in items if str(item.get("status") or "").lower() == status_norm]
    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return items[: max(1, min(int(limit or 120), 300))]


def summary() -> dict[str, Any]:
    items = list(_load().get("items") or [])
    unread = [item for item in items if item.get("unread")]
    open_items = [item for item in items if item.get("status") in {"new", "open"}]
    return {
        "total_count": len(items),
        "open_count": len(open_items),
        "unread_count": len(unread),
        "latest": max((item.get("created_at") or "" for item in items), default=None),
    }


def set_status(item_id: str, status: str, *, reviewer: dict[str, Any] | None = None, note: str | None = None) -> dict[str, Any] | None:
    status_norm = (status or "").strip().lower()
    if status_norm not in {"new", "checked", "contacted", "dismissed"}:
        raise ValueError("status must be new, checked, contacted, or dismissed")
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
