"""Site-level admin / manager / user. Workspace owner remains workspace super-admin."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.database import get_conn

ROLES = ("admin", "manager", "user")
PERM_KEYS = ("can_export", "can_edit_files", "can_access_tools")
WORKSPACE_PERM_KEYS = ("can_export", "can_edit_files", "can_access_tools", "can_invite")
CONTROL_GROUPS = ("manager", "user", "admin", "workspace")
PERM_LABELS = {
    "can_export": "Export models",
    "can_edit_files": "Edit files",
    "can_access_tools": "Access tools",
    "can_invite": "Invite members",
}
GROUP_META = {
    "manager": {
        "label": "Manager settings",
        "description": "Platform managers: team leads who can help run workspaces without becoming super admin.",
    },
    "user": {
        "label": "User settings",
        "description": "Team users: default members. Defaults apply to people who are not managers or admins.",
    },
    "admin": {
        "label": "Admin settings",
        "description": "Platform admins. Super admin mailboxes stay fully privileged.",
    },
    "workspace": {
        "label": "Workspace settings",
        "description": "Workspace admins (owners) and default permissions for other members in those teams.",
    },
}
GROUP_DEFAULTS: dict[str, dict[str, bool]] = {
    "manager": {"can_export": True, "can_edit_files": True, "can_access_tools": True},
    "user": {"can_export": False, "can_edit_files": True, "can_access_tools": True},
    "admin": {"can_export": True, "can_edit_files": True, "can_access_tools": True},
    "workspace": {
        "can_export": True,
        "can_edit_files": True,
        "can_access_tools": True,
        "can_invite": True,
    },
}
def _email_set(name: str) -> set[str]:
    return {value.strip().lower() for value in os.getenv(name, "").split(",") if value.strip()}


SUPER_ADMIN_EMAILS = _email_set("RENDER3D_SUPER_ADMIN_EMAILS")
SITE_ADMIN_EMAILS = _email_set("RENDER3D_ADMIN_EMAILS") | SUPER_ADMIN_EMAILS
MANAGEMENT_EMAIL = os.getenv("RENDER3D_MANAGEMENT_EMAIL", "").strip().lower()
_ADMIN_SAFE_USER_COLS = "id,email,username,display_name,role,created_at"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS platform_roles (
            user_id TEXT PRIMARY KEY,
            role TEXT NOT NULL DEFAULT 'user',
            can_export INTEGER NOT NULL DEFAULT 0,
            can_edit_files INTEGER NOT NULL DEFAULT 1,
            can_access_tools INTEGER NOT NULL DEFAULT 1,
            workspace_ids TEXT NOT NULL DEFAULT '[]',
            created_by TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def is_super_admin(user: dict[str, Any] | None) -> bool:
    email = str((user or {}).get("email") or "").strip().lower()
    return email in SUPER_ADMIN_EMAILS or email == MANAGEMENT_EMAIL


def is_management_user(user: dict[str, Any] | None) -> bool:
    return is_platform_admin(user)


def _email(user: dict[str, Any] | None) -> str:
    return str((user or {}).get("email") or "").strip().lower()


def _prefer_supabase_roles() -> bool:
    try:
        from backend.services import supabase_users_store as sbusers

        return bool(sbusers.prefer_supabase())
    except Exception:
        return False


def _supabase_role_name(user: dict[str, Any] | None) -> str | None:
    if not user:
        return None
    try:
        from backend.services import supabase_users_store as sbusers

        if not sbusers.prefer_supabase():
            return None
        uid = str(user.get("id") or "")
        email = _email(user)
        row = (sbusers.get_by_id(uid) if uid else None) or (sbusers.get_by_email(email) if email else None)
        role = str((row or {}).get("role") or "").strip().lower()
        if role in ROLES:
            return role
    except Exception:
        return None
    return None


def _sqlite_role_name(user_id: str) -> str | None:
    if not user_id:
        return None
    with get_conn() as conn:
        _ensure(conn)
        row = conn.execute("SELECT role FROM platform_roles WHERE user_id=?", (user_id,)).fetchone()
    if row and str(row["role"] or "").strip().lower() in ROLES:
        return str(row["role"]).strip().lower()
    return None


def stored_role_name(user: dict[str, Any] | None) -> str:
    if is_super_admin(user) or _email(user) in SUPER_ADMIN_EMAILS:
        return "admin"
    if _prefer_supabase_roles():
        sb = _supabase_role_name(user)
        if sb:
            return sb
    sqlite_role = _sqlite_role_name(str((user or {}).get("id") or ""))
    if sqlite_role:
        return sqlite_role
    raw = str((user or {}).get("role") or "").strip().lower()
    if raw in ROLES:
        return raw
    if _email(user) in SITE_ADMIN_EMAILS:
        return "admin"
    return "user"


def is_platform_admin(user: dict[str, Any] | None) -> bool:
    if not user:
        return False
    if is_super_admin(user) or _email(user) in SITE_ADMIN_EMAILS:
        return True
    if str(user.get("role") or "").strip().lower() == "admin":
        return True
    return stored_role_name(user) == "admin"


def attach_role_fields(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    out = dict(user)
    role = stored_role_name(out)
    super_admin = is_super_admin(out)
    if super_admin:
        role = "admin"
    out["role"] = role
    out["role_label"] = {"admin": "Admin", "manager": "Manager", "user": "User"}.get(role, "User")
    out["super_admin"] = super_admin
    out["platform_admin"] = bool(super_admin or role == "admin" or _email(out) in SITE_ADMIN_EMAILS)
    out["management"] = bool(out["platform_admin"])
    return out


def claim_initial_instance_admin(user: dict[str, Any]) -> bool:
    """Make the earliest local account admin when no admin is configured yet."""
    user_id = str((user or {}).get("id") or "").strip()
    if not user_id or SUPER_ADMIN_EMAILS or SITE_ADMIN_EMAILS or MANAGEMENT_EMAIL:
        return False
    now = _now()
    with get_conn() as conn:
        _ensure(conn)
        earliest = conn.execute(
            """
            SELECT id FROM users
             WHERE password_hash <> 'marketplace-profile-only'
             ORDER BY created_at ASC, id ASC LIMIT 1
            """
        ).fetchone()
        existing_admin = conn.execute(
            "SELECT 1 FROM platform_roles WHERE role='admin' LIMIT 1"
        ).fetchone()
        if not earliest or str(earliest["id"]) != user_id or existing_admin:
            return False
        defaults = GROUP_DEFAULTS["admin"]
        conn.execute(
            """
            INSERT INTO platform_roles (
                user_id, role, can_export, can_edit_files, can_access_tools,
                workspace_ids, created_by, created_at, updated_at
            ) VALUES (?, 'admin', ?, ?, ?, '[]', ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                role='admin', can_export=excluded.can_export,
                can_edit_files=excluded.can_edit_files,
                can_access_tools=excluded.can_access_tools,
                updated_at=excluded.updated_at
            """,
            (
                user_id,
                int(bool(defaults["can_export"])),
                int(bool(defaults["can_edit_files"])),
                int(bool(defaults["can_access_tools"])),
                user_id,
                now,
                now,
            ),
        )
        conn.commit()
    _sync_role_to_supabase(user_id, "admin")
    _invalidate_auth_cache(user_id)
    return True


def _sync_role_to_supabase(user_id: str, role: str) -> None:
    if not _prefer_supabase_roles():
        return
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.patch_user(user_id, role=role)
    except Exception:
        return


def _invalidate_auth_cache(user_id: str) -> None:
    try:
        from backend.auth import invalidate_user_cache

        invalidate_user_cache(user_id)
    except Exception:
        return


def _row_payload(row: Any, user: dict[str, Any] | None = None) -> dict[str, Any]:
    data = dict(row) if row is not None else {}
    try:
        ids = json.loads(data.get("workspace_ids") or "[]")
    except json.JSONDecodeError:
        ids = []
    if not isinstance(ids, list):
        ids = []
    role = str(data.get("role") or "user")
    if user and is_super_admin(user):
        role = "admin"
        return {
            "user_id": user.get("id"),
            "role": "admin",
            "role_label": "Admin",
            "can_export": True,
            "can_edit_files": True,
            "can_access_tools": True,
            "workspace_ids": [],
            "super_admin": True,
        }
    return {
        "user_id": data.get("user_id"),
        "role": role if role in ROLES else "user",
        "role_label": {"admin": "Admin", "manager": "Manager", "user": "User"}.get(role, "User"),
        "can_export": bool(int(0 if data.get("can_export") is None else data.get("can_export"))),
        "can_edit_files": bool(int(1 if data.get("can_edit_files") is None else data.get("can_edit_files"))),
        "can_access_tools": bool(int(1 if data.get("can_access_tools") is None else data.get("can_access_tools"))),
        "workspace_ids": [str(x) for x in ids if str(x).strip()],
        "super_admin": False,
    }


def get_role(user: dict[str, Any]) -> dict[str, Any]:
    if is_super_admin(user):
        return _row_payload(None, user)
    role_name = stored_role_name(user)
    with get_conn() as conn:
        _ensure(conn)
        row = conn.execute(
            "SELECT * FROM platform_roles WHERE user_id=?",
            (user["id"],),
        ).fetchone()
    if row:
        payload = _row_payload(row, user)
        payload["role"] = role_name if role_name in ROLES else payload.get("role") or "user"
        payload["role_label"] = {"admin": "Admin", "manager": "Manager", "user": "User"}.get(
            payload["role"], "User"
        )
        payload["super_admin"] = False
        return payload
    defaults = load_group_permissions().get(role_name if role_name in GROUP_DEFAULTS else "user") or GROUP_DEFAULTS["user"]
    return {
        "user_id": user["id"],
        "role": role_name if role_name in ROLES else "user",
        "role_label": {"admin": "Admin", "manager": "Manager", "user": "User"}.get(role_name, "User"),
        "can_export": bool(defaults.get("can_export")),
        "can_edit_files": bool(defaults.get("can_edit_files", True)),
        "can_access_tools": bool(defaults.get("can_access_tools", True)),
        "workspace_ids": [],
        "super_admin": False,
    }


def list_managers() -> list[dict[str, Any]]:
    with get_conn() as conn:
        _ensure(conn)
        rows = conn.execute(
            """
            SELECT pr.*, u.email, u.display_name
            FROM platform_roles pr
            JOIN users u ON u.id = pr.user_id
            WHERE pr.role IN ('admin', 'manager')
            ORDER BY pr.updated_at DESC
            """
        ).fetchall()
    out = []
    for row in rows:
        item = _row_payload(row)
        item["email"] = row["email"]
        item["display_name"] = row["display_name"]
        out.append(item)
    return out


def _admin_record(
    *,
    user_id: str | None,
    email: str,
    display_name: str | None = None,
    source: str,
    super_admin: bool = False,
) -> dict[str, Any]:
    addr = str(email or "").strip().lower()
    return {
        "user_id": user_id,
        "email": addr,
        "display_name": display_name or addr,
        "role": "admin",
        "super_admin": bool(super_admin or addr in SUPER_ADMIN_EMAILS),
        "locked": bool(super_admin or addr in SUPER_ADMIN_EMAILS),
        "source": source,
    }


def list_site_admins() -> list[dict[str, Any]]:
    """All current website admins. Never includes password hashes or API keys."""
    by_email: dict[str, dict[str, Any]] = {}

    def add(row: dict[str, Any]) -> None:
        email = str(row.get("email") or "").strip().lower()
        if not email:
            return
        prev = by_email.get(email)
        if not prev:
            by_email[email] = row
            return
        if row.get("super_admin") and not prev.get("super_admin"):
            by_email[email] = {**prev, **row, "super_admin": True, "locked": True}
            return
        if row.get("user_id") and not prev.get("user_id"):
            prev["user_id"] = row["user_id"]
        if row.get("display_name") and not prev.get("display_name"):
            prev["display_name"] = row["display_name"]

    with get_conn() as conn:
        _ensure(conn)
        for email in sorted(SUPER_ADMIN_EMAILS | SITE_ADMIN_EMAILS):
            row = conn.execute(
                "SELECT id, email, display_name FROM users WHERE lower(email)=?",
                (email,),
            ).fetchone()
            add(
                _admin_record(
                    user_id=str(row["id"]) if row else None,
                    email=email,
                    display_name=row["display_name"] if row else None,
                    source="allowlist",
                    super_admin=email in SUPER_ADMIN_EMAILS,
                )
            )
        for row in conn.execute(
            """
            SELECT pr.user_id, u.email, u.display_name
            FROM platform_roles pr
            JOIN users u ON u.id = pr.user_id
            WHERE pr.role = 'admin'
            """
        ).fetchall():
            add(
                _admin_record(
                    user_id=row["user_id"],
                    email=row["email"],
                    display_name=row["display_name"],
                    source="sqlite",
                    super_admin=_email({"email": row["email"]}) in SUPER_ADMIN_EMAILS,
                )
            )
    try:
        if _prefer_supabase_roles():
            from backend.services import supabase_users_store as sbusers

            for row in sbusers.list_by_role("admin"):
                add(
                    _admin_record(
                        user_id=row.get("id"),
                        email=row.get("email") or "",
                        display_name=row.get("display_name"),
                        source="supabase",
                        super_admin=_email(row) in SUPER_ADMIN_EMAILS,
                    )
                )
    except Exception:
        pass
    out = list(by_email.values())
    out.sort(key=lambda r: (not r.get("super_admin"), str(r.get("email") or "")))
    return out


def set_site_admin(requester: dict[str, Any], *, email: str, admin: bool) -> dict[str, Any]:
    if not is_platform_admin(requester):
        raise PermissionError("Only an admin can change site admins")
    address = str(email or "").strip().lower()
    if not address or "@" not in address:
        raise ValueError("Enter a valid email")
    if not admin and (address in SUPER_ADMIN_EMAILS or is_super_admin({"email": address})):
        raise ValueError("You cannot revoke a super admin")
    target = None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email)=?",
            (address,),
        ).fetchone()
        if row:
            target = dict(row)
    if not target:
        try:
            if _prefer_supabase_roles():
                from backend.services import supabase_users_store as sbusers

                found = sbusers.get_by_email(address)
                if found and found.get("id"):
                    target = {
                        "id": found.get("id"),
                        "email": found.get("email"),
                        "display_name": found.get("display_name"),
                    }
        except Exception:
            target = target
    if not target or not target.get("id"):
        raise ValueError("No account with that email")
    row = set_role(requester, str(target["id"]), role="admin" if admin else "user")
    row["email"] = address
    row["display_name"] = target.get("display_name")
    row["locked"] = address in SUPER_ADMIN_EMAILS
    return row


def set_role(
    requester: dict[str, Any],
    target_user_id: str,
    *,
    role: str,
    can_export: bool | None = None,
    can_edit_files: bool | None = None,
    can_access_tools: bool | None = None,
    workspace_ids: list[str] | None = None,
) -> dict[str, Any]:
    wanted = str(role or "user").strip().lower()
    if wanted not in ROLES:
        raise ValueError("Role must be admin, manager, or user")
    if wanted == "manager":
        if not is_super_admin(requester):
            raise PermissionError("Only the super admin can appoint managers")
    elif not is_platform_admin(requester):
        raise PermissionError("Only an admin can change site admins")
    target_email = ""
    with get_conn() as conn:
        trow = conn.execute("SELECT email FROM users WHERE id=?", (target_user_id,)).fetchone()
        target_email = str((trow["email"] if trow else "") or "").strip().lower()
    if (is_super_admin({"email": target_email}) or target_email in SUPER_ADMIN_EMAILS) and wanted != "admin":
        raise ValueError("You cannot demote the super admin")
    if target_user_id == requester.get("id") and wanted != "admin" and is_super_admin(requester):
        raise ValueError("You cannot demote the super admin")
    now = _now()
    ids_json = json.dumps([str(x) for x in (workspace_ids or []) if str(x).strip()])
    with get_conn() as conn:
        _ensure(conn)
        existing = conn.execute(
            "SELECT * FROM platform_roles WHERE user_id=?",
            (target_user_id,),
        ).fetchone()
        user_row = conn.execute("SELECT id FROM users WHERE id=?", (target_user_id,)).fetchone()
        if not user_row:
            if _prefer_supabase_roles():
                _sync_role_to_supabase(target_user_id, wanted)
                _invalidate_auth_cache(target_user_id)
                return {
                    "user_id": target_user_id,
                    "role": wanted,
                    "role_label": {"admin": "Admin", "manager": "Manager", "user": "User"}.get(wanted, "User"),
                    "can_export": wanted != "user",
                    "can_edit_files": True,
                    "can_access_tools": True,
                    "workspace_ids": [],
                    "super_admin": False,
                }
            raise ValueError("User not found")
        prev = dict(existing) if existing else {}
        export = int(bool(can_export if can_export is not None else prev.get("can_export") or wanted != "user"))
        edit = int(bool(can_edit_files if can_edit_files is not None else prev.get("can_edit_files", 1)))
        tools = int(bool(can_access_tools if can_access_tools is not None else prev.get("can_access_tools", 1)))
        if existing:
            conn.execute(
                """
                UPDATE platform_roles
                SET role=?, can_export=?, can_edit_files=?, can_access_tools=?,
                    workspace_ids=?, updated_at=?
                WHERE user_id=?
                """,
                (wanted, export, edit, tools, ids_json, now, target_user_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO platform_roles
                (user_id, role, can_export, can_edit_files, can_access_tools, workspace_ids, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (target_user_id, wanted, export, edit, tools, ids_json, requester.get("id"), now, now),
            )
        row = conn.execute("SELECT * FROM platform_roles WHERE user_id=?", (target_user_id,)).fetchone()
    _sync_role_to_supabase(target_user_id, wanted)
    _invalidate_auth_cache(target_user_id)
    return _row_payload(row)


def _group_perm_path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "platform_group_permissions.json"


def load_group_permissions() -> dict[str, dict[str, bool]]:
    data = {key: dict(vals) for key, vals in GROUP_DEFAULTS.items()}
    path = _group_perm_path()
    if path.is_file():
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            stored = {}
        if isinstance(stored, dict):
            for group, defaults in GROUP_DEFAULTS.items():
                raw = stored.get(group)
                if not isinstance(raw, dict):
                    continue
                keys = WORKSPACE_PERM_KEYS if group == "workspace" else PERM_KEYS
                for key in keys:
                    if key in raw:
                        data[group][key] = bool(raw[key])
    return data


def save_group_permissions(groups: dict[str, dict[str, bool]]) -> dict[str, dict[str, bool]]:
    merged = load_group_permissions()
    for group, perms in (groups or {}).items():
        if group not in GROUP_DEFAULTS or not isinstance(perms, dict):
            continue
        keys = WORKSPACE_PERM_KEYS if group == "workspace" else PERM_KEYS
        for key in keys:
            if key in perms:
                merged[group][key] = bool(perms[key])
    _group_perm_path().write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    return merged


def _bool_perm(value: Any, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    try:
        return bool(int(value))
    except (TypeError, ValueError):
        return bool(value)


def _is_online(last_seen_at: str | None) -> bool:
    from backend.services.social_service import ONLINE_WINDOW_SECONDS, _now, _parse_iso

    seen = _parse_iso(last_seen_at)
    return bool(seen and (_now() - seen).total_seconds() <= ONLINE_WINDOW_SECONDS)


def _perm_list(group: str, perms: dict[str, bool]) -> list[dict[str, Any]]:
    keys = WORKSPACE_PERM_KEYS if group == "workspace" else PERM_KEYS
    return [
        {"key": key, "label": PERM_LABELS.get(key, key), "value": bool(perms.get(key))}
        for key in keys
    ]


def _person_payload(row: Any, *, extras: dict[str, Any] | None = None) -> dict[str, Any]:
    data = dict(row) if row is not None else {}
    last_seen = data.get("last_seen_at")
    payload = {
        "user_id": data.get("id") or data.get("user_id"),
        "email": data.get("email"),
        "display_name": data.get("display_name") or data.get("email") or data.get("id"),
        "online": _is_online(last_seen),
        "last_seen_at": last_seen,
        "super_admin": str(data.get("email") or "").strip().lower() in SUPER_ADMIN_EMAILS,
    }
    if extras:
        payload.update(extras)
    return payload


def _apply_platform_group(role: str, perms: dict[str, bool]) -> int:
    now = _now()
    with get_conn() as conn:
        _ensure(conn)
        cur = conn.execute(
            """
            UPDATE platform_roles
            SET can_export=?, can_edit_files=?, can_access_tools=?, updated_at=?
            WHERE role=?
            """,
            (
                int(bool(perms.get("can_export"))),
                int(bool(perms.get("can_edit_files", True))),
                int(bool(perms.get("can_access_tools", True))),
                now,
                role,
            ),
        )
        conn.commit()
        return int(cur.rowcount or 0)


def _apply_workspace_group(perms: dict[str, bool]) -> int:
    access = "edit" if perms.get("can_edit_files", True) else "view"
    with get_conn() as conn:
        from backend.services.teams_service import _ensure_member_permission_columns

        _ensure_member_permission_columns(conn)
        cur = conn.execute(
            """
            UPDATE team_members
            SET can_invite=?, access=?, can_export=?, can_access_tools=?
            WHERE lower(COALESCE(role, 'user')) NOT IN ('owner', 'admin')
            """,
            (
                int(bool(perms.get("can_invite", True))),
                access,
                int(bool(perms.get("can_export", True))),
                int(bool(perms.get("can_access_tools", True))),
            ),
        )
        conn.commit()
        return int(cur.rowcount or 0)


def set_group_permissions(
    requester: dict[str, Any],
    group: str,
    permissions: dict[str, Any],
    *,
    apply_to_members: bool = True,
) -> dict[str, Any]:
    if not is_super_admin(requester):
        raise PermissionError("Only the super admin can change group permissions")
    wanted = str(group or "").strip().lower()
    if wanted not in CONTROL_GROUPS:
        raise ValueError("Group must be manager, user, admin, or workspace")
    keys = WORKSPACE_PERM_KEYS if wanted == "workspace" else PERM_KEYS
    patch = {key: bool(permissions[key]) for key in keys if key in permissions}
    if not patch:
        raise ValueError("Provide at least one permission to change")
    merged = save_group_permissions({wanted: patch})
    applied = 0
    if apply_to_members:
        if wanted == "workspace":
            applied = _apply_workspace_group(merged["workspace"])
        else:
            applied = _apply_platform_group(wanted, merged[wanted])
    return {
        "group": wanted,
        "permissions": merged[wanted],
        "applied_to_members": applied,
        "groups": merged,
    }


def set_workspace_member_permissions(
    requester: dict[str, Any],
    team_id: str,
    target_user_id: str,
    *,
    can_invite: bool | None = None,
    can_export: bool | None = None,
    can_access_tools: bool | None = None,
    can_edit_files: bool | None = None,
) -> dict[str, Any]:
    if not is_super_admin(requester):
        raise PermissionError("Only the super admin can set workspace permissions from Management")
    from backend.services.teams_service import decorate_member_row, normalize_access, normalize_role

    if can_invite is None and can_export is None and can_access_tools is None and can_edit_files is None:
        raise ValueError("Provide a permission to change")
    with get_conn() as conn:
        from backend.services.teams_service import _ensure_member_permission_columns

        _ensure_member_permission_columns(conn)
        target = conn.execute(
            """
            SELECT role, can_invite, access, can_export, can_access_tools
            FROM team_members WHERE team_id=? AND user_id=?
            """,
            (team_id, target_user_id),
        ).fetchone()
        if not target:
            raise ValueError("User is not a member of this workspace")
        if normalize_role(target["role"]) == "owner":
            raise ValueError("Cannot change the workspace admin permissions")
        next_invite = int(bool(can_invite)) if can_invite is not None else int(target["can_invite"] or 0)
        next_export = int(bool(can_export)) if can_export is not None else int(
            target["can_export"] if target["can_export"] is not None else 1
        )
        next_tools = int(bool(can_access_tools)) if can_access_tools is not None else int(
            target["can_access_tools"] if target["can_access_tools"] is not None else 1
        )
        if can_edit_files is not None:
            next_access = "edit" if can_edit_files else "view"
        else:
            next_access = normalize_access(target["access"])
        conn.execute(
            """
            UPDATE team_members
            SET can_invite=?, access=?, can_export=?, can_access_tools=?
            WHERE team_id=? AND user_id=?
            """,
            (next_invite, next_access, next_export, next_tools, team_id, target_user_id),
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.avatar_url, tm.role, tm.joined_at,
                   tm.can_invite, tm.access, tm.can_export, tm.can_access_tools
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            WHERE tm.team_id=? AND tm.user_id=?
            """,
            (team_id, target_user_id),
        ).fetchone()
    return decorate_member_row(row)


