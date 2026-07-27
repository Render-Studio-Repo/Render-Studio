"""Email Sam when users sign up or create their first model (with a preview share link)."""

from __future__ import annotations

import html
import json
import logging
import secrets
import smtplib
import threading
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.sam_user_alerts")

SAM_EMAIL = "sam@render3d.app"
PUBLIC_BASE = (getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def smtp_configured() -> bool:
    return bool(
        (settings.capacity_alert_smtp_user or "").strip()
        and (settings.capacity_alert_smtp_password or "").strip()
    )


def _state_path() -> Path:
    root = Path(settings.data_dir) / "admin_alerts"
    root.mkdir(parents=True, exist_ok=True)
    return root / "sam_user_alert_emails.json"


def _load_state() -> dict[str, Any]:
    path = _state_path()
    if not path.is_file():
        return {"signup_sent": {}, "first_model_sent": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"signup_sent": {}, "first_model_sent": {}}
    if not isinstance(data, dict):
        return {"signup_sent": {}, "first_model_sent": {}}
    data.setdefault("signup_sent", {})
    data.setdefault("first_model_sent", {})
    return data


def _save_state(data: dict[str, Any]) -> None:
    _state_path().write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _send_html_email(*, subject: str, text: str, html_body: str, to: str = SAM_EMAIL) -> dict[str, Any]:
    if not smtp_configured():
        logger.info("Sam alert not sent (%s): SMTP is not configured.", subject)
        return {"ok": False, "error": "smtp_not_configured"}
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = (settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    msg["To"] = to
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
    return {"ok": True, "to": to, "subject": subject}


def _card_html(*, title: str, body_html: str, cta_url: str | None = None, cta_label: str = "Open") -> str:
    cta = ""
    if cta_url:
        cta = (
            f'<a href="{html.escape(cta_url, quote=True)}" '
            f'style="display:inline-block;margin:12px 0 0;padding:12px 16px;border-radius:999px;'
            f'background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">{html.escape(cta_label)}</a>'
        )
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:720px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:#161b22;">
        <img src="{PUBLIC_BASE}/render3d-logo.png" alt="Render Studio" width="48" height="48" style="border-radius:12px;" />
        <h1 style="margin:16px 0 10px;font-size:22px;">{html.escape(title)}</h1>
        {body_html}
        {cta}
      </div>
    </div>
  </body>
</html>"""


def send_new_signup_email(user: dict[str, Any], *, source: str = "email") -> dict[str, Any]:
    """Notify Sam when a new user signs up (idempotent per user)."""
    user_id = str(user.get("id") or "").strip()
    if not user_id:
        return {"ok": False, "error": "missing_user"}
    state = _load_state()
    if state["signup_sent"].get(user_id):
        return {"ok": True, "skipped": True, "reason": "already_sent"}

    name = str(user.get("display_name") or "New user").strip() or "New user"
    email = str(user.get("email") or "").strip()
    subject = f"New Render Studio signup — {name}"
    admin_url = f"{PUBLIC_BASE}/admin-dashboard.html#new-users"
    body_html = f"""
      <p style="margin:0 0 10px;color:#9da7b3;line-height:1.55;">
        <strong style="color:#e6edf3;">{html.escape(name)}</strong>
        just created an account.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;color:#c9d1d9;font-size:14px;">
        <tr><td style="padding:6px 0;color:#9da7b3;">Email</td><td style="padding:6px 0;">{html.escape(email or "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#9da7b3;">User id</td><td style="padding:6px 0;font-family:ui-monospace,monospace;">{html.escape(user_id)}</td></tr>
        <tr><td style="padding:6px 0;color:#9da7b3;">Source</td><td style="padding:6px 0;">{html.escape(source or "email")}</td></tr>
        <tr><td style="padding:6px 0;color:#9da7b3;">Signed up</td><td style="padding:6px 0;">{html.escape(str(user.get("created_at") or _now()))}</td></tr>
      </table>
    """
    text = (
        f"New Render Studio signup\n\n"
        f"Name: {name}\nEmail: {email or '—'}\nUser id: {user_id}\n"
        f"Source: {source}\nSigned up: {user.get('created_at') or _now()}\n\n"
        f"Admin: {admin_url}\n"
    )
    result = _send_html_email(
        subject=subject,
        text=text,
        html_body=_card_html(title="New user signup", body_html=body_html, cta_url=admin_url, cta_label="Open admin"),
    )
    if result.get("ok"):
        state["signup_sent"][user_id] = {"at": _now(), "email": email, "source": source}
        _save_state(state)
    return result


def notify_new_signup_async(user: dict[str, Any], *, source: str = "email") -> None:
    def _run() -> None:
        try:
            send_new_signup_email(user, source=source)
        except Exception:
            logger.warning("Could not email Sam about signup user_id=%s", user.get("id"), exc_info=True)

    threading.Thread(target=_run, daemon=True, name="sam-signup-email").start()


def ensure_model_share_url(
    project_path: Path,
    *,
    filename: str,
    user_id: str,
    project_id: str | None = None,
) -> str | None:
    """Create (or reuse) a public /share/{token} link for the model file."""
    from backend.services import cad_service, project_store

    safe = cad_service.resolve_existing_project_file(project_path, filename)
    if not safe:
        # Fall back to basename if resolve fails but file exists.
        candidate = Path(str(filename or "")).name
        if candidate and (project_path / candidate).is_file():
            safe = candidate
        else:
            return None

    meta = project_store.load_meta(project_path)
    shares = meta.setdefault("file_shares", {})
    if not isinstance(shares, dict):
        shares = {}
        meta["file_shares"] = shares

    token = next(
        (
            tok
            for tok, share in shares.items()
            if isinstance(share, dict) and share.get("filename") == safe and share.get("sam_first_model")
        ),
        None,
    )
    if not token:
        token = next(
            (
                tok
                for tok, share in shares.items()
                if isinstance(share, dict) and share.get("filename") == safe
            ),
            None,
        )
    if not token:
        token = secrets.token_urlsafe(18)
        while token in shares:
            token = secrets.token_urlsafe(18)
        shares[token] = {
            "filename": safe,
            "created_at": _now(),
            "created_by": user_id,
            "sam_first_model": True,
        }
    share = shares[token]
    if isinstance(share, dict):
        share["sam_first_model"] = True
        share["updated_at"] = _now()
        if not share.get("viewer_filename") and not share.get("assembly_filename"):
            try:
                resolved_viewer = cad_service.resolve_viewport_filename(project_path, safe)
                if resolved_viewer and (project_path / resolved_viewer).is_file():
                    if Path(resolved_viewer).suffix.lower() in {".glb", ".gltf"}:
                        share["viewer_filename"] = resolved_viewer
            except Exception:
                logger.debug("Could not resolve share viewer for first-model email", exc_info=True)
    project_store.save_meta(project_path, meta)
    return f"{PUBLIC_BASE}/share/{token}"


def send_first_model_email(
    user: dict[str, Any],
    *,
    project_id: str,
    project_path: Path | str,
    filename: str,
    prompt: str | None = None,
) -> dict[str, Any]:
    """Notify Sam the first time a user creates a model; include a preview share link."""
    user_id = str(user.get("id") or "").strip()
    if not user_id or not filename:
        return {"ok": False, "error": "missing_user_or_filename"}

    state = _load_state()
    if state["first_model_sent"].get(user_id):
        return {"ok": True, "skipped": True, "reason": "already_sent"}

    path = Path(project_path)
    share_url = ensure_model_share_url(path, filename=filename, user_id=user_id, project_id=project_id)
    if not share_url:
        return {"ok": False, "error": "share_unavailable"}

    name = str(user.get("display_name") or "User").strip() or "User"
    email = str(user.get("email") or "").strip()
    subject = f"First model — {name}"
    prompt_snip = " ".join(str(prompt or "").split())[:280]
    project_url = f"{PUBLIC_BASE}/?project={project_id}"
    body_html = f"""
      <p style="margin:0 0 10px;color:#9da7b3;line-height:1.55;">
        <strong style="color:#e6edf3;">{html.escape(name)}</strong>
        just created their first model.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;color:#c9d1d9;font-size:14px;">
        <tr><td style="padding:6px 0;color:#9da7b3;">Email</td><td style="padding:6px 0;">{html.escape(email or "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#9da7b3;">Project</td><td style="padding:6px 0;font-family:ui-monospace,monospace;">{html.escape(project_id)}</td></tr>
        <tr><td style="padding:6px 0;color:#9da7b3;">File</td><td style="padding:6px 0;">{html.escape(Path(filename).name)}</td></tr>
      </table>
      {"<p style='margin:0 0 12px;color:#c9d1d9;line-height:1.5;'><strong>Prompt:</strong> " + html.escape(prompt_snip) + "</p>" if prompt_snip else ""}
      <p style="margin:0;color:#9da7b3;line-height:1.55;">
        Preview / copy link:<br />
        <a href="{html.escape(share_url, quote=True)}" style="color:#58a6ff;word-break:break-all;">{html.escape(share_url)}</a>
      </p>
    """
    text = (
        f"First model from {name}\n\n"
        f"Email: {email or '—'}\nUser id: {user_id}\n"
        f"Project: {project_id}\nFile: {Path(filename).name}\n"
        f"Prompt: {prompt_snip or '—'}\n\n"
        f"Preview share link:\n{share_url}\n\n"
        f"Open project: {project_url}\n"
    )
    result = _send_html_email(
        subject=subject,
        text=text,
        html_body=_card_html(
            title="First model created",
            body_html=body_html,
            cta_url=share_url,
            cta_label="Preview model",
        ),
    )
    if result.get("ok"):
        state["first_model_sent"][user_id] = {
            "at": _now(),
            "project_id": project_id,
            "filename": Path(filename).name,
            "share_url": share_url,
        }
        _save_state(state)
        result["share_url"] = share_url
    return result


def maybe_notify_first_model_async(
    user: dict[str, Any] | None,
    *,
    project_id: str,
    project_path: Path | str,
    filename: str | None,
    prompt: str | None = None,
) -> None:
    if not user or not user.get("id") or not filename:
        return
    user_id = str(user.get("id"))
    state = _load_state()
    if state["first_model_sent"].get(user_id):
        return

    payload = dict(user)

    def _run() -> None:
        try:
            send_first_model_email(
                payload,
                project_id=project_id,
                project_path=project_path,
                filename=str(filename),
                prompt=prompt,
            )
        except Exception:
            logger.warning(
                "Could not email Sam about first model user_id=%s project=%s",
                user_id,
                project_id,
                exc_info=True,
            )

    threading.Thread(target=_run, daemon=True, name="sam-first-model-email").start()
