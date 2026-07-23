"""Per-user project shares (bookmark + ACL overlay) and email invites."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services.teams_service import _require_team_member


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _invite_token() -> str:
    return secrets.token_urlsafe(24)


def _project_access_row(project_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT pa.project_id, pa.team_id, pa.folder_id, pa.sort_order,
                   pa.created_by, pa.created_at,
                   u.email AS owner_email, u.display_name AS owner_name
            FROM project_access pa
            LEFT JOIN users u ON u.id = pa.created_by
            WHERE pa.project_id = ?
            """,
            (project_id,),
        ).fetchone()
    return dict(row) if row else None


def _can_manage_shares(access: dict[str, Any], user_id: str) -> bool:
    if access.get("created_by") == user_id:
        return True
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT role FROM team_members
            WHERE team_id = ? AND user_id = ?
            """,
            (access["team_id"], user_id),
        ).fetchone()
    return bool(row and row["role"] in {"owner", "admin"})


def _require_manage(project_id: str, user_id: str) -> dict[str, Any]:
    access = _project_access_row(project_id)
    if not access:
        raise ValueError("Project not found")
    _require_team_member(access["team_id"], user_id)
    if not _can_manage_shares(access, user_id):
        raise PermissionError("Only the project owner or a workspace admin can share this project")
    return access


def _ensure_invite_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS project_share_invites (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            email TEXT NOT NULL,
            invited_by TEXT NOT NULL,
            invite_token TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            FOREIGN KEY (invited_by) REFERENCES users(id)
        )
        """
    )


def _grant_share(conn, project_id: str, user_id: str, shared_by: str) -> None:
    conn.execute(
        """
        INSERT INTO project_shares (project_id, user_id, shared_by, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, user_id) DO NOTHING
        """,
        (project_id, user_id, shared_by, _now()),
    )
    conn.execute(
        "DELETE FROM project_hidden WHERE project_id = ? AND user_id = ?",
        (project_id, user_id),
    )


