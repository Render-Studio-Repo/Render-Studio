"""Social network: friends from shared workspaces + invite-to-join-you."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services import social_service, teams_service

logger = logging.getLogger("render3d.social_network")

ONLINE_WINDOW_SECONDS = getattr(social_service, "ONLINE_WINDOW_SECONDS", 120)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(text)
    except Exception:
        return None


def _is_online(last_seen_at: str | None) -> bool:
    last_seen = _parse_iso(last_seen_at)
    return bool(last_seen and (_now() - last_seen).total_seconds() <= ONLINE_WINDOW_SECONDS)


def migrate_friends(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_friends (
            user_id TEXT NOT NULL,
            friend_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, friend_id)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_friends_friend ON user_friends(friend_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_friend_requests (
            id TEXT PRIMARY KEY,
            from_user_id TEXT NOT NULL,
            to_user_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            UNIQUE(from_user_id, to_user_id)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON user_friend_requests(to_user_id, status)"
    )


def list_friend_ids(user_id: str) -> set[str]:
    with get_conn() as conn:
        migrate_friends(conn)
        rows = conn.execute(
            "SELECT friend_id FROM user_friends WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    return {str(r["friend_id"]) for r in rows}


def add_friend(user_id: str, friend_id: str) -> dict[str, Any]:
    """Send a friend request, or accept if they already asked you."""
    import uuid

    uid = str(user_id or "").strip()
    fid = str(friend_id or "").strip()
    if not uid or not fid:
        raise ValueError("Pick someone to add")
    if uid == fid:
        raise ValueError("That's you")

    def _card(row: Any) -> dict[str, Any]:
        keys = row.keys()
        return {
            "id": fid,
            "display_name": row["display_name"] or row["email"] or "User",
            "handle": row["handle"] if "handle" in keys else None,
            "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
            "email": (row["email"] or "").strip().lower() if "email" in keys else None,
        }

    with get_conn() as conn:
        migrate_friends(conn)
        row = conn.execute("SELECT * FROM users WHERE id = ?", (fid,)).fetchone()
        if not row:
            raise ValueError("User not found")
        already = conn.execute(
            "SELECT 1 FROM user_friends WHERE user_id = ? AND friend_id = ?",
            (uid, fid),
        ).fetchone()
        if already:
            return {"ok": True, "status": "friends", "friend": _card(row)}
        reverse = conn.execute(
            """
            SELECT id FROM user_friend_requests
            WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
            """,
            (fid, uid),
        ).fetchone()
        now = _now().isoformat()
        if reverse:
            conn.execute(
                "INSERT OR IGNORE INTO user_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)",
                (uid, fid, now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO user_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)",
                (fid, uid, now),
            )
            conn.execute(
                """
                UPDATE user_friend_requests SET status = 'accepted'
                WHERE status = 'pending' AND (
                    (from_user_id = ? AND to_user_id = ?)
                    OR (from_user_id = ? AND to_user_id = ?)
                )
                """,
                (uid, fid, fid, uid),
            )
            conn.commit()
            return {"ok": True, "status": "friends", "friend": _card(row), "accepted": True}
        existing = conn.execute(
            """
            SELECT id FROM user_friend_requests
            WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
            """,
            (uid, fid),
        ).fetchone()
        if existing:
            return {"ok": True, "status": "pending", "request_id": existing["id"], "friend": _card(row)}
        req_id = str(uuid.uuid4())[:12]
        conn.execute(
            """
            INSERT INTO user_friend_requests (id, from_user_id, to_user_id, status, created_at)
            VALUES (?, ?, ?, 'pending', ?)
            """,
            (req_id, uid, fid, now),
        )
        conn.commit()
        return {"ok": True, "status": "pending", "request_id": req_id, "friend": _card(row)}


def list_friend_requests(user_id: str) -> dict[str, Any]:
    uid = str(user_id or "").strip()
    incoming: list[dict[str, Any]] = []
    outgoing: list[dict[str, Any]] = []
    with get_conn() as conn:
        migrate_friends(conn)
        in_rows = conn.execute(
            """
            SELECT r.id, r.from_user_id, r.to_user_id, r.created_at,
                   u.display_name, u.email, u.handle, u.avatar_url
            FROM user_friend_requests r
            JOIN users u ON u.id = r.from_user_id
            WHERE r.to_user_id = ? AND r.status = 'pending'
            ORDER BY r.created_at DESC
            """,
            (uid,),
        ).fetchall()
        out_rows = conn.execute(
            """
            SELECT r.id, r.from_user_id, r.to_user_id, r.created_at,
                   u.display_name, u.email, u.handle, u.avatar_url
            FROM user_friend_requests r
            JOIN users u ON u.id = r.to_user_id
            WHERE r.from_user_id = ? AND r.status = 'pending'
            ORDER BY r.created_at DESC
            """,
            (uid,),
        ).fetchall()
    for row in in_rows:
        incoming.append({
            "id": row["id"],
            "kind": "friend",
            "created_at": row["created_at"],
            "from_user_id": row["from_user_id"],
            "user": {
                "id": row["from_user_id"],
                "display_name": row["display_name"] or row["email"] or "User",
                "email": (row["email"] or "").strip().lower(),
                "handle": row["handle"],
                "avatar_url": row["avatar_url"],
            },
        })
    for row in out_rows:
        outgoing.append({
            "id": row["id"],
            "kind": "friend",
            "created_at": row["created_at"],
            "to_user_id": row["to_user_id"],
            "user": {
                "id": row["to_user_id"],
                "display_name": row["display_name"] or row["email"] or "User",
                "email": (row["email"] or "").strip().lower(),
                "handle": row["handle"],
                "avatar_url": row["avatar_url"],
            },
        })
    return {"incoming": incoming, "outgoing": outgoing}


def respond_friend_request(user_id: str, request_id: str, *, accept: bool) -> dict[str, Any]:
    uid = str(user_id or "").strip()
    rid = str(request_id or "").strip()
    if not uid or not rid:
        raise ValueError("Request not found")
    with get_conn() as conn:
        migrate_friends(conn)
        row = conn.execute(
            "SELECT id, from_user_id, to_user_id, status FROM user_friend_requests WHERE id = ?",
            (rid,),
        ).fetchone()
        if not row or row["status"] != "pending":
            raise ValueError("Request not found")
        if str(row["to_user_id"]) != uid:
            raise PermissionError("That request is not for you")
        if accept:
            now = _now().isoformat()
            fid = str(row["from_user_id"])
            conn.execute(
                "INSERT OR IGNORE INTO user_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)",
                (uid, fid, now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO user_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)",
                (fid, uid, now),
            )
            conn.execute(
                "UPDATE user_friend_requests SET status = 'accepted' WHERE id = ?",
                (rid,),
            )
        else:
            conn.execute(
                "UPDATE user_friend_requests SET status = 'declined' WHERE id = ?",
                (rid,),
            )
        conn.commit()
    return {"ok": True, "status": "accepted" if accept else "declined", "request_id": rid}


def list_my_workspaces(user_id: str) -> list[dict[str, Any]]:
    """Workspaces the user belongs to (for Social filter chips)."""
    teams = teams_service.list_teams(user_id) or []
    out = []
    for team in teams:
        tid = str(team.get("id") or "")
        if not tid:
            continue
        member_count = 0
        try:
            member_count = len(teams_service.list_team_members(tid, user_id) or [])
        except Exception:
            member_count = int(team.get("member_count") or 0) or 0
        out.append({
            "id": tid,
            "name": team.get("name") or "Workspace",
            "role": team.get("role") or team.get("role_label") or "member",
            "member_count": member_count,
        })
    return out


def list_friends(
    user_id: str,
    *,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """People you share workspaces with (your friends / network).

    Optional workspace_id filters to members of that workspace only.
    """
    workspaces = list_my_workspaces(user_id)
    workspace_ids = {w["id"] for w in workspaces}
    if workspace_id:
        if workspace_id not in workspace_ids:
            raise PermissionError("Not a member of that workspace")
        filter_ids = [workspace_id]
    else:
        filter_ids = [w["id"] for w in workspaces]

    by_user: dict[str, dict[str, Any]] = {}
    friend_ids: set[str] = set()
    with get_conn() as conn:
        try:
            social_service.migrate_social_features(conn)
        except Exception:
            pass
        migrate_friends(conn)
        friend_ids = {
            str(r["friend_id"])
            for r in conn.execute(
                "SELECT friend_id FROM user_friends WHERE user_id = ?",
                (user_id,),
            ).fetchall()
        }
        for tid in filter_ids:
            rows = conn.execute(
                """
                SELECT u.id, u.email, u.display_name, u.avatar_url, u.handle,
                       u.status_text, u.status_icon, u.last_seen_at,
                       tm.role, t.id AS team_id, t.name AS team_name
                FROM team_members tm
                JOIN users u ON u.id = tm.user_id
                JOIN teams t ON t.id = tm.team_id
                WHERE tm.team_id = ?
                  AND tm.user_id != ?
                ORDER BY lower(COALESCE(u.display_name, u.email))
                """,
                (tid, user_id),
            ).fetchall()
            for row in rows:
                uid = str(row["id"])
                entry = by_user.get(uid)
                team_bit = {
                    "id": row["team_id"],
                    "name": row["team_name"] or "Workspace",
                    "role": row["role"] or "member",
                }
                if not entry:
                    by_user[uid] = {
                        "id": uid,
                        "email": (row["email"] or "").strip().lower(),
                        "display_name": row["display_name"] or row["email"] or "User",
                        "avatar_url": row["avatar_url"] if "avatar_url" in row.keys() else None,
                        "handle": row["handle"] if "handle" in row.keys() else None,
                        "status_text": row["status_text"] if "status_text" in row.keys() else None,
                        "status_icon": row["status_icon"] if "status_icon" in row.keys() else None,
                        "last_seen_at": row["last_seen_at"] if "last_seen_at" in row.keys() else None,
                        "online": _is_online(row["last_seen_at"] if "last_seen_at" in row.keys() else None),
                        "workspaces": [team_bit],
                    }
                else:
                    if not any(w["id"] == team_bit["id"] for w in entry["workspaces"]):
                        entry["workspaces"].append(team_bit)
                    # Prefer freshest online flag
                    if _is_online(row["last_seen_at"] if "last_seen_at" in row.keys() else None):
                        entry["online"] = True
                        entry["last_seen_at"] = row["last_seen_at"]

        if not workspace_id:
            for fid in friend_ids:
                if fid in by_user:
                    continue
                row = conn.execute("SELECT * FROM users WHERE id = ?", (fid,)).fetchone()
                if not row:
                    continue
                keys = row.keys()
                by_user[fid] = {
                    "id": fid,
                    "email": (row["email"] or "").strip().lower() if "email" in keys else "",
                    "display_name": (row["display_name"] if "display_name" in keys else None)
                    or (row["email"] if "email" in keys else None)
                    or "User",
                    "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
                    "handle": row["handle"] if "handle" in keys else None,
                    "status_text": row["status_text"] if "status_text" in keys else None,
                    "status_icon": row["status_icon"] if "status_icon" in keys else None,
                    "last_seen_at": row["last_seen_at"] if "last_seen_at" in keys else None,
                    "online": _is_online(row["last_seen_at"] if "last_seen_at" in keys else None),
                    "workspaces": [],
                }

    accept_map = accept_print_map(list(by_user.keys()))
    for uid, entry in by_user.items():
        entry["is_friend"] = uid in friend_ids
        entry["accept_sends"] = bool(accept_map.get(uid))

    people = sorted(
        by_user.values(),
        key=lambda p: (
            0 if p.get("online") else 1,
            0 if p.get("is_friend") else 1,
            str(p.get("display_name") or "").lower(),
        ),
    )
    online_count = sum(1 for p in people if p.get("online"))
    return {
        "workspaces": workspaces,
        "workspace_id": workspace_id,
        "people": people,
        "count": len(people),
        "online_count": online_count,
        "friend_ids": sorted(friend_ids),
    }


def build_hub(user: dict[str, Any], *, workspace_id: str | None = None) -> dict[str, Any]:
    """One payload for the Social popup: people, public rooms, teams, and pending requests."""
    user_id = str(user.get("id") or "")
    email = str(user.get("email") or "")
    friends = list_friends(user_id, workspace_id=workspace_id)
    people = friends.get("people") or []
    online_count = sum(1 for p in people if p.get("online"))
    room: dict[str, Any] = {"id": "public", "name": "Public room", "count": 0, "users": []}
    try:
        from backend.services import xr_public_room_service

        room = xr_public_room_service.list_occupants(viewer_id=user_id)
    except Exception:
        pass
    project_shares: list[dict[str, Any]] = []
    try:
        from backend.services import project_shares_service

        project_shares = project_shares_service.pending_project_shares_for_user(user_id, email) or []
    except Exception:
        project_shares = []
    workspace_invites: list[dict[str, Any]] = []
    try:
        workspace_invites = teams_service.list_pending_invites(email) or []
    except Exception:
        workspace_invites = []
    friend_reqs = list_friend_requests(user_id)
    incoming_friends = friend_reqs.get("incoming") or []
    meeting_incoming: list[dict[str, Any]] = []
    meeting_outgoing: list[dict[str, Any]] = []
    try:
        from backend.services import calendar_service

        meetings = calendar_service.list_meeting_requests(user_id)
        meeting_incoming = meetings.get("incoming") or []
        meeting_outgoing = meetings.get("outgoing") or []
    except Exception:
        meeting_incoming = []
        meeting_outgoing = []
    request_count = len(project_shares) + len(workspace_invites) + len(incoming_friends) + len(meeting_incoming)
    return {
        **friends,
        "online_count": online_count,
        "room": room,
        "requests": {
            "project_shares": project_shares,
            "workspace_invites": workspace_invites,
            "friend_requests": incoming_friends,
            "outgoing_friends": friend_reqs.get("outgoing") or [],
            "meeting_requests": meeting_incoming,
            "outgoing_meetings": meeting_outgoing,
            "count": request_count,
        },
    }


def invite_to_join_you(
    requester: dict[str, Any],
    *,
    target_user_id: str | None = None,
    email: str | None = None,
    team_id: str | None = None,
    project_id: str | None = None,
    invite_url: str | None = None,
) -> dict[str, Any]:
    """Invite a friend to join you — workspace invite and/or project share + email."""
    requester_id = str(requester.get("id") or "")
    if not requester_id:
        raise PermissionError("Sign in required")

    target_email = (email or "").strip().lower()
    target_user: dict[str, Any] | None = None
    with get_conn() as conn:
        if target_user_id:
            row = conn.execute(
                "SELECT id, email, display_name, avatar_url, handle FROM users WHERE id = ?",
                (target_user_id,),
            ).fetchone()
            if not row:
                raise ValueError("User not found")
            target_user = dict(row)
            target_email = str(row["email"] or "").strip().lower()
        elif target_email:
            row = conn.execute(
                "SELECT id, email, display_name, avatar_url, handle FROM users WHERE lower(email)=lower(?)",
                (target_email,),
            ).fetchone()
            if row:
                target_user = dict(row)
                target_user_id = row["id"]
        else:
            raise ValueError("Pick a friend or enter an email")

    if not target_email:
        raise ValueError("That person has no email on file")

    # Resolve workspace: explicit, else selected project team, else personal/first
    resolved_team = team_id
    if not resolved_team and project_id:
        try:
            resolved_team = teams_service.project_team_id(project_id)
        except Exception:
            resolved_team = None
    if not resolved_team:
        teams = teams_service.list_teams(requester_id) or []
        # Prefer a multi-member collab workspace, else first
        multi = [t for t in teams if int(t.get("member_count") or 0) > 1]
        pick = multi[0] if multi else (teams[0] if teams else None)
        resolved_team = str(pick["id"]) if pick else None
    if not resolved_team:
        raise ValueError("Open or create a workspace first")

    # Must belong to that workspace
    my_teams = {str(t.get("id")) for t in (teams_service.list_teams(requester_id) or [])}
    if resolved_team not in my_teams:
        raise PermissionError("Not allowed to invite to this workspace")

    result: dict[str, Any] = {
        "ok": True,
        "team_id": resolved_team,
        "project_id": project_id,
        "email": target_email,
        "target_user_id": target_user_id or (target_user or {}).get("id"),
        "workspace_invite": None,
        "project_share": None,
        "email_result": None,
    }

    # Workspace invite if not already a member
    already_member = False
    try:
        members = teams_service.list_team_members(resolved_team, requester_id) or []
        already_member = any(str(m.get("id")) == str(target_user_id) for m in members if target_user_id)
        if not already_member and target_email:
            already_member = any(
                str(m.get("email") or "").strip().lower() == target_email for m in members
            )
    except Exception:
        already_member = False

    if not already_member:
        try:
            invite = teams_service.invite_user_to_team(resolved_team, target_email, requester_id)
            result["workspace_invite"] = invite
        except Exception as exc:
            logger.warning("join-you workspace invite failed: %s", exc)
            result["workspace_invite_error"] = str(exc)

    # Project share when a project is open
    if project_id:
        try:
            from backend.services import project_shares_service

            share = project_shares_service.share_project(project_id, target_email, requester_id)
            result["project_share"] = share
        except Exception as exc:
            logger.warning("join-you project share failed: %s", exc)
            result["project_share_error"] = str(exc)

    return result


def _migrate_file_inbox(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_file_inbox (
            id TEXT PRIMARY KEY,
            from_user_id TEXT NOT NULL,
            to_user_id TEXT NOT NULL,
            filename TEXT,
            share_url TEXT NOT NULL,
            project_id TEXT,
            created_at TEXT NOT NULL
        )
        """
    )


