"""Teams, users, invites, and project access."""

from __future__ import annotations

import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.auth import hash_password, verify_password
from backend.database import get_conn

# Workspace access roles (platform site-admin is separate — email allowlist).
# owner = workspace admin (creator); manager = assigned; user = default member.
WORKSPACE_ROLES = ("owner", "manager", "user")
ROLE_ALIASES = {"member": "user", "admin": "owner"}
ASSIGNABLE_ROLES = ("manager", "user")
ACCESS_LEVELS = ("edit", "view")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_invite_token_column(conn) -> None:
    try:
        conn.execute("ALTER TABLE team_invites ADD COLUMN token TEXT")
    except sqlite3.OperationalError:
        pass


def _ensure_member_permission_columns(conn) -> None:
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN can_invite INTEGER NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN access TEXT NOT NULL DEFAULT 'edit'")
    except sqlite3.OperationalError:
        pass


def normalize_access(access: str | None) -> str:
    raw = str(access or "edit").strip().lower()
    if raw in {"view", "viewer", "read", "readonly", "read_only"}:
        return "view"
    return "edit"


def _invite_token() -> str:
    return secrets.token_urlsafe(24)


def normalize_role(role: str | None) -> str:
    raw = str(role or "user").strip().lower()
    mapped = ROLE_ALIASES.get(raw, raw)
    return mapped if mapped in WORKSPACE_ROLES else "user"


def display_role(role: str | None) -> str:
    return {
        "owner": "Admin",
        "manager": "Manager",
        "user": "User",
    }.get(normalize_role(role), "User")


def decorate_member_row(row: dict[str, Any] | Any) -> dict[str, Any]:
    data = dict(row) if not isinstance(row, dict) else dict(row)
    role = normalize_role(data.get("role"))
    access = normalize_access(data.get("access"))
    # Owners always have full invite + edit; ignore stale column values.
    if role == "owner":
        can_invite = True
        access = "edit"
    else:
        raw_invite = data.get("can_invite")
        if raw_invite is None and role == "manager":
            can_invite = True
        else:
            can_invite = bool(int(raw_invite or 0))
    data["role"] = role
    data["role_label"] = display_role(role)
    data["access"] = access
    data["access_label"] = "Can edit" if access == "edit" else "View only"
    data["can_invite"] = can_invite
    data["can_edit"] = access == "edit"
    return data


def get_member_role(team_id: str, user_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT role FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, user_id),
        ).fetchone()
    if not row:
        return None
    return normalize_role(row["role"])


def get_member_permissions(team_id: str, user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        row = conn.execute(
            """
            SELECT role, can_invite, access
            FROM team_members
            WHERE team_id=? AND user_id=?
            """,
            (team_id, user_id),
        ).fetchone()
    if not row:
        return None
    return decorate_member_row(row)


def can_manage_workspace(role: str | None) -> bool:
    return normalize_role(role) in {"owner", "manager"}


def member_can_invite(team_id: str, user_id: str) -> bool:
    perms = get_member_permissions(team_id, user_id)
    return bool(perms and perms.get("can_invite"))


def member_can_edit(team_id: str, user_id: str) -> bool:
    perms = get_member_permissions(team_id, user_id)
    return bool(perms and perms.get("can_edit"))


def can_edit_project(user_id: str, project_id: str) -> bool:
    """True when the user may mutate the project (generate/edit/upload), not just view."""
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        row = conn.execute(
            """
            SELECT tm.role, tm.can_invite, tm.access
            FROM project_access pa
            JOIN team_members tm ON tm.team_id = pa.team_id
            WHERE pa.project_id = ? AND tm.user_id = ?
            """,
            (project_id, user_id),
        ).fetchone()
        if row:
            return decorate_member_row(row).get("can_edit") is True
        shared = conn.execute(
            "SELECT 1 FROM project_shares WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
    return shared is not None


def create_user(email: str, password: str, display_name: str) -> dict[str, Any]:
    from backend.services.profile_service import ensure_unique_handle, slugify_handle

    email = email.strip().lower()
    display_name = display_name.strip() or email.split("@")[0]
    user_id = str(uuid.uuid4())[:12]
    team_id = str(uuid.uuid4())[:8]
    now = _now()
    joined_team_ids: list[str] = []
    with get_conn() as conn:
        try:
            handle = ensure_unique_handle(conn, slugify_handle(display_name or email.split("@")[0]))
            try:
                conn.execute(
                    "INSERT INTO users (id, email, display_name, password_hash, created_at, handle) VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, email, display_name, hash_password(password), now, handle),
                )
            except sqlite3.OperationalError:
                conn.execute(
                    "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, email, display_name, hash_password(password), now),
                )
                handle = None
            first_name = display_name.split()[0] if display_name.split() else display_name
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
                (team_id, f"{first_name}'s Workspace", user_id, now),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
                (team_id, user_id, "owner", now),
            )
            pending_invites = conn.execute(
                "SELECT id, team_id FROM team_invites WHERE lower(email)=lower(?) AND status='pending'",
                (email,),
            ).fetchall()
            for invite in pending_invites:
                existing = conn.execute(
                    "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
                    (invite["team_id"], user_id),
                ).fetchone()
                if not existing:
                    conn.execute(
                        "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'user', ?)",
                        (invite["team_id"], user_id, now),
                    )
                    joined_team_ids.append(invite["team_id"])
                conn.execute("UPDATE team_invites SET status='accepted' WHERE id=?", (invite["id"],))
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("Email already registered") from exc
    if joined_team_ids:
        from backend.services.user_ai_keys_service import deny_shared_keys_for_new_member

        for team_id in joined_team_ids:
            deny_shared_keys_for_new_member(team_id, user_id)
    out = {"id": user_id, "email": email, "display_name": display_name, "created_at": now}
    if handle:
        out["handle"] = handle
        out["profile_url"] = f"/u/{handle}"
    return out


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    email = email.strip().lower()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return None
    keys = row.keys()
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "handle": row["handle"] if "handle" in keys else None,
        "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
        "created_at": row["created_at"],
    }


