"""Teams, users, invites, and project access."""

from __future__ import annotations

import logging
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.auth import hash_password, verify_password
from backend.database import get_conn
from backend.services.account_email_identity import email_identity_transaction, find_email_user, normalize_email


def _ws_live() -> bool:
    try:
        from backend.services.supabase_workspace_store import live

        return live()
    except Exception:
        return False


def _ws():
    from backend.services import supabase_workspace_store as ws

    return ws

logger = logging.getLogger("render3d.auth")


class AccountServiceUnavailable(Exception):
    """Configured Supabase Auth / Users could not be reached."""

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
    _ensure_invite_grant_columns(conn)


def _ensure_invite_grant_columns(conn) -> None:
    for col, spec in (
        ("grant_chatgpt", "INTEGER NOT NULL DEFAULT 0"),
        ("grant_openai", "INTEGER NOT NULL DEFAULT 0"),
    ):
        try:
            conn.execute(f"ALTER TABLE team_invites ADD COLUMN {col} {spec}")
        except sqlite3.OperationalError:
            pass


def _invite_grant_flags(invite: Any) -> tuple[bool, bool]:
    data = dict(invite) if invite is not None else {}
    def _flag(key: str) -> bool:
        try:
            return bool(int(data.get(key) or 0))
        except (TypeError, ValueError):
            return False
    return _flag("grant_chatgpt"), _flag("grant_openai")


def apply_member_ai_access(
    team_id: str,
    user_id: str,
    requester_id: str,
    *,
    grant_openai_keys: bool = False,
    grant_chatgpt: bool = False,
    newly_added: bool = True,
) -> dict[str, Any]:
    """Default-deny shared keys, then grant ChatGPT / OpenAI when the invite asked for it."""
    from backend.services.chatgpt_share_service import grant_team_chatgpt_to_member
    from backend.services.user_ai_keys_service import (
        deny_shared_keys_for_new_member,
        grant_team_openai_keys_to_member,
    )

    chatgpt_ids: list[str] = []
    openai_ids: list[str] = []
    if newly_added and not grant_openai_keys:
        deny_shared_keys_for_new_member(team_id, user_id, updated_by=requester_id)
    if grant_openai_keys:
        openai_ids = grant_team_openai_keys_to_member(team_id, user_id, requester_id) or []
    if grant_chatgpt or grant_openai_keys:
        chatgpt_ids = grant_team_chatgpt_to_member(team_id, user_id, requester_id) or []
    return {
        "chatgpt_granted": bool(chatgpt_ids),
        "openai_granted": bool(openai_ids),
        "chatgpt_share_ids": chatgpt_ids,
    }


def _ensure_member_permission_columns(conn) -> None:
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN can_invite INTEGER NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN access TEXT NOT NULL DEFAULT 'edit'")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN can_export INTEGER NOT NULL DEFAULT 1")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN can_access_tools INTEGER NOT NULL DEFAULT 1")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE team_members ADD COLUMN explorer_visible INTEGER NOT NULL DEFAULT 1")
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
    if role == "owner":
        data["can_export"] = True
        data["can_access_tools"] = True
    else:
        raw_export = data.get("can_export")
        raw_tools = data.get("can_access_tools")
        data["can_export"] = True if raw_export is None else bool(int(raw_export or 0))
        data["can_access_tools"] = True if raw_tools is None else bool(int(raw_tools or 0))
    raw_vis = data.get("explorer_visible")
    data["explorer_visible"] = True if raw_vis is None else bool(int(raw_vis))
    handle = str(data.get("handle") or "").strip()
    if handle:
        data["handle"] = handle
        data["handle_label"] = f"@{handle}"
    return data


def _sqlite_member_role(team_id: str, user_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT role FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, user_id),
        ).fetchone()
    if not row:
        return None
    return normalize_role(row["role"])