def send_file(
    from_user: dict[str, Any],
    to_user_id: str,
    *,
    share_url: str,
    filename: str = "",
    project_id: str | None = None,
) -> dict[str, Any]:
    import uuid

    dest = str(to_user_id or "").strip()
    url = str(share_url or "").strip()
    if not dest:
        raise ValueError("Pick someone to send to")
    if dest == str(from_user.get("id") or ""):
        raise ValueError("That's you")
    if not url.startswith("/") and not url.startswith("http"):
        raise ValueError("Need a share link")
    item = {
        "id": str(uuid.uuid4()),
        "from_user_id": from_user["id"],
        "from_name": from_user.get("display_name") or from_user.get("email") or "Someone",
        "to_user_id": dest,
        "filename": str(filename or "").strip()[:180],
        "share_url": url[:1200],
        "project_id": str(project_id or "").strip() or None,
        "created_at": _now().isoformat(),
    }
    with get_conn() as conn:
        _migrate_file_inbox(conn)
        dest_row = conn.execute("SELECT id FROM users WHERE id = ?", (dest,)).fetchone()
        if not dest_row:
            raise ValueError("User not found")
        conn.execute(
            """
            INSERT INTO user_file_inbox
                (id, from_user_id, to_user_id, filename, share_url, project_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["id"],
                item["from_user_id"],
                item["to_user_id"],
                item["filename"],
                item["share_url"],
                item["project_id"],
                item["created_at"],
            ),
        )
    return {"ok": True, "item": item}


def list_inbox_files(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    with get_conn() as conn:
        _migrate_file_inbox(conn)
        rows = conn.execute(
            """
            SELECT i.id, i.from_user_id, i.filename, i.share_url, i.project_id, i.created_at,
                   u.display_name AS from_name
              FROM user_file_inbox i
              LEFT JOIN users u ON u.id = i.from_user_id
             WHERE i.to_user_id = ?
             ORDER BY i.created_at DESC
             LIMIT ?
            """,
            (user_id, max(1, min(int(limit or 20), 50))),
        ).fetchall()
    return [dict(r) for r in rows]


def migrate_printer_share(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_printer_share_settings (
            user_id TEXT PRIMARY KEY,
            accept_sends INTEGER NOT NULL DEFAULT 0,
            show_outline INTEGER NOT NULL DEFAULT 0,
            show_model INTEGER NOT NULL DEFAULT 0,
            lan_ip TEXT NOT NULL DEFAULT '',
            access_code TEXT NOT NULL DEFAULT '',
            serial TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '',
            bound_id TEXT NOT NULL DEFAULT '',
            fence_json TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        )
        """
    )
    cols = {str(row[1]) for row in conn.execute("PRAGMA table_info(user_printer_share_settings)").fetchall()}
    for col, spec in (
        ("lan_ip", "TEXT NOT NULL DEFAULT ''"),
        ("access_code", "TEXT NOT NULL DEFAULT ''"),
        ("serial", "TEXT NOT NULL DEFAULT ''"),
        ("name", "TEXT NOT NULL DEFAULT ''"),
        ("bound_id", "TEXT NOT NULL DEFAULT ''"),
        ("fence_json", "TEXT NOT NULL DEFAULT ''"),
    ):
        if col not in cols:
            conn.execute(f"ALTER TABLE user_printer_share_settings ADD COLUMN {col} {spec}")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_printer_inbox (
            id TEXT PRIMARY KEY,
            from_user_id TEXT NOT NULL,
            to_user_id TEXT NOT NULL,
            project_id TEXT,
            filename TEXT,
            share_url TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_printer_inbox_to ON user_printer_inbox(to_user_id, status)"
    )