def list_teams(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        rows = conn.execute(
            """
            SELECT t.id, t.name, t.created_by, t.created_at, tm.role,
                   tm.can_invite, tm.access,
                   t.render_folder_provider, t.render_folder_ref,
                   t.render_folder_label, t.render_folder_connected_at,
                   (SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_id = t.id) AS member_count
            FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.user_id = ?
            ORDER BY
              CASE WHEN t.created_by = ? AND tm.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
              t.created_at,
              lower(t.name)
            """,
            (user_id, user_id),
        ).fetchall()
    out = []
    for row in rows:
        item = decorate_member_row(row)
        # Keep team fields on the payload (decorate focuses on member flags).
        item.update(
            {
                "id": row["id"],
                "name": row["name"],
                "created_by": row["created_by"],
                "created_at": row["created_at"],
                "member_count": row["member_count"],
                "render_folder_provider": row["render_folder_provider"],
                "render_folder_ref": row["render_folder_ref"],
                "render_folder_label": row["render_folder_label"],
                "render_folder_connected_at": row["render_folder_connected_at"],
            }
        )
        out.append(item)
    return out


def list_team_members(team_id: str, user_id: str) -> list[dict[str, Any]]:
    _require_team_member(team_id, user_id)
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        rows = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.avatar_url, tm.role, tm.joined_at,
                   tm.can_invite, tm.access
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = ?
            ORDER BY
              CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
              lower(u.display_name), lower(u.email)
            """,
            (team_id,),
        ).fetchall()
    return [decorate_member_row(r) for r in rows]


def list_render_agent_invite_candidates(user_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    """People a user can add to a Render Agent thread.

    Includes the current workspace first, then teammates from other workspaces.
    """
    rows: list[dict[str, Any]] = []
    if team_id:
        _require_team_member(team_id, user_id)
        with get_conn() as conn:
            current = conn.execute(
                """
                SELECT u.id, u.email, u.display_name, u.avatar_url, tm.role,
                       tm.team_id, t.name AS team_name, 'current_workspace' AS source
                FROM team_members tm
                JOIN teams t ON t.id = tm.team_id
                JOIN users u ON u.id = tm.user_id
                WHERE tm.team_id = ?
                ORDER BY lower(u.display_name), lower(u.email)
                """,
                (team_id,),
            ).fetchall()
        rows.extend(dict(r) for r in current)

    with get_conn() as conn:
        others = conn.execute(
            """
            SELECT DISTINCT u.id, u.email, u.display_name, u.avatar_url, source_member.role,
                   source_member.team_id, source_team.name AS team_name, 'shared_workspace' AS source
            FROM team_members requester_tm
            JOIN teams source_team ON source_team.id = requester_tm.team_id
            JOIN team_members source_member ON source_member.team_id = requester_tm.team_id
            JOIN users u ON u.id = source_member.user_id
            WHERE requester_tm.user_id = ?
              AND source_member.user_id != ?
              AND (? IS NULL OR source_member.team_id != ?)
            ORDER BY lower(u.display_name), lower(u.email)
            """,
            (user_id, user_id, team_id, team_id),
        ).fetchall()
    rows.extend(dict(r) for r in others)

    by_user: dict[str, dict[str, Any]] = {}
    for row in rows:
        target_id = str(row.get("id") or "")
        if not target_id or target_id == user_id:
            continue
        existing = by_user.get(target_id)
        if existing and existing.get("source") == "current_workspace":
            continue
        by_user[target_id] = row
    return sorted(
        by_user.values(),
        key=lambda item: (
            0 if item.get("source") == "current_workspace" else 1,
            str(item.get("display_name") or item.get("email") or "").lower(),
        ),
    )


def list_workspace_invite_candidates(user_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    """People you've worked with before — for workspace invite dropdowns.

    Includes teammates from other workspaces and emails you've invited previously.
    When team_id is set, excludes people already in that workspace (and pending invites).
    """
    if team_id:
        _require_team_member(team_id, user_id)

    by_email: dict[str, dict[str, Any]] = {}
    with get_conn() as conn:
        member_rows = conn.execute(
            """
            SELECT u.id, u.email, u.display_name,
                   GROUP_CONCAT(DISTINCT source_team.name) AS source_teams
            FROM team_members requester_tm
            JOIN teams source_team ON source_team.id = requester_tm.team_id
            JOIN team_members source_member ON source_member.team_id = requester_tm.team_id
            JOIN users u ON u.id = source_member.user_id
            WHERE requester_tm.user_id = ?
              AND source_member.user_id != ?
              AND (
                ? IS NULL
                OR source_member.user_id NOT IN (
                    SELECT user_id FROM team_members WHERE team_id = ?
                )
              )
            GROUP BY u.id, u.email, u.display_name
            ORDER BY lower(u.display_name), lower(u.email)
            """,
            (user_id, user_id, team_id, team_id),
        ).fetchall()
        for row in member_rows:
            email = str(row["email"] or "").strip().lower()
            if not email:
                continue
            by_email[email] = {
                "id": row["id"],
                "email": email,
                "display_name": row["display_name"] or email,
                "source_teams": row["source_teams"] or "",
                "source": "shared_workspace",
            }

        past_invites = conn.execute(
            """
            SELECT i.email,
                   u.id AS user_id,
                   u.display_name,
                   GROUP_CONCAT(DISTINCT t.name) AS source_teams
            FROM team_invites i
            LEFT JOIN users u ON lower(u.email) = lower(i.email)
            LEFT JOIN teams t ON t.id = i.team_id
            WHERE i.invited_by = ?
              AND lower(i.email) != (
                  SELECT lower(email) FROM users WHERE id = ? LIMIT 1
              )
              AND (
                ? IS NULL
                OR (
                  lower(i.email) NOT IN (
                      SELECT lower(u2.email) FROM team_members tm
                      JOIN users u2 ON u2.id = tm.user_id
                      WHERE tm.team_id = ?
                  )
                  AND lower(i.email) NOT IN (
                      SELECT lower(email) FROM team_invites
                      WHERE team_id = ? AND status = 'pending'
                  )
                )
              )
            GROUP BY i.email, u.id, u.display_name
            ORDER BY lower(i.email)
            """,
            (user_id, user_id, team_id, team_id, team_id),
        ).fetchall()
        for row in past_invites:
            email = str(row["email"] or "").strip().lower()
            if not email or email in by_email:
                continue
            by_email[email] = {
                "id": row["user_id"],
                "email": email,
                "display_name": row["display_name"] or email,
                "source_teams": row["source_teams"] or "Previously invited",
                "source": "previous_invite",
            }

    return sorted(
        by_email.values(),
        key=lambda item: str(item.get("display_name") or item.get("email") or "").lower(),
    )


def team_management_summary(team_id: str, user_id: str) -> dict[str, Any]:
    """Workspace roster: members, pending invites, and management capabilities."""
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
        _ensure_member_permission_columns(conn)
        requester = conn.execute(
            "SELECT role, can_invite, access FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, user_id),
        ).fetchone()
        if not requester:
            raise PermissionError("Not a member of this team")
        team = conn.execute(
            "SELECT id, name, created_by, created_at FROM teams WHERE id=?",
            (team_id,),
        ).fetchone()
        members = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.avatar_url, tm.role, tm.joined_at,
                   tm.can_invite, tm.access
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id = ?
            ORDER BY
              CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,
              lower(u.display_name), lower(u.email)
            """,
            (team_id,),
        ).fetchall()
        invites = conn.execute(
            """
            SELECT i.id, i.email, i.created_at, i.invited_by,
                   u.id AS user_id,
                   u.display_name,
                   u.email AS registered_email,
                   inviter.display_name AS invited_by_name
            FROM team_invites i
            LEFT JOIN users u ON lower(u.email) = lower(i.email)
            LEFT JOIN users inviter ON inviter.id = i.invited_by
            WHERE i.team_id = ? AND i.status = 'pending'
            ORDER BY i.created_at DESC
            """,
            (team_id,),
        ).fetchall()
        project_count = conn.execute(
            "SELECT COUNT(*) AS n FROM project_access WHERE team_id=?",
            (team_id,),
        ).fetchone()["n"]
    requester_perms = decorate_member_row(requester)
    role = requester_perms["role"]
    return {
        "team": dict(team) if team else {"id": team_id},
        "members": [decorate_member_row(r) for r in members],
        "invites": [dict(r) for r in invites],
        "candidates": list_workspace_invite_candidates(user_id, team_id),
        "project_count": int(project_count or 0),
        "requester_role": role,
        "requester_role_label": display_role(role),
        "requester_access": requester_perms.get("access"),
        "requester_can_edit": requester_perms.get("can_edit"),
        "can_manage_roles": role == "owner",
        "can_manage_permissions": role == "owner",
        "can_remove_members": can_manage_workspace(role),
        "can_invite": bool(requester_perms.get("can_invite")),
        "is_workspace_admin": role == "owner",
    }


