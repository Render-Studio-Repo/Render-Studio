"""User handles, public profiles, and meeting requests."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from backend.database import get_conn

HANDLE_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{2,23}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify_handle(raw: str, *, fallback: str = "user") -> str:
    text = re.sub(r"[^A-Za-z0-9_]", "", (raw or "").strip())
    if text and text[0].isdigit():
        text = f"u{text}"
    text = text[:24] or fallback
    if len(text) < 3:
        text = (text + "user")[:3]
    return text


def validate_handle(handle: str) -> str:
    cleaned = (handle or "").strip().lstrip("@")
    if not HANDLE_RE.match(cleaned):
        raise ValueError("Handle must be 3–24 chars: start with a letter, then letters, numbers, or _")
    return cleaned


def ensure_unique_handle(conn, desired: str, *, exclude_user_id: str | None = None) -> str:
    base = slugify_handle(desired)
    candidate = base
    n = 2
    while True:
        row = conn.execute(
            "SELECT id FROM users WHERE lower(handle) = lower(?) LIMIT 1",
            (candidate,),
        ).fetchone()
        if not row or (exclude_user_id and row["id"] == exclude_user_id):
            return candidate
        suffix = str(n)
        candidate = f"{base[: 24 - len(suffix)]}{suffix}"
        n += 1
        if n > 9999:
            return f"u{uuid.uuid4().hex[:8]}"


def migrate_user_handles(conn) -> None:
    try:
        conn.execute("ALTER TABLE users ADD COLUMN handle TEXT")
    except Exception:
        pass
    try:
        conn.execute("ALTER TABLE users ADD COLUMN bio TEXT")
    except Exception:
        pass
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_lower ON users(lower(handle))"
        )
    except Exception:
        pass
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meeting_requests (
              id TEXT PRIMARY KEY,
              from_user_id TEXT NOT NULL,
              to_user_id TEXT NOT NULL,
              message TEXT,
              proposed_time TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              channel TEXT NOT NULL DEFAULT 'chat',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """
        )
    except Exception:
        pass
    rows = conn.execute(
        "SELECT id, email, display_name, handle FROM users"
    ).fetchall()
    for row in rows:
        if row["handle"]:
            continue
        seed = row["display_name"] or (row["email"] or "user").split("@")[0]
        handle = ensure_unique_handle(conn, seed, exclude_user_id=row["id"])
        conn.execute("UPDATE users SET handle = ? WHERE id = ?", (handle, row["id"]))


def get_user_row(user_id: str | None = None, *, handle: str | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        if user_id:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        elif handle:
            row = conn.execute(
                "SELECT * FROM users WHERE lower(handle) = lower(?)",
                (handle.lstrip("@"),),
            ).fetchone()
        else:
            return None
    if not row:
        return None
    keys = row.keys()
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "handle": row["handle"] if "handle" in keys else None,
        "bio": row["bio"] if "bio" in keys else None,
        "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
        "created_at": row["created_at"],
    }


def update_profile(
    user_id: str,
    *,
    display_name: str | None = None,
    handle: str | None = None,
    bio: str | None = None,
) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise KeyError("User not found")
        updates: list[str] = []
        params: list[Any] = []
        if display_name is not None:
            name = display_name.strip()
            if not name or len(name) > 80:
                raise ValueError("Display name must be 1–80 characters")
            updates.append("display_name = ?")
            params.append(name)
        if handle is not None:
            cleaned = validate_handle(handle)
            unique = ensure_unique_handle(conn, cleaned, exclude_user_id=user_id)
            if unique.lower() != cleaned.lower():
                # Collision with another user
                taken = conn.execute(
                    "SELECT id FROM users WHERE lower(handle) = lower(?) AND id != ?",
                    (cleaned, user_id),
                ).fetchone()
                if taken:
                    raise ValueError("That handle is already taken")
            updates.append("handle = ?")
            params.append(cleaned)
        if bio is not None:
            text = bio.strip()
            if len(text) > 500:
                raise ValueError("Bio must be 500 characters or fewer")
            updates.append("bio = ?")
            params.append(text or None)
        if updates:
            params.append(user_id)
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
        refreshed = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return get_user_row(refreshed["id"])  # type: ignore[index]


def _user_projects(user_id: str, *, limit: int = 12) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT pa.project_id, pa.created_at, pa.is_public, t.name AS team_name
              FROM project_access pa
              LEFT JOIN teams t ON t.id = pa.team_id
             WHERE pa.created_by = ?
             ORDER BY pa.created_at DESC
             LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    out = []
    root = Path(__file__).resolve().parents[2] / "projects"
    for row in rows:
        pid = row["project_id"]
        meta_name = pid
        project_path = root / pid
        for candidate in ("project.json", "meta.json"):
            p = project_path / candidate
            if p.is_file():
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                    meta_name = data.get("name") or data.get("title") or pid
                except Exception:
                    pass
                break
        models = []
        if project_path.is_dir():
            for ext in (".glb", ".stl", ".step", ".stp", ".obj"):
                models.extend(sorted(project_path.glob(f"*{ext}"))[:4])
        out.append(
            {
                "project_id": pid,
                "name": meta_name,
                "created_at": row["created_at"],
                "is_public": bool(row["is_public"]),
                "team_name": row["team_name"],
                "model_count": len(models),
                "models": [{"filename": m.name} for m in models[:4]],
            }
        )
    return out


