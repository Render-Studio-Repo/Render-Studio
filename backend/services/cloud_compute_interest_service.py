"""Cloud compute waitlist: persist interest on the user, email Sam."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.database import get_conn
from backend.services.feature_request_service import SAM_EMAIL

logger = logging.getLogger("render3d.cloud_compute_interest")

MIGRATION_SQL = (
    Path(__file__).resolve().parents[2]
    / "integrations"
    / "supabase"
    / "migrations"
    / "004_cloud_compute_interest.sql"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_schema() -> None:
    with get_conn() as conn:
        try:
            conn.execute(
                "ALTER TABLE users ADD COLUMN cloud_compute_interest INTEGER NOT NULL DEFAULT 0"
            )
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN cloud_compute_interest_at TEXT")
        except sqlite3.OperationalError:
            pass
        conn.commit()
    _ensure_remote_column()


def _ensure_remote_column() -> None:
    try:
        from backend.services import supabase_client

        if not supabase_client.management_configured():
            return
        sql = MIGRATION_SQL.read_text(encoding="utf-8") if MIGRATION_SQL.is_file() else (
            "alter table public.\"Users\" add column if not exists cloud_compute_interest boolean not null default false;\n"
            "alter table public.\"Users\" add column if not exists cloud_compute_interest_at timestamptz;"
        )
        from backend.services.supabase_users_store import _sql_statements

        for chunk in _sql_statements(sql):
            supabase_client.run_management_sql(chunk + ";")
    except Exception:
        logger.debug("cloud_compute_interest remote column ensure skipped", exc_info=True)


def is_interested(user_id: str) -> bool:
    uid = str(user_id or "").strip()
    if not uid:
        return False
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT cloud_compute_interest FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
    if not row:
        return False
    try:
        return bool(int(row["cloud_compute_interest"] or 0))
    except Exception:
        return bool(row["cloud_compute_interest"])


def _persist_sqlite(user: dict[str, Any], at: str) -> None:
    uid = str(user.get("id") or "").strip()
    if not uid:
        return
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE users
               SET cloud_compute_interest = 1,
                   cloud_compute_interest_at = COALESCE(cloud_compute_interest_at, ?)
             WHERE id = ?
            """,
            (at, uid),
        )
        conn.commit()


def _persist_supabase(user: dict[str, Any], at: str) -> dict[str, Any]:
    try:
        from backend.services import supabase_users_store as sbusers

        if not sbusers.enabled():
            return {"ok": False, "skipped": True}
        uid = str(user.get("id") or "").strip()
        if not uid:
            return {"ok": False, "error": "missing_user"}
        body = {
            "cloud_compute_interest": True,
            "cloud_compute_interest_at": at,
        }
        sbusers._sb().table(sbusers.USERS_TABLE).update(body).eq("id", uid).execute()
        return {"ok": True}
    except Exception as exc:
        logger.warning("cloud_compute_interest supabase write failed", exc_info=True)
        return {"ok": False, "error": str(exc)[:240]}


def _email_sam(user: dict[str, Any], notify_email: str) -> dict[str, Any]:
    from backend.services.email_notification_service import send_email

    who = f"{user.get('display_name') or ''} <{notify_email}>".strip()
    uid = str(user.get("id") or "")
    text = (
        f"{who} signed up for cloud compute (trainings and policies).\n"
        f"User id: {uid}\n"
        f"Email: {notify_email}\n"
    )
    html_body = (
        f"<p><strong>{who}</strong> signed up for cloud compute for trainings and policies.</p>"
        f"<p>User id: {uid}</p>"
    )
    try:
        return send_email(
            to_email=SAM_EMAIL,
            subject=f"[Cloud compute] {notify_email} is interested",
            text=text,
            html_body=html_body,
            category="ops",
            skip_preferences=True,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}


def signup(user: dict[str, Any], email: str | None = None) -> dict[str, Any]:
    ensure_schema()
    uid = str(user.get("id") or "").strip()
    if not uid:
        return {"ok": False, "error": "missing_user"}
    notify_email = (email or user.get("email") or "").strip()
    already = is_interested(uid)
    at = _now()
    _persist_sqlite(user, at)
    remote = _persist_supabase(user, at)
    emailed = {"ok": False, "skipped": True}
    if not already:
        emailed = _email_sam(user, notify_email)
    return {
        "ok": True,
        "interested": True,
        "already": already,
        "email": notify_email,
        "supabase": remote,
        "notified": bool(emailed.get("ok")) and not already,
        "notify_to": SAM_EMAIL,
        "detail": (
            "You're already on the list. We'll write when cloud compute ships."
            if already
            else "You're on the list. We'll email you when cloud compute for trainings and policies is ready."
        ),
    }