def set_member_role(
    team_id: str,
    target_user_id: str,
    role: str,
    requester_id: str,
) -> dict[str, Any]:
    """Workspace owner assigns manager / user roles."""
    _require_team_owner(team_id, requester_id)
    wanted = normalize_role(role)
    if wanted not in ASSIGNABLE_ROLES:
        raise ValueError("Role must be manager or user")
    if target_user_id == requester_id:
        raise ValueError("You cannot change your own workspace admin role")
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        target = conn.execute(
            "SELECT role FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not target:
            raise ValueError("User is not a member of this workspace")
        if normalize_role(target["role"]) == "owner":
            raise ValueError("Cannot change the workspace admin role")
        # Promoting to manager grants invite by default; demoting leaves invite as owner set it.
        if wanted == "manager":
            conn.execute(
                "UPDATE team_members SET role=?, can_invite=1 WHERE team_id=? AND user_id=?",
                (wanted, team_id, target_user_id),
            )
        else:
            conn.execute(
                "UPDATE team_members SET role=? WHERE team_id=? AND user_id=?",
                (wanted, team_id, target_user_id),
            )
        conn.commit()
        row = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.avatar_url, tm.role, tm.joined_at,
                   tm.can_invite, tm.access
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id=? AND tm.user_id=?
            """,
            (team_id, target_user_id),
        ).fetchone()
    return decorate_member_row(row)


def set_member_permissions(
    team_id: str,
    target_user_id: str,
    requester_id: str,
    *,
    can_invite: bool | None = None,
    access: str | None = None,
) -> dict[str, Any]:
    """Workspace owner sets invite + edit/view permissions for a member."""
    _require_team_owner(team_id, requester_id)
    if target_user_id == requester_id:
        raise ValueError("You cannot change your own workspace admin permissions")
    if can_invite is None and access is None:
        raise ValueError("Provide can_invite and/or access")
    wanted_access = normalize_access(access) if access is not None else None
    if wanted_access is not None and wanted_access not in ACCESS_LEVELS:
        raise ValueError("Access must be edit or view")
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        target = conn.execute(
            "SELECT role, can_invite, access FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not target:
            raise ValueError("User is not a member of this workspace")
        if normalize_role(target["role"]) == "owner":
            raise ValueError("Cannot change the workspace admin permissions")
        next_invite = int(bool(can_invite)) if can_invite is not None else int(target["can_invite"] or 0)
        next_access = wanted_access if wanted_access is not None else normalize_access(target["access"])
        conn.execute(
            "UPDATE team_members SET can_invite=?, access=? WHERE team_id=? AND user_id=?",
            (next_invite, next_access, team_id, target_user_id),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.avatar_url, tm.role, tm.joined_at,
                   tm.can_invite, tm.access
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id=? AND tm.user_id=?
            """,
            (team_id, target_user_id),
        ).fetchone()
    return decorate_member_row(row)