def control_directory() -> dict[str, Any]:
    groups_perms = load_group_permissions()
    with get_conn() as conn:
        _ensure(conn)
        from backend.services.teams_service import _ensure_member_permission_columns, normalize_role

        try:
            conn.execute("ALTER TABLE users ADD COLUMN last_seen_at TEXT")
        except Exception:
            pass
        _ensure_member_permission_columns(conn)
        users = conn.execute(
            """
            SELECT id, email, display_name, last_seen_at
            FROM users
            ORDER BY lower(COALESCE(display_name, email, id))
            """
        ).fetchall()
        role_rows = conn.execute("SELECT * FROM platform_roles").fetchall()
        members = conn.execute(
            """
            SELECT tm.team_id, tm.user_id, tm.role, tm.can_invite, tm.access,
                   tm.can_export, tm.can_access_tools, t.name AS team_name,
                   u.email, u.display_name, u.last_seen_at
            FROM team_members tm
            JOIN teams t ON t.id = tm.team_id
            JOIN users u ON u.id = tm.user_id
            ORDER BY lower(COALESCE(t.name, '')), lower(COALESCE(u.display_name, u.email))
            """
        ).fetchall()

    roles_by_user = {row["user_id"]: dict(row) for row in role_rows}
    user_defaults = groups_perms["user"]
    people: list[dict[str, Any]] = []
    for row in users:
        item = _person_payload(row)
        email = str(row["email"] or "").strip().lower()
        stored = roles_by_user.get(row["id"])
        if is_super_admin({"email": email}) or email in SUPER_ADMIN_EMAILS:
            role = "admin"
            perms = {key: True for key in PERM_KEYS}
            item["super_admin"] = True
        elif stored:
            role = str(stored.get("role") or "user")
            if role not in ROLES:
                role = "user"
            perms = {
                "can_export": _bool_perm(stored.get("can_export"), False),
                "can_edit_files": _bool_perm(stored.get("can_edit_files"), True),
                "can_access_tools": _bool_perm(stored.get("can_access_tools"), True),
            }
        else:
            role = "user"
            perms = dict(user_defaults)
        item["role"] = role
        item["role_label"] = {"admin": "Admin", "manager": "Manager", "user": "User"}.get(role, "User")
        item.update(perms)
        people.append(item)

    by_id = {p["user_id"]: p for p in people}

    grouped: dict[str, list[dict[str, Any]]] = {key: [] for key in CONTROL_GROUPS}
    for person in people:
        if person["role"] == "admin" or person.get("super_admin"):
            grouped["admin"].append(person)
        elif person["role"] == "manager":
            grouped["manager"].append(person)
        else:
            grouped["user"].append(person)

    workspace_people: list[dict[str, Any]] = []
    workspace_admins: list[dict[str, Any]] = []
    workspace_stats: dict[str, dict[str, Any]] = {}
    for row in members:
        role = normalize_role(row["role"])
        access = str(row["access"] or "edit").lower()
        extras = {
            "team_id": row["team_id"],
            "team_name": row["team_name"],
            "workspace_role": role,
            "workspace_role_label": {"owner": "Workspace admin", "manager": "Manager", "user": "User"}.get(role, "User"),
            "can_invite": _bool_perm(row["can_invite"], False),
            "can_export": _bool_perm(row["can_export"], True),
            "can_access_tools": _bool_perm(row["can_access_tools"], True),
            "can_edit_files": access != "view",
            "access": access if access in {"edit", "view"} else "edit",
        }
        person = _person_payload(row, extras=extras)
        person["user_id"] = row["user_id"]
        workspace_people.append(person)
        if role == "owner":
            workspace_admins.append(person)
        ws = workspace_stats.setdefault(
            row["team_id"],
            {
                "id": row["team_id"],
                "name": row["team_name"] or row["team_id"],
                "member_count": 0,
                "online": 0,
                "owner_count": 0,
            },
        )
        ws["member_count"] += 1
        if person["online"]:
            ws["online"] += 1
        if role == "owner":
            ws["owner_count"] += 1
        platform = by_id.get(row["user_id"])
        if platform:
            memberships = platform.setdefault("workspaces", [])
            memberships.append({"id": row["team_id"], "name": row["team_name"], "role": role})

    workspace_people.sort(
        key=lambda p: (0 if p.get("workspace_role") == "owner" else 1, str(p.get("team_name") or ""), str(p.get("display_name") or ""))
    )
    grouped["workspace"] = workspace_people

    def _group_payload(group_id: str) -> dict[str, Any]:
        members_list = grouped[group_id]
        meta = GROUP_META[group_id]
        return {
            "id": group_id,
            "label": meta["label"],
            "description": meta["description"],
            "permissions": _perm_list(group_id, groups_perms[group_id]),
            "members": members_list,
            "count": len(members_list),
            "online_count": sum(1 for m in members_list if m.get("online")),
        }

    coverage = []
    total = max(len(people), 1)
    for key in PERM_KEYS:
        granted = sum(1 for p in people if p.get(key))
        coverage.append({
            "key": key,
            "label": PERM_LABELS[key],
            "granted": granted,
            "total": len(people),
            "pct": round(granted / total, 4),
        })
    ws_total = max(len(members), 1)
    ws_export = sum(1 for row in members if _bool_perm(row["can_export"], True))
    coverage.append({
        "key": "workspace_export",
        "label": "Workspace export",
        "granted": ws_export,
        "total": len(members),
        "pct": round(ws_export / ws_total, 4) if members else 0,
    })

    by_role = []
    for gid, label in (("admin", "Admin"), ("manager", "Manager"), ("user", "User")):
        by_role.append({
            "id": gid,
            "label": label,
            "count": len(grouped[gid]),
            "online": sum(1 for m in grouped[gid] if m.get("online")),
        })

    return {
        "groups": {gid: _group_payload(gid) for gid in CONTROL_GROUPS},
        "stats": {
            "user_count": len(people),
            "online_total": sum(1 for p in people if p.get("online")),
            "workspace_count": len(workspace_stats),
            "workspace_admin_count": len(workspace_admins),
            "by_role": by_role,
            "by_workspace": sorted(workspace_stats.values(), key=lambda w: (-w["member_count"], str(w["name"]))),
            "permission_coverage": coverage,
        },
        "group_permissions": groups_perms,
    }
