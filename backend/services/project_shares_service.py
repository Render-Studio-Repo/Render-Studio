"""Per-user project shares (bookmark + ACL overlay) and email invites."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

import sqlite3

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


_EDITOR_ROLES = {
    "editor",
    "edit",
    "remix_and_edit",
    "remix-and-edit",
    "view_edit_remix",
    "view_and_edit_remix",
    "view_and_remix_and_edit",
}
_REMIXER_ROLES = {"remixer", "remix", "view_and_remix", "view-and-remix", "remix_only", "remix-only"}


def _normalize_share_role(role: str | None) -> str:
    """Map UI labels onto stored roles: viewer, remixer, editor."""
    value = str(role or "viewer").strip().lower().replace(" ", "_").replace("-", "_")
    if value in _EDITOR_ROLES:
        return "editor"
    if value in _REMIXER_ROLES:
        return "remixer"
    return "viewer"


def share_role_can_edit(role: str | None) -> bool:
    return _normalize_share_role(role) == "editor"


def share_role_can_remix(role: str | None) -> bool:
    return _normalize_share_role(role) in {"remixer", "editor"}


def share_role_for_user(project_id: str, user_id: str) -> str:
    """Stored share role for a collaborator, or viewer if they are not on the share list."""
    pid = str(project_id or "").strip()
    uid = str(user_id or "").strip()
    if not pid or not uid:
        return "viewer"
    with get_conn() as conn:
        _ensure_share_role_column(conn)
        try:
            row = conn.execute(
                "SELECT role FROM project_shares WHERE project_id = ? AND user_id = ?",
                (pid, uid),
            ).fetchone()
        except sqlite3.OperationalError:
            return "viewer"
    if not row:
        return "viewer"
    try:
        return _normalize_share_role(row["role"] if "role" in row.keys() else "editor")
    except (KeyError, IndexError, TypeError):
        return "viewer"


def share_target_from_user_id(user_id: str) -> str:
    """Resolve a signed-in room user to the email/handle share_project expects."""
    uid = str(user_id or "").strip()
    if not uid:
        raise ValueError("User is required")
    with get_conn() as conn:
        try:
            row = conn.execute(
                "SELECT email, handle FROM users WHERE id = ?",
                (uid,),
            ).fetchone()
        except sqlite3.OperationalError:
            row = conn.execute(
                "SELECT email FROM users WHERE id = ?",
                (uid,),
            ).fetchone()
    if not row:
        raise ValueError("User not found")
    email = str(row["email"] or "").strip()
    if email and "@" in email:
        return email
    handle = ""
    try:
        handle = str(row["handle"] or "").strip()
    except (KeyError, IndexError, TypeError):
        handle = ""
    if handle:
        return f"@{handle}"
    raise ValueError("That person has no email on file")


def _ensure_share_role_column(conn) -> None:
    try:
        conn.execute("ALTER TABLE project_shares ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'")
    except sqlite3.OperationalError:
        pass


def _ensure_invite_role_column(conn) -> None:
    _ensure_invite_table(conn)
    try:
        conn.execute("ALTER TABLE project_share_invites ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'")
    except sqlite3.OperationalError:
        pass


def _ensure_join_links_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS project_join_links (
            token TEXT PRIMARY KEY,
            project_id TEXT NOT NULL UNIQUE,
            created_by TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            enabled INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )


def _grant_share(conn, project_id: str, user_id: str, shared_by: str, role: str = "editor") -> None:
    _ensure_share_role_column(conn)
    conn.execute(
        """
        INSERT INTO project_shares (project_id, user_id, shared_by, created_at, role)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role
        """,
        (project_id, user_id, shared_by, _now(), _normalize_share_role(role)),
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
        _ensure_share_role_column(conn)
        _ensure_invite_role_column(conn)
        try:
            rows = conn.execute(
                """
                SELECT ps.user_id, ps.shared_by, ps.created_at, ps.role,
                       u.email, u.display_name, u.handle
                FROM project_shares ps
                JOIN users u ON u.id = ps.user_id
                WHERE ps.project_id = ?
                ORDER BY ps.created_at DESC
                """,
                (project_id,),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = conn.execute(
                """
                SELECT ps.user_id, ps.shared_by, ps.created_at, ps.role,
                       u.email, u.display_name
                FROM project_shares ps
                JOIN users u ON u.id = ps.user_id
                WHERE ps.project_id = ?
                ORDER BY ps.created_at DESC
                """,
                (project_id,),
            ).fetchall()
        try:
            pending = conn.execute(
                """
                SELECT id, email, invited_by, invite_token, created_at, status, role
                FROM project_share_invites
                WHERE project_id = ? AND status = 'pending'
                ORDER BY created_at DESC
                """,
                (project_id,),
            ).fetchall()
        except sqlite3.OperationalError:
            pending = conn.execute(
                """
                SELECT id, email, invited_by, invite_token, created_at, status
                FROM project_share_invites
                WHERE project_id = ? AND status = 'pending'
                ORDER BY created_at DESC
                """,
                (project_id,),
            ).fetchall()
    shares = []
    for row in rows:
        item = dict(row)
        item["role"] = _normalize_share_role(item.get("role"))
        shares.append(item)
    pending_out = []
    for row in pending:
        item = dict(row)
        item["role"] = _normalize_share_role(item.get("role"))
        pending_out.append(item)
    return {
        "project_id": project_id,
        "team_id": access["team_id"],
        "shares": shares,
        "pending": pending_out,
    }


def _resolve_share_target(conn, raw: str) -> tuple[str, Any]:
    """Resolve email or @handle to a lowercase email and optional user row."""
    value = (raw or "").strip()
    if not value:
        raise ValueError("Email or @handle is required")
    handle = value.lstrip("@").strip()
    looks_email = "@" in value and "." in value.split("@")[-1] and " " not in value and not value.startswith("@")
    target = None
    email = value.lower() if looks_email else ""
    if looks_email:
        try:
            target = conn.execute(
                "SELECT id, email, display_name, handle FROM users WHERE lower(email) = ?",
                (email,),
            ).fetchone()
        except sqlite3.OperationalError:
            target = conn.execute(
                "SELECT id, email, display_name FROM users WHERE lower(email) = ?",
                (email,),
            ).fetchone()
    if target is None and handle:
        try:
            target = conn.execute(
                "SELECT id, email, display_name, handle FROM users WHERE lower(COALESCE(handle,'')) = lower(?)",
                (handle,),
            ).fetchone()
        except sqlite3.OperationalError:
            target = None
        if target:
            email = str(target["email"] or "").strip().lower()
    if not email or "@" not in email:
        raise ValueError("Email or @handle is required")
    return email, target


def share_project(
    project_id: str,
    email: str,
    sharer_id: str,
    role: str | None = None,
) -> dict[str, Any]:
    """Share a linked live project.

    Workspace members get access immediately. Anyone else gets an email invite;
    on accept the same project appears in their files with a Shared tag (not a copy).
    """
    access = _require_manage(project_id, sharer_id)
    role_val = _normalize_share_role(role)

    with get_conn() as conn:
        _ensure_invite_table(conn)
        _ensure_invite_role_column(conn)
        _ensure_share_role_column(conn)
        try:
            email, target = _resolve_share_target(conn, email)
        except sqlite3.OperationalError:
            email = (email or "").strip().lower()
            if not email or "@" not in email:
                raise ValueError("Email is required") from None
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
            conn.execute(
                "UPDATE project_shares SET role = ? WHERE project_id = ? AND user_id = ?",
                (role_val, project_id, target["id"]),
            )
            conn.commit()
            return {
                "status": "shared",
                "message": f"Already shared with {target['display_name'] or email}",
                "user": dict(target),
                "project_id": project_id,
                "team_id": access["team_id"],
                "role": role_val,
            }

        # Always send a pending invite so the recipient can accept in chat.
        # (Workspace members used to get the project immediately with no ping.)
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
            try:
                conn.execute(
                    "UPDATE project_share_invites SET role = ? WHERE id = ?",
                    (role_val, invite_id),
                )
                conn.commit()
            except sqlite3.OperationalError:
                pass
        else:
            invite_id = str(uuid.uuid4())[:12]
            token = _invite_token()
            try:
                conn.execute(
                    """
                    INSERT INTO project_share_invites
                      (id, project_id, email, invited_by, invite_token, status, created_at, role)
                    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
                    """,
                    (invite_id, project_id, email, sharer_id, token, _now(), role_val),
                )
            except sqlite3.OperationalError:
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
            "message": f"Invite sent to {label}. They’ll get a chat ping to accept this project.",
            "email": email,
            "invite_id": invite_id,
            "invite_token": token,
            "user": dict(target) if target else None,
            "project_id": project_id,
            "project_name": _project_display_name(project_id),
            "team_id": access["team_id"],
            "target_user_id": target["id"] if target else None,
            "role": role_val,
        }


def set_project_share_role(
    project_id: str,
    target_user_id: str,
    actor_id: str,
    role: str | None,
) -> dict[str, Any]:
    access = _require_manage(project_id, actor_id)
    role_val = _normalize_share_role(role)
    with get_conn() as conn:
        _ensure_share_role_column(conn)
        cur = conn.execute(
            "UPDATE project_shares SET role = ? WHERE project_id = ? AND user_id = ?",
            (role_val, project_id, target_user_id),
        )
        if cur.rowcount == 0:
            raise ValueError("Share not found")
        conn.commit()
    return {
        "status": "ok",
        "project_id": project_id,
        "user_id": target_user_id,
        "role": role_val,
        "team_id": access["team_id"],
    }


def set_project_share_invite_role(
    project_id: str,
    invite_id: str,
    actor_id: str,
    role: str | None,
) -> dict[str, Any]:
    access = _require_manage(project_id, actor_id)
    role_val = _normalize_share_role(role)
    with get_conn() as conn:
        _ensure_invite_role_column(conn)
        cur = conn.execute(
            """
            UPDATE project_share_invites
               SET role = ?
             WHERE id = ? AND project_id = ? AND status = 'pending'
            """,
            (role_val, invite_id, project_id),
        )
        if cur.rowcount == 0:
            raise ValueError("Invite not found")
        conn.commit()
    return {
        "status": "ok",
        "invite_id": invite_id,
        "role": role_val,
        "team_id": access["team_id"],
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
        _ensure_invite_role_column(conn)
        try:
            row = conn.execute(
                """
                SELECT id, project_id, email, invited_by, status, role
                FROM project_share_invites
                WHERE invite_token = ?
                """,
                (token,),
            ).fetchone()
        except sqlite3.OperationalError:
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
        invite_role = _normalize_share_role(row["role"] if "role" in row.keys() else "editor")
        _grant_share(conn, row["project_id"], user_id, row["invited_by"], role=invite_role)
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


def decline_project_share_invite(token: str, user: dict[str, Any]) -> dict[str, Any]:
    token = (token or "").strip()
    if not token:
        raise ValueError("Invite token required")
    user_email = str(user.get("email") or "").strip().lower()
    with get_conn() as conn:
        _ensure_invite_table(conn)
        row = conn.execute(
            """
            SELECT id, project_id, email, status
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
                f"Sign in as {invite_email} to decline this project share."
            )
        conn.execute(
            "UPDATE project_share_invites SET status = 'declined' WHERE id = ?",
            (row["id"],),
        )
        conn.commit()
        access = conn.execute(
            "SELECT team_id FROM project_access WHERE project_id = ?",
            (row["project_id"],),
        ).fetchone()
    return {
        "status": "declined",
        "project_id": row["project_id"],
        "team_id": access["team_id"] if access else None,
    }