def _require_team_member(team_id: str, user_id: str) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (team_id, user_id),
        ).fetchone()
    if not row:
        raise PermissionError("Not a member of this team")


def _require_team_owner(team_id: str, user_id: str) -> None:
    role = get_member_role(team_id, user_id)
    if role != "owner":
        raise PermissionError("Only workspace admins can do that")


def _require_team_manager(team_id: str, user_id: str) -> None:
    role = get_member_role(team_id, user_id)
    if not can_manage_workspace(role):
        raise PermissionError("Only workspace admins or managers can do that")


def add_registered_user_to_team(team_id: str, email: str, requester_id: str) -> dict[str, Any]:
    """Owner adds an existing registered user immediately; unknown emails stay as invites."""
    if not member_can_invite(team_id, requester_id):
        raise PermissionError("You do not have permission to invite people to this workspace")
    email = email.strip().lower()
    if not email:
        raise ValueError("Email is required")
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        user = conn.execute("SELECT id, email, display_name FROM users WHERE lower(email)=?", (email,)).fetchone()
        if not user:
            # Preserve the existing invite flow for users who have not signed up yet.
            conn.commit()
            return invite_user_to_team(team_id, email, requester_id)
        existing = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, user["id"]),
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT INTO team_members (team_id, user_id, role, joined_at, can_invite, access)
                VALUES (?, ?, 'user', ?, 0, 'edit')
                """,
                (team_id, user["id"], _now()),
            )
            newly_added = True
        else:
            newly_added = False
        conn.execute(
            "UPDATE team_invites SET status='accepted' WHERE team_id=? AND lower(email)=? AND status='pending'",
            (team_id, email),
        )
        conn.commit()
    if newly_added:
        from backend.services.user_ai_keys_service import deny_shared_keys_for_new_member

        deny_shared_keys_for_new_member(team_id, user["id"], updated_by=requester_id)
    return {"status": "added", "user": dict(user)}


def remove_team_member(team_id: str, target_user_id: str, requester_id: str) -> dict[str, Any]:
    _require_team_manager(team_id, requester_id)
    if target_user_id == requester_id:
        raise ValueError("You cannot remove yourself from your own workspace")
    requester_role = get_member_role(team_id, requester_id)
    with get_conn() as conn:
        target = conn.execute(
            "SELECT role FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not target:
            raise ValueError("Team member not found")
        target_role = normalize_role(target["role"])
        if target_role == "owner":
            raise ValueError("Workspace admins cannot be removed here")
        if requester_role == "manager" and target_role != "user":
            raise ValueError("Managers can only remove users")
        conn.execute("DELETE FROM team_members WHERE team_id=? AND user_id=?", (team_id, target_user_id))
        conn.execute(
            "DELETE FROM user_team_key_opts WHERE user_id=? "
            "AND key_id IN (SELECT id FROM team_shared_ai_keys WHERE team_id=?)",
            (target_user_id, team_id),
        )
        conn.execute(
            "DELETE FROM team_key_grants WHERE user_id=? "
            "AND key_id IN (SELECT id FROM team_shared_ai_keys WHERE team_id=?)",
            (target_user_id, team_id),
        )
        conn.commit()
    return {"status": "removed", "user_id": target_user_id}


def leave_team(team_id: str, user_id: str) -> dict[str, Any]:
    """Let a non-owner leave a workspace."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT role FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, user_id),
        ).fetchone()
        if not row:
            raise ValueError("You are not a member of this workspace")
        if normalize_role(row["role"]) == "owner":
            raise ValueError("Workspace admins cannot leave their own workspace")
        conn.execute("DELETE FROM team_members WHERE team_id=? AND user_id=?", (team_id, user_id))
        conn.execute(
            "DELETE FROM user_team_key_opts WHERE user_id=? "
            "AND key_id IN (SELECT id FROM team_shared_ai_keys WHERE team_id=?)",
            (user_id, team_id),
        )
        conn.execute(
            "DELETE FROM team_key_grants WHERE user_id=? "
            "AND key_id IN (SELECT id FROM team_shared_ai_keys WHERE team_id=?)",
            (user_id, team_id),
        )
        conn.commit()
    return {"status": "left", "team_id": team_id}


