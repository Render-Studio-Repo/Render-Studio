"""Teams, users, invites, and project access."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.auth import hash_password, verify_password
from backend.database import get_conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_user(email: str, password: str, display_name: str) -> dict[str, Any]:
    email = email.strip().lower()
    display_name = display_name.strip() or email.split("@")[0]
    user_id = str(uuid.uuid4())[:12]
    team_id = str(uuid.uuid4())[:8]
    now = _now()
    with get_conn() as conn:
        try:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email, display_name, hash_password(password), now),
            )
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
                (team_id, f"{display_name}'s Team", user_id, now),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
                (team_id, user_id, "owner", now),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("Email already registered") from exc
    return {"id": user_id, "email": email, "display_name": display_name, "created_at": now}


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    email = email.strip().lower()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "created_at": row["created_at"],
    }


def list_teams(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT t.id, t.name, t.created_by, t.created_at, tm.role
            FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.user_id = ?
            ORDER BY t.name
            """,
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def list_team_members(team_id: str, user_id: str) -> list[dict[str, Any]]:
    _require_team_member(team_id, user_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, tm.role, tm.joined_at
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = ?
            ORDER BY u.display_name
            """,
            (team_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _require_team_member(team_id: str, user_id: str) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (team_id, user_id),
        ).fetchone()
    if not row:
        raise PermissionError("Not a member of this team")


def _require_team_owner(team_id: str, user_id: str) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
            (team_id, user_id),
        ).fetchone()
    if not row or row["role"] != "owner":
        raise PermissionError("Only workspace owners can rename the workspace")


def update_team(team_id: str, name: str, user_id: str) -> dict[str, Any]:
    _require_team_owner(team_id, user_id)
    clean = name.strip()
    if not clean:
        raise ValueError("Workspace name is required")
    with get_conn() as conn:
        conn.execute("UPDATE teams SET name = ? WHERE id = ?", (clean, team_id))
        conn.commit()
        row = conn.execute(
            "SELECT t.id, t.name, t.created_by, t.created_at, tm.role FROM teams t "
            "JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ? WHERE t.id = ?",
            (user_id, team_id),
        ).fetchone()
    if not row:
        raise ValueError("Workspace not found")
    return dict(row)


def create_team(name: str, user_id: str) -> dict[str, Any]:
    team_id = str(uuid.uuid4())[:8]
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
            (team_id, name.strip(), user_id, now),
        )
        conn.execute(
            "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
            (team_id, user_id, "owner", now),
        )
        conn.commit()
    return {"id": team_id, "name": name.strip(), "created_by": user_id, "created_at": now, "role": "owner"}


def invite_user_to_team(team_id: str, email: str, inviter_id: str) -> dict[str, Any]:
    _require_team_member(team_id, inviter_id)
    email = email.strip().lower()
    with get_conn() as conn:
        user = conn.execute("SELECT id, email, display_name FROM users WHERE email = ?", (email,)).fetchone()
        if user:
            existing = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
                (team_id, user["id"]),
            ).fetchone()
            if existing:
                return {"status": "already_member", "user": dict(user)}

        pending = conn.execute(
            """
            SELECT id FROM team_invites
            WHERE team_id = ? AND email = ? AND status = 'pending'
            """,
            (team_id, email),
        ).fetchone()
        if pending:
            return {"status": "invited", "email": email, "invite_id": pending["id"]}

        invite_id = str(uuid.uuid4())[:8]
        conn.execute(
            """
            INSERT INTO team_invites (id, team_id, email, invited_by, status, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?)
            """,
            (invite_id, team_id, email, inviter_id, _now()),
        )
        conn.commit()
        return {"status": "invited", "email": email, "invite_id": invite_id}


def list_pending_invites(email: str) -> list[dict[str, Any]]:
    email = email.strip().lower()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT i.id, i.team_id, i.email, i.invited_by, i.created_at,
                   t.name AS team_name,
                   u.display_name AS inviter_name
            FROM team_invites i
            JOIN teams t ON t.id = i.team_id
            JOIN users u ON u.id = i.invited_by
            WHERE i.email = ? AND i.status = 'pending'
            ORDER BY i.created_at DESC
            """,
            (email,),
        ).fetchall()
    return [dict(r) for r in rows]