def accept_pending_project_shares_for_user(user_id: str, email: str) -> list[dict[str, Any]]:
    """Auto-claim pending project share invites after signup/login."""
    email = (email or "").strip().lower()
    if not user_id or not email:
        return []
    accepted: list[dict[str, Any]] = []
    with get_conn() as conn:
        _ensure_invite_table(conn)
        _ensure_invite_role_column(conn)
        try:
            rows = conn.execute(
                """
                SELECT id, project_id, invited_by, role
                FROM project_share_invites
                WHERE lower(email) = ? AND status = 'pending'
                ORDER BY created_at
                """,
                (email,),
            ).fetchall()
        except sqlite3.OperationalError:
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
            role_val = _normalize_share_role(row["role"] if "role" in row.keys() else "editor")
            _grant_share(conn, row["project_id"], user_id, row["invited_by"], role=role_val)
            conn.execute(
                "UPDATE project_share_invites SET status = 'accepted' WHERE id = ?",
                (row["id"],),
            )
            accepted.append({"id": row["id"], "project_id": row["project_id"]})
        if accepted:
            conn.commit()
    return accepted


def _project_display_name(project_id: str) -> str:
    try:
        from pathlib import Path

        from backend.config import settings
        from backend.services import project_store

        summary = project_store.project_list_summary(Path(settings.projects_dir) / project_id)
        name = str(summary.get("name") or "").strip()
        return name or project_id
    except Exception:
        return project_id


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
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["project_name"] = _project_display_name(item["project_id"])
        item["inviter_name"] = item.get("invited_by_name") or item.get("invited_by_email") or "A teammate"
        out.append(item)
    return out


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