def _personal_team_id_for_user(conn: sqlite3.Connection, user_id: str) -> str | None:
    row = conn.execute(
        """
        SELECT t.id
        FROM teams t
        JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
        WHERE t.created_by = ? AND tm.role IN ('owner', 'admin')
        ORDER BY t.created_at ASC
        LIMIT 1
        """,
        (user_id, user_id),
    ).fetchone()
    return row["id"] if row else None


def delete_team(team_id: str, user_id: str) -> dict[str, Any]:
    """Permanently delete a shared workspace. Owners only; personal workspace blocked."""
    _require_team_owner(team_id, user_id)
    with get_conn() as conn:
        personal_id = _personal_team_id_for_user(conn, user_id)
        if personal_id and personal_id == team_id:
            raise ValueError("Your personal workspace cannot be deleted")
        team = conn.execute("SELECT id, name FROM teams WHERE id = ?", (team_id,)).fetchone()
        if not team:
            raise ValueError("Workspace not found")
        project_ids = [
            r["project_id"]
            for r in conn.execute(
                "SELECT project_id FROM project_access WHERE team_id = ?",
                (team_id,),
            ).fetchall()
        ]
        # Clean related rows (ignore missing tables/columns).
        for sql, params in (
            ("DELETE FROM team_key_grants WHERE key_id IN (SELECT id FROM team_shared_ai_keys WHERE team_id=?)", (team_id,)),
            ("DELETE FROM user_team_key_opts WHERE key_id IN (SELECT id FROM team_shared_ai_keys WHERE team_id=?)", (team_id,)),
            ("DELETE FROM team_shared_ai_keys WHERE team_id=?", (team_id,)),
            ("DELETE FROM folder_share_invites WHERE folder_id IN (SELECT id FROM workspace_folders WHERE team_id=?)", (team_id,)),
            ("DELETE FROM folder_shares WHERE folder_id IN (SELECT id FROM workspace_folders WHERE team_id=?)", (team_id,)),
            ("DELETE FROM workspace_folders WHERE team_id=?", (team_id,)),
            ("DELETE FROM workspace_activity WHERE team_id=?", (team_id,)),
            ("DELETE FROM team_invites WHERE team_id=?", (team_id,)),
            ("DELETE FROM team_members WHERE team_id=?", (team_id,)),
            ("DELETE FROM project_access WHERE team_id=?", (team_id,)),
            ("DELETE FROM teams WHERE id=?", (team_id,)),
        ):
            try:
                conn.execute(sql, params)
            except sqlite3.OperationalError:
                pass
        conn.commit()
    return {
        "status": "deleted",
        "team_id": team_id,
        "name": team["name"],
        "project_ids": project_ids,
    }


