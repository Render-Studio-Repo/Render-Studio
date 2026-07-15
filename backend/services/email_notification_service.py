"""Email notification preferences and transactional email helpers."""

from __future__ import annotations

import html
import logging
import smtplib
from email.message import EmailMessage
from typing import Any

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.email_notifications")

CATEGORIES = (
    "chat_alerts",
    "purchase_alerts",
    "calendar_meetings",
    "credit_refills",
    "workspace_invites",
)

DEFAULTS = {
    "chat_alerts": False,
    "purchase_alerts": False,
    "calendar_meetings": True,
    "credit_refills": True,
    "workspace_invites": True,
}


def _now_expr() -> str:
    return "strftime('%Y-%m-%dT%H:%M:%fZ','now')"


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_email_preferences (
              user_id TEXT PRIMARY KEY,
              chat_alerts INTEGER NOT NULL DEFAULT 0,
              purchase_alerts INTEGER NOT NULL DEFAULT 0,
              calendar_meetings INTEGER NOT NULL DEFAULT 1,
              credit_refills INTEGER NOT NULL DEFAULT 1,
              workspace_invites INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )
            """
        )
        conn.commit()


def defaults() -> dict[str, bool]:
    return dict(DEFAULTS)


def get_preferences(user_id: str) -> dict[str, bool]:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM user_email_preferences WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return defaults()
    data = defaults()
    for key in CATEGORIES:
        if key in row.keys():
            data[key] = bool(row[key])
    return data


def update_preferences(user_id: str, values: dict[str, Any]) -> dict[str, bool]:
    ensure_schema()
    next_values = get_preferences(user_id)
    for key in CATEGORIES:
        if key in values:
            next_values[key] = bool(values[key])
    with get_conn() as conn:
        conn.execute(
            f"""
            INSERT INTO user_email_preferences
              (user_id, chat_alerts, purchase_alerts, calendar_meetings, credit_refills, workspace_invites, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, {_now_expr()})
            ON CONFLICT(user_id) DO UPDATE SET
              chat_alerts=excluded.chat_alerts,
              purchase_alerts=excluded.purchase_alerts,
              calendar_meetings=excluded.calendar_meetings,
              credit_refills=excluded.credit_refills,
              workspace_invites=excluded.workspace_invites,
              updated_at={_now_expr()}
            """,
            (
                user_id,
                int(next_values["chat_alerts"]),
                int(next_values["purchase_alerts"]),
                int(next_values["calendar_meetings"]),
                int(next_values["credit_refills"]),
                int(next_values["workspace_invites"]),
            ),
        )
        conn.commit()
    return next_values


def smtp_configured() -> bool:
    return bool((settings.capacity_alert_smtp_user or "").strip() and (settings.capacity_alert_smtp_password or "").strip())


def _registered_user_for_email(email: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, display_name FROM users WHERE lower(email)=lower(?)",
            ((email or "").strip(),),
        ).fetchone()
    return dict(row) if row else None


def user_allows_email(user_id: str | None, category: str) -> bool:
    if category not in CATEGORIES:
        return False
    if not user_id:
        return bool(DEFAULTS[category])
    return bool(get_preferences(user_id).get(category, DEFAULTS[category]))


def email_allows_category(email: str, category: str) -> bool:
    user = _registered_user_for_email(email)
    return user_allows_email(user.get("id") if user else None, category)


def send_email(
    *,
    to_email: str,
    subject: str,
    text: str,
    html_body: str,
    category: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    to_email = (to_email or "").strip()
    if not to_email or "@" not in to_email:
        return {"ok": False, "error": "missing_email"}
    if to_email.endswith("@social.render3d.local"):
        return {"ok": False, "error": "placeholder_social_email"}
    if not user_allows_email(user_id, category):
        return {"ok": False, "error": "disabled_by_preference", "category": category}
    if not smtp_configured():
        logger.info("Email not sent to %s: SMTP is not configured.", to_email)
        return {"ok": False, "error": "smtp_not_configured"}

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = (settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    msg["To"] = to_email
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")

    host = (settings.capacity_alert_smtp_host or "smtp.gmail.com").strip()
    port = int(settings.capacity_alert_smtp_port or 587)
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(settings.capacity_alert_smtp_user.strip(), settings.capacity_alert_smtp_password.strip())
        smtp.send_message(msg)
    return {"ok": True, "to": to_email, "category": category}


def send_workspace_invite_email(
    *,
    to_email: str,
    inviter_name: str,
    team_name: str,
    invite_url: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    safe_inviter = html.escape(inviter_name or "A teammate")
    safe_team = html.escape(team_name or "a Render3D workspace")
    safe_url = html.escape(invite_url)
    subject = f"You're invited to {team_name or 'a Render3D workspace'}"
    text = (
        f"{inviter_name or 'A teammate'} invited you to join {team_name or 'a Render3D workspace'} on Render3D.\n\n"
        f"Join workspace: {invite_url}\n\n"
        "This link accepts the workspace invite for the invited email address."
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render3d-logo.png" alt="Render3D" width="52" height="52" style="border-radius:14px;" />
        <h1 style="margin:18px 0 8px;font-size:26px;">Join {safe_team}</h1>
        <p style="margin:0 0 18px;color:#9da7b3;line-height:1.55;">{safe_inviter} invited you to collaborate in Render3D. This link accepts the invite for this email address and opens the workspace.</p>
        <a href="{safe_url}" style="display:inline-block;padding:12px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">Join workspace</a>
        <p style="margin:18px 0 0;color:#9da7b3;font-size:13px;">If the button does not work, paste this link into your browser:<br />{safe_url}</p>
      </div>
    </div>
  </body>
</html>"""
    return send_email(
        to_email=to_email,
        subject=subject,
        text=text,
        html_body=html_body,
        category="workspace_invites",
        user_id=user_id,
    )