def _join_link_row(row) -> dict[str, Any] | None:
    if not row:
        return None
    item = dict(row)
    item["enabled"] = bool(int(item.get("enabled") or 0))
    item["role"] = _normalize_share_role(item.get("role"))
    return item


def get_join_link_by_token(token: str) -> dict[str, Any] | None:
    token = str(token or "").strip()
    if not token:
        return None
    with get_conn() as conn:
        _ensure_join_links_table(conn)
        row = conn.execute(
            """
            SELECT token, project_id, created_by, role, enabled, created_at
            FROM project_join_links
            WHERE token = ?
            """,
            (token,),
        ).fetchone()
    return _join_link_row(row)


def get_project_join_link(project_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        _ensure_join_links_table(conn)
        row = conn.execute(
            """
            SELECT token, project_id, created_by, role, enabled, created_at
            FROM project_join_links
            WHERE project_id = ?
            """,
            (project_id,),
        ).fetchone()
    return _join_link_row(row)


def upsert_project_join_link(
    project_id: str,
    user_id: str,
    *,
    enabled: bool | None = None,
    role: str | None = None,
) -> dict[str, Any]:
    project_id = str(project_id or "").strip()
    user_id = str(user_id or "").strip()
    if not project_id or not user_id:
        raise ValueError("Project not found")
    with get_conn() as conn:
        _ensure_join_links_table(conn)
        row = conn.execute(
            """
            SELECT token, project_id, created_by, role, enabled, created_at
            FROM project_join_links
            WHERE project_id = ?
            """,
            (project_id,),
        ).fetchone()
        if not row:
            token = secrets.token_urlsafe(18)
            enabled_val = 0 if enabled is None else (1 if enabled else 0)
            role_val = _normalize_share_role(role)
            conn.execute(
                """
                INSERT INTO project_join_links
                  (token, project_id, created_by, role, enabled, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (token, project_id, user_id, role_val, enabled_val, _now()),
            )
        else:
            token = row["token"]
            enabled_val = int(row["enabled"] or 0) if enabled is None else (1 if enabled else 0)
            role_val = _normalize_share_role(role) if role is not None else _normalize_share_role(row["role"])
            conn.execute(
                """
                UPDATE project_join_links
                   SET enabled = ?, role = ?
                 WHERE project_id = ?
                """,
                (enabled_val, role_val, project_id),
            )
        conn.commit()
        row = conn.execute(
            """
            SELECT token, project_id, created_by, role, enabled, created_at
            FROM project_join_links
            WHERE project_id = ?
            """,
            (project_id,),
        ).fetchone()
    link = _join_link_row(row)
    if not link:
        raise ValueError("Could not save join link")
    return link


def join_project_via_link(token: str, user: dict[str, Any]) -> dict[str, Any]:
    token = str(token or "").strip()
    if not token:
        raise ValueError("Join link required")
    user_id = str(user.get("id") or "").strip()
    if not user_id:
        raise ValueError("Sign in to join this project")
    with get_conn() as conn:
        _ensure_join_links_table(conn)
        _ensure_share_role_column(conn)
        row = conn.execute(
            """
            SELECT token, project_id, created_by, role, enabled
            FROM project_join_links
            WHERE token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            raise ValueError("Join link not found")
        if not int(row["enabled"] or 0):
            raise ValueError("This join link is turned off")
        project_id = str(row["project_id"])
        role = _normalize_share_role(row["role"])
        access = conn.execute(
            """
            SELECT pa.project_id, pa.team_id, pa.created_by
            FROM project_access pa
            WHERE pa.project_id = ?
            """,
            (project_id,),
        ).fetchone()
        if not access:
            raise ValueError("Project not found")
        team_id = access["team_id"]
        if access["created_by"] == user_id:
            return {
                "status": "already_member",
                "project_id": project_id,
                "role": "owner",
                "team_id": team_id,
                "already_member": True,
            }
        team_member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (team_id, user_id),
        ).fetchone()
        if team_member:
            return {
                "status": "already_member",
                "project_id": project_id,
                "role": "member",
                "team_id": team_id,
                "already_member": True,
            }
        existing = conn.execute(
            "SELECT role FROM project_shares WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
        if existing:
            existing_role = _normalize_share_role(existing["role"] if "role" in existing.keys() else "editor")
            return {
                "status": "already_member",
                "project_id": project_id,
                "role": existing_role,
                "team_id": team_id,
                "already_member": True,
            }
        _grant_share(conn, project_id, user_id, row["created_by"], role=role)
        conn.commit()
    return {
        "status": "joined",
        "project_id": project_id,
        "role": role,
        "team_id": team_id,
        "already_member": False,
    }