def update_team(team_id: str, name: str, user_id: str) -> dict[str, Any]:
    _require_team_owner(team_id, user_id)
    clean = name.strip()
    if not clean:
        raise ValueError("Workspace name is required")
    with get_conn() as conn:
        conn.execute("UPDATE teams SET name = ? WHERE id = ?", (clean, team_id))
        conn.commit()
        row = conn.execute(
            "SELECT t.id, t.name, t.created_by, t.created_at, tm.role, "
            "t.render_folder_provider, t.render_folder_ref, t.render_folder_label, t.render_folder_connected_at, "
            "(SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_id = t.id) AS member_count FROM teams t "
            "JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ? WHERE t.id = ?",
            (user_id, team_id),
        ).fetchone()
    if not row:
        raise ValueError("Workspace not found")
    item = dict(row)
    item["role"] = normalize_role(item.get("role"))
    item["role_label"] = display_role(item["role"])
    return item


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
    return {
        "id": team_id,
        "name": name.strip(),
        "created_by": user_id,
        "created_at": now,
        "role": "owner",
        "role_label": display_role("owner"),
        "can_invite": True,
        "can_edit": True,
        "access": "edit",
        "access_label": "Can edit",
        "member_count": 1,
        "render_folder_provider": "render3d",
        "render_folder_ref": None,
        "render_folder_label": None,
        "render_folder_connected_at": None,
    }