def _empty_printer_share() -> dict[str, Any]:
    return {
        "accept_sends": False,
        "show_outline": False,
        "show_model": False,
        "lan_ip": "",
        "access_code": "",
        "serial": "",
        "name": "",
        "bound_id": "",
        "access_code_set": False,
        "fence": None,
    }


def _clean_printer_lan_ip(raw: str | None) -> str:
    host = str(raw or "").strip()
    if not host:
        return ""
    from backend.services.viser_proxy import hostname_of, is_private_lan_host

    parsed = hostname_of(host) or host.split("/")[0].split(":")[0].strip()
    if not is_private_lan_host(parsed):
        raise ValueError(
            "Enter a printer LAN IP from the printer Network / WLAN screen, or Bambu Studio → Device → LAN."
        )
    return parsed[:255]


def _clean_printer_secret(raw: str | None, limit: int) -> str:
    return str(raw or "").strip()[:limit]


def _parse_printer_fence(raw) -> dict[str, Any] | None:
    import json as _json

    if isinstance(raw, dict):
        data = raw
    else:
        text = str(raw or "").strip()
        if not text:
            return None
        try:
            data = _json.loads(text)
        except Exception:
            return None
    size = data.get("size")
    pos = data.get("position") or data.get("p")
    if not isinstance(size, list) or len(size) < 3 or not isinstance(pos, list) or len(pos) < 3:
        return None
    try:
        sx, sy, sz = float(size[0]), float(size[1]), float(size[2])
        px, py, pz = float(pos[0]), float(pos[1]), float(pos[2])
    except (TypeError, ValueError):
        return None
    if not (0.05 <= sx <= 4 and 0.05 <= sy <= 4 and 0.05 <= sz <= 4):
        return None
    if abs(px) > 40 or abs(py) > 8 or abs(pz) > 40:
        return None
    return {"size": [sx, sy, sz], "position": [px, py, pz]}