def is_shared_with(project_id: str, user_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM project_shares WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
    return bool(row)


def is_hidden_for(project_id: str, user_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM project_hidden WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
    return bool(row)


def shared_project_ids_for_user(user_id: str) -> set[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT project_id FROM project_shares WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    return {str(r["project_id"]) for r in rows}


def hidden_project_ids_for_user(user_id: str) -> set[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT project_id FROM project_hidden WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    return {str(r["project_id"]) for r in rows}


def share_counts_for_projects(project_ids: list[str]) -> dict[str, int]:
    if not project_ids:
        return {}
    placeholders = ",".join("?" for _ in project_ids)
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT project_id, COUNT(*) AS n
            FROM project_shares
            WHERE project_id IN ({placeholders})
            GROUP BY project_id
            """,
            tuple(project_ids),
        ).fetchall()
    return {str(r["project_id"]): int(r["n"] or 0) for r in rows}


def list_project_shares(project_id: str, user_id: str) -> dict[str, Any]:
    access = _require_manage(project_id, user_id)
    with get_conn() as conn:
        _ensure_invite_table(conn)
        rows = conn.execute(
            """
            SELECT ps.user_id, ps.shared_by, ps.created_at,
                   u.email, u.display_name
            FROM project_shares ps
            JOIN users u ON u.id = ps.user_id
            WHERE ps.project_id = ?
            ORDER BY ps.created_at
            """,
            (project_id,),
        ).fetchall()
        pending = conn.execute(
            """
            SELECT id, email, invited_by, invite_token, created_at, status
            FROM project_share_invites
            WHERE project_id = ? AND status = 'pending'
            ORDER BY created_at
            """,
            (project_id,),
        ).fetchall()
    return {
        "project_id": project_id,
        "team_id": access["team_id"],
        "shares": [dict(r) for r in rows],
        "pending": [dict(r) for r in pending],
    }


def share_project(project_id: str, email: str, sharer_id: str) -> dict[str, Any]:
    """Share a linked live project.

    Workspace members get access immediately. Anyone else gets an email invite;
    on accept the same project appears in their files with a Shared tag (not a copy).
    """
    access = _require_manage(project_id, sharer_id)
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        raise ValueError("Email is required")

    with get_conn() as conn:
        _ensure_invite_table(conn)
        target = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
        if target and target["id"] == sharer_id:
            raise ValueError("You already own this project")

        already = None
        if target:
            already = conn.execute(
                "SELECT 1 FROM project_shares WHERE project_id = ? AND user_id = ?",
                (project_id, target["id"]),
            ).fetchone()
        if already:
            return {
                "status": "shared",
                "message": f"Already shared with {target['display_name'] or email}",
                "user": dict(target),
                "project_id": project_id,
                "team_id": access["team_id"],
            }

        member = None
        if target:
            member = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
                (access["team_id"], target["id"]),
            ).fetchone()

        # Same-workspace teammates: share immediately (linked project).
        if target and member:
            _grant_share(conn, project_id, target["id"], sharer_id)
            conn.commit()
            return {
                "status": "shared",
                "message": f"Shared with {target['display_name'] or email}",
                "user": dict(target),
                "project_id": project_id,
                "team_id": access["team_id"],
            }

        # Outside workspace (or no account yet): pending invite until they accept.
        existing_inv = conn.execute(
            """
            SELECT id, invite_token FROM project_share_invites
            WHERE project_id = ? AND lower(email) = ? AND status = 'pending'
            """,
            (project_id, email),
        ).fetchone()
        if existing_inv:
            token = existing_inv["invite_token"]
            invite_id = existing_inv["id"]
        else:
            invite_id = str(uuid.uuid4())[:12]
            token = _invite_token()
            conn.execute(
                """
                INSERT INTO project_share_invites
                  (id, project_id, email, invited_by, invite_token, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', ?)
                """,
                (invite_id, project_id, email, sharer_id, token, _now()),
            )
            conn.commit()

        label = (target["display_name"] if target else None) or email
        return {
            "status": "invited",
            "message": f"Invite sent to {label}. They will see this project in their files after they accept.",
            "email": email,
            "invite_id": invite_id,
            "invite_token": token,
            "user": dict(target) if target else None,
            "project_id": project_id,
            "team_id": access["team_id"],
            "target_user_id": target["id"] if target else None,
        }


def cancel_project_share_invite(project_id: str, invite_id: str, sharer_id: str) -> dict[str, Any]:
    access = _require_manage(project_id, sharer_id)
    with get_conn() as conn:
        _ensure_invite_table(conn)
        conn.execute(
            """
            UPDATE project_share_invites
               SET status = 'cancelled'
             WHERE id = ? AND project_id = ? AND status = 'pending'
            """,
            (invite_id, project_id),
        )
        conn.commit()
    return {"status": "cancelled", "invite_id": invite_id, "team_id": access["team_id"]}


def accept_project_share_invite(token: str, user: dict[str, Any]) -> dict[str, Any]:
    token = (token or "").strip()
    if not token:
        raise ValueError("Invite token required")
    user_id = user["id"]
    user_email = str(user.get("email") or "").strip().lower()
    with get_conn() as conn:
        _ensure_invite_table(conn)
        row = conn.execute(
            """
            SELECT id, project_id, email, invited_by, status
            FROM project_share_invites
            WHERE invite_token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            raise ValueError("Invite not found")
        if row["status"] != "pending":
            raise ValueError("This invite is no longer pending")
        invite_email = str(row["email"] or "").strip().lower()
        if user_email and invite_email and user_email != invite_email:
            raise PermissionError(
                f"Sign in as {invite_email} to accept this project share."
            )
        _grant_share(conn, row["project_id"], user_id, row["invited_by"])
        conn.execute(
            "UPDATE project_share_invites SET status = 'accepted' WHERE id = ?",
            (row["id"],),
        )
        conn.commit()
        access = conn.execute(
            "SELECT team_id FROM project_access WHERE project_id = ?",
            (row["project_id"],),
        ).fetchone()
    return {
        "status": "accepted",
        "project_id": row["project_id"],
        "team_id": access["team_id"] if access else None,
        "shared_with_me": True,
    }


def accept_pending_project_shares_for_user(user_id: str, email: str) -> list[dict[str, Any]]:
    """Auto-claim pending project share invites after signup/login."""
    email = (email or "").strip().lower()
    if not user_id or not email:
        return []
    accepted: list[dict[str, Any]] = []
    with get_conn() as conn:
        _ensure_invite_table(conn)
        rows = conn.execute(
            """
            SELECT id, project_id, invited_by
            FROM project_share_invites
            WHERE lower(email) = ? AND status = 'pending'
            ORDER BY created_at
            """,
            (email,),
        ).fetchall()
        for row in rows:
            _grant_share(conn, row["project_id"], user_id, row["invited_by"])
            conn.execute(
                "UPDATE project_share_invites SET status = 'accepted' WHERE id = ?",
                (row["id"],),
            )
            accepted.append({"id": row["id"], "project_id": row["project_id"]})
        if accepted:
            conn.commit()
    return accepted


def pending_project_shares_for_user(user_id: str, email: str) -> list[dict[str, Any]]:
    email = (email or "").strip().lower()
    if not email:
        return []
    with get_conn() as conn:
        _ensure_invite_table(conn)
        rows = conn.execute(
            """
            SELECT psi.id, psi.project_id, psi.email, psi.invite_token, psi.created_at,
                   psi.invited_by, u.display_name AS invited_by_name, u.email AS invited_by_email,
                   pa.team_id
            FROM project_share_invites psi
            LEFT JOIN users u ON u.id = psi.invited_by
            LEFT JOIN project_access pa ON pa.project_id = psi.project_id
            WHERE lower(psi.email) = ? AND psi.status = 'pending'
            ORDER BY psi.created_at DESC
            """,
            (email,),
        ).fetchall()
    return [dict(r) for r in rows]


def remove_project_share(project_id: str, target_user_id: str, sharer_id: str) -> dict[str, Any]:
    access = _require_manage(project_id, sharer_id)
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM project_shares WHERE project_id = ? AND user_id = ?",
            (project_id, target_user_id),
        )
        conn.commit()
    return {
        "status": "removed",
        "user_id": target_user_id,
        "project_id": project_id,
        "team_id": access["team_id"],
    }


def leave_project_share(project_id: str, user_id: str) -> dict[str, Any]:
    """Recipient removes the shared project from their files list."""
    access = _project_access_row(project_id)
    if not access:
        raise ValueError("Project not found")
    with get_conn() as conn:
        share = conn.execute(
            "SELECT 1 FROM project_shares WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
        if not share:
            raise ValueError("This project is not shared with you")
        conn.execute(
            "DELETE FROM project_shares WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        )
        conn.execute(
            """
            INSERT INTO project_hidden (project_id, user_id, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(project_id, user_id) DO NOTHING
            """,
            (project_id, user_id, _now()),
        )
        conn.commit()
    return {
        "status": "left",
        "project_id": project_id,
        "team_id": access["team_id"],
    }


def shared_access_rows_for_user(user_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    """Project access rows for shares that may not already appear in team listing."""
    with get_conn() as conn:
        if team_id:
            rows = conn.execute(
                """
                SELECT pa.project_id, pa.team_id, pa.folder_id, pa.sort_order,
                       pa.created_by, u.email AS owner_email, u.display_name AS owner_name,
                       ps.created_at AS shared_at
                FROM project_shares ps
                JOIN project_access pa ON pa.project_id = ps.project_id
                LEFT JOIN users u ON u.id = pa.created_by
                WHERE ps.user_id = ? AND pa.team_id = ?
                ORDER BY ps.created_at DESC
                """,
                (user_id, team_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT pa.project_id, pa.team_id, pa.folder_id, pa.sort_order,
                       pa.created_by, u.email AS owner_email, u.display_name AS owner_name,
                       ps.created_at AS shared_at
                FROM project_shares ps
                JOIN project_access pa ON pa.project_id = ps.project_id
                LEFT JOIN users u ON u.id = pa.created_by
                WHERE ps.user_id = ?
                ORDER BY ps.created_at DESC
                """,
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]