def invite_user_to_team(team_id: str, email: str, inviter_id: str) -> dict[str, Any]:
    if not member_can_invite(team_id, inviter_id):
        raise PermissionError("You do not have permission to invite people to this workspace")
    email = email.strip().lower()
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
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
            SELECT id, token FROM team_invites
            WHERE team_id = ? AND email = ? AND status = 'pending'
            """,
            (team_id, email),
        ).fetchone()
        if pending:
            token = pending["token"] if "token" in pending.keys() else None
            if not token:
                token = _invite_token()
                conn.execute("UPDATE team_invites SET token=? WHERE id=?", (token, pending["id"]))
                conn.commit()
            return {"status": "invited", "email": email, "invite_id": pending["id"], "invite_token": token}

        invite_id = str(uuid.uuid4())[:8]
        token = _invite_token()
        conn.execute(
            """
            INSERT INTO team_invites (id, team_id, email, invited_by, status, created_at, token)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)
            """,
            (invite_id, team_id, email, inviter_id, _now(), token),
        )
        conn.commit()
        return {"status": "invited", "email": email, "invite_id": invite_id, "invite_token": token}


def list_pending_invites(email: str) -> list[dict[str, Any]]:
    email = email.strip().lower()
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
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
        _ensure_invite_token_column(conn)
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
                (invite["team_id"], user_id, "user", _now()),
            )
            newly_added = True
        else:
            newly_added = False
        conn.execute(
            "UPDATE team_invites SET status = 'accepted' WHERE id = ?",
            (invite_id,),
        )
        conn.commit()
        team = conn.execute("SELECT id, name FROM teams WHERE id = ?", (invite["team_id"],)).fetchone()
    from backend.services import folders_service
    from backend.services.user_ai_keys_service import deny_shared_keys_for_new_member

    if newly_added:
        deny_shared_keys_for_new_member(invite["team_id"], user_id)
    folders_service.grant_pending_folder_shares(user_id, email, invite["team_id"])
    return {"status": "accepted", "team": dict(team)}


def accept_pending_invites_for_user(user_id: str, email: str) -> list[dict[str, Any]]:
    """Auto-claim pending workspace invites for a newly verified social-login email."""
    email = email.strip().lower()
    if not user_id or not email:
        return []
    accepted: list[dict[str, Any]] = []
    newly_joined: list[str] = []
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
        rows = conn.execute(
            """
            SELECT i.id, i.team_id, i.email, t.name AS team_name
            FROM team_invites i
            JOIN teams t ON t.id = i.team_id
            WHERE lower(i.email) = lower(?) AND i.status = 'pending'
            ORDER BY i.created_at
            """,
            (email,),
        ).fetchall()
        for invite in rows:
            existing = conn.execute(
                "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
                (invite["team_id"], user_id),
            ).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
                    (invite["team_id"], user_id, "user", _now()),
                )
                newly_joined.append(invite["team_id"])
            conn.execute("UPDATE team_invites SET status = 'accepted' WHERE id = ?", (invite["id"],))
            accepted.append({"id": invite["id"], "team_id": invite["team_id"], "team_name": invite["team_name"]})
        if accepted:
            conn.commit()
    if accepted:
        from backend.services import folders_service
        from backend.services.user_ai_keys_service import deny_shared_keys_for_new_member

        for team_id in newly_joined:
            deny_shared_keys_for_new_member(team_id, user_id)
        for invite in accepted:
            folders_service.grant_pending_folder_shares(user_id, email, invite["team_id"])
    return accepted


def peek_team_invite(invite_id: str, token: str) -> dict[str, Any]:
    """Read invite metadata for the email-link UI without accepting it."""
    token = str(token or "").strip()
    if not token:
        raise ValueError("Invite link is missing its token")
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
        invite = conn.execute(
            """
            SELECT i.id, i.team_id, i.email, i.status, i.token, i.invited_by, i.created_at,
                   t.name AS team_name,
                   u.display_name AS inviter_name,
                   u.email AS inviter_email
            FROM team_invites i
            JOIN teams t ON t.id = i.team_id
            LEFT JOIN users u ON u.id = i.invited_by
            WHERE i.id = ?
            """,
            (invite_id,),
        ).fetchone()
        if not invite or str(invite["token"] or "") != token:
            raise ValueError("Invite not found or expired")
        status = str(invite["status"] or "")
        if status == "declined":
            raise ValueError("Invite was declined")
        user = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email)=lower(?)",
            (invite["email"],),
        ).fetchone()
        already_member = False
        if user:
            already_member = bool(
                conn.execute(
                    "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
                    (invite["team_id"], user["id"]),
                ).fetchone()
            )
    return {
        "invite_id": invite["id"],
        "status": status,
        "email": invite["email"],
        "team": {"id": invite["team_id"], "name": invite["team_name"]},
        "inviter_name": invite["inviter_name"] or invite["inviter_email"] or "A teammate",
        "user_exists": bool(user),
        "already_member": already_member,
        "signup_required": not bool(user),
    }


def claim_team_invite(invite_id: str, token: str) -> dict[str, Any]:
    """Accept a workspace invite via emailed link token (explicit user action only).

    Idempotent for already-accepted invites with a matching token so double-clicks
    still land in the app cleanly.
    """
    token = str(token or "").strip()
    if not token:
        raise ValueError("Invite link is missing its token")
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
        invite = conn.execute(
            """
            SELECT i.*, t.name AS team_name
            FROM team_invites i
            JOIN teams t ON t.id = i.team_id
            WHERE i.id = ?
            """,
            (invite_id,),
        ).fetchone()
        if not invite or str(invite["token"] or "") != token:
            raise ValueError("Invite not found or expired")
        status = str(invite["status"] or "")
        if status == "declined":
            raise ValueError("Invite was declined")
        team = {"id": invite["team_id"], "name": invite["team_name"]}
        user = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email)=lower(?)",
            (invite["email"],),
        ).fetchone()
        if status == "accepted":
            if not user:
                return {
                    "status": "signup_required",
                    "email": invite["email"],
                    "team": team,
                    "already_claimed": True,
                }
            return {"status": "accepted", "team": team, "user": dict(user), "already_claimed": True}
        if status != "pending":
            raise ValueError("Invite not found or expired")
        if not user:
            return {
                "status": "signup_required",
                "email": invite["email"],
                "team": team,
            }
        existing = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (invite["team_id"], user["id"]),
        ).fetchone()
        newly_added = False
        if not existing:
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
                (invite["team_id"], user["id"], "user", _now()),
            )
            newly_added = True
        conn.execute("UPDATE team_invites SET status = 'accepted' WHERE id = ?", (invite_id,))
        conn.commit()
    from backend.services import folders_service
    from backend.services.user_ai_keys_service import deny_shared_keys_for_new_member

    if newly_added:
        deny_shared_keys_for_new_member(invite["team_id"], user["id"])
    folders_service.grant_pending_folder_shares(user["id"], invite["email"], invite["team_id"])
    return {"status": "accepted", "team": team, "user": dict(user)}


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


def decline_team_invite_by_token(invite_id: str, token: str) -> dict[str, Any]:
    token = str(token or "").strip()
    if not token:
        raise ValueError("Invite link is missing its token")
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
        invite = conn.execute(
            "SELECT id, token, status FROM team_invites WHERE id = ?",
            (invite_id,),
        ).fetchone()
        if not invite or str(invite["token"] or "") != token:
            raise ValueError("Invite not found or expired")
        if str(invite["status"] or "") == "declined":
            return {"status": "declined"}
        if str(invite["status"] or "") != "pending":
            raise ValueError("Invite not found or expired")
        conn.execute("UPDATE team_invites SET status = 'declined' WHERE id = ?", (invite_id,))
        conn.commit()
    return {"status": "declined"}


def list_users(query: str = "", limit: int = 50) -> list[dict[str, Any]]:
    q = f"%{query.strip().lower()}%"
    with get_conn() as conn:
        if query.strip():
            try:
                rows = conn.execute(
                    """
                    SELECT id, email, display_name, handle, avatar_url FROM users
                    WHERE lower(email) LIKE ?
                       OR lower(display_name) LIKE ?
                       OR lower(COALESCE(handle, '')) LIKE ?
                    ORDER BY display_name LIMIT ?
                    """,
                    (q, q, q, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = conn.execute(
                    """
                    SELECT id, email, display_name FROM users
                    WHERE lower(email) LIKE ? OR lower(display_name) LIKE ?
                    ORDER BY display_name LIMIT ?
                    """,
                    (q, q, limit),
                ).fetchall()
        else:
            try:
                rows = conn.execute(
                    "SELECT id, email, display_name, handle, avatar_url FROM users ORDER BY display_name LIMIT ?",
                    (limit,),
                ).fetchall()
            except sqlite3.OperationalError:
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
                SELECT pa.project_id, pa.team_id, pa.folder_id, pa.sort_order,
                       pa.created_by, u.email AS owner_email, u.display_name AS owner_name
                FROM project_access pa
                JOIN team_members tm ON tm.team_id = pa.team_id
                LEFT JOIN users u ON u.id = pa.created_by
                WHERE tm.user_id = ? AND pa.team_id = ?
                ORDER BY pa.sort_order ASC, pa.created_at DESC
                """,
                (user_id, team_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT pa.project_id, pa.team_id, pa.folder_id, pa.sort_order,
                       pa.created_by, u.email AS owner_email, u.display_name AS owner_name
                FROM project_access pa
                JOIN team_members tm ON tm.team_id = pa.team_id
                LEFT JOIN users u ON u.id = pa.created_by
                WHERE tm.user_id = ?
                ORDER BY pa.sort_order ASC, pa.created_at DESC
                """,
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def get_team_for_user(team_id: str, user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT t.id, t.name, t.created_by, t.created_at, tm.role,
                   t.render_folder_provider, t.render_folder_ref,
                   t.render_folder_label, t.render_folder_connected_at
            FROM teams t
            JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
            WHERE t.id = ?
            """,
            (user_id, team_id),
        ).fetchone()
    return dict(row) if row else None


