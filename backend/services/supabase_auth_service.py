"""Supabase Auth for passwords (GoTrue bcrypt) — source of truth when configured.

Local SQLite keeps app profile / teams / projects. Passwords are verified via
Supabase Auth; we do not store plaintext passwords, and after a successful
Supabase sync we clear the local password_hash so hashes aren't duplicated.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.database import get_conn
from backend.services import supabase_client

logger = logging.getLogger("render3d.supabase_auth")


def enabled() -> bool:
    return supabase_client.configured()


def _admin():
    return supabase_client.get_admin_client()


def _ensure_supabase_user_id_column(conn) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "supabase_user_id" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN supabase_user_id TEXT")


def get_local_supabase_user_id(user_id: str) -> str | None:
    with get_conn() as conn:
        _ensure_supabase_user_id_column(conn)
        row = conn.execute(
            "SELECT supabase_user_id FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    val = str(row["supabase_user_id"] or "").strip()
    return val or None


def set_local_supabase_user_id(user_id: str, supabase_user_id: str, *, clear_local_hash: bool = False) -> None:
    with get_conn() as conn:
        _ensure_supabase_user_id_column(conn)
        if clear_local_hash:
            conn.execute(
                "UPDATE users SET supabase_user_id = ?, password_hash = '' WHERE id = ?",
                (supabase_user_id, user_id),
            )
        else:
            conn.execute(
                "UPDATE users SET supabase_user_id = ? WHERE id = ?",
                (supabase_user_id, user_id),
            )
        conn.commit()


def upsert_profile(
    *,
    user_id: str,
    email: str,
    display_name: str,
    handle: str | None = None,
    supabase_user_id: str | None = None,
) -> None:
    if not enabled():
        return
    try:
        payload: dict[str, Any] = {
            "id": user_id,
            "email": email.strip().lower(),
            "display_name": display_name or "",
            "handle": handle,
            "updated_at": "now()",
        }
        if supabase_user_id:
            payload["supabase_user_id"] = supabase_user_id
        # PostgREST wants ISO timestamps; use client-side now for updated_at.
        from datetime import datetime, timezone

        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        _admin().table("render_profiles").upsert(payload, on_conflict="id").execute()
    except Exception:
        logger.warning("Supabase upsert_profile failed for %s", user_id, exc_info=True)


def create_auth_user(
    *,
    email: str,
    password: str,
    app_user_id: str,
    display_name: str,
) -> str | None:
    """Create a Supabase Auth user. Returns supabase UUID or None."""
    if not enabled():
        return None
    try:
        res = _admin().auth.admin.create_user(
            {
                "email": email.strip().lower(),
                "password": password,
                "email_confirm": True,
                "user_metadata": {
                    "app_user_id": app_user_id,
                    "display_name": display_name,
                },
            }
        )
        user = getattr(res, "user", None) or (res.get("user") if isinstance(res, dict) else None)
        sid = str(getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else "") or "")
        if sid:
            set_local_supabase_user_id(app_user_id, sid, clear_local_hash=True)
            upsert_profile(
                user_id=app_user_id,
                email=email,
                display_name=display_name,
                supabase_user_id=sid,
            )
        return sid or None
    except Exception:
        logger.warning("Supabase create_auth_user failed for %s", email, exc_info=True)
        return None


def import_auth_user_with_hash(
    *,
    email: str,
    password_hash: str,
    app_user_id: str,
    display_name: str,
) -> str | None:
    """Import existing bcrypt hash into Supabase Auth (no plaintext password needed)."""
    if not enabled() or not password_hash or not password_hash.startswith("$2"):
        return None
    try:
        res = _admin().auth.admin.create_user(
            {
                "email": email.strip().lower(),
                "password_hash": password_hash,
                "email_confirm": True,
                "user_metadata": {
                    "app_user_id": app_user_id,
                    "display_name": display_name,
                },
            }
        )
        user = getattr(res, "user", None) or (res.get("user") if isinstance(res, dict) else None)
        sid = str(getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else "") or "")
        if sid:
            set_local_supabase_user_id(app_user_id, sid, clear_local_hash=True)
            upsert_profile(
                user_id=app_user_id,
                email=email,
                display_name=display_name,
                supabase_user_id=sid,
            )
        return sid or None
    except Exception:
        logger.warning("Supabase import_auth_user_with_hash failed for %s", email, exc_info=True)
        return None


def verify_password(email: str, password: str) -> bool:
    """Verify credentials against Supabase Auth. False if unavailable or wrong."""
    if not enabled():
        return False
    try:
        # Prefer admin-generated session via password grant through public auth API.
        res = _admin().auth.sign_in_with_password(
            {"email": email.strip().lower(), "password": password}
        )
        session = getattr(res, "session", None) or (res.get("session") if isinstance(res, dict) else None)
        return bool(session)
    except Exception:
        return False


def migrate_local_user_password(
    *,
    email: str,
    password: str,
    app_user_id: str,
    display_name: str,
) -> bool:
    """After successful local bcrypt login, create/link Supabase Auth user."""
    if not enabled():
        return False
    existing = get_local_supabase_user_id(app_user_id)
    if existing:
        # Ensure password is current (user may have only local hash updated).
        try:
            _admin().auth.admin.update_user_by_id(
                existing,
                {"password": password},
            )
            set_local_supabase_user_id(app_user_id, existing, clear_local_hash=True)
            return True
        except Exception:
            logger.warning("Supabase update password failed for %s", email, exc_info=True)
            return False
    sid = create_auth_user(
        email=email,
        password=password,
        app_user_id=app_user_id,
        display_name=display_name,
    )
    return bool(sid)


def sync_all_users_to_supabase(*, limit: int = 500) -> dict[str, Any]:
    """Batch: upsert profiles + import bcrypt hashes into Auth when possible."""
    if not enabled():
        return {"ok": False, "error": "not_configured"}
    imported = 0
    profiled = 0
    skipped = 0
    errors: list[str] = []
    with get_conn() as conn:
        _ensure_supabase_user_id_column(conn)
        rows = conn.execute(
            """
            SELECT id, email, display_name, password_hash, handle, supabase_user_id
            FROM users
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (int(limit),),
        ).fetchall()
    for row in rows:
        uid = str(row["id"])
        email = str(row["email"] or "").strip().lower()
        display_name = str(row["display_name"] or email.split("@")[0])
        handle = row["handle"] if "handle" in row.keys() else None
        ph = str(row["password_hash"] or "")
        sid = str(row["supabase_user_id"] or "").strip() or None
        try:
            if not sid and ph.startswith("$2"):
                sid = import_auth_user_with_hash(
                    email=email,
                    password_hash=ph,
                    app_user_id=uid,
                    display_name=display_name,
                )
                if sid:
                    imported += 1
                else:
                    skipped += 1
            elif not sid:
                # Social / empty password — profile only
                skipped += 1
            upsert_profile(
                user_id=uid,
                email=email,
                display_name=display_name,
                handle=handle,
                supabase_user_id=sid,
            )
            profiled += 1
        except Exception as exc:
            errors.append(f"{email}: {str(exc)[:120]}")
    return {
        "ok": True,
        "profiled": profiled,
        "imported_auth": imported,
        "skipped": skipped,
        "errors": errors[:20],
        "total": len(rows),
    }


def status() -> dict[str, Any]:
    base = supabase_client.status()
    if not enabled():
        return {"ok": False, "error": "not_configured", **base}
    try:
        # Lightweight Auth admin call
        _admin().auth.admin.list_users(page=1, per_page=1)
        return {"ok": True, "auth": True, **base}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240], "auth": False, **base}