def _sqlite_member_permissions(team_id: str, user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        row = conn.execute(
            """
            SELECT role, can_invite, access, can_export, can_access_tools
            FROM team_members
            WHERE team_id=? AND user_id=?
            """,
            (team_id, user_id),
        ).fetchone()
    if not row:
        return None
    return decorate_member_row(row)


def get_member_role(team_id: str, user_id: str) -> str | None:
    if _ws_live():
        row = _ws().get_member(team_id, user_id)
        if row:
            return normalize_role(row.get("role"))
        return _sqlite_member_role(team_id, user_id)
    return _sqlite_member_role(team_id, user_id)


def get_member_permissions(team_id: str, user_id: str) -> dict[str, Any] | None:
    if _ws_live():
        row = _ws().get_member(team_id, user_id)
        if row:
            return decorate_member_row(row)
        return _sqlite_member_permissions(team_id, user_id)
    return _sqlite_member_permissions(team_id, user_id)


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
    if _ws_live():
        access = _ws().get_project_access(project_id)
        if access:
            mem = _ws().get_member(str(access.get("team_id") or ""), user_id)
            if mem:
                return decorate_member_row(mem).get("can_edit") is True
        with get_conn() as conn:
            try:
                shared = conn.execute(
                    "SELECT role FROM project_shares WHERE project_id = ? AND user_id = ?",
                    (project_id, user_id),
                ).fetchone()
            except sqlite3.OperationalError:
                shared = None
        if not shared:
            return False
        try:
            role = str(shared["role"] or "editor").strip().lower()
        except (KeyError, IndexError, TypeError):
            role = "editor"
        return role == "editor"
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
        try:
            shared = conn.execute(
                "SELECT role FROM project_shares WHERE project_id = ? AND user_id = ?",
                (project_id, user_id),
            ).fetchone()
        except sqlite3.OperationalError:
            shared = conn.execute(
                "SELECT 1 FROM project_shares WHERE project_id = ? AND user_id = ?",
                (project_id, user_id),
            ).fetchone()
            return shared is not None
    if not shared:
        return False
    try:
        role = str(shared["role"] or "editor").strip().lower()
    except (KeyError, IndexError, TypeError):
        role = "editor"
    return role == "editor"


def create_user(
    email: str,
    password: str,
    display_name: str,
    handle: str | None = None,
) -> dict[str, Any]:
    from backend.services.profile_service import handle_availability, validate_handle

    email = normalize_email(email)
    display_name = display_name.strip() or email.split("@")[0]
    cleaned_handle: str | None = None
    if handle is not None and str(handle).strip():
        cleaned_handle = validate_handle(str(handle))
        avail = handle_availability(cleaned_handle)
        if not avail.get("available"):
            raise ValueError("That handle is already taken")
    user_id = str(uuid.uuid4())[:12]
    team_id = str(uuid.uuid4())[:8]
    now = _now()
    joined_team_ids: list[str] = []
    password_hash = hash_password(password)
    with email_identity_transaction() as conn:
        if find_email_user(conn, email):
            raise ValueError("Email already registered. Sign in using your existing account.")
        try:
            try:
                conn.execute(
                    "INSERT INTO users (id, email, display_name, password_hash, created_at, handle) VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, email, display_name, password_hash, now, cleaned_handle),
                )
            except sqlite3.OperationalError:
                conn.execute(
                    "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, email, display_name, password_hash, now),
                )
                cleaned_handle = None
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
            msg = str(exc).lower()
            if "handle" in msg:
                raise ValueError("That handle is already taken") from exc
            raise ValueError("Email already registered") from exc
    try:
        ws = _ws()
        ws.upsert_team({"id": team_id, "name": f"{first_name}'s Workspace", "created_by": user_id, "created_at": now})
        ws.upsert_member({"team_id": team_id, "user_id": user_id, "role": "owner", "joined_at": now, "can_invite": True, "access": "edit"})
        for joined in joined_team_ids:
            ws.upsert_member({"team_id": joined, "user_id": user_id, "role": "user", "joined_at": now})
    except Exception:
        logger.debug("workspace remote upsert after create_user skipped", exc_info=True)
    if joined_team_ids:
        from backend.services.user_ai_keys_service import deny_shared_keys_for_new_member

        for team_id in joined_team_ids:
            deny_shared_keys_for_new_member(team_id, user_id)
    # Best security: register password in Supabase Auth (bcrypt via GoTrue).
    # Local password_hash is cleared after a successful Supabase create.
    try:
        from backend.services import supabase_auth_service as sbauth

        if sbauth.enabled():
            sbauth.create_auth_user(
                email=email,
                password=password,
                app_user_id=user_id,
                display_name=display_name,
            )
            sbauth.upsert_profile(
                user_id=user_id,
                email=email,
                display_name=display_name,
                handle=cleaned_handle if cleaned_handle else None,
            )
    except Exception:
        pass
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.upsert_local_user(user_id)
    except Exception:
        pass
    out = {"id": user_id, "email": email, "display_name": display_name, "created_at": now}
    if cleaned_handle:
        out["handle"] = cleaned_handle
        out["profile_url"] = f"/u/{cleaned_handle}"
    return out


def _profile_from_sqlite_email(email: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        try:
            row = find_email_user(conn, email)
        except ValueError:
            return None
    if not row:
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


def _profile_from_auth_success(
    email: str,
    remote: dict[str, Any] | None,
    auth_user: dict[str, Any] | None,
) -> dict[str, Any] | None:
    from backend.services import supabase_users_store as sbusers

    user_dict = sbusers.profile_from_row(remote) if remote else None
    if user_dict and user_dict.get("id"):
        return user_dict
    local = _profile_from_sqlite_email(email)
    if local:
        return local
    app_id = ""
    if auth_user:
        meta = auth_user.get("user_metadata") or {}
        if isinstance(meta, dict):
            app_id = str(meta.get("app_user_id") or "").strip()
        if not app_id:
            app_id = str(auth_user.get("id") or "").strip()
    if not app_id:
        return None
    remote_by_id = sbusers.get_by_id(app_id)
    user_dict = sbusers.profile_from_row(remote_by_id) if remote_by_id else None
    if user_dict and user_dict.get("id"):
        return user_dict
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (app_id,)).fetchone()
    if not row:
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


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    email = email.strip().lower()
    from backend.services import supabase_users_store as sbusers

    if sbusers.prefer_supabase():
        # Always hit GoTrue first. Do not require the Users table probe — that
        # skipped Auth and made the login form look disconnected from Supabase.
        auth_result: dict[str, Any] = {"ok": False, "error": "skipped", "user": None}
        try:
            from backend.services import supabase_auth_service as sbauth

            if sbauth.enabled():
                auth_result = sbauth.sign_in(email, password)
        except Exception:
            auth_result = {"ok": False, "error": "unreachable", "user": None}

        remote = sbusers.get_by_email(email)
        hash_ok = bool(remote) and sbusers.verify_password_for_email(email, password)

        if auth_result.get("ok") or hash_ok:
            user_dict = _profile_from_auth_success(email, remote, auth_result.get("user"))
            if not user_dict or not user_dict.get("id"):
                logger.info("auth_backend=supabase_no_profile")
                return None
            local = _profile_from_sqlite_email(email)
            if local:
                user_dict["handle"] = user_dict.get("handle") or local.get("handle")
                user_dict["avatar_url"] = user_dict.get("avatar_url") or local.get("avatar_url")
            try:
                sbusers.touch_last_login(user_dict["id"])
            except Exception:
                pass
            logger.info(
                "auth_backend=%s",
                "supabase_auth" if auth_result.get("ok") else "supabase_users",
            )
            return user_dict

        users_up = False
        try:
            users_up = bool(sbusers.source_of_truth())
        except Exception:
            users_up = False
        err = str(auth_result.get("error") or "")
        if err in {"unreachable", "not_configured"} or (err == "skipped" and not users_up):
            if err in {"not_configured", "skipped"}:
                from backend.services import supabase_client

                reason = supabase_client.supabase_login_misconfigured() or (
                    "Account service is not configured. Set SUPABASE_URL and "
                    "SUPABASE_PUBLISHABLE_KEY or SUPABASE_SERVICE_ROLE_KEY "
                    "(aliases: SUPABASE_SECRET_KEY, SUPABASE_KEY)."
                )
                logger.error("auth_backend=supabase_not_configured %s", reason)
                raise AccountServiceUnavailable(reason)
            logger.info("auth_backend=supabase_unreachable")
            raise AccountServiceUnavailable("supabase_unreachable")
        logger.info("auth_backend=supabase_denied")
        return None

    user_dict = _profile_from_sqlite_email(email)
    if not user_dict:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_dict["id"],)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return None
    logger.info("auth_backend=sqlite")
    return user_dict