def accept_team_invite(invite_id: str, user_id: str, email: str) -> dict[str, Any]:
    email = email.strip().lower()
    with get_conn() as conn:
        invite = conn.execute(
            "SELECT * FROM team_invites WHERE id = ? AND status = 'pending'",
            (invite_id,),
        ).fetchone()
        if not invite or invite["email"] != email:
            raise ValueError("Invite not found")
        existing = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (invite["team_id"], user_id),
        ).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
                (invite["team_id"], user_id, "member", _now()),
            )
        conn.execute(
            "UPDATE team_invites SET status = 'accepted' WHERE id = ?",
            (invite_id,),
        )
        conn.commit()
        team = conn.execute("SELECT id, name FROM teams WHERE id = ?", (invite["team_id"],)).fetchone()
    from backend.services import folders_service

    folders_service.grant_pending_folder_shares(user_id, email, invite["team_id"])
    return {"status": "accepted", "team": dict(team)}


def decline_team_invite(invite_id: str, email: str) -> dict[str, Any]:
    email = email.strip().lower()
    with get_conn() as conn:
        invite = conn.execute(
            "SELECT id FROM team_invites WHERE id = ? AND email = ? AND status = 'pending'",
            (invite_id, email),
        ).fetchone()
        if not invite:
            raise ValueError("Invite not found")
        conn.execute("UPDATE team_invites SET status = 'declined' WHERE id = ?", (invite_id,))
        conn.commit()
    return {"status": "declined"}


def list_users(query: str = "", limit: int = 50) -> list[dict[str, Any]]:
    q = f"%{query.strip().lower()}%"
    with get_conn() as conn:
        if query.strip():
            rows = conn.execute(
                """
                SELECT id, email, display_name FROM users
                WHERE lower(email) LIKE ? OR lower(display_name) LIKE ?
                ORDER BY display_name LIMIT ?
                """,
                (q, q, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, email, display_name FROM users ORDER BY display_name LIMIT ?",
                (limit,),
            ).fetchall()
    return [dict(r) for r in rows]


def migrate_orphan_projects(projects_root: Path) -> int:
    """Assign on-disk projects without DB rows to the first team."""
    if not projects_root.is_dir():
        return 0
    with get_conn() as conn:
        team = conn.execute(
            "SELECT id, created_by FROM teams ORDER BY created_at LIMIT 1"
        ).fetchone()
        if not team:
            return 0
        registered = {
            r["project_id"]
            for r in conn.execute("SELECT project_id FROM project_access").fetchall()
        }
        count = 0
        now = _now()
        for d in sorted(projects_root.iterdir()):
            if not d.is_dir() or d.name in registered or d.name.startswith("."):
                continue
            conn.execute(
                """
                INSERT INTO project_access (project_id, team_id, created_by, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (d.name, team["id"], team["created_by"], now),
            )
            count += 1
        if count:
            conn.commit()
    return count


def register_project_access(project_id: str, team_id: str, user_id: str) -> None:
    _require_team_member(team_id, user_id)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO project_access (project_id, team_id, created_by, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (project_id, team_id, user_id, _now()),
        )
        conn.commit()


def user_project_access(user_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if team_id:
            rows = conn.execute(
                """
                SELECT pa.project_id, pa.team_id, pa.folder_id
                FROM project_access pa
                JOIN team_members tm ON tm.team_id = pa.team_id
                WHERE tm.user_id = ? AND pa.team_id = ?
                ORDER BY pa.created_at DESC
                """,
                (user_id, team_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT pa.project_id, pa.team_id, pa.folder_id
                FROM project_access pa
                JOIN team_members tm ON tm.team_id = pa.team_id
                WHERE tm.user_id = ?
                ORDER BY pa.created_at DESC
                """,
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def user_project_ids(user_id: str) -> list[str]:
    return [r["project_id"] for r in user_project_access(user_id)]


def can_access_project(user_id: str, project_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM project_access pa
            JOIN team_members tm ON tm.team_id = pa.team_id
            WHERE pa.project_id = ? AND tm.user_id = ?
            """,
            (project_id, user_id),
        ).fetchone()
    return row is not None


def delete_project_access(project_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM project_access WHERE project_id = ?", (project_id,))
        conn.commit()


def team_project_ids(team_id: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT project_id FROM project_access WHERE team_id = ?",
            (team_id,),
        ).fetchall()
    return [r["project_id"] for r in rows]


def project_team_id(project_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT team_id FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
    return row["team_id"] if row else None
