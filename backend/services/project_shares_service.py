"""Per-user project shares within a team (bookmark + ACL overlay)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services.teams_service import _require_team_member


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    return {
        "project_id": project_id,
        "team_id": access["team_id"],
        "shares": [dict(r) for r in rows],
    }


def share_project(project_id: str, email: str, sharer_id: str) -> dict[str, Any]:
    access = _require_manage(project_id, sharer_id)
    email = (email or "").strip().lower()
    if not email:
        raise ValueError("Email is required")

    with get_conn() as conn:
        target = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
        if not target:
            raise ValueError(f"No account found for {email}")
        if target["id"] == sharer_id:
            raise ValueError("You already own this project")
        member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (access["team_id"], target["id"]),
        ).fetchone()
        if not member:
            raise ValueError(
                f"{target['display_name'] or email} is not on this workspace. "
                "Invite them to the workspace first, then share the project."
            )
        conn.execute(
            """
            INSERT INTO project_shares (project_id, user_id, shared_by, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(project_id, user_id) DO NOTHING
            """,
            (project_id, target["id"], sharer_id, _now()),
        )
        # Re-sharing clears a prior "remove from my folder" hide.
        conn.execute(
            "DELETE FROM project_hidden WHERE project_id = ? AND user_id = ?",
            (project_id, target["id"]),
        )
        conn.commit()

    return {
        "status": "shared",
        "message": f"Shared with {target['display_name'] or email}",
        "user": dict(target),
        "project_id": project_id,
        "team_id": access["team_id"],
    }


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
        # Hide from their explorer even if they still have team-wide access.
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