def update_render_folder(
    team_id: str,
    user_id: str,
    *,
    provider: str,
    folder_ref: str | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    _require_team_owner(team_id, user_id)
    allowed = {"render3d", "fusion", "google_drive", "dropbox", "onedrive", "local", "onshape"}
    clean_provider = (provider or "render3d").strip().lower()
    if clean_provider not in allowed:
        raise ValueError("Unsupported Render folder provider")
    now = _now()
    clean_ref = (folder_ref or "").strip() or None
    clean_label = (label or "").strip() or clean_provider.replace("_", " ").title()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE teams
            SET render_folder_provider = ?,
                render_folder_ref = ?,
                render_folder_label = ?,
                render_folder_connected_at = ?
            WHERE id = ?
            """,
            (clean_provider, clean_ref, clean_label, now, team_id),
        )
        conn.commit()
    team = get_team_for_user(team_id, user_id)
    if not team:
        raise ValueError("Workspace not found")
    return team


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
        if row:
            return True
        shared = conn.execute(
            "SELECT 1 FROM project_shares WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
    return shared is not None


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


def team_member_ids(team_id: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT user_id FROM team_members WHERE team_id = ?",
            (team_id,),
        ).fetchall()
    return [r["user_id"] for r in rows]


def project_team_id(project_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT team_id FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
    return row["team_id"] if row else None
