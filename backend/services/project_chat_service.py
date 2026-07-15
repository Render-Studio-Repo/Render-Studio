"""Project collaboration chat: threads, replies, mentions, reactions, images."""

from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.database import get_conn

CHAT_FILE = "chat.json"
MAX_THREADS = 40
MAX_MESSAGES = 500
MAX_IMAGES_PER_MESSAGE = 6
MAX_IMAGE_BYTES = 8_000_000
ALLOWED_REACTIONS = ("👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀")
RENDER_AGENT_ID = "render-agent"
RENDER_AGENT_NAME = "Render Agent"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path(project_path: Path) -> Path:
    return project_path / CHAT_FILE


def _media_dir(project_path: Path) -> Path:
    path = project_path / "chat_media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load(project_path: Path) -> dict[str, Any]:
    path = _path(project_path)
    if not path.is_file():
        return {"threads": [], "read_cursors": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"threads": [], "read_cursors": {}}
    if not isinstance(data.get("threads"), list):
        data["threads"] = []
    if not isinstance(data.get("read_cursors"), dict):
        data["read_cursors"] = {}
    return data


def _save(project_path: Path, data: dict[str, Any]) -> None:
    data["threads"] = list(data.get("threads") or [])[-MAX_THREADS:]
    for thread in data["threads"]:
        msgs = list(thread.get("messages") or [])
        thread["messages"] = msgs[-MAX_MESSAGES:]
    _path(project_path).write_text(json.dumps(data, indent=2), encoding="utf-8")


