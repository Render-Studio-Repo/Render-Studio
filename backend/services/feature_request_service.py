"""Persist admin feature requests, optionally notify GitHub + sam@render3d.app."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.services import site_settings_service

SAM_EMAIL = "sam@render3d.app"
FEATURE_REQUEST_LABEL = "feature-request"


def _path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "feature_requests.json"


def notify_enabled(cfg: dict[str, Any] | None = None) -> bool:
    data = cfg or site_settings_service.load()
    return bool(data.get("feature_request_notify_enabled", True))


def _load_all() -> list[dict[str, Any]]:
    path = _path()
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return raw if isinstance(raw, list) else []


def _save_all(rows: list[dict[str, Any]]) -> None:
    _path().write_text(json.dumps(rows[-200:], indent=2), encoding="utf-8")


def _email_sam(*, title: str, body: str, who: str, issue_url: str, attachment_names: list[str]) -> dict[str, Any]:
    from backend.services.email_notification_service import send_email

    url_line = f"GitHub: {issue_url}\n" if issue_url else "GitHub: (not created)\n"
    text = (
        f"Feature request from {who}\n"
        f"Label: {FEATURE_REQUEST_LABEL}\n"
        f"{url_line}"
        f"Attachments: {', '.join(attachment_names) if attachment_names else 'none'}\n\n"
        f"{title}\n\n{body}"
    )
    html_body = (
        f"<p>Feature request from {who}</p>"
        f"<p>Label: <code>{FEATURE_REQUEST_LABEL}</code></p>"
        f"<p>{url_line.replace(chr(10), '<br>')}</p>"
        f"<p>{body.replace(chr(10), '<br>')}</p>"
    )
    try:
        return send_email(
            to_email=SAM_EMAIL,
            subject=f"[Feature request] {title[:70]}",
            text=text,
            html_body=html_body,
            category="ops",
            skip_preferences=True,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}


def submit_feature_request(
    *,
    user: dict[str, Any],
    title: str,
    body: str,
    setting_query: str = "",
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    who = f"{user.get('display_name') or ''} <{user.get('email') or user.get('id') or ''}>".strip()
    clean_title = (title or setting_query or "Feature request").strip()[:160] or "Feature request"
    clean_body = (body or "").strip()[:4000]
    query = (setting_query or "").strip()[:200]
    files = attachments or []
    names = [str(item.get("filename") or "") for item in files if item.get("filename")]
    issue_body = (
        f"## Requested setting\n{query or '(none)'}\n\n"
        f"## From\n{who}\n\n"
        f"## Details\n{clean_body or '(no description)'}\n\n"
        f"Attachments: {', '.join(names) if names else 'none'}\n"
    )
    item = {
        "id": str(uuid.uuid4())[:12],
        "title": clean_title,
        "body": clean_body,
        "setting_query": query,
        "user_id": user.get("id"),
        "email": user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "label": FEATURE_REQUEST_LABEL,
        "attachment_names": names,
        "notified": False,
    }
    github: dict[str, Any] = {"ok": False, "skipped": True}
    email: dict[str, Any] = {"ok": False, "skipped": True}
    if notify_enabled():
        from backend.services import github_issues_service

        github = github_issues_service.create_feature_request_issue(title=clean_title, body=issue_body)
        issue_url = str(github.get("html_url") or "")
        email = _email_sam(
            title=clean_title,
            body=issue_body,
            who=who,
            issue_url=issue_url,
            attachment_names=names,
        )
        item["notified"] = True
        item["github"] = {k: github.get(k) for k in ("ok", "html_url", "number", "error", "repo")}
        item["email"] = {k: email.get(k) for k in ("ok", "error", "to")}
    else:
        item["notify_disabled"] = True
    rows = _load_all()
    rows.append(item)
    _save_all(rows)
    return {
        "ok": True,
        "request": {k: item[k] for k in item if k != "body"} | {"body": clean_body},
        "github": github,
        "email": email,
        "notified": item.get("notified", False),
        "notify_enabled": notify_enabled(),
        "label": FEATURE_REQUEST_LABEL,
        "detail": (
            "Saved. Notifications are off in super-admin preferences."
            if item.get("notify_disabled")
            else (
                "Opened a GitHub feature-request issue and emailed sam@render3d.app."
                if github.get("ok") and email.get("ok")
                else "Saved the request. GitHub or email may still need configuration."
            )
        ),
    }