def _decorate_listed_team(row: dict[str, Any] | Any) -> dict[str, Any]:
    data = dict(row) if not isinstance(row, dict) else dict(row)
    item = decorate_member_row(data)
    item.update(
        {
            "id": data.get("id") or data.get("team_id"),
            "name": data.get("name"),
            "created_by": data.get("created_by"),
            "created_at": data.get("created_at"),
            "member_count": data.get("member_count") or 0,
            "explorer_visible": bool(data.get("explorer_visible", True)),
            "render_folder_provider": data.get("render_folder_provider"),
            "render_folder_ref": data.get("render_folder_ref"),
            "render_folder_label": data.get("render_folder_label"),
            "render_folder_connected_at": data.get("render_folder_connected_at"),
        }
    )
    raw_vis = data.get("explorer_visible")
    if raw_vis is not None and not isinstance(raw_vis, bool):
        try:
            item["explorer_visible"] = bool(int(raw_vis))
        except (TypeError, ValueError):
            item["explorer_visible"] = True
    return item


def _list_teams_sqlite(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        rows = conn.execute(
            """
            SELECT t.id, t.name, t.created_by, t.created_at, tm.role,
                   tm.can_invite, tm.access, tm.can_export, tm.can_access_tools,
                   COALESCE(tm.explorer_visible, 1) AS explorer_visible,
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
    return [_decorate_listed_team(row) for row in rows]


def list_teams(user_id: str) -> list[dict[str, Any]]:
    if _ws_live():
        rows = _ws().list_teams_for_user(user_id)
        out = [_decorate_listed_team(row) for row in rows]
        if out:
            return out
        sqlite_out = _list_teams_sqlite(user_id)
        if sqlite_out:
            logger.info(
                "list_teams supabase empty; using sqlite memberships user_id=%s count=%s",
                user_id,
                len(sqlite_out),
            )
        return sqlite_out
    return _list_teams_sqlite(user_id)


def list_team_members(team_id: str, user_id: str) -> list[dict[str, Any]]:
    _require_team_member(team_id, user_id)
    if _ws_live():
        members = _ws().list_members(team_id)
        ids = [str(m.get("user_id")) for m in members if m.get("user_id")]
        profiles: dict[str, dict[str, Any]] = {}
        if ids:
            try:
                from backend.services.supabase_users_store import USERS_TABLE, _sb as _users_sb

                res = (
                    _users_sb()
                    .table(USERS_TABLE)
                    .select("id,email,display_name,username,avatar_url")
                    .in_("id", ids)
                    .execute()
                )
                for p in res.data or []:
                    if isinstance(p, dict) and p.get("id"):
                        profiles[str(p["id"])] = p
            except Exception:
                logger.debug("list_team_members profile join skipped", exc_info=True)
        out = []
        for mem in members:
            uid = str(mem.get("user_id") or "")
            p = profiles.get(uid) or {}
            row = {
                **mem,
                "id": uid,
                "email": p.get("email"),
                "display_name": p.get("display_name"),
                "handle": p.get("username"),
                "avatar_url": p.get("avatar_url"),
            }
            out.append(decorate_member_row(row))
        return out
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        rows = conn.execute(
            """
            SELECT u.id, u.email, u.display_name, u.handle, u.avatar_url, tm.role, tm.joined_at,
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
            SELECT u.id, u.email, u.display_name, u.handle, u.avatar_url,
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
            GROUP BY u.id, u.email, u.display_name, u.handle, u.avatar_url
            ORDER BY lower(u.display_name), lower(u.email)
            """,
            (user_id, user_id, team_id, team_id),
        ).fetchall()
        for row in member_rows:
            email = str(row["email"] or "").strip().lower()
            handle = str(row["handle"] or "").strip()
            if not email and not handle:
                continue
            key = email or f"id:{row['id']}"
            by_email[key] = {
                "id": row["id"],
                "email": email or None,
                "display_name": row["display_name"] or handle or email,
                "handle": handle or None,
                "handle_label": f"@{handle}" if handle else None,
                "avatar_url": row["avatar_url"] or (f"/api/users/{row['id']}/avatar" if row["id"] else None),
                "source_teams": row["source_teams"] or "",
                "source": "shared_workspace",
            }

        past_invites = conn.execute(
            """
            SELECT i.email,
                   u.id AS user_id,
                   u.display_name,
                   u.handle,
                   u.avatar_url,
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
            GROUP BY i.email, u.id, u.display_name, u.handle, u.avatar_url
            ORDER BY lower(i.email)
            """,
            (user_id, user_id, team_id, team_id, team_id),
        ).fetchall()
        for row in past_invites:
            email = str(row["email"] or "").strip().lower()
            if not email or email in by_email:
                continue
            handle = str(row["handle"] or "").strip()
            uid = row["user_id"]
            by_email[email] = {
                "id": uid,
                "email": email,
                "display_name": row["display_name"] or handle or email,
                "handle": handle or None,
                "handle_label": f"@{handle}" if handle else None,
                "avatar_url": row["avatar_url"] or (f"/api/users/{uid}/avatar" if uid else None),
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
            SELECT u.id, u.email, u.display_name, u.handle, u.avatar_url, tm.role, tm.joined_at,
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
    try:
        mem = dict(row) if row else {}
        _ws().upsert_member(
            {
                "team_id": team_id,
                "user_id": target_user_id,
                "role": mem.get("role") or wanted,
                "joined_at": mem.get("joined_at") or _now(),
                "can_invite": mem.get("can_invite"),
                "access": mem.get("access") or "edit",
            }
        )
    except Exception:
        logger.debug("workspace set_member_role remote skipped", exc_info=True)
    return decorate_member_row(row)


def set_member_permissions(
    team_id: str,
    target_user_id: str,
    requester_id: str,
    *,
    can_invite: bool | None = None,
    access: str | None = None,
    can_export: bool | None = None,
    can_access_tools: bool | None = None,
) -> dict[str, Any]:
    """Workspace owner sets invite + edit/view + export/tools for a member."""
    _require_team_owner(team_id, requester_id)
    if target_user_id == requester_id:
        raise ValueError("You cannot change your own workspace admin permissions")
    if can_invite is None and access is None and can_export is None and can_access_tools is None:
        raise ValueError("Provide a permission to change")
    wanted_access = normalize_access(access) if access is not None else None
    if wanted_access is not None and wanted_access not in ACCESS_LEVELS:
        raise ValueError("Access must be edit or view")
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        target = conn.execute(
            "SELECT role, can_invite, access, can_export, can_access_tools FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not target:
            raise ValueError("User is not a member of this workspace")
        if normalize_role(target["role"]) == "owner":
            raise ValueError("Cannot change the workspace admin permissions")
        next_invite = int(bool(can_invite)) if can_invite is not None else int(target["can_invite"] or 0)
        next_access = wanted_access if wanted_access is not None else normalize_access(target["access"])
        next_export = int(bool(can_export)) if can_export is not None else int(target["can_export"] if target["can_export"] is not None else 1)
        next_tools = int(bool(can_access_tools)) if can_access_tools is not None else int(target["can_access_tools"] if target["can_access_tools"] is not None else 1)
        conn.execute(
            "UPDATE team_members SET can_invite=?, access=?, can_export=?, can_access_tools=? WHERE team_id=? AND user_id=?",
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


def transfer_ownership(team_id: str, target_user_id: str, requester_id: str) -> dict[str, Any]:
    """Workspace owner hands admin to another member."""
    _require_team_owner(team_id, requester_id)
    if target_user_id == requester_id:
        raise ValueError("You already own this workspace")
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        target = conn.execute(
            "SELECT role FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not target:
            raise ValueError("User is not a member of this workspace")
        conn.execute(
            "UPDATE team_members SET role='user' WHERE team_id=? AND user_id=? AND role IN ('owner', 'admin')",
            (team_id, requester_id),
        )
        conn.execute(
            """
            UPDATE team_members
            SET role='owner', can_invite=1, access='edit', can_export=1, can_access_tools=1
            WHERE team_id=? AND user_id=?
            """,
            (team_id, target_user_id),
        )
        try:
            conn.execute("UPDATE teams SET created_by=? WHERE id=?", (target_user_id, team_id))
        except sqlite3.OperationalError:
            pass
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


def _require_team_member(team_id: str, user_id: str) -> None:
    if get_member_role(team_id, user_id) is None:
        raise PermissionError("Not a member of this team")


def set_explorer_visible(team_id: str, user_id: str, visible: bool) -> dict[str, Any]:
    """Per-member hide/show in the left sidebar. Default is show (1)."""
    _require_team_member(team_id, user_id)
    flag = 1 if visible else 0
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        conn.execute(
            "UPDATE team_members SET explorer_visible=? WHERE team_id=? AND user_id=?",
            (flag, team_id, user_id),
        )
        conn.commit()
    return {"team_id": team_id, "explorer_visible": bool(flag)}


def _require_team_owner(team_id: str, user_id: str) -> None:
    role = get_member_role(team_id, user_id)
    if role != "owner":
        raise PermissionError("Only workspace admins can do that")


def _require_team_manager(team_id: str, user_id: str) -> None:
    role = get_member_role(team_id, user_id)
    if not can_manage_workspace(role):
        raise PermissionError("Only workspace admins or managers can do that")


def _user_public_card(row: Any, *, include_email: bool) -> dict[str, Any]:
    data = dict(row)
    handle = str(data.get("handle") or "").strip()
    out = {
        "id": data.get("id"),
        "display_name": data.get("display_name") or handle or (data.get("email") or "User"),
        "handle": handle or None,
        "handle_label": f"@{handle}" if handle else None,
        "avatar_url": data.get("avatar_url"),
    }
    if include_email:
        out["email"] = str(data.get("email") or "").strip().lower() or None
    return out


def have_shared_workspace(requester_id: str, target_user_id: str) -> bool:
    """True when both users are currently members of the same workspace."""
    if not requester_id or not target_user_id or requester_id == target_user_id:
        return False
    if _ws_live():
        a = {str(m.get("team_id")) for m in _ws().list_user_memberships(requester_id)}
        b = {str(m.get("team_id")) for m in _ws().list_user_memberships(target_user_id)}
        return bool(a & b)
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT 1
            FROM team_members a
            JOIN team_members b ON a.team_id = b.team_id
            WHERE a.user_id = ? AND b.user_id = ?
            LIMIT 1
            """,
            (requester_id, target_user_id),
        ).fetchone()
    return bool(row)


def lookup_invite_person(
    requester_id: str,
    query: str,
    team_id: str | None = None,
) -> dict[str, Any]:
    """Search a registered user by email, @handle, or name for workspace invites."""
    raw = (query or "").strip()
    if not raw:
        return {"status": "empty", "matches": []}
    looks_email = "@" in raw and "." in raw.split("@")[-1] and " " not in raw
    handle_q = raw.lstrip("@").strip()
    email_q = raw.strip().lower()
    if team_id:
        _require_team_member(team_id, requester_id)

    with get_conn() as conn:
        rows: list[Any] = []
        try:
            if looks_email:
                found = conn.execute(
                    """
                    SELECT id, email, display_name, handle, avatar_url
                    FROM users WHERE lower(email)=? LIMIT 1
                    """,
                    (email_q,),
                ).fetchone()
                rows = [found] if found else []
            else:
                exact_handle = conn.execute(
                    """
                    SELECT id, email, display_name, handle, avatar_url
                    FROM users WHERE lower(COALESCE(handle,''))=lower(?) LIMIT 8
                    """,
                    (handle_q,),
                ).fetchall()
                if exact_handle:
                    rows = list(exact_handle)
                else:
                    like = f"%{handle_q.lower()}%"
                    prefix = f"{handle_q.lower()}%"
                    rows = list(
                        conn.execute(
                            """
                            SELECT id, email, display_name, handle, avatar_url
                            FROM users
                            WHERE lower(display_name) LIKE ?
                               OR lower(COALESCE(handle,'')) LIKE ?
                            ORDER BY
                              CASE WHEN lower(display_name) LIKE ? THEN 0
                                   WHEN lower(COALESCE(handle,'')) LIKE ? THEN 1
                                   ELSE 2 END,
                              lower(display_name)
                            LIMIT 8
                            """,
                            (like, like, prefix, prefix),
                        ).fetchall()
                    )
        except sqlite3.OperationalError:
            if looks_email:
                found = conn.execute(
                    "SELECT id, email, display_name FROM users WHERE lower(email)=? LIMIT 1",
                    (email_q,),
                ).fetchone()
                rows = [found] if found else []
            else:
                like = f"%{handle_q.lower()}%"
                rows = list(
                    conn.execute(
                        """
                        SELECT id, email, display_name FROM users
                        WHERE lower(display_name) LIKE ? OR lower(email) LIKE ?
                        ORDER BY display_name LIMIT 8
                        """,
                        (like, like),
                    ).fetchall()
                )

        if not rows:
            return {
                "status": "not_found",
                "message": "This user doesn't exist",
                "matches": [],
            }

        member_ids: set[str] = set()
        if team_id:
            member_ids = {
                str(r["user_id"])
                for r in conn.execute(
                    "SELECT user_id FROM team_members WHERE team_id=?",
                    (team_id,),
                ).fetchall()
            }

        matches: list[dict[str, Any]] = []
        for row in rows:
            uid = str(row["id"])
            email = str(row["email"] or "").strip().lower()
            worked = have_shared_workspace(requester_id, uid)
            already = uid in member_ids
            include_email = looks_email or worked or already
            card = _user_public_card(row, include_email=include_email)
            card["worked_together"] = worked
            card["already_member"] = already
            card["needs_confirm"] = not worked and not already
            if already:
                card["message"] = "Already in this workspace"
            elif not worked:
                handle_label = card.get("handle_label") or card.get("display_name")
                card["message"] = f"You haven't worked with this person yet ({handle_label})"
            else:
                card["message"] = None
            matches.append(card)

    primary = matches[0]
    status = "found"
    message = primary.get("message")
    if len(matches) == 1 and primary.get("already_member"):
        status = "already_member"
    return {
        "status": status,
        "message": message if len(matches) == 1 else None,
        "user": primary if len(matches) == 1 else None,
        "matches": matches,
        "needs_confirm": bool(len(matches) == 1 and primary.get("needs_confirm")),
    }


def add_registered_user_to_team(
    team_id: str,
    email: str | None = None,
    requester_id: str = "",
    *,
    handle: str | None = None,
    grant_openai_keys: bool = False,
    grant_chatgpt: bool = False,
    confirm_new_collaborator: bool = False,
) -> dict[str, Any]:
    """Add an existing registered user immediately (no accept). Unknown emails stay as invites.

    Accepts email and/or handle (Discord-style). Handle is resolved to a registered user.
    First-time collaborators require confirm_new_collaborator=True.
    """
    if not member_can_invite(team_id, requester_id):
        raise PermissionError("You do not have permission to invite people to this workspace")
    email = (email or "").strip().lower()
    handle_raw = (handle or "").strip().lstrip("@")
    if not email and not handle_raw:
        raise ValueError("Email or @handle is required")
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        user = None
        if handle_raw:
            try:
                user = conn.execute(
                    "SELECT id, email, display_name, handle FROM users WHERE lower(COALESCE(handle,''))=lower(?)",
                    (handle_raw,),
                ).fetchone()
            except sqlite3.OperationalError:
                user = None
            if not user:
                raise LookupError(f"This user doesn't exist")
            email = str(user["email"] or "").strip().lower()
        if not user and email:
            user = conn.execute(
                "SELECT id, email, display_name, handle FROM users WHERE lower(email)=?",
                (email,),
            ).fetchone()
        if not user:
            raise LookupError("This user doesn't exist")
        existing = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, user["id"]),
        ).fetchone()
        if existing:
            grants = {}
            if grant_openai_keys or grant_chatgpt:
                grants = apply_member_ai_access(
                    team_id,
                    user["id"],
                    requester_id,
                    grant_openai_keys=grant_openai_keys,
                    grant_chatgpt=grant_chatgpt,
                    newly_added=False,
                )
            return {"status": "already_member", "user": dict(user), **grants}
        worked = have_shared_workspace(requester_id, user["id"])
        if not worked and not confirm_new_collaborator:
            handle_label = f"@{user['handle']}" if user["handle"] else (user["display_name"] or email)
            return {
                "status": "needs_confirm",
                "message": f"You haven't worked with this person yet. Share this workspace with {handle_label}?",
                "user": _user_public_card(user, include_email=True),
                "needs_confirm": True,
            }
        conn.execute(
            """
            INSERT INTO team_members (team_id, user_id, role, joined_at, can_invite, access)
            VALUES (?, ?, 'user', ?, 0, 'edit')
            """,
            (team_id, user["id"], _now()),
        )
        conn.execute(
            "UPDATE team_invites SET status='accepted' WHERE team_id=? AND lower(email)=? AND status='pending'",
            (team_id, email),
        )
        conn.commit()
    try:
        _ws().upsert_member(
            {
                "team_id": team_id,
                "user_id": user["id"],
                "role": "user",
                "joined_at": _now(),
                "can_invite": False,
                "access": "edit",
            }
        )
    except Exception:
        logger.debug("workspace member remote upsert skipped", exc_info=True)
    grants = apply_member_ai_access(
        team_id,
        user["id"],
        requester_id,
        grant_openai_keys=grant_openai_keys,
        grant_chatgpt=grant_chatgpt,
        newly_added=True,
    )
    return {"status": "added", "user": dict(user), **grants}


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
        try:
            conn.execute(
                "DELETE FROM team_chatgpt_grants WHERE user_id=? "
                "AND share_id IN (SELECT id FROM team_shared_chatgpt WHERE team_id=?)",
                (target_user_id, team_id),
            )
        except sqlite3.OperationalError:
            pass
        conn.commit()
    try:
        _ws().delete_member(team_id, target_user_id)
    except Exception:
        logger.debug("workspace member remote delete skipped", exc_info=True)
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