def _profile(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, display_name, avatar_url FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def _sender(user: dict[str, Any] | None, *, as_agent: bool = False) -> dict[str, Any]:
    if as_agent:
        return {
            "id": RENDER_AGENT_ID,
            "display_name": RENDER_AGENT_NAME,
            "avatar_url": "/render3d-logo.png?v=20260715-new-logo",
            "is_agent": True,
        }
    return {
        "id": user.get("id") if user else None,
        "display_name": (user or {}).get("display_name") or "User",
        "avatar_url": (user or {}).get("avatar_url"),
        "is_agent": False,
    }


def _ensure_general_thread(data: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
    threads = data.setdefault("threads", [])
    for thread in threads:
        if thread.get("slug") == "general" or str(thread.get("title") or "").lower() == "general":
            thread.setdefault("visibility", "shared")
            thread.setdefault("members", [])
            return thread
    thread = {
        "id": str(uuid.uuid4())[:10],
        "slug": "general",
        "title": "General",
        "created_at": _now(),
        "created_by": (user or {}).get("id"),
        "visibility": "shared",
        "members": [],
        "messages": [],
    }
    threads.insert(0, thread)
    return thread


def _find_thread(data: dict[str, Any], thread_id: str) -> dict[str, Any] | None:
    for thread in data.get("threads") or []:
        if thread.get("id") == thread_id:
            return thread
    return None


def _find_message(thread: dict[str, Any], message_id: str) -> dict[str, Any] | None:
    for msg in thread.get("messages") or []:
        if msg.get("id") == message_id:
            return msg
    return None


def _thread_member_ids(thread: dict[str, Any]) -> set[str]:
    ids = {str(m.get("id")) for m in (thread.get("members") or []) if m.get("id")}
    if thread.get("created_by"):
        ids.add(str(thread["created_by"]))
    return ids


def user_can_access_thread(
    thread: dict[str, Any],
    user: dict[str, Any] | None,
    *,
    workspace_role: str | None = None,
) -> bool:
    """Shared threads are open to the project; private threads are invite-only (+ managers)."""
    if not user:
        return False
    visibility = str(thread.get("visibility") or "shared").lower()
    if visibility != "private":
        return True
    uid = str(user.get("id") or "")
    if uid and uid in _thread_member_ids(thread):
        return True
    role = str(workspace_role or "").lower()
    if role in {"owner", "manager", "admin"}:
        return True
    return False


def _thread_summary(thread: dict[str, Any]) -> dict[str, Any]:
    messages = thread.get("messages") or []
    last = messages[-1] if messages else None
    return {
        "id": thread.get("id"),
        "slug": thread.get("slug"),
        "title": thread.get("title") or "Thread",
        "created_at": thread.get("created_at"),
        "created_by": thread.get("created_by"),
        "visibility": thread.get("visibility") or "shared",
        "members": list(thread.get("members") or []),
        "member_count": len(_thread_member_ids(thread)),
        "message_count": len(messages),
        "last_message": (
            {
                "id": last.get("id"),
                "body": (last.get("body") or "")[:160],
                "created_at": last.get("created_at"),
                "user_name": last.get("user_name"),
            }
            if last
            else None
        ),
    }


def list_threads(
    project_path: Path,
    user: dict[str, Any] | None = None,
    *,
    workspace_role: str | None = None,
) -> list[dict[str, Any]]:
    data = _load(project_path)
    _ensure_general_thread(data, user)
    _save(project_path, data)
    out = []
    for thread in data["threads"]:
        # Existing threads without a visibility flag stay shared so current chats don't disappear.
        if "visibility" not in thread:
            thread["visibility"] = "shared" if thread.get("slug") == "general" else "shared"
        thread.setdefault("members", [])
        if not user_can_access_thread(thread, user, workspace_role=workspace_role):
            continue
        out.append(_thread_summary(thread))
    return out


def get_thread(
    project_path: Path,
    thread_id: str,
    *,
    user: dict[str, Any] | None = None,
    workspace_role: str | None = None,
) -> dict[str, Any] | None:
    data = _load(project_path)
    _ensure_general_thread(data, user)
    thread = _find_thread(data, thread_id)
    if not thread and thread_id in {"general", "default"}:
        thread = _ensure_general_thread(data, user)
    if not thread:
        return None
    thread.setdefault("visibility", "shared" if thread.get("slug") == "general" else "private")
    thread.setdefault("members", [])
    if not user_can_access_thread(thread, user, workspace_role=workspace_role):
        return None
    _save(project_path, data)
    return {
        "id": thread.get("id"),
        "slug": thread.get("slug"),
        "title": thread.get("title"),
        "created_at": thread.get("created_at"),
        "created_by": thread.get("created_by"),
        "visibility": thread.get("visibility") or "shared",
        "members": list(thread.get("members") or []),
        "messages": list(thread.get("messages") or []),
    }


def create_thread(
    project_path: Path,
    *,
    title: str,
    user: dict[str, Any],
    visibility: str | None = None,
    workspace_role: str | None = None,
) -> dict[str, Any]:
    data = _load(project_path)
    _ensure_general_thread(data, user)
    clean = (title or "New thread").strip()[:80] or "New thread"
    role = str(workspace_role or "").lower()
    # Managers/admins can create shared workspace threads; users get private invite threads.
    wanted = str(visibility or "").strip().lower()
    if wanted not in {"shared", "private"}:
        wanted = "shared" if role in {"owner", "manager", "admin"} else "private"
    profile = _profile(user.get("id")) or {}
    creator_member = {
        "id": user.get("id"),
        "display_name": user.get("display_name") or profile.get("display_name") or "User",
        "avatar_url": user.get("avatar_url") or profile.get("avatar_url"),
        "role": "owner",
        "joined_at": _now(),
    }
    thread = {
        "id": str(uuid.uuid4())[:10],
        "slug": re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")[:40] or "thread",
        "title": clean,
        "created_at": _now(),
        "created_by": user.get("id"),
        "visibility": wanted,
        "members": [creator_member],
        "messages": [],
    }
    data["threads"].append(thread)
    _save(project_path, data)
    return _thread_summary(thread)


def add_thread_member(
    project_path: Path,
    *,
    thread_id: str,
    target_user_id: str,
    requester: dict[str, Any],
    workspace_role: str | None = None,
) -> dict[str, Any]:
    data = _load(project_path)
    thread = _find_thread(data, thread_id)
    if not thread:
        raise KeyError("Thread not found")
    if not user_can_access_thread(thread, requester, workspace_role=workspace_role):
        raise PermissionError("Thread not found")
    uid = str(requester.get("id") or "")
    role = str(workspace_role or "").lower()
    can_invite = (
        uid and uid == str(thread.get("created_by") or "")
    ) or role in {"owner", "manager", "admin"}
    if not can_invite:
        raise PermissionError("Only the thread creator or workspace managers can invite")
    if thread.get("slug") == "general" or (thread.get("visibility") or "shared") == "shared":
        # Shared threads already include everyone — still record explicit invite for UI.
        pass
    profile = _profile(target_user_id)
    if not profile:
        raise ValueError("User not found")
    members = thread.setdefault("members", [])
    if not any(str(m.get("id")) == str(target_user_id) for m in members):
        members.append(
            {
                "id": profile["id"],
                "display_name": profile.get("display_name") or profile.get("email") or "User",
                "avatar_url": profile.get("avatar_url"),
                "role": "member",
                "joined_at": _now(),
            }
        )
        # Inviting someone to a shared thread is fine; private threads stay private.
        if (thread.get("visibility") or "shared") != "private" and thread.get("slug") != "general":
            thread["visibility"] = thread.get("visibility") or "shared"
    _save(project_path, data)
    return _thread_summary(thread)


MENTION_RE = re.compile(
    r"@\[(?P<label>[^\]]+)\]\((?P<kind>user|agent):(?P<id>[^)]+)\)|@(?P<bare>[A-Za-z][\w.-]{1,40})",
    re.UNICODE,
)


def parse_mentions(body: str, candidates: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Extract @mentions from rich or bare tokens."""
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    text = body or ""
    for match in MENTION_RE.finditer(text):
        if match.group("kind"):
            kind = match.group("kind")
            mid = match.group("id")
            label = match.group("label")
            key = f"{kind}:{mid}"
            if key in seen:
                continue
            seen.add(key)
            found.append({"type": kind, "id": mid, "name": label})
            continue
        bare = (match.group("bare") or "").strip()
        if not bare:
            continue
        lower = bare.lower().replace("_", " ").replace("-", " ")
        if lower in {"renderagent", "render agent", "agent"}:
            key = f"agent:{RENDER_AGENT_ID}"
            if key not in seen:
                seen.add(key)
                found.append({"type": "agent", "id": RENDER_AGENT_ID, "name": RENDER_AGENT_NAME})
            continue
        for cand in candidates or []:
            name = str(cand.get("display_name") or "")
            email = str(cand.get("email") or "")
            handle = re.sub(r"[^a-z0-9]+", "", name.lower())
            if bare.lower() == handle or bare.lower() == email.split("@")[0].lower() or bare.lower() == name.lower().replace(" ", ""):
                key = f"user:{cand.get('id')}"
                if key in seen:
                    break
                seen.add(key)
                found.append({"type": "user", "id": cand.get("id"), "name": name or email})
                break
    return found


def mention_candidates(project_members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = [
        {
            "id": RENDER_AGENT_ID,
            "display_name": RENDER_AGENT_NAME,
            "avatar_url": "/render3d-logo.png?v=20260715-new-logo",
            "type": "agent",
            "handle": "RenderAgent",
        }
    ]
    for member in project_members:
        out.append(
            {
                "id": member.get("id") or member.get("user_id"),
                "display_name": member.get("display_name") or member.get("email") or "User",
                "avatar_url": member.get("avatar_url"),
                "email": member.get("email"),
                "type": "user",
                "handle": re.sub(r"[^A-Za-z0-9]", "", str(member.get("display_name") or "user"))[:24] or "user",
            }
        )
    return out


def _safe_image_ext(filename: str, content_type: str | None = None) -> str:
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
    return ".jpg"


def save_chat_image(project_path: Path, upload: Any, *, message_id: str, index: int) -> dict[str, Any] | None:
    filename = getattr(upload, "filename", "") or f"image-{index}.png"
    content_type = getattr(upload, "content_type", "") or ""
    if content_type and not content_type.lower().startswith("image/"):
        return None
    raw = upload.file.read(MAX_IMAGE_BYTES + 1)
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        return None
    ext = _safe_image_ext(filename, content_type)
    safe_msg = re.sub(r"[^a-zA-Z0-9_-]+", "-", message_id)[:40] or "msg"
    name = f"{safe_msg}-{index}{ext}"
    path = _media_dir(project_path) / name
    path.write_bytes(raw)
    return {
        "filename": Path(filename).name[:180],
        "content_type": content_type or "image/png",
        "size": path.stat().st_size,
        "stored_name": name,
        "url": f"chat_media/{name}",
    }


def post_message(
    project_path: Path,
    *,
    thread_id: str,
    body: str,
    user: dict[str, Any],
    parent_id: str | None = None,
    images: list[dict[str, Any]] | None = None,
    mention_candidates_list: list[dict[str, Any]] | None = None,
    as_agent: bool = False,
    message_id: str | None = None,
    workspace_role: str | None = None,
) -> dict[str, Any]:
    text = (body or "").strip()
    if not text and not images:
        raise ValueError("Message body required")
    if len(text) > 8000:
        raise ValueError("Message too long")
    data = _load(project_path)
    _ensure_general_thread(data, user)
    thread = _find_thread(data, thread_id)
    if not thread:
        raise KeyError("Thread not found")
    if not as_agent and not user_can_access_thread(thread, user, workspace_role=workspace_role):
        raise PermissionError("Thread not found")
    parent = None
    if parent_id:
        parent = _find_message(thread, parent_id)
        if not parent:
            raise KeyError("Parent message not found")
    sender = _sender(user, as_agent=as_agent)
    mentions = parse_mentions(text, mention_candidates_list)
    msg = {
        "id": message_id or str(uuid.uuid4())[:10],
        "thread_id": thread["id"],
        "parent_id": parent_id,
        "body": text,
        "user_id": sender.get("id"),
        "user_name": sender.get("display_name"),
        "user_avatar_url": sender.get("avatar_url"),
        "is_agent": bool(sender.get("is_agent")),
        "created_at": _now(),
        "edited_at": None,
        "images": (images or [])[:MAX_IMAGES_PER_MESSAGE],
        "mentions": mentions,
        "reactions": {},
        "reply_count": 0,
    }
    thread.setdefault("messages", []).append(msg)
    if parent is not None:
        parent["reply_count"] = int(parent.get("reply_count") or 0) + 1
    # Mark poster as caught up.
    if user.get("id"):
        data.setdefault("read_cursors", {})[user["id"]] = {
            "at": msg["created_at"],
            "message_id": msg["id"],
            "thread_id": thread["id"],
        }
    _save(project_path, data)
    return msg


def toggle_reaction(
    project_path: Path,
    *,
    thread_id: str,
    message_id: str,
    emoji: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    if emoji not in ALLOWED_REACTIONS:
        raise ValueError("Unsupported reaction")
    data = _load(project_path)
    thread = _find_thread(data, thread_id)
    if not thread:
        raise KeyError("Thread not found")
    msg = _find_message(thread, message_id)
    if not msg:
        raise KeyError("Message not found")
    reactions = msg.setdefault("reactions", {})
    users = list(reactions.get(emoji) or [])
    uid = user.get("id")
    if uid in users:
        users = [u for u in users if u != uid]
    else:
        users.append(uid)
    if users:
        reactions[emoji] = users
    else:
        reactions.pop(emoji, None)
    _save(project_path, data)
    return msg


def mark_read(project_path: Path, *, user_id: str, thread_id: str | None = None, message_id: str | None = None) -> dict[str, Any]:
    data = _load(project_path)
    cursor = {"at": _now(), "thread_id": thread_id, "message_id": message_id}
    data.setdefault("read_cursors", {})[user_id] = cursor
    _save(project_path, data)
    return cursor


def unread_summary(project_path: Path, user_id: str) -> dict[str, Any]:
    data = _load(project_path)
    cursor = (data.get("read_cursors") or {}).get(user_id) or {}
    cursor_at = str(cursor.get("at") or "")
    total = 0
    mention_count = 0
    latest_mention = None
    for thread in data.get("threads") or []:
        for msg in thread.get("messages") or []:
            created = str(msg.get("created_at") or "")
            if cursor_at and created <= cursor_at:
                continue
            if msg.get("user_id") == user_id:
                continue
            total += 1
            mentions = msg.get("mentions") or []
            if any(m.get("type") == "user" and m.get("id") == user_id for m in mentions):
                mention_count += 1
                latest_mention = {
                    "message_id": msg.get("id"),
                    "thread_id": thread.get("id"),
                    "body": (msg.get("body") or "")[:120],
                    "user_name": msg.get("user_name"),
                    "created_at": msg.get("created_at"),
                }
    return {
        "unread_count": total,
        "mention_count": mention_count,
        "latest_mention": latest_mention,
        "read_cursor": cursor or None,
    }


def resolve_media_path(project_path: Path, stored_name: str) -> Path | None:
    safe = Path(stored_name or "").name
    if not safe or ".." in safe:
        return None
    path = _media_dir(project_path) / safe
    return path if path.is_file() else None
