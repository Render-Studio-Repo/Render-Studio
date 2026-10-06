"""Public boot-chrome links + suggestion routing (email / Slack channel email)."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from backend.config import settings

DEFAULTS: dict[str, Any] = {
    "discord_url": "https://discord.gg/kaPZRCk9c",
    "slack_url": "https://join.slack.com/t/renderserver/shared_invite/zt-490s0apzr-K3C9wuQmLfgWjKKVvEnUWg",
    "github_url": "https://github.com/wprojects/Render-Studio",
    "x_url": "https://x.com/A1_Projects",
    "suggestions_email": "sam@render3d.app",
    "suggestions_from_email": "info@render3d.app",
    "suggestions_slack_email": "suggestions-aaaav3eniyeai4qvwkmfsxknzm@renderserver.slack.com",
    "suggestions_slack_channel": "#suggestions",
    "email_enabled": True,
    "slack_enabled": True,
    "feature_request_notify_enabled": True,
}

PUBLIC_KEYS = (
    "discord_url",
    "slack_url",
    "github_url",
    "x_url",
)

KINDS = {"bug", "idea", "business"}

MAX_FILES = 6
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 12 * 1024 * 1024
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".pdf"}
ALLOWED_MIME = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "text/plain",
    "application/pdf",
}
MIME_FROM_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
}

_rate: list[float] = []


def _path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "site_settings.json"


def load() -> dict[str, Any]:
    path = _path()
    data = dict(DEFAULTS)
    if path.is_file():
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                data.update({k: stored[k] for k in DEFAULTS if k in stored})
        except Exception:
            pass
    data["email_enabled"] = bool(data.get("email_enabled", True))
    data["slack_enabled"] = bool(data.get("slack_enabled", True))
    data["feature_request_notify_enabled"] = bool(data.get("feature_request_notify_enabled", True))
    for key in DEFAULTS:
        if key.endswith("_url") or key.endswith("_email") or key.endswith("_channel"):
            data[key] = str(data.get(key) or DEFAULTS[key]).strip()
    return data


def save(patch: dict[str, Any]) -> dict[str, Any]:
    data = load()
    for key, default in DEFAULTS.items():
        if key not in patch:
            continue
        value = patch[key]
        if isinstance(default, bool):
            data[key] = bool(value)
        else:
            data[key] = str(value or "").strip() or default
    _path().write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def public_boot_chrome() -> dict[str, Any]:
    data = load()
    return {key: data[key] for key in PUBLIC_KEYS}


def allow_rate(limit: int = 8, window_s: float = 120.0) -> bool:
    now = time.time()
    while _rate and now - _rate[0] > window_s:
        _rate.pop(0)
    if len(_rate) >= limit:
        return False
    _rate.append(now)
    return True


def route_kind(kind: str) -> str:
    value = (kind or "").strip().lower()
    if value in {"suggestion", "feature"}:
        return "idea"
    if value in {"business inquiry", "business_inquiry", "inquiry"}:
        return "business"
    return value if value in KINDS else "idea"


def should_post_slack(kind: str, cfg: dict[str, Any] | None = None) -> bool:
    data = cfg or load()
    if not data.get("slack_enabled"):
        return False
    return route_kind(kind) in {"bug", "idea"}


def should_send_email(cfg: dict[str, Any] | None = None) -> bool:
    data = cfg or load()
    return bool(data.get("email_enabled"))


def _safe_filename(name: str) -> str:
    base = Path(str(name or "attachment")).name
    cleaned = re.sub(r"[^\w.\-]+", "_", base).strip("._")[:80]
    return cleaned or "attachment"


def infer_mime(filename: str, content_type: str = "") -> str:
    raw = (content_type or "").split(";")[0].strip().lower()
    if raw in ALLOWED_MIME:
        return raw
    ext = Path(filename or "").suffix.lower()
    return MIME_FROM_EXT.get(ext, "")


def normalize_attachments(items: list[dict[str, Any]] | None) -> tuple[list[dict[str, Any]], str | None]:
    out: list[dict[str, Any]] = []
    total = 0
    for raw in items or []:
        if len(out) >= MAX_FILES:
            return out, f"up to {MAX_FILES} files"
        filename = _safe_filename(str(raw.get("filename") or "attachment"))
        content = raw.get("content")
        if not isinstance(content, (bytes, bytearray)):
            continue
        data = bytes(content)
        if not data:
            continue
        if len(data) > MAX_FILE_BYTES:
            return [], f"{filename} exceeds 5 MB"
        if total + len(data) > MAX_TOTAL_BYTES:
            return [], "attachments exceed 12 MB"
        mime = infer_mime(filename, str(raw.get("content_type") or ""))
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXT or mime not in ALLOWED_MIME:
            return [], "use images, TXT, or PDF"
        expected_ext = {
            "image/png": {".png"},
            "image/jpeg": {".jpg", ".jpeg"},
            "image/webp": {".webp"},
            "image/gif": {".gif"},
            "text/plain": {".txt"},
            "application/pdf": {".pdf"},
        }.get(mime, set())
        if expected_ext and ext not in expected_ext:
            filename = f"{Path(filename).stem}{next(iter(expected_ext))}"
        out.append({"filename": filename, "content": data, "content_type": mime})
        total += len(data)
    return out, None


async def attachments_from_uploads(uploads: list[Any] | None) -> tuple[list[dict[str, Any]], str | None]:
    items: list[dict[str, Any]] = []
    for upload in (uploads or [])[:MAX_FILES]:
        if not hasattr(upload, "read"):
            continue
        data = await upload.read()
        items.append({
            "filename": getattr(upload, "filename", None) or "attachment",
            "content": data,
            "content_type": getattr(upload, "content_type", "") or "",
        })
    return normalize_attachments(items)


def inbox_kind(kind: str) -> str:
    return "bug" if route_kind(kind) == "bug" else "suggestion"


def record_suggestion_inbox(
    *,
    kind: str,
    message: str,
    user: dict[str, Any] | None = None,
    page_url: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from backend.services import feedback_service

    names = [str(item.get("filename") or "") for item in (attachments or []) if item.get("filename")]
    extra = dict(context or {})
    extra.setdefault("source", extra.get("source") or "site_suggestions")
    extra["route_kind"] = route_kind(kind)
    extra["attachment_names"] = names
    return feedback_service.add_request(
        kind=inbox_kind(kind),
        message=message,
        user=user or {},
        page_url=page_url,
        context=extra,
    )


def _safe_send_mail(**kwargs: Any) -> dict[str, Any]:
    from backend.services import workspace_automation_service

    try:
        result = workspace_automation_service._send_mail(**kwargs)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}
    if not isinstance(result, dict):
        return {"ok": False, "error": "send_failed"}
    return result


def deliver_suggestion_mail(
    *,
    kind: str,
    message: str,
    user: dict[str, Any] | None = None,
    transcribed: bool = False,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cfg = load()
    kind_n = route_kind(kind)
    text = (message or "").strip()[:4000]
    files, file_err = normalize_attachments(attachments)
    if file_err:
        return {"ok": False, "error": file_err, "kind": kind_n, "emailed": False, "posted_to_slack": False}
    who = "Guest"
    if user:
        who = f"{user.get('display_name') or ''} <{user.get('email') or ''}>".strip()
    channel = cfg.get("suggestions_slack_channel") or "#suggestions"
    names = [item["filename"] for item in files]
    body = (
        f"Studio suggestion ({kind_n}) from {who}\n"
        f"Transcribed: {'yes' if transcribed else 'no'}\n"
        f"Attachments: {', '.join(names) if names else 'none'}\n\n"
        f"{text}"
    )
    subject = f"Render Studio {kind_n}: {text[:70]}"
    email_result: dict[str, Any] = {"ok": False, "skipped": True}
    slack_result: dict[str, Any] = {"ok": False, "skipped": True}
    want_email = should_send_email(cfg)
    want_slack = should_post_slack(kind_n, cfg)
    if not want_email and not want_slack:
        return {
            "ok": False,
            "error": "routing_disabled",
            "kind": kind_n,
            "email": email_result,
            "slack": slack_result,
            "posted_to_slack": False,
            "emailed": False,
            "attachment_count": len(files),
        }
    mail_kwargs: dict[str, Any] = {"attachments": files} if files else {}
    if want_email:
        email_result = _safe_send_mail(
            to=[cfg.get("suggestions_email") or DEFAULTS["suggestions_email"]],
            from_address=cfg.get("suggestions_from_email") or DEFAULTS["suggestions_from_email"],
            subject=subject,
            text=body,
            **mail_kwargs,
        )
        email_result["skipped"] = False
    if want_slack:
        slack_to = cfg.get("suggestions_slack_email") or DEFAULTS["suggestions_slack_email"]
        slack_result = _safe_send_mail(
            to=[slack_to],
            subject=f"{channel} {kind_n}: {text[:60]}",
            text=f"{channel} ({cfg.get('suggestions_slack_email')})\n\n{body}",
            **mail_kwargs,
        )
        slack_result["skipped"] = False
        slack_result["channel"] = channel
    emailed = bool(email_result.get("ok"))
    posted = bool(slack_result.get("ok"))
    ok = (not want_email or emailed) and (not want_slack or posted)
    err = None
    if not ok:
        err = email_result.get("error") or slack_result.get("error") or "send_failed"
    return {
        "ok": ok,
        "kind": kind_n,
        "email": email_result,
        "slack": slack_result,
        "posted_to_slack": posted,
        "emailed": emailed,
        "attachment_count": len(files),
        "error": err,
    }


def submit_suggestion(
    *,
    kind: str,
    message: str,
    user: dict[str, Any] | None = None,
    transcribed: bool = False,
    attachments: list[dict[str, Any]] | None = None,
    page_url: str | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    kind_n = route_kind(kind)
    text = (message or "").strip()[:4000]
    if len(text) < 4:
        return {"ok": False, "error": "message_required"}
    files, file_err = normalize_attachments(attachments)
    if file_err:
        return {"ok": False, "error": file_err, "kind": kind_n}
    item = record_suggestion_inbox(
        kind=kind_n,
        message=text,
        user=user,
        page_url=page_url,
        attachments=files,
        context=context,
    )
    mail = deliver_suggestion_mail(
        kind=kind_n,
        message=text,
        user=user,
        transcribed=transcribed,
        attachments=files,
    )
    training = None
    if kind_n == "bug":
        extra = dict(context or {})
        check = extra.get("feature_check") or extra.get("features") or extra.get("checklist") or {}
        if not isinstance(check, dict):
            check = {}
        from backend.services import debug_training_service as dts

        training = dts.ingest_quietly(
            title=text[:80],
            traceback_text=text,
            feature_check=check,
            source="site-bug-report",
        )
    return {**mail, "request": item, "debug_training": training}
