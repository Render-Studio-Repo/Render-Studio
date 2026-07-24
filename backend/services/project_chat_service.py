"""Project collaboration chat: threads, replies, mentions, reactions, images.

Render Studio (slug ``general``) is stored per workspace so the public group
chat survives project switches. Other threads stay project-scoped.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.database import get_conn

CHAT_FILE = "chat.json"
MAX_THREADS = 40
MAX_MESSAGES = 500
MAX_IMAGES_PER_MESSAGE = 6
MAX_IMAGE_BYTES = 8_000_000
ALLOWED_REACTIONS = ("👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀")
RENDER_AGENT_ID = "render-agent"
RENDER_AGENT_NAME = "Render Agent"
GLOBAL_PUBLIC_CHAT_IDS = {"render3d-public", "public", "global-public"}
_LOCKS_GUARD = threading.Lock()
_PROJECT_LOCKS: dict[str, threading.RLock] = {}
logger = logging.getLogger(__name__)


class ChatStorageError(RuntimeError):
    """Raised when chat history exists but cannot be safely loaded."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path(project_path: Path) -> Path:
    return project_path / CHAT_FILE


def _empty_chat() -> dict[str, Any]:
    return {"threads": [], "read_cursors": {}}


def _backup_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.bak")


def _corrupt_path(path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return path.with_name(f"{path.name}.corrupt-{stamp}")


def _read_chat_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Chat data must be a JSON object")
    if not isinstance(data.get("threads"), list):
        raise ValueError("Chat data has invalid threads")
    if not isinstance(data.get("read_cursors"), dict):
        data["read_cursors"] = {}
    return data


def _lock_for(project_path: Path) -> threading.RLock:
    key = str(project_path.resolve())
    with _LOCKS_GUARD:
        lock = _PROJECT_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _PROJECT_LOCKS[key] = lock
        return lock


def _media_dir(project_path: Path) -> Path:
    path = project_path / "chat_media"
    path.mkdir(parents=True, exist_ok=True)
    return path


def workspace_chat_root(workspace_id: str | None) -> Path | None:
    """Directory that stores the workspace-wide Render Studio channel."""
    if not workspace_id:
        return None
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(workspace_id).strip())[:80].strip("-")
    if not safe:
        return None
    return (Path(settings.data_dir) / "workspace_chats" / safe).resolve()


def _is_general_thread(thread: dict[str, Any] | None) -> bool:
    if not thread:
        return False
    slug = str(thread.get("slug") or "").lower()
    title = str(thread.get("title") or "").lower()
    return slug in {"general", "render-studio"} or title in {"general", "render studio"}


def _load(project_path: Path) -> dict[str, Any]:
    path = _path(project_path)
    if not path.is_file():
        return _empty_chat()
    try:
        return _read_chat_json(path)
    except Exception as exc:
        backup = _backup_path(path)
        if backup.is_file():
            try:
                logger.warning("Recovering project chat from backup path=%s backup=%s", path, backup)
                data = _read_chat_json(backup)
                data["_recovered_from_backup"] = True
                return data
            except Exception:
                logger.exception("Project chat backup is also unreadable path=%s backup=%s", path, backup)
        try:
            corrupt = _corrupt_path(path)
            shutil.copy2(path, corrupt)
            logger.error("Preserved unreadable project chat at %s", corrupt)
        except Exception:
            logger.exception("Could not preserve unreadable project chat path=%s", path)
        raise ChatStorageError("Project chat history is unreadable; refusing to overwrite it.") from exc