def personal_team_id(user_id: str) -> str | None:
    if _ws_live():
        remote = _ws().personal_team_id(user_id)
        if remote:
            return remote
    with get_conn() as conn:
        return _personal_team_id_for_user(conn, user_id)


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
            ("DELETE FROM team_chatgpt_grants WHERE share_id IN (SELECT id FROM team_shared_chatgpt WHERE team_id=?)", (team_id,)),
            ("DELETE FROM team_shared_chatgpt WHERE team_id=?", (team_id,)),
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
    try:
        _ws().upsert_team({"id": team_id, "name": name.strip(), "created_by": user_id, "created_at": now})
        _ws().upsert_member(
            {"team_id": team_id, "user_id": user_id, "role": "owner", "joined_at": now, "can_invite": True, "access": "edit"}
        )
    except Exception:
        logger.debug("workspace create_team remote skipped", exc_info=True)
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
        "explorer_visible": True,
        "member_count": 1,
        "render_folder_provider": "render3d",
        "render_folder_ref": None,
        "render_folder_label": None,
        "render_folder_connected_at": None,
    }


_VIEW_ONLY_WORKSPACE = (
    "This shared workspace is view-only for your account. Ask the workspace admin for edit access."
)


def personal_workspace_name(user: dict[str, Any] | None = None) -> str:
    raw = str((user or {}).get("display_name") or "").strip()
    if not raw:
        email = str((user or {}).get("email") or "").strip()
        raw = email.split("@")[0] if email else "My"
    first = raw.split()[0] if raw.split() else "My"
    return f"{first}'s Workspace"