def _dump_printer_fence(fence) -> str:
    import json as _json

    parsed = _parse_printer_fence(fence)
    return _json.dumps(parsed) if parsed else ""


def env_bambu_defaults() -> dict[str, Any]:
    try:
        from backend.config import settings
    except Exception:
        return {}
    host = str(getattr(settings, "bambu_printer_host", "") or "").strip()
    code = str(getattr(settings, "bambu_printer_access_code", "") or "").strip()
    serial = str(getattr(settings, "bambu_printer_serial", "") or "").strip()
    name = str(getattr(settings, "bambu_printer_name", "") or "").strip()
    if not host and not code:
        return {}
    return {
        "lan_ip": host,
        "access_code": code,
        "serial": serial,
        "name": name or ("Bambu" if host else ""),
        "bound_id": serial or host,
    }


def apply_env_printer_defaults(row: dict[str, Any]) -> dict[str, Any]:
    env = env_bambu_defaults()
    out = dict(row)
    if env.get("lan_ip") and not out.get("lan_ip"):
        out["lan_ip"] = env["lan_ip"]
        if not out.get("show_outline"):
            out["show_outline"] = True
        if not out.get("show_model"):
            out["show_model"] = True
    if env.get("serial") and not out.get("serial"):
        out["serial"] = env["serial"]
    if env.get("name") and not out.get("name"):
        out["name"] = env["name"]
    if env.get("bound_id") and not out.get("bound_id"):
        out["bound_id"] = env["bound_id"]
    if env.get("access_code") and not out.get("access_code"):
        out["access_code"] = env["access_code"]
    out["access_code_set"] = bool(str(out.get("access_code") or "").strip())
    return out


