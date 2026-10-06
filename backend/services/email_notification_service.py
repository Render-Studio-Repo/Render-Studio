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
    "meeting_reminders",
    "credit_refills",
    "workspace_invites",
)

DEFAULTS = {
    "chat_alerts": False,
    "purchase_alerts": False,
    "calendar_meetings": True,
    "meeting_reminders": True,
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
              meeting_reminders INTEGER NOT NULL DEFAULT 1,
              credit_refills INTEGER NOT NULL DEFAULT 1,
              workspace_invites INTEGER NOT NULL DEFAULT 1,
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )
            """
        )
        try:
            conn.execute(
                "ALTER TABLE user_email_preferences ADD COLUMN meeting_reminders INTEGER NOT NULL DEFAULT 1"
            )
        except Exception:
            pass
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
              (user_id, chat_alerts, purchase_alerts, calendar_meetings, meeting_reminders,
               credit_refills, workspace_invites, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, {_now_expr()})
            ON CONFLICT(user_id) DO UPDATE SET
              chat_alerts=excluded.chat_alerts,
              purchase_alerts=excluded.purchase_alerts,
              calendar_meetings=excluded.calendar_meetings,
              meeting_reminders=excluded.meeting_reminders,
              credit_refills=excluded.credit_refills,
              workspace_invites=excluded.workspace_invites,
              updated_at={_now_expr()}
            """,
            (
                user_id,
                int(next_values["chat_alerts"]),
                int(next_values["purchase_alerts"]),
                int(next_values["calendar_meetings"]),
                int(next_values["meeting_reminders"]),
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
    skip_preferences: bool = False,
) -> dict[str, Any]:
    to_email = (to_email or "").strip()
    if not to_email or "@" not in to_email:
        return {"ok": False, "error": "missing_email"}
    if to_email.endswith("@social.render3d.local"):
        return {"ok": False, "error": "placeholder_social_email"}
    if not skip_preferences and not user_allows_email(user_id, category):
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
    safe_team = html.escape(team_name or "a Render Studio workspace")
    safe_url = html.escape(invite_url)
    subject = f"You're invited to {team_name or 'a Render Studio workspace'}"
    text = (
        f"{inviter_name or 'A teammate'} invited you to join {team_name or 'a Render Studio workspace'} on Render Studio.\n\n"
        f"Join workspace: {invite_url}\n\n"
        "This link accepts the workspace invite for the invited email address."
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render-logo-gear-still.png?v=20260915-logo1" alt="Render Studio" width="52" height="52" style="border-radius:14px;background:transparent;" />
        <h1 style="margin:18px 0 8px;font-size:26px;">Join {safe_team}</h1>
        <p style="margin:0 0 18px;color:#9da7b3;line-height:1.55;">{safe_inviter} invited you to collaborate in Render Studio. This link accepts the invite for this email address and opens the workspace.</p>
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


def send_project_share_invite_email(
    *,
    to_email: str,
    inviter_name: str,
    project_name: str,
    invite_url: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    safe_inviter = html.escape(inviter_name or "A teammate")
    safe_project = html.escape(project_name or "a Render Studio project")
    safe_url = html.escape(invite_url)
    subject = f"{inviter_name or 'Someone'} shared “{project_name or 'a project'}” with you"
    text = (
        f"{inviter_name or 'A teammate'} shared “{project_name or 'a project'}” with you on Render Studio.\n\n"
        f"Accept share: {invite_url}\n\n"
        "After you accept, the project appears in your files with a Shared tag. "
        "Edits stay linked to the same live project."
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render-logo-gear-still.png?v=20260915-logo1" alt="Render Studio" width="52" height="52" style="border-radius:14px;background:transparent;" />
        <h1 style="margin:18px 0 8px;font-size:26px;">Shared: {safe_project}</h1>
        <p style="margin:0 0 18px;color:#9da7b3;line-height:1.55;">{safe_inviter} shared a project with you. Accept to add it to your files with a Shared tag — edits stay linked live.</p>
        <a href="{safe_url}" style="display:inline-block;padding:12px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">Accept project</a>
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


def send_chatgpt_share_email(
    *,
    to_email: str,
    owner_name: str,
    team_name: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    safe_owner = html.escape(owner_name or "A teammate")
    safe_team = html.escape(team_name or "a Render Studio workspace")
    subject = f"{owner_name or 'A teammate'} shared a ChatGPT subscription with you"
    text = (
        f"{owner_name or 'A teammate'} shared their ChatGPT subscription with you on "
        f"{team_name or 'a Render Studio workspace'}.\n\n"
        "Sign in to Render Studio, open Render Agent, and check Subscriptions — "
        "you can generate CAD with that login. You don't need your own ChatGPT Plus "
        "for those workspace generations.\n"
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render-logo-gear-still.png?v=20260915-logo1" alt="Render Studio" width="52" height="52" style="border-radius:14px;background:transparent;" />
        <h1 style="margin:18px 0 8px;font-size:26px;">ChatGPT subscription shared</h1>
        <p style="margin:0 0 18px;color:#9da7b3;line-height:1.55;">{safe_owner} shared their ChatGPT login with you on {safe_team}. Open Render Studio → Render Agent, then Subscriptions. You can generate CAD with that login without your own ChatGPT Plus.</p>
        <a href="https://render3d.app/" style="display:inline-block;padding:12px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">Open Render Studio</a>
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


def send_meeting_request_email(
    *,
    to_email: str,
    requester_name: str,
    when_label: str,
    note: str = "",
    user_id: str | None = None,
) -> dict[str, Any]:
    safe_who = html.escape(requester_name or "Someone")
    safe_when = html.escape(when_label or "a proposed time")
    safe_note = html.escape((note or "").strip())
    subject = f"{requester_name or 'Someone'} requested a Render Studio meeting"
    text = (
        f"{requester_name or 'Someone'} requested a meeting on Render Studio.\n"
        f"When: {when_label or 'see the request in Social → Requests'}\n"
    )
    if note:
        text += f"Note: {note}\n"
    text += "\nOpen Social → Requests in Render Studio to accept or decline.\n"
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render-logo-gear-still.png?v=20260915-logo1" alt="Render Studio" width="52" height="52" style="border-radius:14px;background:transparent;" />
        <h1 style="margin:18px 0 8px;font-size:26px;">Meeting request</h1>
        <p style="margin:0 0 18px;color:#9da7b3;line-height:1.55;">{safe_who} wants to meet. Proposed: {safe_when}.</p>
        {f'<p style="margin:0 0 18px;color:#9da7b3;">{safe_note}</p>' if safe_note else ""}
        <a href="https://render3d.app/" style="display:inline-block;padding:12px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">Accept or decline in Studio</a>
      </div>
    </div>
  </body>
</html>"""
    return send_email(
        to_email=to_email,
        subject=subject,
        text=text,
        html_body=html_body,
        category="calendar_meetings",
        user_id=user_id,
    )


def send_meeting_reminder_email(
    *,
    to_email: str,
    title: str,
    starts_at: str,
    meet_url: str = "",
    user_id: str | None = None,
) -> dict[str, Any]:
    safe_title = html.escape(title or "Render Studio meeting")
    safe_when = html.escape(starts_at or "soon")
    safe_meet = html.escape(meet_url or "")
    subject = f"Reminder: {title or 'Render Studio meeting'} in 30 minutes"
    text = f"{title or 'Your Render Studio meeting'} starts in about 30 minutes.\nWhen: {starts_at or 'see your calendar'}\n"
    if meet_url:
        text += f"Join: {meet_url}\n"
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render-logo-gear-still.png?v=20260915-logo1" alt="Render Studio" width="52" height="52" style="border-radius:14px;background:transparent;" />
        <h1 style="margin:18px 0 8px;font-size:26px;">Meeting in 30 minutes</h1>
        <p style="margin:0 0 18px;color:#9da7b3;line-height:1.55;">{safe_title}<br/>When: {safe_when}</p>
        {f'<a href="{safe_meet}" style="display:inline-block;padding:12px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">Join Google Meet</a>' if meet_url else ""}
      </div>
    </div>
  </body>
</html>"""
    return send_email(
        to_email=to_email,
        subject=subject,
        text=text,
        html_body=html_body,
        category="meeting_reminders",
        user_id=user_id,
    )