def ensure_personal_team(user: dict[str, Any]) -> dict[str, Any]:
    """Return an existing workspace, or create the user's personal '{Name}'s Workspace'."""
    user_id = str((user or {}).get("id") or "").strip()
    if not user_id:
        raise ValueError("user_id is required")
    teams = list_teams(user_id)
    if teams:
        pid = personal_team_id(user_id)
        if pid:
            found = next((t for t in teams if str(t.get("id")) == str(pid)), None)
            if found:
                return found
        return teams[0]
    logger.info("Creating personal workspace for user_id=%s", user_id)
    return create_team(personal_workspace_name(user), user_id)


def ensure_user_teams(user: dict[str, Any]) -> list[dict[str, Any]]:
    team = ensure_personal_team(user)
    teams = list_teams(str(user.get("id") or ""))
    return teams or ([team] if team else [])


def resolve_writable_team_id(user: dict[str, Any], requested: str | None = None) -> str:
    """Pick a workspace the user can edit. Auto-creates a personal one if they have none.

    Unknown or stale requested ids fall back to the personal/default workspace instead of 403.
    """
    teams = ensure_user_teams(user)
    if not teams:
        raise ValueError("No workspace available")
    ids = {str(t.get("id") or "") for t in teams if t.get("id")}
    tid = str(requested or "").strip()
    user_id = str(user.get("id") or "")
    if tid and tid in ids:
        if not member_can_edit(tid, user_id):
            raise PermissionError(_VIEW_ONLY_WORKSPACE)
        return tid
    if tid:
        logger.info(
            "requested team_id=%s is not a membership for user_id=%s; using personal workspace",
            tid,
            user_id,
        )
    personal = personal_team_id(user_id)
    fallback = personal if personal and personal in ids else str(teams[0]["id"])
    if member_can_edit(fallback, user_id):
        return fallback
    for team in teams:
        candidate = str(team.get("id") or "")
        if candidate and member_can_edit(candidate, user_id):
            return candidate
    raise PermissionError(_VIEW_ONLY_WORKSPACE)