def client_printer_share(row: dict[str, Any]) -> dict[str, Any]:
    """Owner API payload — merge local .env host, never include the access code / PIN."""
    out = apply_env_printer_defaults(dict(row))
    out["access_code_set"] = bool(str(out.pop("access_code", "") or "").strip() or out.get("access_code_set"))
    out["access_code"] = ""
    fence = _parse_printer_fence(out.get("fence") or out.get("fence_json"))
    out.pop("fence_json", None)
    out["fence"] = fence
    return out


def bind_printer_for_user(
    user_id: str,
    *,
    pin: str,
    serial: str = "",
    lan_ip: str = "",
    name: str = "",
) -> dict[str, Any]:
    from backend.services.bambu_printer_bind import bind_with_pin

    result = bind_with_pin(pin=pin, serial=serial, lan_ip=lan_ip, name=name)
    saved = save_printer_share_settings(
        user_id,
        lan_ip=result.get("lan_ip") or lan_ip or None,
        access_code=pin,
        serial=result.get("serial") or serial or None,
        name=result.get("name") or name or None,
        show_outline=True,
    )
    public = client_printer_share(saved)
    public["bound"] = bool(result.get("bound"))
    public["message"] = result.get("message") or "Printer saved."
    return public


def get_printer_share_settings(user_id: str) -> dict[str, Any]:
    uid = str(user_id or "").strip()
    empty = _empty_printer_share()
    if not uid:
        return empty
    with get_conn() as conn:
        migrate_printer_share(conn)
        row = conn.execute(
            """
            SELECT accept_sends, show_outline, show_model, lan_ip, access_code, serial, name, bound_id, fence_json
            FROM user_printer_share_settings WHERE user_id = ?
            """,
            (uid,),
        ).fetchone()
    if not row:
        return empty
    return {
        "accept_sends": bool(int(row["accept_sends"] or 0)),
        "show_outline": bool(int(row["show_outline"] or 0)),
        "show_model": bool(int(row["show_model"] or 0)),
        "lan_ip": str(row["lan_ip"] or ""),
        "access_code": str(row["access_code"] or ""),
        "serial": str(row["serial"] or ""),
        "name": str(row["name"] or ""),
        "bound_id": str(row["bound_id"] or ""),
        "access_code_set": bool(str(row["access_code"] or "").strip()),
        "fence": _parse_printer_fence(row["fence_json"] if "fence_json" in row.keys() else ""),
    }


