"""Workspace folders for organizing projects within a team."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services.teams_service import _require_team_member, invite_user_to_team


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_folder(folder_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM workspace_folders WHERE id = ?", (folder_id,)).fetchone()
    if not row:
        raise ValueError("Folder not found")
    return dict(row)


def user_can_access_folder(folder_id: str, user_id: str) -> bool:
    try:
        folder = _get_folder(folder_id)
    except ValueError:
        return False
    if folder.get("visibility", "workspace") == "workspace":
        try:
            _require_team_member(folder["team_id"], user_id)
            return True
        except PermissionError:
            return False
    if folder.get("created_by") == user_id:
        return True
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM folder_shares WHERE folder_id = ? AND user_id = ?",
            (folder_id, user_id),
        ).fetchone()
    return bool(row)


def can_manage_folder(folder: dict[str, Any], user_id: str) -> bool:
    try:
        _require_team_member(folder["team_id"], user_id)
    except PermissionError:
        return False
    owner = folder.get("created_by")
    return not owner or owner == user_id


def _require_folder_manage(folder_id: str, user_id: str) -> dict[str, Any]:
    folder = _get_folder(folder_id)
    if not can_manage_folder(folder, user_id):
        raise PermissionError("Only the folder owner can do this")
    return folder


def list_folders(team_id: str, user_id: str) -> list[dict[str, Any]]:
    _require_team_member(team_id, user_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT f.id, f.team_id, f.parent_id, f.name, f.sort_order, f.visibility,
                   f.created_by, f.created_at,
                   (SELECT COUNT(*) FROM project_access pa WHERE pa.folder_id = f.id) AS project_count,
                   (SELECT COUNT(*) FROM folder_shares fs WHERE fs.folder_id = f.id) AS share_count
            FROM workspace_folders f
            WHERE f.team_id = ?
              AND (
                f.visibility = 'workspace'
                OR f.created_by = ?
                OR EXISTS (SELECT 1 FROM folder_shares fs WHERE fs.folder_id = f.id AND fs.user_id = ?)
              )
            ORDER BY f.sort_order, f.name
            """,
            (team_id, user_id, user_id),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["can_manage"] = can_manage_folder(d, user_id)
        d["is_owner"] = d["can_manage"]
        d["shared_with_me"] = bool(d.get("created_by")) and d.get("created_by") != user_id
        out.append(d)
    return out


def create_folder(
    team_id: str,
    name: str,
    user_id: str,
    *,
    parent_id: str | None = None,
) -> dict[str, Any]:
    _require_team_member(team_id, user_id)
    name = name.strip()
    if not name:
        raise ValueError("Folder name cannot be empty")
    if len(name) > 120:
        raise ValueError("Folder name must be 120 characters or fewer")

    folder_id = str(uuid.uuid4())[:8]
    now = _now()
    with get_conn() as conn:
        if parent_id:
            parent = conn.execute(
                "SELECT team_id FROM workspace_folders WHERE id = ?",
                (parent_id,),
            ).fetchone()
            if not parent or parent["team_id"] != team_id:
                raise ValueError("Parent folder not found in this workspace")
        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM workspace_folders WHERE team_id = ?",
            (team_id,),
        ).fetchone()
        sort_order = int(row["n"])
        conn.execute(
            """
            INSERT INTO workspace_folders (id, team_id, parent_id, name, sort_order, visibility, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, 'workspace', ?, ?)
            """,
            (folder_id, team_id, parent_id, name, sort_order, user_id, now),
        )
        conn.commit()
    return {
        "id": folder_id,
        "team_id": team_id,
        "parent_id": parent_id,
        "name": name,
        "sort_order": sort_order,
        "visibility": "workspace",
        "created_by": user_id,
        "created_at": now,
        "project_count": 0,
        "share_count": 0,
        "is_owner": True,
    }


def rename_folder(folder_id: str, name: str, user_id: str) -> dict[str, Any]:
    folder = _require_folder_manage(folder_id, user_id)
    name = name.strip()
    if not name:
        raise ValueError("Folder name cannot be empty")
    with get_conn() as conn:
        conn.execute("UPDATE workspace_folders SET name = ? WHERE id = ?", (name, folder_id))
        conn.commit()
    folder["name"] = name
    return folder


