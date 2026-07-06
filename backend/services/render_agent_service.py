"""Persistent lightweight Render Agent chat threads."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.database import get_conn

MAX_THREADS = 40
MAX_MESSAGES_PER_THREAD = 80


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_user_id(user_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(user_id or "user"))[:120] or "user"


def _path(user_id: str) -> Path:
    root = Path(settings.data_dir) / "render_agent"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{_safe_user_id(user_id)}.json"


def _load(user_id: str) -> dict[str, Any]:
    path = _path(user_id)
    if not path.is_file():
        return {"threads": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"threads": []}
    if not isinstance(data.get("threads"), list):
        data["threads"] = []
    return data


def _all_user_files() -> list[Path]:
    root = Path(settings.data_dir) / "render_agent"
    if not root.is_dir():
        return []
    return sorted(root.glob("*.json"))


def _user_from_file(path: Path) -> str:
    return path.stem


def _save(user_id: str, data: dict[str, Any]) -> None:
    data["threads"] = list(data.get("threads") or [])[-MAX_THREADS:]
    _path(user_id).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _profile(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, display_name, avatar_url FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def _sender(user: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "id": user.get("id") if user else None,
        "display_name": user.get("display_name") if user else "Render Agent",
        "avatar_url": user.get("avatar_url") if user else None,
    }


def _ensure_owner_member(thread: dict[str, Any], owner_id: str) -> None:
    members = thread.setdefault("members", [])
    if not any(m.get("id") == owner_id for m in members):
        owner = _profile(owner_id) or {"id": owner_id, "display_name": "Owner", "avatar_url": None}
        members.insert(0, {
            "id": owner["id"],
            "display_name": owner.get("display_name") or owner["id"],
            "avatar_url": owner.get("avatar_url"),
            "role": "owner",
            "joined_at": thread.get("created_at") or _now(),
        })


def _can_access(thread: dict[str, Any], user_id: str, owner_id: str) -> bool:
    _ensure_owner_member(thread, owner_id)
    return user_id == owner_id or any(m.get("id") == user_id for m in thread.get("members") or [])


def _find_thread_for_user(user_id: str, thread_id: str) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
    owner_data = _load(user_id)
    for thread in owner_data.get("threads") or []:
        if thread.get("id") == thread_id and _can_access(thread, user_id, user_id):
            return user_id, owner_data, thread
    for path in _all_user_files():
        owner_id = _user_from_file(path)
        if owner_id == _safe_user_id(user_id):
            continue
        data = _load(owner_id)
        for thread in data.get("threads") or []:
            if thread.get("id") == thread_id and _can_access(thread, user_id, owner_id):
                return owner_id, data, thread
    return None


def _thread_summary(thread: dict[str, Any], owner_id: str) -> dict[str, Any]:
    _ensure_owner_member(thread, owner_id)
    return {
        "id": thread.get("id"),
        "title": thread.get("title") or "New thread",
        "folder": thread.get("folder") or "",
        "created_at": thread.get("created_at"),
        "updated_at": thread.get("updated_at"),
        "message_count": len(thread.get("messages") or []),
        "members": thread.get("members") or [],
        "owner_id": owner_id,
    }


def list_threads(user_id: str) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for path in _all_user_files() or [_path(user_id)]:
        owner_id = _user_from_file(path)
        data = _load(owner_id)
        changed = False
        for thread in data.get("threads") or []:
            before = json.dumps(thread.get("members") or [], sort_keys=True)
            if _can_access(thread, user_id, owner_id):
                summaries.append(_thread_summary(thread, owner_id))
            changed = changed or before != json.dumps(thread.get("members") or [], sort_keys=True)
        if changed:
            _save(owner_id, data)
    return sorted(summaries, key=lambda item: item.get("updated_at") or "", reverse=True)


def get_thread(user_id: str, thread_id: str) -> dict[str, Any] | None:
    found = _find_thread_for_user(user_id, thread_id)
    if not found:
        return None
    owner_id, data, thread = found
    _ensure_owner_member(thread, owner_id)
    _save(owner_id, data)
    return thread


def update_thread(
    user_id: str,
    thread_id: str,
    *,
    title: str | None = None,
    folder: str | None = None,
) -> dict[str, Any] | None:
    found = _find_thread_for_user(user_id, thread_id)
    if not found:
        return None
    owner_id, data, thread = found
    if title is not None:
        clean = title.strip()[:80]
        if clean:
            thread["title"] = clean
    if folder is not None:
        clean_folder = folder.strip()[:80]
        if clean_folder:
            thread["folder"] = clean_folder
        else:
            thread.pop("folder", None)
    thread["updated_at"] = _now()
    _save(owner_id, data)
    return thread


def create_thread(user_id: str, title: str | None = None) -> dict[str, Any]:
    data = _load(user_id)
    now = _now()
    thread = {
        "id": str(uuid.uuid4())[:10],
        "title": (title or "New Render Agent thread").strip()[:80] or "New Render Agent thread",
        "created_at": now,
        "updated_at": now,
        "members": [],
        "messages": [],
    }
    _ensure_owner_member(thread, user_id)
    data.setdefault("threads", []).append(thread)
    _save(user_id, data)
    return thread


def append_messages(user_id: str, thread_id: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    found = _find_thread_for_user(user_id, thread_id)
    if found is None:
        thread = create_thread(user_id)
        thread_id = thread["id"]
        data = _load(user_id)
        thread = next(item for item in data["threads"] if item.get("id") == thread_id)
        owner_id = user_id
    else:
        owner_id, data, thread = found

    now = _now()
    _ensure_owner_member(thread, owner_id)
    existing = thread.setdefault("messages", [])
    for message in messages:
        sender = message.get("sender")
        existing.append(
            {
                "id": str(uuid.uuid4())[:10],
                "role": message.get("role") or "assistant",
                "content": str(message.get("content") or ""),
                "attachments": list(message.get("attachments") or []),
                "sender": sender if isinstance(sender, dict) else None,
                "created_at": message.get("created_at") or now,
            }
        )
    thread["messages"] = existing[-MAX_MESSAGES_PER_THREAD:]
    thread["updated_at"] = now
    first_user = next((m.get("content") for m in thread["messages"] if m.get("role") == "user" and m.get("content")), "")
    if first_user and (not thread.get("title") or thread.get("title") == "New Render Agent thread"):
        thread["title"] = first_user.strip().replace("\n", " ")[:70] or "Render Agent thread"
    _save(owner_id, data)
    return thread


def add_thread_member(user_id: str, thread_id: str, target_user_id: str, *, team_id: str | None = None) -> dict[str, Any]:
    found = _find_thread_for_user(user_id, thread_id)
    if not found:
        raise PermissionError("Thread not found")
    owner_id, data, thread = found
    with get_conn() as conn:
        if team_id:
            requester = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
                (team_id, user_id),
            ).fetchone()
            target_member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
                (team_id, target_user_id),
            ).fetchone()
            if not requester or not target_member:
                raise PermissionError("Both users must be members of the selected workspace")
        else:
            shared = conn.execute(
                """
                SELECT 1
                  FROM team_members a
                  JOIN team_members b ON b.team_id = a.team_id
                 WHERE a.user_id=? AND b.user_id=?
                 LIMIT 1
                """,
                (user_id, target_user_id),
            ).fetchone()
            if not shared:
                raise PermissionError("Users must share a workspace")
    profile = _profile(target_user_id)
    if not profile:
        raise ValueError("User not found")
    _ensure_owner_member(thread, owner_id)
    members = thread.setdefault("members", [])
    if not any(m.get("id") == target_user_id for m in members):
        members.append({
            "id": profile["id"],
            "display_name": profile.get("display_name") or profile["email"],
            "avatar_url": profile.get("avatar_url"),
            "role": "member",
            "joined_at": _now(),
        })
        thread["updated_at"] = _now()
        _save(owner_id, data)
    return thread


def sender_for_user(user: dict[str, Any]) -> dict[str, Any]:
    return _sender(user)
