"""Email a one-time password reset link and apply a new password."""

from __future__ import annotations

import hashlib
import html
import logging
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.auth import get_user_by_email, hash_password
from backend.config import settings
from backend.database import get_conn
from backend.services import email_notification_service

logger = logging.getLogger("render3d.password_reset")

TOKEN_TTL = timedelta(hours=1)


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
              token_hash TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              email TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              used_at TEXT,
              created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at)"
        )
        conn.commit()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _public_origin(origin: str | None) -> str:
    raw = str(origin or "").strip().rstrip("/")
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    configured = str(getattr(settings, "public_base_url", "") or "").strip().rstrip("/")
    if configured:
        return configured
    return "https://render3d.app"


def create_reset_token(user_id: str, email: str) -> str:
    ensure_schema()
    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
            (_iso(now), user_id),
        )
        conn.execute(
            """
            INSERT INTO password_reset_tokens (token_hash, user_id, email, expires_at, used_at, created_at)
            VALUES (?, ?, ?, ?, NULL, ?)
            """,
            (token_hash, user_id, email.strip().lower(), _iso(now + TOKEN_TTL), _iso(now)),
        )
        conn.commit()
    return token


def request_reset(email: str, *, origin: str | None = None) -> dict[str, Any]:
    """Always return a generic ok payload so emails cannot be enumerated."""
    ensure_schema()
    address = (email or "").strip().lower()
    generic = {
        "ok": True,
        "message": "If an account exists for that email, we sent a reset link.",
    }
    if not address or "@" not in address or address.endswith("@social.render3d.local"):
        return generic
    user = get_user_by_email(address)
    if not user:
        return generic
    token = create_reset_token(user["id"], address)
    reset_link = f"{_public_origin(origin)}/reset-password?token={urllib.parse.quote(token)}"
    name = html.escape(str(user.get("display_name") or "there"))
    subject = "Reset your Render Studio password"
    text = (
        f"Hi {user.get('display_name') or 'there'},\n\n"
        "We received a request to reset your Render Studio password.\n"
        f"Open this link within 1 hour to choose a new password:\n{reset_link}\n\n"
        "If you did not ask for this, you can ignore the email.\n"
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:18px;background:#161b22;">
        <h1 style="margin:0 0 10px;font-size:22px;">Reset your password</h1>
        <p style="margin:0 0 16px;color:#9da7b3;line-height:1.55;">Hi {name}, use the button below within 1 hour to set a new Render Studio password.</p>
        <p style="margin:0 0 18px;">
          <a href="{html.escape(reset_link)}" style="display:inline-block;padding:11px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">Choose a new password</a>
        </p>
        <p style="margin:0;color:#8b949e;font-size:13px;line-height:1.5;">If the button does not work, copy this link:<br />{html.escape(reset_link)}</p>
        <p style="margin:16px 0 0;color:#8b949e;font-size:13px;">If you did not request this, you can ignore this email.</p>
      </div>
    </div>
  </body>
</html>"""
    try:
        result = email_notification_service.send_email(
            to_email=address,
            subject=subject,
            text=text,
            html_body=html_body,
            category="workspace_invites",
            user_id=user["id"],
            skip_preferences=True,
        )
        if not result.get("ok"):
            logger.warning("Password reset email not sent to %s: %s", address, result.get("error"))
    except Exception:
        logger.warning("Password reset email failed for %s", address, exc_info=True)
    return generic


def peek_reset_token(token: str) -> dict[str, Any] | None:
    ensure_schema()
    raw = str(token or "").strip()
    if not raw:
        return None
    token_hash = _hash_token(raw)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, email, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
    if not row or row["used_at"]:
        return None
    expires = _parse_iso(row["expires_at"])
    if not expires or expires < _now():
        return None
    return {"user_id": row["user_id"], "email": row["email"]}


def set_user_password(user_id: str, password: str) -> None:
    password_hash = hash_password(password)
    email = ""
    display_name = ""
    with get_conn() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
        row = conn.execute("SELECT email, display_name FROM users WHERE id = ?", (user_id,)).fetchone()
        conn.commit()
    if row:
        email = str(row["email"] or "")
        display_name = str(row["display_name"] or "")
    try:
        from backend.services import supabase_users_store as sbusers

        if email:
            sbusers.upsert_password_hash(user_id, email, password_hash, display_name=display_name)
    except Exception:
        logger.warning("Users table password sync failed for user_id=%s", user_id, exc_info=True)
    try:
        from backend.services import supabase_auth_service as sbauth

        if sbauth.enabled() and email:
            sbauth.migrate_local_user_password(
                email=email,
                password=password,
                app_user_id=user_id,
                display_name=display_name,
            )
    except Exception:
        logger.warning("Supabase password update failed for user_id=%s", user_id, exc_info=True)


def reset_password(token: str, password: str) -> dict[str, Any]:
    password = str(password or "")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    row = peek_reset_token(token)
    if not row:
        raise ValueError("This reset link is invalid or has expired.")
    set_user_password(row["user_id"], password)
    with get_conn() as conn:
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?",
            (_iso(_now()), _hash_token(str(token).strip())),
        )
        conn.commit()
    user = None
    with get_conn() as conn:
        found = conn.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone()
    if found:
        from backend.auth import user_row_to_dict

        user = user_row_to_dict(found)
    return {"ok": True, "user": user}