def _prune_threads(threads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep Render Studio pinned; prune only non-general threads to MAX_THREADS."""
    pinned = [t for t in threads if _is_general_thread(t)][:1]
    rest = [t for t in threads if not _is_general_thread(t)]
    budget = max(0, MAX_THREADS - len(pinned))
    return pinned + rest[-budget:]


def _save(project_path: Path, data: dict[str, Any]) -> None:
    recovered_from_backup = bool(data.pop("_recovered_from_backup", False))
    data["threads"] = _prune_threads(list(data.get("threads") or []))
    for thread in data["threads"]:
        msgs = list(thread.get("messages") or [])
        thread["messages"] = msgs[-MAX_MESSAGES:]
    path = _path(project_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not recovered_from_backup and path.is_file() and path.stat().st_size > 0:
        try:
            shutil.copy2(path, _backup_path(path))
        except Exception:
            logger.warning("Could not back up chat history before save path=%s", path, exc_info=True)
    tmp = path.with_suffix(f"{path.suffix}.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def _profile(user_id: str | None) -> dict[str, Any] | None:
    if not user_id:
        return None
    with get_conn() as conn:
        try:
            row = conn.execute(
                "SELECT id, email, display_name, avatar_url, handle FROM users WHERE id=?",
                (user_id,),
            ).fetchone()
        except Exception:
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
        "handle": (user or {}).get("handle"),
        "avatar_url": (user or {}).get("avatar_url"),
        "is_agent": False,
    }


def _ensure_general_thread(data: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
    threads = data.setdefault("threads", [])
    for thread in threads:
        if not _is_general_thread(thread):
            continue
        thread["slug"] = "general"
        thread["title"] = "Render Studio"
        thread.setdefault("visibility", "shared")
        thread.setdefault("kind", "group")
        thread.setdefault("members", [])
        if user and user.get("id"):
            members = thread.setdefault("members", [])
            if not any(str(m.get("id")) == str(user["id"]) for m in members):
                members.append(
                    {
                        "id": user["id"],
                        "display_name": user.get("display_name"),
                        "handle": user.get("handle"),
                        "avatar_url": user.get("avatar_url"),
                    }
                )
        return thread
    thread = {
        "id": str(uuid.uuid4())[:10],
        "slug": "general",
        "title": "Render Studio",
        "created_at": _now(),
        "created_by": (user or {}).get("id"),
        "visibility": "shared",
        "kind": "group",
        "members": (
            [
                {
                    "id": user["id"],
                    "display_name": user.get("display_name"),
                    "handle": user.get("handle"),
                    "avatar_url": user.get("avatar_url"),
                }
            ]
            if user and user.get("id")
            else []
        ),
        "messages": [],
    }
    threads.insert(0, thread)
    return thread


def _merge_messages_into_thread(dest: dict[str, Any], source_messages: list[dict[str, Any]]) -> int:
    existing = {str(m.get("id")) for m in (dest.get("messages") or []) if m.get("id")}
    added = 0
    msgs = list(dest.get("messages") or [])
    for msg in source_messages or []:
        mid = str(msg.get("id") or "")
        if not mid or mid in existing:
            continue
        msgs.append(msg)
        existing.add(mid)
        added += 1
    msgs.sort(key=lambda m: str(m.get("created_at") or ""))
    dest["messages"] = msgs[-MAX_MESSAGES:]
    return added


def _absorb_project_general(project_path: Path, workspace_thread: dict[str, Any], migrated: list[str]) -> None:
    """Copy a project's Render Studio history into the workspace channel, then drop the local copy."""
    key = str(Path(project_path).resolve())
    if key in migrated:
        return
    with _lock_for(project_path):
        pdata = _load(project_path)
        src = next((t for t in (pdata.get("threads") or []) if _is_general_thread(t)), None)
        if src:
            _merge_messages_into_thread(workspace_thread, list(src.get("messages") or []))
            members = workspace_thread.setdefault("members", [])
            for m in src.get("members") or []:
                if m.get("id") and not any(str(x.get("id")) == str(m.get("id")) for x in members):
                    members.append(m)
            pdata["threads"] = [t for t in (pdata.get("threads") or []) if not _is_general_thread(t)]
            _save(project_path, pdata)
        migrated.append(key)


def _team_project_paths(workspace_id: str) -> list[Path]:
    root = Path(settings.projects_dir)
    if str(workspace_id or "").strip().lower() in GLOBAL_PUBLIC_CHAT_IDS:
        try:
            return [p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")]
        except OSError:
            return []
    try:
        from backend.services import teams_service

        ids = teams_service.team_project_ids(workspace_id) or []
    except Exception:
        ids = []
    return [root / str(pid) for pid in ids if (root / str(pid)).is_dir()]


def ensure_workspace_general(
    workspace_id: str,
    user: dict[str, Any] | None = None,
    *,
    seed_project_path: Path | None = None,
) -> tuple[Path, dict[str, Any]]:
    """Load/create the workspace Render Studio channel and migrate project history into it."""
    root = workspace_chat_root(workspace_id)
    if root is None:
        raise ValueError("workspace_id required")
    with _lock_for(root):
        data = _load(root)
        thread = _ensure_general_thread(data, user)
        thread["slug"] = "general"
        thread["title"] = "Render Studio"
        thread["visibility"] = "shared"
        thread["kind"] = "group"
        thread["scope"] = "workspace"
        migrated = list(data.get("migrated_projects") or [])
        if seed_project_path is not None:
            _absorb_project_general(Path(seed_project_path), thread, migrated)
        if not data.get("full_team_migrated"):
            for project_path in _team_project_paths(workspace_id):
                try:
                    _absorb_project_general(project_path, thread, migrated)
                except Exception:
                    logger.exception("Could not migrate Render Studio history from %s", project_path)
            data["full_team_migrated"] = True
        data["migrated_projects"] = migrated
        data["threads"] = [t for t in (data.get("threads") or []) if _is_general_thread(t)][:1] or [thread]
        _save(root, data)
        return root, data["threads"][0]


def chat_storage_for_thread(
    project_path: Path,
    thread_id: str,
    *,
    workspace_id: str | None = None,
    user: dict[str, Any] | None = None,
) -> tuple[Path, dict[str, Any]]:
    """Return ``(storage_root, thread)`` for a thread id, preferring workspace Render Studio."""
    ws_root = workspace_chat_root(workspace_id) if workspace_id else None
    if ws_root is not None:
        _root, general = ensure_workspace_general(workspace_id, user, seed_project_path=project_path)
        if thread_id in {"general", "default", general.get("id")}:
            return _root, general
    with _lock_for(project_path):
        data = _load(project_path)
        if not workspace_id:
            _ensure_general_thread(data, user)
            _save(project_path, data)
        thread = _find_thread(data, thread_id)
        if thread and _is_general_thread(thread) and ws_root is not None:
            return ensure_workspace_general(workspace_id, user, seed_project_path=project_path)
        if not thread and thread_id in {"general", "default"}:
            if ws_root is not None:
                return ensure_workspace_general(workspace_id, user, seed_project_path=project_path)
            thread = _ensure_general_thread(data, user)
            _save(project_path, data)
            return project_path, thread
        if not thread:
            raise KeyError("Thread not found")
        return project_path, thread


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
        "kind": thread.get("kind")
        or (
            "group"
            if _is_general_thread(thread) or len(_thread_member_ids(thread)) > 1
            else "thread"
        ),
        "scope": thread.get("scope") or ("workspace" if _is_general_thread(thread) else "project"),
        "assist_session": thread.get("assist_session") or None,
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
    workspace_id: str | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if workspace_id:
        _root, general = ensure_workspace_general(workspace_id, user, seed_project_path=project_path)
        if user_can_access_thread(general, user, workspace_role=workspace_role):
            out.append(_thread_summary(general))
        with _lock_for(project_path):
            data = _load(project_path)
            changed = False
            kept = []
            for thread in data.get("threads") or []:
                if _is_general_thread(thread):
                    changed = True
                    continue
                kept.append(thread)
            if changed:
                data["threads"] = kept
                _save(project_path, data)
            for thread in kept:
                if "visibility" not in thread:
                    thread["visibility"] = "shared"
                thread.setdefault("members", [])
                if not user_can_access_thread(thread, user, workspace_role=workspace_role):
                    continue
                out.append(_thread_summary(thread))
        return out

    with _lock_for(project_path):
        data = _load(project_path)
        _ensure_general_thread(data, user)
        _save(project_path, data)
        for thread in data["threads"]:
            if "visibility" not in thread:
                thread["visibility"] = "shared"
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
    workspace_id: str | None = None,
) -> dict[str, Any] | None:
    try:
        _root, thread = chat_storage_for_thread(
            project_path,
            thread_id,
            workspace_id=workspace_id,
            user=user,
        )
    except KeyError:
        return None
    thread.setdefault("visibility", "shared")
    thread.setdefault("members", [])
    if _is_general_thread(thread):
        thread["kind"] = "group"
        if workspace_id:
            thread["scope"] = "workspace"
    if not user_can_access_thread(thread, user, workspace_role=workspace_role):
        return None
    return {
        "id": thread.get("id"),
        "slug": thread.get("slug"),
        "title": thread.get("title"),
        "created_at": thread.get("created_at"),
        "created_by": thread.get("created_by"),
        "visibility": thread.get("visibility") or "shared",
        "kind": thread.get("kind")
        or ("group" if _is_general_thread(thread) or len(_thread_member_ids(thread)) > 1 else "thread"),
        "scope": thread.get("scope") or ("workspace" if _is_general_thread(thread) and workspace_id else "project"),
        "assist_session": thread.get("assist_session") or None,
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
    kind: str | None = None,
    invite_user_ids: list[str] | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    if workspace_id:
        ensure_workspace_general(workspace_id, user, seed_project_path=project_path)
    with _lock_for(project_path):
        data = _load(project_path)
        if workspace_id:
            data["threads"] = [t for t in (data.get("threads") or []) if not _is_general_thread(t)]
        else:
            _ensure_general_thread(data, user)
        clean = (title or "New thread").strip()[:80] or "New thread"
        # Normal project questions should be visible to everyone with project access.
        # Group/invite threads remain private unless the caller explicitly shares them.
        wanted = str(visibility or "").strip().lower()
        if wanted not in {"shared", "private"}:
            wanted = "private" if (kind == "group" or invite_user_ids) else "shared"
        profile = _profile(user.get("id")) or {}
        creator_member = {
            "id": user.get("id"),
            "display_name": user.get("display_name") or profile.get("display_name") or "User",
            "avatar_url": user.get("avatar_url") or profile.get("avatar_url"),
            "role": "owner",
            "joined_at": _now(),
        }
        members = [creator_member]
        for target_user_id in invite_user_ids or []:
            if not target_user_id or str(target_user_id) == str(user.get("id") or ""):
                continue
            profile = _profile(str(target_user_id))
            if not profile or any(str(m.get("id")) == str(profile["id"]) for m in members):
                continue
            members.append(
                {
                    "id": profile["id"],
                    "display_name": profile.get("display_name") or profile.get("email") or "User",
                    "avatar_url": profile.get("avatar_url"),
                    "role": "member",
                    "joined_at": _now(),
                }
            )
        thread = {
            "id": str(uuid.uuid4())[:10],
            "slug": re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")[:40] or "thread",
            "title": clean,
            "created_at": _now(),
            "created_by": user.get("id"),
            "visibility": wanted,
            "kind": "group" if (kind == "group" or len(members) > 1) else "thread",
            "members": members,
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
    with _lock_for(project_path):
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


def update_thread_settings(
    project_path: Path,
    *,
    thread_id: str,
    requester: dict[str, Any],
    workspace_role: str | None = None,
    title: str | None = None,
    visibility: str | None = None,
) -> dict[str, Any]:
    with _lock_for(project_path):
        data = _load(project_path)
        thread = _find_thread(data, thread_id)
        if not thread:
            raise KeyError("Thread not found")
        if not user_can_access_thread(thread, requester, workspace_role=workspace_role):
            raise PermissionError("Thread not found")
        uid = str(requester.get("id") or "")
        role = str(workspace_role or "").lower()
        can_manage = (
            uid and uid == str(thread.get("created_by") or "")
        ) or role in {"owner", "manager", "admin"}
        if not can_manage:
            raise PermissionError("Only the thread creator or workspace managers can change thread settings")
        if title is not None:
            clean = str(title or "").strip()[:80]
            if clean:
                thread["title"] = clean
                thread["slug"] = re.sub(r"[^a-z0-9]+", "-", clean.lower()).strip("-")[:40] or thread.get("slug") or "thread"
        if visibility is not None and thread.get("slug") != "general":
            wanted = str(visibility or "").strip().lower()
            if wanted not in {"shared", "private"}:
                raise ValueError("Visibility must be shared or private")
            thread["visibility"] = wanted
        _save(project_path, data)
        return _thread_summary(thread)


def remove_thread_member(
    project_path: Path,
    *,
    thread_id: str,
    target_user_id: str,
    requester: dict[str, Any],
    workspace_role: str | None = None,
) -> dict[str, Any]:
    with _lock_for(project_path):
        data = _load(project_path)
        thread = _find_thread(data, thread_id)
        if not thread:
            raise KeyError("Thread not found")
        if not user_can_access_thread(thread, requester, workspace_role=workspace_role):
            raise PermissionError("Thread not found")
        if thread.get("slug") == "general":
            raise ValueError("The default Render Studio thread includes the workspace")
        uid = str(requester.get("id") or "")
        role = str(workspace_role or "").lower()
        can_manage = (
            uid and uid == str(thread.get("created_by") or "")
        ) or role in {"owner", "manager", "admin"}
        if not can_manage:
            raise PermissionError("Only the thread creator or workspace managers can remove members")
        target = str(target_user_id or "")
        if target and target == str(thread.get("created_by") or ""):
            raise ValueError("Transfer ownership before removing the creator")
        thread["members"] = [m for m in (thread.get("members") or []) if str(m.get("id") or "") != target]
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
            stored_handle = str(cand.get("handle") or "").lower().lstrip("@")
            handle = stored_handle or re.sub(r"[^a-z0-9]+", "", name.lower())
            if (
                bare.lower() == handle
                or bare.lower() == stored_handle
                or bare.lower() == email.split("@")[0].lower()
                or bare.lower() == name.lower().replace(" ", "")
            ):
                key = f"user:{cand.get('id')}"
                if key in seen:
                    break
                seen.add(key)
                found.append({"type": "user", "id": cand.get("id"), "name": name or email, "handle": cand.get("handle")})
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
        display = member.get("display_name") or member.get("email") or "User"
        stored = (member.get("handle") or "").strip().lstrip("@")
        handle = stored or (re.sub(r"[^A-Za-z0-9_]", "", str(display))[:24] or "user")
        out.append(
            {
                "id": member.get("id") or member.get("user_id"),
                "display_name": display,
                "avatar_url": member.get("avatar_url"),
                "email": member.get("email"),
                "type": "user",
                "handle": handle,
                "profile_url": f"/u/{handle}",
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
    workspace_id: str | None = None,
) -> dict[str, Any]:
    text_body = (body or "").strip()
    if not text_body and not images:
        raise ValueError("Message body required")
    if len(text_body) > 8000:
        raise ValueError("Message too long")
    storage_root, thread = chat_storage_for_thread(
        project_path,
        thread_id,
        workspace_id=workspace_id,
        user=user,
    )
    with _lock_for(storage_root):
        data = _load(storage_root)
        if workspace_id and (_is_general_thread(thread) or thread_id in {"general", "default", thread.get("id")}):
            thread = _ensure_general_thread(data, user)
            thread["kind"] = "group"
            thread["scope"] = "workspace"
        else:
            thread = _find_thread(data, thread.get("id") or thread_id)
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
        mentions = parse_mentions(text_body, mention_candidates_list)
        msg = {
            "id": message_id or str(uuid.uuid4())[:10],
            "thread_id": thread["id"],
            "parent_id": parent_id,
            "body": text_body,
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
        if user.get("id"):
            data.setdefault("read_cursors", {})[user["id"]] = {
                "at": msg["created_at"],
                "message_id": msg["id"],
                "thread_id": thread["id"],
            }
        _save(storage_root, data)
        return msg


def edit_message(
    project_path: Path,
    *,
    thread_id: str,
    message_id: str,
    body: str,
    user: dict[str, Any],
    mention_candidates_list: list[dict[str, Any]] | None = None,
    workspace_role: str | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Edit a message the current user previously sent (text only; images stay)."""
    text_body = (body or "").strip()
    if not text_body:
        raise ValueError("Message body required")
    if len(text_body) > 8000:
        raise ValueError("Message too long")
    storage_root, seed = chat_storage_for_thread(
        project_path, thread_id, workspace_id=workspace_id, user=user
    )
    with _lock_for(storage_root):
        data = _load(storage_root)
        thread = _find_thread(data, seed.get("id") or thread_id)
        if not thread:
            raise KeyError("Thread not found")
        if not user_can_access_thread(thread, user, workspace_role=workspace_role):
            raise PermissionError("Thread not found")
        msg = _find_message(thread, message_id)
        if not msg:
            raise KeyError("Message not found")
        if msg.get("is_agent"):
            raise PermissionError("Agent messages cannot be edited")
        if str(msg.get("user_id") or "") != str(user.get("id") or ""):
            raise PermissionError("You can only edit your own messages")
        msg["body"] = text_body
        msg["mentions"] = parse_mentions(text_body, mention_candidates_list)
        msg["edited_at"] = _now()
        _save(storage_root, data)
        return msg


def toggle_reaction(
    project_path: Path,
    *,
    thread_id: str,
    message_id: str,
    emoji: str,
    user: dict[str, Any],
    workspace_id: str | None = None,
) -> dict[str, Any]:
    storage_root, seed = chat_storage_for_thread(
        project_path, thread_id, workspace_id=workspace_id, user=user
    )
    with _lock_for(storage_root):
        if emoji not in ALLOWED_REACTIONS:
            raise ValueError("Unsupported reaction")
        data = _load(storage_root)
        thread = _find_thread(data, seed.get("id") or thread_id)
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
        _save(storage_root, data)
        return msg


def mark_read(
    project_path: Path,
    *,
    user_id: str,
    thread_id: str | None = None,
    message_id: str | None = None,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    storage_root = project_path
    if workspace_id and thread_id:
        try:
            storage_root, _thread = chat_storage_for_thread(
                project_path,
                thread_id,
                workspace_id=workspace_id,
                user={"id": user_id},
            )
        except KeyError:
            storage_root = project_path
    with _lock_for(storage_root):
        data = _load(storage_root)
        cursor = {"at": _now(), "thread_id": thread_id, "message_id": message_id}
        data.setdefault("read_cursors", {})[user_id] = cursor
        _save(storage_root, data)
        return cursor


def unread_summary(
    project_path: Path,
    user_id: str,
    *,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    threads: list[dict[str, Any]] = []
    cursors: dict[str, Any] = {}
    if workspace_id:
        root, general = ensure_workspace_general(workspace_id, None, seed_project_path=project_path)
        ws_data = _load(root)
        cursors.update(ws_data.get("read_cursors") or {})
        threads.append(general)
        pdata = _load(project_path)
        cursors.update(pdata.get("read_cursors") or {})
        threads.extend([t for t in (pdata.get("threads") or []) if not _is_general_thread(t)])
    else:
        data = _load(project_path)
        cursors = dict(data.get("read_cursors") or {})
        threads = list(data.get("threads") or [])
    cursor = cursors.get(user_id) or {}
    cursor_at = str(cursor.get("at") or "")
    total = 0
    mention_count = 0
    latest_mention = None
    for thread in threads:
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


def resolve_media_path(
    project_path: Path,
    stored_name: str,
    *,
    workspace_id: str | None = None,
) -> Path | None:
    safe = Path(stored_name or "").name
    if not safe or ".." in safe:
        return None
    path = _media_dir(project_path) / safe
    if path.is_file():
        return path
    ws = workspace_chat_root(workspace_id) if workspace_id else None
    if ws is not None:
        alt = _media_dir(ws) / safe
        if alt.is_file():
            return alt
    return None
