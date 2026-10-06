"""Public XR lobby: occupancy roster that survives multiple uvicorn workers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services.xr_hot_path import sanitize_xr_device, sanitize_xr_mode

STALE_SECONDS = 60
ROOM_ID = "public"
ROOM_NAME = "Public room"
PALETTE = ["#58a6ff", "#3fb950", "#d29922", "#ff7b72", "#bc8cff", "#79c0ff", "#ffa657"]

# Shared VR scenes available inside the public room (must match XR_BUILTIN_ENVIRONMENTS).
PUBLIC_ROOM_SCENES = [
    {"id": "white", "label": "White room", "kind": "builtin"},
    {"id": "warehouse", "label": "Warehouse", "kind": "builtin"},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def color_for(user_id: str) -> str:
    n = 0
    for ch in str(user_id or ""):
        n = (n * 31 + ord(ch)) & 0xFFFFFFFF
    return PALETTE[n % len(PALETTE)]


def migrate(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS xr_public_presence (
            user_id TEXT PRIMARY KEY,
            display_name TEXT,
            handle TEXT,
            avatar_url TEXT,
            color TEXT,
            project_id TEXT,
            project_name TEXT,
            last_seen_at TEXT NOT NULL
        )
        """
    )
    cols = {str(r[1]) for r in conn.execute("PRAGMA table_info(xr_public_presence)").fetchall()}
    if "xr_device" not in cols:
        conn.execute("ALTER TABLE xr_public_presence ADD COLUMN xr_device TEXT")
    if "xr_mode" not in cols:
        conn.execute("ALTER TABLE xr_public_presence ADD COLUMN xr_mode TEXT")


def prune(conn) -> None:
    cutoff = _now().timestamp() - STALE_SECONDS
    rows = conn.execute("SELECT user_id, last_seen_at FROM xr_public_presence").fetchall()
    dead = []
    for row in rows:
        seen = _parse_iso(row["last_seen_at"] if "last_seen_at" in row.keys() else None)
        if not seen or seen.timestamp() < cutoff:
            dead.append(row["user_id"])
    for uid in dead:
        conn.execute("DELETE FROM xr_public_presence WHERE user_id = ?", (uid,))


def touch(
    user: dict[str, Any],
    *,
    project_id: str | None = None,
    project_name: str | None = None,
    update_project: bool = False,
    update_device: bool = False,
) -> dict[str, Any]:
    uid = str(user.get("id") or "")
    if not uid:
        raise ValueError("Missing user")
    display = (user.get("display_name") or user.get("email") or "User").strip() or "User"
    handle = (user.get("handle") or "").strip().lstrip("@") or None
    avatar = user.get("avatar_url")
    color = color_for(uid)
    now = _iso()
    with get_conn() as conn:
        migrate(conn)
        prune(conn)
        existing = conn.execute(
            "SELECT project_id, project_name, xr_device, xr_mode FROM xr_public_presence WHERE user_id = ?",
            (uid,),
        ).fetchone()
        keep_pid = existing["project_id"] if existing else None
        keep_pname = existing["project_name"] if existing else None
        keep_device = existing["xr_device"] if existing else None
        keep_mode = existing["xr_mode"] if existing else None
        if update_project:
            keep_pid = (project_id or "").strip() or None
            keep_pname = (project_name or "").strip() or None
        if update_device:
            keep_device = sanitize_xr_device(user.get("xr_device") or user.get("xrDevice")) or keep_device
            keep_mode = sanitize_xr_mode(user.get("xr_mode") or user.get("xrMode")) or keep_mode
        conn.execute(
            """
            INSERT INTO xr_public_presence
                (user_id, display_name, handle, avatar_url, color, project_id, project_name, last_seen_at, xr_device, xr_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                display_name = excluded.display_name,
                handle = excluded.handle,
                avatar_url = excluded.avatar_url,
                color = excluded.color,
                project_id = excluded.project_id,
                project_name = excluded.project_name,
                last_seen_at = excluded.last_seen_at,
                xr_device = excluded.xr_device,
                xr_mode = excluded.xr_mode
            """,
            (uid, display, handle, avatar, color, keep_pid, keep_pname, now, keep_device, keep_mode),
        )
    return {
        "id": uid,
        "display_name": display,
        "handle": handle,
        "avatar_url": avatar,
        "color": color,
        "project_id": keep_pid,
        "project_name": keep_pname,
        "xr_device": keep_device,
        "xr_mode": keep_mode,
    }


def leave(user_id: str) -> None:
    uid = str(user_id or "").strip()
    if not uid:
        return
    with get_conn() as conn:
        migrate(conn)
        conn.execute("DELETE FROM xr_public_presence WHERE user_id = ?", (uid,))


def list_occupants(*, viewer_id: str | None = None) -> dict[str, Any]:
    with get_conn() as conn:
        migrate(conn)
        prune(conn)
        rows = conn.execute(
            """
            SELECT user_id, display_name, handle, avatar_url, color,
                   project_id, project_name, last_seen_at, xr_device, xr_mode
            FROM xr_public_presence
            ORDER BY lower(COALESCE(display_name, user_id))
            """
        ).fetchall()
        friend_ids: list[str] = []
        if viewer_id:
            try:
                from backend.services import social_network_service

                social_network_service.migrate_friends(conn)
                friend_ids = [
                    str(r["friend_id"])
                    for r in conn.execute(
                        "SELECT friend_id FROM user_friends WHERE user_id = ?",
                        (viewer_id,),
                    ).fetchall()
                ]
            except Exception:
                friend_ids = []
    users = []
    for row in rows:
        uid = str(row["user_id"])
        users.append(
            {
                "id": uid,
                "display_name": row["display_name"] or "User",
                "handle": row["handle"],
                "avatar_url": row["avatar_url"],
                "color": row["color"] or color_for(uid),
                "project_id": row["project_id"],
                "project_name": row["project_name"],
                "xr_device": row["xr_device"] if "xr_device" in row.keys() else None,
                "xr_mode": row["xr_mode"] if "xr_mode" in row.keys() else None,
                "is_self": bool(viewer_id and uid == viewer_id),
                "is_friend": uid in friend_ids,
            }
        )
    return {
        "id": ROOM_ID,
        "name": ROOM_NAME,
        "count": len(users),
        "users": users,
        "friend_ids": friend_ids,
        "scenes": list(PUBLIC_ROOM_SCENES),
    }