def save_printer_share_settings(
    user_id: str,
    *,
    accept_sends: bool | None = None,
    show_outline: bool | None = None,
    show_model: bool | None = None,
    lan_ip: str | None = None,
    access_code: str | None = None,
    serial: str | None = None,
    name: str | None = None,
    fence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("Sign in required")
    current = get_printer_share_settings(uid)
    next_accept = current["accept_sends"] if accept_sends is None else bool(accept_sends)
    next_outline = current["show_outline"] if show_outline is None else bool(show_outline)
    next_model = current["show_model"] if show_model is None else bool(show_model)
    next_ip = current["lan_ip"] if lan_ip is None else _clean_printer_lan_ip(lan_ip)
    next_code = current["access_code"] if access_code is None else _clean_printer_secret(access_code, 32)
    next_serial = current["serial"] if serial is None else _clean_printer_secret(serial, 40)
    next_name = current["name"] if name is None else _clean_printer_secret(name, 80)
    next_bound = current.get("bound_id") or next_serial or next_ip or ""
    next_fence = _dump_printer_fence(current.get("fence") if fence is None else fence)
    now = _now().isoformat()
    with get_conn() as conn:
        migrate_printer_share(conn)
        conn.execute(
            """
            INSERT INTO user_printer_share_settings
                (user_id, accept_sends, show_outline, show_model, lan_ip, access_code, serial, name, bound_id, fence_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                accept_sends = excluded.accept_sends,
                show_outline = excluded.show_outline,
                show_model = excluded.show_model,
                lan_ip = excluded.lan_ip,
                access_code = excluded.access_code,
                serial = excluded.serial,
                name = excluded.name,
                bound_id = excluded.bound_id,
                fence_json = excluded.fence_json,
                updated_at = excluded.updated_at
            """,
            (
                uid,
                1 if next_accept else 0,
                1 if next_outline else 0,
                1 if next_model else 0,
                next_ip,
                next_code,
                next_serial,
                next_name,
                next_bound,
                next_fence,
                now,
            ),
        )
    return get_printer_share_settings(uid)


def accept_print_map(user_ids: list[str]) -> dict[str, bool]:
    ids = [str(i or "").strip() for i in (user_ids or []) if str(i or "").strip()]
    if not ids:
        return {}
    placeholders = ",".join("?" * len(ids))
    with get_conn() as conn:
        migrate_printer_share(conn)
        rows = conn.execute(
            f"SELECT user_id, accept_sends FROM user_printer_share_settings WHERE user_id IN ({placeholders})",
            ids,
        ).fetchall()
    return {str(r["user_id"]): bool(int(r["accept_sends"] or 0)) for r in rows}


def send_to_printer(
    from_user: dict[str, Any],
    to_user_id: str,
    *,
    project_id: str | None = None,
    filename: str = "",
    share_url: str = "",
) -> dict[str, Any]:
    import uuid

    dest = str(to_user_id or "").strip()
    if not dest:
        raise ValueError("Pick someone to send to")
    if dest == str(from_user.get("id") or ""):
        raise ValueError("That's you — throw into your own printer instead")
    settings = get_printer_share_settings(dest)
    if not settings.get("accept_sends"):
        raise PermissionError("They have not allowed incoming print requests")
    with get_conn() as conn:
        dest_row = conn.execute("SELECT id FROM users WHERE id = ?", (dest,)).fetchone()
        if not dest_row:
            raise ValueError("User not found")
    item = {
        "id": str(uuid.uuid4()),
        "from_user_id": from_user["id"],
        "from_name": from_user.get("display_name") or from_user.get("email") or "Someone",
        "to_user_id": dest,
        "project_id": str(project_id or "").strip() or None,
        "filename": str(filename or "").strip()[:180],
        "share_url": str(share_url or "").strip()[:1200],
        "status": "pending",
        "created_at": _now().isoformat(),
    }
    if item["project_id"]:
        try:
            from backend.services import project_shares_service

            email_row = None
            with get_conn() as conn:
                email_row = conn.execute("SELECT email FROM users WHERE id = ?", (dest,)).fetchone()
            if email_row and email_row["email"]:
                project_shares_service.share_project(item["project_id"], email_row["email"], from_user["id"])
        except Exception as exc:
            logger.warning("printer share project grant failed: %s", exc)
    with get_conn() as conn:
        migrate_printer_share(conn)
        conn.execute(
            """
            INSERT INTO user_printer_inbox
                (id, from_user_id, to_user_id, project_id, filename, share_url, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["id"],
                item["from_user_id"],
                item["to_user_id"],
                item["project_id"],
                item["filename"],
                item["share_url"],
                item["status"],
                item["created_at"],
            ),
        )
    return {"ok": True, "item": item}


def list_printer_inbox(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    with get_conn() as conn:
        migrate_printer_share(conn)
        rows = conn.execute(
            """
            SELECT i.id, i.from_user_id, i.project_id, i.filename, i.share_url, i.status, i.created_at,
                   u.display_name AS from_name
              FROM user_printer_inbox i
              LEFT JOIN users u ON u.id = i.from_user_id
             WHERE i.to_user_id = ?
             ORDER BY i.created_at DESC
             LIMIT ?
            """,
            (user_id, max(1, min(int(limit or 20), 50))),
        ).fetchall()
    return [dict(r) for r in rows]


def respond_printer_inbox(user_id: str, item_id: str, *, accept: bool) -> dict[str, Any]:
    iid = str(item_id or "").strip()
    if not iid:
        raise ValueError("Missing print request")
    with get_conn() as conn:
        migrate_printer_share(conn)
        row = conn.execute(
            "SELECT * FROM user_printer_inbox WHERE id = ? AND to_user_id = ?",
            (iid, user_id),
        ).fetchone()
        if not row:
            raise LookupError("Print request not found")
        status = "accepted" if accept else "declined"
        conn.execute(
            "UPDATE user_printer_inbox SET status = ? WHERE id = ?",
            (status, iid),
        )
    item = dict(row)
    item["status"] = status
    return {"ok": True, "item": item}