def delete_folder(folder_id: str, user_id: str) -> dict[str, Any]:
    folder = _require_folder_manage(folder_id, user_id)
    with get_conn() as conn:
        conn.execute("UPDATE project_access SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
        conn.execute("DELETE FROM workspace_folders WHERE id = ?", (folder_id,))
        conn.commit()
    return folder


def folder_name(folder_id: str | None) -> str:
    if not folder_id:
        return "Unfiled"
    try:
        return _get_folder(folder_id)["name"]
    except ValueError:
        return "Unfiled"


def _folder_project_ids(conn: sqlite3.Connection, team_id: str, folder_id: str | None) -> list[str]:
    if folder_id:
        rows = conn.execute(
            """
            SELECT project_id FROM project_access
            WHERE team_id = ? AND folder_id = ?
            ORDER BY sort_order ASC, created_at DESC, project_id ASC
            """,
            (team_id, folder_id),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT project_id FROM project_access
            WHERE team_id = ? AND folder_id IS NULL
            ORDER BY sort_order ASC, created_at DESC, project_id ASC
            """,
            (team_id,),
        ).fetchall()
    return [str(r["project_id"]) for r in rows]


def _renumber_folder_projects(
    conn: sqlite3.Connection,
    team_id: str,
    folder_id: str | None,
    ordered_ids: list[str],
) -> None:
    for index, pid in enumerate(ordered_ids):
        if folder_id:
            conn.execute(
                """
                UPDATE project_access
                SET folder_id = ?, sort_order = ?
                WHERE project_id = ? AND team_id = ?
                """,
                (folder_id, index, pid, team_id),
            )
        else:
            conn.execute(
                """
                UPDATE project_access
                SET folder_id = NULL, sort_order = ?
                WHERE project_id = ? AND team_id = ?
                """,
                (index, pid, team_id),
            )


def set_project_folder(
    project_id: str,
    folder_id: str | None,
    user_id: str,
    before_project_id: str | None = None,
    *,
    at_end: bool = False,
) -> dict[str, Any]:
    from backend.services.teams_service import can_access_project, project_team_id

    if not can_access_project(user_id, project_id):
        raise PermissionError("Cannot access this project")
    team_id = project_team_id(project_id)
    if not team_id:
        raise ValueError("Project has no workspace")
    _require_team_member(team_id, user_id)

    if folder_id:
        folder = _get_folder(folder_id)
        if folder["team_id"] != team_id:
            raise ValueError("Folder belongs to a different workspace")
        if not user_can_access_folder(folder_id, user_id):
            raise PermissionError("You do not have access to this folder")

    with get_conn() as conn:
        current = conn.execute(
            "SELECT folder_id, sort_order FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        if not current:
            raise ValueError("Project not found in workspace")

        same_folder = (current["folder_id"] or None) == (folder_id or None)
        ordered = [pid for pid in _folder_project_ids(conn, team_id, folder_id) if pid != project_id]
        if before_project_id:
            if before_project_id == project_id:
                raise ValueError("Cannot place a project before itself")
            if before_project_id not in ordered:
                raise ValueError("Anchor project is not in the target folder")
            ordered.insert(ordered.index(before_project_id), project_id)
        elif at_end:
            ordered.append(project_id)
        elif same_folder:
            # Preserve existing order when only folder_id is patched with no position.
            ordered = _folder_project_ids(conn, team_id, folder_id)
            if project_id not in ordered:
                ordered.insert(0, project_id)
        else:
            # Cross-folder moves land at the top of the destination.
            ordered.insert(0, project_id)

        _renumber_folder_projects(conn, team_id, folder_id, ordered)
        conn.commit()

    return {
        "project_id": project_id,
        "folder_id": folder_id,
        "team_id": team_id,
        "folder_name": folder_name(folder_id),
        "sort_order": ordered.index(project_id) if project_id in ordered else 0,
    }


def list_folder_shares(folder_id: str, user_id: str) -> list[dict[str, Any]]:
    folder = _require_folder_manage(folder_id, user_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT fs.user_id, fs.shared_by, fs.created_at,
                   u.email, u.display_name
            FROM folder_shares fs
            JOIN users u ON u.id = fs.user_id
            WHERE fs.folder_id = ?
            ORDER BY fs.created_at
            """,
            (folder_id,),
        ).fetchall()
        pending = conn.execute(
            """
            SELECT id, email, created_at FROM folder_share_invites
            WHERE folder_id = ? AND status = 'pending'
            ORDER BY created_at
            """,
            (folder_id,),
        ).fetchall()
    members = [dict(r) for r in rows]
    for p in pending:
        members.append(
            {
                "pending": True,
                "invite_id": p["id"],
                "email": p["email"],
                "created_at": p["created_at"],
            }
        )
    return {"folder": folder, "shares": members}


def share_folder(
    folder_id: str,
    email: str,
    sharer_id: str,
    *,
    restrict_access: bool = True,
) -> dict[str, Any]:
    folder = _require_folder_manage(folder_id, sharer_id)
    email = email.strip().lower()
    if not email:
        raise ValueError("Email is required")

    with get_conn() as conn:
        target = conn.execute(
            "SELECT id, email, display_name FROM users WHERE email = ?", (email,)
        ).fetchone()

    if restrict_access:
        with get_conn() as conn:
            conn.execute(
                "UPDATE workspace_folders SET visibility = 'shared' WHERE id = ?",
                (folder_id,),
            )
            conn.commit()

    if not target:
        raise ValueError(f"No account found for {email}")

    target_id = target["id"]
    if target_id == sharer_id:
        raise ValueError("You already own this folder")

    with get_conn() as conn:
        member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (folder["team_id"], target_id),
        ).fetchone()

    if not member:
        invite_result = invite_user_to_team(folder["team_id"], email, sharer_id)
        with get_conn() as conn:
            existing_inv = conn.execute(
                """
                SELECT id FROM folder_share_invites
                WHERE folder_id = ? AND email = ? AND status = 'pending'
                """,
                (folder_id, email),
            ).fetchone()
            if not existing_inv:
                conn.execute(
                    """
                    INSERT INTO folder_share_invites (id, folder_id, email, invited_by, status, created_at)
                    VALUES (?, ?, ?, ?, 'pending', ?)
                    """,
                    (str(uuid.uuid4())[:8], folder_id, email, sharer_id, _now()),
                )
                conn.commit()
        return {
            "status": "workspace_invited",
            "message": f"Invited {email} to the workspace — they will get folder access when they join.",
            "team_invite": invite_result,
            "folder_id": folder_id,
        }

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO folder_shares (folder_id, user_id, shared_by, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(folder_id, user_id) DO NOTHING
            """,
            (folder_id, target_id, sharer_id, _now()),
        )
        conn.commit()

    return {
        "status": "shared",
        "message": f"Shared with {target['display_name']}",
        "user": dict(target),
        "folder_id": folder_id,
    }


def remove_folder_share(folder_id: str, target_user_id: str, sharer_id: str) -> dict[str, Any]:
    _require_folder_manage(folder_id, sharer_id)
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM folder_shares WHERE folder_id = ? AND user_id = ?",
            (folder_id, target_user_id),
        )
        conn.commit()
    return {"status": "removed", "user_id": target_user_id}


def grant_pending_folder_shares(user_id: str, email: str, team_id: str) -> int:
    """Grant folder access from pending invites after workspace join."""
    email = email.strip().lower()
    count = 0
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT fi.id, fi.folder_id
            FROM folder_share_invites fi
            JOIN workspace_folders f ON f.id = fi.folder_id
            WHERE fi.email = ? AND fi.status = 'pending' AND f.team_id = ?
            """,
            (email, team_id),
        ).fetchall()
        now = _now()
        for row in rows:
            inv = conn.execute(
                "SELECT invited_by FROM folder_share_invites WHERE id = ?", (row["id"],)
            ).fetchone()
            shared_by = inv["invited_by"] if inv else user_id
            conn.execute(
                """
                INSERT INTO folder_shares (folder_id, user_id, shared_by, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(folder_id, user_id) DO NOTHING
                """,
                (row["folder_id"], user_id, shared_by, now),
            )
            conn.execute(
                "UPDATE folder_share_invites SET status = 'accepted' WHERE id = ?",
                (row["id"],),
            )
            count += 1
        if count:
            conn.commit()
    return count