def invite_user_to_team(
    team_id: str,
    email: str,
    inviter_id: str,
    *,
    grant_chatgpt: bool = False,
    grant_openai_keys: bool = False,
) -> dict[str, Any]:
    if not member_can_invite(team_id, inviter_id):
        raise PermissionError("You do not have permission to invite people to this workspace")
    email = email.strip().lower()
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
        user = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email)=lower(?)",
            (email,),
        ).fetchone()
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
            WHERE team_id = ? AND lower(email) = lower(?) AND status = 'pending'
            """,
            (team_id, email),
        ).fetchone()
        chatgpt_flag = 1 if grant_chatgpt else 0
        openai_flag = 1 if grant_openai_keys else 0
        if pending:
            token = pending["token"] if "token" in pending.keys() else None
            if not token:
                token = _invite_token()
                conn.execute("UPDATE team_invites SET token=? WHERE id=?", (token, pending["id"]))
            conn.execute(
                "UPDATE team_invites SET grant_chatgpt=?, grant_openai=? WHERE id=?",
                (chatgpt_flag, openai_flag, pending["id"]),
            )
            conn.commit()
            return {
                "status": "invited",
                "email": email,
                "invite_id": pending["id"],
                "invite_token": token,
                "grant_chatgpt": bool(chatgpt_flag),
                "openai_granted": False,
                "chatgpt_granted": False,
            }

        invite_id = str(uuid.uuid4())[:8]
        token = _invite_token()
        conn.execute(
            """
            INSERT INTO team_invites (
                id, team_id, email, invited_by, status, created_at, token, grant_chatgpt, grant_openai
            )
            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
            """,
            (invite_id, team_id, email, inviter_id, _now(), token, chatgpt_flag, openai_flag),
        )
        conn.commit()
        return {
            "status": "invited",
            "email": email,
            "invite_id": invite_id,
            "invite_token": token,
            "grant_chatgpt": bool(chatgpt_flag),
            "openai_granted": False,
            "chatgpt_granted": False,
        }


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
            WHERE lower(i.email) = lower(?) AND i.status = 'pending'
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
        if not invite or str(invite["email"] or "").strip().lower() != email:
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

    grant_chatgpt, grant_openai = _invite_grant_flags(invite)
    grants = {}
    if newly_added or grant_chatgpt or grant_openai:
        grants = apply_member_ai_access(
            invite["team_id"],
            user_id,
            invite["invited_by"] or user_id,
            grant_openai_keys=grant_openai,
            grant_chatgpt=grant_chatgpt,
            newly_added=newly_added,
        )
    folders_service.grant_pending_folder_shares(user_id, email, invite["team_id"])
    return {"status": "accepted", "team": dict(team), **grants}


def accept_pending_invites_for_user(user_id: str, email: str) -> list[dict[str, Any]]:
    """Auto-claim pending workspace invites for a newly verified social-login email."""
    email = email.strip().lower()
    if not user_id or not email:
        return []
    accepted: list[dict[str, Any]] = []
    with get_conn() as conn:
        _ensure_invite_token_column(conn)
        rows = conn.execute(
            """
            SELECT i.id, i.team_id, i.email, i.invited_by,
                   COALESCE(i.grant_chatgpt, 0) AS grant_chatgpt,
                   COALESCE(i.grant_openai, 0) AS grant_openai,
                   t.name AS team_name
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
            conn.execute("UPDATE team_invites SET status = 'accepted' WHERE id = ?", (invite["id"],))
            accepted.append({
                "id": invite["id"],
                "team_id": invite["team_id"],
                "team_name": invite["team_name"],
                "invited_by": invite["invited_by"],
                "grant_chatgpt": bool(int(invite["grant_chatgpt"] or 0)),
                "grant_openai": bool(int(invite["grant_openai"] or 0)),
                "newly_added": not existing,
            })
        if accepted:
            conn.commit()
    if accepted:
        from backend.services import folders_service

        for item in accepted:
            apply_member_ai_access(
                item["team_id"],
                user_id,
                item.get("invited_by") or user_id,
                grant_openai_keys=bool(item.get("grant_openai")),
                grant_chatgpt=bool(item.get("grant_chatgpt")),
                newly_added=bool(item.get("newly_added")),
            )
            folders_service.grant_pending_folder_shares(user_id, email, item["team_id"])
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

    grant_chatgpt, grant_openai = _invite_grant_flags(invite)
    grants = {}
    if newly_added or grant_chatgpt or grant_openai:
        grants = apply_member_ai_access(
            invite["team_id"],
            user["id"],
            invite["invited_by"] or user["id"],
            grant_openai_keys=grant_openai,
            grant_chatgpt=grant_chatgpt,
            newly_added=newly_added,
        )
    folders_service.grant_pending_folder_shares(user["id"], invite["email"], invite["team_id"])
    return {"status": "accepted", "team": team, "user": dict(user), **grants}


