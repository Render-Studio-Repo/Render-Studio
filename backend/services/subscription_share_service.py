"""Team-shared Cursor / Claude CLI logins (same grant model as ChatGPT)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn

PROVIDERS = ("cursor", "claude")
LABELS = {"cursor": "Cursor", "claude": "Claude"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_provider(provider: str | None) -> str:
    value = str(provider or "").strip().lower()
    aliases = {"anthropic": "claude", "cursor-agent": "cursor", "agent": "cursor"}
    value = aliases.get(value, value)
    if value not in PROVIDERS:
        raise ValueError("Provider must be cursor or claude")
    return value


def ensure_tables(conn: Any | None = None) -> None:
    sql = """
        CREATE TABLE IF NOT EXISTS team_shared_cli_logins (
            id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (team_id, owner_user_id, provider),
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS team_cli_login_grants (
            share_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            granted INTEGER NOT NULL DEFAULT 0,
            updated_by TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            daily_limit_usd REAL,
            PRIMARY KEY (share_id, user_id),
            FOREIGN KEY (share_id) REFERENCES team_shared_cli_logins(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    """
    if conn is not None:
        conn.executescript(sql)
        return
    with get_conn() as owned:
        owned.executescript(sql)


def _signed_in(provider: str, user_id: str | None) -> bool:
    uid = str(user_id or "").strip()
    if not uid:
        return False
    try:
        if provider == "cursor":
            from backend.services.cursor_cli_auth import read_cursor_auth

            return bool(read_cursor_auth(uid).get("signed_in"))
        from backend.services.claude_cli_auth import read_claude_auth

        return bool(read_claude_auth(uid).get("signed_in"))
    except Exception:
        return False


def _user_label(conn: Any, user_id: str) -> str:
    row = conn.execute(
        "SELECT display_name, email FROM users WHERE id=?",
        (user_id,),
    ).fetchone()
    if not row:
        return ""
    return str(row["display_name"] or row["email"] or "").strip()


def _is_team_member(conn: Any, team_id: str, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
        (team_id, user_id),
    ).fetchone()
    return bool(row)


def _is_team_owner(conn: Any, team_id: str, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id=? AND user_id=? AND role='owner'",
        (team_id, user_id),
    ).fetchone()
    return bool(row)


def resolve_owner(user_id: str, provider: str, *, spent_today_usd: float | None = None) -> dict[str, Any]:
    pid = normalize_provider(provider)
    uid = str(user_id or "").strip()
    empty = {"owner_user_id": None, "kind": None, "owner_name": ""}
    if not uid:
        return empty
    if _signed_in(pid, uid):
        return {"owner_user_id": uid, "kind": "self", "owner_name": ""}
    from backend.services import personal_subscription_share_service

    personal = personal_subscription_share_service.resolve_owner(uid, pid, spent_today_usd)
    if personal and personal.get("owner_user_id"):
        return personal
    blocked = personal
    with get_conn() as conn:
        ensure_tables(conn)
        rows = conn.execute(
            """
            SELECT s.id, s.owner_user_id, s.team_id, g.daily_limit_usd
              FROM team_cli_login_grants g
              JOIN team_shared_cli_logins s ON s.id = g.share_id
              JOIN team_members tm ON tm.team_id = s.team_id AND tm.user_id = ?
             WHERE g.user_id = ?
               AND g.granted = 1
               AND s.provider = ?
             ORDER BY s.created_at ASC
            """,
            (uid, uid, pid),
        ).fetchall()
        for row in rows:
            owner = str(row["owner_user_id"] or "")
            if owner and _signed_in(pid, owner):
                limit = row["daily_limit_usd"]
                if limit is not None and (spent_today_usd is None or spent_today_usd >= float(limit)):
                    blocked = {**empty, "kind": "daily_limit", "owner_name": _user_label(conn, owner),
                               "share_id": row["id"], "team_id": row["team_id"], "source": "team",
                               "daily_limit_usd": float(limit), "spent_today_usd": spent_today_usd}
                    continue
                return {
                    "owner_user_id": owner,
                    "kind": "team",
                    "owner_name": _user_label(conn, owner),
                    "share_id": row["id"],
                    "team_id": row["team_id"],
                }
    return blocked or empty


def share_with_team(team_id: str, owner_user_id: str, provider: str) -> dict[str, Any]:
    pid = normalize_provider(provider)
    label = LABELS[pid]
    if not _signed_in(pid, owner_user_id):
        raise ValueError(f"Sign in with {label} under Subscriptions before sharing it with a team.")
    now = _now()
    share_id = str(uuid.uuid4())[:8]
    with get_conn() as conn:
        ensure_tables(conn)
        if not _is_team_member(conn, team_id, owner_user_id):
            raise ValueError("Not a team member")
        existing = conn.execute(
            """
            SELECT id FROM team_shared_cli_logins
             WHERE team_id=? AND owner_user_id=? AND provider=?
            """,
            (team_id, owner_user_id, pid),
        ).fetchone()
        if existing:
            return get_share(team_id, existing["id"], owner_user_id, pid)
        conn.execute(
            """
            INSERT INTO team_shared_cli_logins (id, team_id, owner_user_id, provider, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (share_id, team_id, owner_user_id, pid, now),
        )
        members = conn.execute(
            "SELECT user_id FROM team_members WHERE team_id=?",
            (team_id,),
        ).fetchall()
        for member in members:
            mid = member["user_id"]
            if mid == owner_user_id:
                continue
            conn.execute(
                """
                INSERT INTO team_cli_login_grants (share_id, user_id, granted, updated_by, updated_at)
                VALUES (?, ?, 0, ?, ?)
                ON CONFLICT(share_id, user_id) DO NOTHING
                """,
                (share_id, mid, owner_user_id, now),
            )
    return get_share(team_id, share_id, owner_user_id, pid)


def unshare_from_team(team_id: str, share_id: str, requester_id: str, provider: str) -> None:
    pid = normalize_provider(provider)
    label = LABELS[pid]
    with get_conn() as conn:
        ensure_tables(conn)
        row = conn.execute(
            """
            SELECT owner_user_id FROM team_shared_cli_logins
             WHERE id=? AND team_id=? AND provider=?
            """,
            (share_id, team_id, pid),
        ).fetchone()
        if not row:
            raise ValueError(f"Shared {label} login not found")
        if row["owner_user_id"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError(f"Only the owner can stop sharing this {label} login")
        conn.execute("DELETE FROM team_cli_login_grants WHERE share_id=?", (share_id,))
        conn.execute("DELETE FROM team_shared_cli_logins WHERE id=?", (share_id,))


def list_team_shares(team_id: str, requester_id: str, provider: str) -> list[dict[str, Any]]:
    pid = normalize_provider(provider)
    with get_conn() as conn:
        ensure_tables(conn)
        if not _is_team_member(conn, team_id, requester_id):
            raise ValueError("Not a team member")
        rows = conn.execute(
            """
            SELECT s.id, s.team_id, s.owner_user_id, s.created_at, s.provider,
                   u.display_name AS owner_name, u.email AS owner_email,
                   COALESCE(g.granted, 0) AS granted
              FROM team_shared_cli_logins s
              JOIN users u ON u.id = s.owner_user_id
              LEFT JOIN team_cli_login_grants g
                     ON g.share_id = s.id AND g.user_id = ?
             WHERE s.team_id = ? AND s.provider = ?
             ORDER BY s.created_at ASC
            """,
            (requester_id, team_id, pid),
        ).fetchall()
        out = []
        for row in rows:
            is_owner = row["owner_user_id"] == requester_id
            out.append(
                {
                    "id": row["id"],
                    "team_id": row["team_id"],
                    "provider": pid,
                    "owner_user_id": row["owner_user_id"],
                    "owner_name": row["owner_name"],
                    "owner_email": row["owner_email"],
                    "created_at": row["created_at"],
                    "is_owner": is_owner,
                    "granted": True if is_owner else bool(row["granted"]),
                    "owner_signed_in": _signed_in(pid, row["owner_user_id"]),
                }
            )
        return out


def get_share(team_id: str, share_id: str, requester_id: str, provider: str) -> dict[str, Any]:
    shares = list_team_shares(team_id, requester_id, provider)
    for share in shares:
        if share["id"] == share_id:
            return share
    raise ValueError("Shared login not found")


def list_share_members(team_id: str, share_id: str, requester_id: str, provider: str) -> list[dict[str, Any]]:
    pid = normalize_provider(provider)
    label = LABELS[pid]
    with get_conn() as conn:
        ensure_tables(conn)
        row = conn.execute(
            """
            SELECT owner_user_id FROM team_shared_cli_logins
             WHERE id=? AND team_id=? AND provider=?
            """,
            (share_id, team_id, pid),
        ).fetchone()
        if not row:
            raise ValueError(f"Shared {label} login not found")
        if row["owner_user_id"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError(f"Only the owner can manage who uses this {label} login")
        members = conn.execute(
            """
            SELECT tm.user_id, u.display_name, u.email, u.handle, u.avatar_url, tm.role,
                   CASE WHEN tm.user_id = ? THEN 1 ELSE COALESCE(g.granted, 0) END AS granted
              FROM team_members tm
              JOIN users u ON u.id = tm.user_id
              LEFT JOIN team_cli_login_grants g ON g.share_id = ? AND g.user_id = tm.user_id
             WHERE tm.team_id = ?
             ORDER BY CASE WHEN tm.user_id = ? THEN 0 ELSE 1 END, u.display_name
            """,
            (row["owner_user_id"], share_id, team_id, row["owner_user_id"]),
        ).fetchall()
        owner_id = row["owner_user_id"]
        return [
            {
                "user_id": m["user_id"],
                "id": m["user_id"],
                "display_name": m["display_name"],
                "email": m["email"],
                "handle": m["handle"],
                "avatar_url": m["avatar_url"],
                "role": m["role"],
                "granted": bool(m["granted"]),
                "is_owner": m["user_id"] == owner_id,
            }
            for m in members
        ]


def set_member_access(
    team_id: str,
    share_id: str,
    target_user_id: str,
    *,
    requester_id: str,
    provider: str,
    granted: bool,
) -> list[dict[str, Any]]:
    pid = normalize_provider(provider)
    label = LABELS[pid]
    now = _now()
    with get_conn() as conn:
        ensure_tables(conn)
        row = conn.execute(
            """
            SELECT owner_user_id FROM team_shared_cli_logins
             WHERE id=? AND team_id=? AND provider=?
            """,
            (share_id, team_id, pid),
        ).fetchone()
        if not row:
            raise ValueError(f"Shared {label} login not found")
        if row["owner_user_id"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError(f"Only the owner can manage who uses this {label} login")
        if target_user_id == row["owner_user_id"]:
            return list_share_members(team_id, share_id, requester_id, pid)
        member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not member:
            raise ValueError("That person is not on this team")
        conn.execute(
            """
            INSERT INTO team_cli_login_grants (share_id, user_id, granted, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(share_id, user_id) DO UPDATE SET
                granted = excluded.granted,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (share_id, target_user_id, 1 if granted else 0, requester_id, now),
        )
    return list_share_members(team_id, share_id, requester_id, pid)


def listing_for_user(user_id: str, provider: str) -> dict[str, Any]:
    pid = normalize_provider(provider)
    uid = str(user_id or "").strip()
    owned: list[dict[str, Any]] = []
    received: list[dict[str, Any]] = []
    if not uid:
        return {"owned": owned, "received": received, "signed_in": False}
    with get_conn() as conn:
        ensure_tables(conn)
        teams = conn.execute(
            """
            SELECT t.id, t.name
              FROM team_members tm
              JOIN teams t ON t.id = tm.team_id
             WHERE tm.user_id = ?
             ORDER BY t.name
            """,
            (uid,),
        ).fetchall()
        team_ids = [t["id"] for t in teams]
        rows = (
            conn.execute(
                """
                SELECT s.id, s.team_id, s.owner_user_id, s.created_at, s.provider, t.name AS team_name,
                       u.display_name AS owner_name
                  FROM team_shared_cli_logins s
                  JOIN teams t ON t.id = s.team_id
                  JOIN users u ON u.id = s.owner_user_id
                 WHERE s.provider = ? AND s.team_id IN ({})
                """.format(",".join("?" * len(team_ids))),
                [pid, *team_ids],
            ).fetchall()
            if team_ids
            else []
        )
        grant_rows = conn.execute(
            """
            SELECT g.share_id, g.granted
              FROM team_cli_login_grants g
              JOIN team_shared_cli_logins s ON s.id = g.share_id
             WHERE g.user_id = ? AND s.provider = ?
            """,
            (uid, pid),
        ).fetchall()
        granted_map = {g["share_id"]: bool(g["granted"]) for g in grant_rows}
        for row in rows:
            item = {
                "id": row["id"],
                "team_id": row["team_id"],
                "team_name": row["team_name"],
                "owner_user_id": row["owner_user_id"],
                "owner_name": row["owner_name"],
                "provider": pid,
                "created_at": row["created_at"],
                "owner_signed_in": _signed_in(pid, row["owner_user_id"]),
            }
            if row["owner_user_id"] == uid:
                owned.append(item)
            elif granted_map.get(row["id"]):
                received.append({**item, "granted": True})
    from backend.services import personal_subscription_share_service

    return {"owned": owned, "received": received, "signed_in": _signed_in(pid, uid),
            "personal_people": personal_subscription_share_service.list_personal_people(uid, pid),
            "personal_received": personal_subscription_share_service.list_personal_received(uid, pid)}