def _user_posts(user_id: str, *, limit: int = 8) -> list[dict[str, Any]]:
    """Recent public-ish activity: marketplace apps + recent shared chat snippets are skipped;
    surface agent app listings authored by the user when present."""
    with get_conn() as conn:
        try:
            rows = conn.execute(
                """
                SELECT id, slug, name, tagline, status, published_at, created_at
                  FROM agent_app_listings
                 WHERE created_by = ? AND status IN ('published', 'approved', 'live')
                 ORDER BY COALESCE(published_at, created_at) DESC
                 LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        except Exception:
            rows = []
    return [
        {
            "id": r["id"],
            "slug": r["slug"],
            "title": r["name"],
            "summary": r["tagline"],
            "kind": "app",
            "created_at": r["published_at"] or r["created_at"],
            "href": f"/marketplace.html?app={r['slug']}" if r["slug"] else None,
        }
        for r in rows
    ]


def public_profile(user_id: str | None = None, *, handle: str | None = None, viewer: dict[str, Any] | None = None) -> dict[str, Any]:
    user = get_user_row(user_id, handle=handle)
    if not user:
        raise KeyError("User not found")
    handle_value = user.get("handle") or slugify_handle(user.get("display_name") or "user")
    profile_path = f"/u/{handle_value}"
    return {
        "id": user["id"],
        "display_name": user["display_name"],
        "handle": handle_value,
        "bio": user.get("bio") or "",
        "avatar_url": user.get("avatar_url"),
        "created_at": user.get("created_at"),
        "profile_url": profile_path,
        "profile_link": f"https://render3d.app{profile_path}",
        "is_self": bool(viewer and viewer.get("id") == user["id"]),
        "projects": _user_projects(user["id"]),
        "posts": _user_posts(user["id"]),
        "stats": {
            "projects": len(_user_projects(user["id"], limit=100)),
            "posts": len(_user_posts(user["id"], limit=100)),
        },
    }


def create_meeting_request(
    *,
    from_user: dict[str, Any],
    to_user_id: str,
    message: str = "",
    proposed_time: str = "",
    channel: str = "chat",
) -> dict[str, Any]:
    if from_user.get("id") == to_user_id:
        raise ValueError("You can't request a meeting with yourself")
    target = get_user_row(to_user_id)
    if not target:
        raise KeyError("User not found")
    channel = (channel or "chat").strip().lower()
    if channel not in {"chat", "calendar", "both"}:
        channel = "chat"
    req_id = str(uuid.uuid4())[:12]
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO meeting_requests
              (id, from_user_id, to_user_id, message, proposed_time, status, channel, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
            """,
            (
                req_id,
                from_user["id"],
                to_user_id,
                (message or "").strip()[:1000],
                (proposed_time or "").strip()[:120],
                channel,
                now,
                now,
            ),
        )
        conn.commit()

    from_handle = from_user.get("handle") or slugify_handle(from_user.get("display_name") or "user")
    to_handle = target.get("handle") or slugify_handle(target.get("display_name") or "user")
    title = quote(f"Render3D meeting with {target.get('display_name') or to_handle}")
    details = quote(
        (message or f"Meeting request from @{from_handle} on Render3D").strip()
        + f"\n\nProfile: https://render3d.app/u/{to_handle}"
    )
    calendar_url = (
        "https://calendar.google.com/calendar/render?action=TEMPLATE"
        f"&text={title}&details={details}"
    )
    if proposed_time:
        # Soft hint only — full ISO optional
        calendar_url += f"&sf=true"

    chat_body = (
        f"📅 Meeting request for @[{target.get('display_name')}](user:{to_user_id})\n"
        f"From @[{from_user.get('display_name')}](user:{from_user['id']})"
    )
    if proposed_time:
        chat_body += f"\nProposed: {proposed_time}"
    if message:
        chat_body += f"\n\n{message.strip()}"
    chat_body += f"\n\nCalendar: {calendar_url}"

    return {
        "id": req_id,
        "status": "pending",
        "channel": channel,
        "from_user": {
            "id": from_user["id"],
            "display_name": from_user.get("display_name"),
            "handle": from_handle,
        },
        "to_user": {
            "id": target["id"],
            "display_name": target.get("display_name"),
            "handle": to_handle,
        },
        "message": (message or "").strip(),
        "proposed_time": proposed_time,
        "calendar_url": calendar_url,
        "chat_body": chat_body,
        "created_at": now,
    }


def profile_mention_markdown(user: dict[str, Any]) -> str:
    handle = user.get("handle") or slugify_handle(user.get("display_name") or "user")
    name = user.get("display_name") or handle
    return f"[@{handle}](https://render3d.app/u/{handle}) ({name})"