def decline_team_invite(invite_id: str, email: str) -> dict[str, Any]:
    email = email.strip().lower()
    with get_conn() as conn:
        invite = conn.execute(
            "SELECT id FROM team_invites WHERE id = ? AND lower(email) = lower(?) AND status = 'pending'",
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
            if not d.is_dir() or d.name.startswith("."):
                continue
            try:
                from backend.services.project_lifecycle import is_project_deleted, remove_leftover_deleted_project

                if is_project_deleted(d.name):
                    remove_leftover_deleted_project(projects_root, d.name)
                    continue
            except Exception:
                pass
            if d.name in registered:
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
    try:
        _ws().upsert_project_access(
            {"project_id": project_id, "team_id": team_id, "created_by": user_id, "created_at": _now()}
        )
    except Exception:
        logger.debug("workspace project_access remote skipped", exc_info=True)


def move_project_to_workspace(project_id: str, target_team_id: str, user_id: str) -> dict[str, Any]:
    """Save / move a project into another workspace the user belongs to."""
    tid = str(target_team_id or "").strip()
    pid = str(project_id or "").strip()
    if not tid or not pid:
        raise ValueError("Pick a workspace")
    _require_team_member(tid, user_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT project_id, team_id, folder_id, created_by FROM project_access WHERE project_id = ?",
            (pid,),
        ).fetchone()
        if not row:
            raise ValueError("Project has no workspace yet")
        current_team = str(row["team_id"] or "")
        if current_team != tid:
            _require_team_member(current_team, user_id)
            role_row = conn.execute(
                "SELECT role FROM team_members WHERE team_id = ? AND user_id = ?",
                (current_team, user_id),
            ).fetchone()
            is_owner = str(row["created_by"] or "") == str(user_id)
            is_admin = bool(role_row and role_row["role"] in {"owner", "admin"})
            if not (is_owner or is_admin):
                raise PermissionError("Only the project owner or a workspace admin can move it")
        conn.execute(
            """
            UPDATE project_access
               SET team_id = ?, folder_id = NULL
             WHERE project_id = ?
            """,
            (tid, pid),
        )
        team = conn.execute("SELECT id, name FROM teams WHERE id = ?", (tid,)).fetchone()
        conn.commit()
    try:
        _ws().upsert_project_access(
            {
                "project_id": pid,
                "team_id": tid,
                "folder_id": None,
                "created_by": (row["created_by"] if row else user_id),
            }
        )
    except Exception:
        logger.debug("workspace move_project remote skipped", exc_info=True)
    return {
        "project_id": pid,
        "team_id": tid,
        "team_name": (team["name"] if team else tid),
        "folder_id": None,
    }


def user_project_access(user_id: str, team_id: str | None = None) -> list[dict[str, Any]]:
    if _ws_live():
        return [decorate_member_row(r) for r in _ws().user_project_access(user_id, team_id)]
    with get_conn() as conn:
        _ensure_member_permission_columns(conn)
        if team_id:
            rows = conn.execute(
                """
                SELECT pa.project_id, pa.team_id, pa.folder_id, pa.sort_order,
                       pa.created_by, u.email AS owner_email, u.display_name AS owner_name,
                       tm.role, tm.can_invite, tm.access
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
                       pa.created_by, u.email AS owner_email, u.display_name AS owner_name,
                       tm.role, tm.can_invite, tm.access
                FROM project_access pa
                JOIN team_members tm ON tm.team_id = pa.team_id
                LEFT JOIN users u ON u.id = pa.created_by
                WHERE tm.user_id = ?
                ORDER BY pa.sort_order ASC, pa.created_at DESC
                """,
                (user_id,),
            ).fetchall()
    return [decorate_member_row(r) for r in rows]


def get_team_for_user(team_id: str, user_id: str) -> dict[str, Any] | None:
    if _ws_live():
        mem = _ws().get_member(team_id, user_id)
        team = _ws().get_team(team_id)
        if not mem or not team:
            return None
        out = dict(team)
        out["role"] = mem.get("role")
        return out
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
    if _ws_live():
        tid = _ws().project_team_id(project_id)
        if tid and _ws().get_member(tid, user_id):
            return True
        with get_conn() as conn:
            shared = conn.execute(
                "SELECT 1 FROM project_shares WHERE project_id = ? AND user_id = ?",
                (project_id, user_id),
            ).fetchone()
        return shared is not None
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
    try:
        _ws().delete_project_access(project_id)
    except Exception:
        logger.debug("workspace delete_project_access remote skipped", exc_info=True)


def team_project_ids(team_id: str) -> list[str]:
    if _ws_live():
        return _ws().team_project_ids(team_id)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT project_id FROM project_access WHERE team_id = ?",
            (team_id,),
        ).fetchall()
    return [r["project_id"] for r in rows]


def team_member_ids(team_id: str) -> list[str]:
    if _ws_live():
        return _ws().team_member_ids(team_id)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT user_id FROM team_members WHERE team_id = ?",
            (team_id,),
        ).fetchall()
    return [r["user_id"] for r in rows]


def project_team_id(project_id: str) -> str | None:
    if _ws_live():
        return _ws().project_team_id(project_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT team_id FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
    return row["team_id"] if row else None
