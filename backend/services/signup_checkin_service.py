"""A few days after signup, Sam checks in by email. Replies notify Sam.

From: Sam Winstead via studio SMTP. Send once per user — Sam is not CC'd.
When someone replies, IMAP matches the thread and emails sam@render3d.app
(who + body); SMS still goes to his phone when Twilio is configured.
Historical signups are included, but sends trickle a few per hour during the
day so Gmail does not treat it as a blast.
"""

from __future__ import annotations

import email
import html
import imaplib
import logging
import os
import random
import re
import secrets
import smtplib
import threading
import time
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Any
from zoneinfo import ZoneInfo

from backend.config import settings
from backend.database import get_conn
from backend.services import sms_notify

logger = logging.getLogger("render3d.signup_checkin")

SAM_EMAIL = "sam@render3d.app"
FROM_NAME = "Sam Winstead"
STUDIO_URL = "https://render3d.app/"
SUBJECT = "How's Render Studio going?"
DELAY_DAYS = 3
CYCLE_SECONDS = 3600
STARTUP_DELAY_SECONDS = 45
SEND_LOCK_MINUTES = 15
IMAP_LOOKBACK_DAYS = 60
TRICKLE_MAX_PER_HOUR = 4
TRICKLE_GAP_MIN_SEC = 75
TRICKLE_GAP_MAX_SEC = 180
SEND_TZ = ZoneInfo("America/Chicago")
SEND_HOUR_START = 9
SEND_HOUR_END = 20
SKIP_EMAILS = {
    SAM_EMAIL,
    "info@render3d.app",
    "a1projects@protonmail.com",
    "sam@smartcallusa.com",
    "illegalandtrill@gmail.com",
    "samwins.stead@gmail.com",
}
SKIP_DOMAINS = {
    "example.com",
    "test.dev",
    "render3d.dev",
    "render3d.local",
    "r3d-studios.com",
    "localhost",
}
PLACEHOLDER_SUFFIX = "@social.render3d.local"

_loop_lock = threading.Lock()
_loop_started = False


def smtp_configured() -> bool:
    return bool(
        (settings.capacity_alert_smtp_user or "").strip()
        and (settings.capacity_alert_smtp_password or "").strip()
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _from_email() -> str:
    return (settings.capacity_alert_from or settings.capacity_alert_smtp_user or "info@render3d.app").strip()


def parse_dt(raw: str | None) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def normalize_email(raw: str | None) -> str:
    return (raw or "").strip().lower()


def should_email_address(raw: str | None) -> bool:
    email_addr = normalize_email(raw)
    if "@" not in email_addr:
        return False
    if email_addr.endswith(PLACEHOLDER_SUFFIX):
        return False
    if email_addr in SKIP_EMAILS:
        return False
    domain = email_addr.rsplit("@", 1)[-1]
    if domain in SKIP_DOMAINS or domain.endswith(".local"):
        return False
    return True


def account_age_days(user: dict[str, Any], *, now: datetime | None = None) -> float | None:
    created = parse_dt(user.get("created_at"))
    if created is None:
        return None
    return ((now or _now()) - created).total_seconds() / 86400


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS signup_checkins (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                display_name TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                message_id TEXT,
                sent_at TEXT,
                send_started_at TEXT,
                reply_at TEXT,
                reply_sms_at TEXT,
                reply_excerpt TEXT,
                reply_from TEXT
            )
            """
        )
        conn.commit()


def greeting_name(user: dict[str, Any]) -> str:
    name = str(user.get("display_name") or "").strip()
    return name or "there"


def render_checkin_email(user: dict[str, Any], *, now: datetime | None = None) -> dict[str, str]:
    name = greeting_name(user)
    safe = html.escape(name)
    age = account_age_days(user, now=now)
    if age is not None and age >= 14:
        when_text = "I wanted to check in and see how Render Studio is treating you."
        when_html = "I wanted to check in and see how Render Studio is treating you."
    else:
        when_text = "You've had a few days with it now, and I wanted to ask how it's going."
        when_html = "You've had a few days with it now, and I wanted to ask how it's going."
    text = (
        f"Hi {name},\n\n"
        f"I'm Sam — I made Render Studio. {when_text}\n\n"
        "Is there anything I can do to help? A stuck model, something that isn't "
        "clear, or an idea you wish it did — just reply to this email. I'll see it, "
        f"and it pings my phone.\n\n"
        f"Sam Winstead\nRender Studio\n{STUDIO_URL}\n"
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:#161b22;">
        <p style="margin:0 0 14px;line-height:1.55;">Hi {safe},</p>
        <p style="margin:0 0 14px;color:#c9d1d9;line-height:1.55;">
          I'm Sam — I made Render Studio. {html.escape(when_html)}
        </p>
        <p style="margin:0 0 14px;color:#c9d1d9;line-height:1.55;">
          Is there anything I can do to help? A stuck model, something that isn't clear, or an idea you wish it did — just reply to this email. I'll see it, and it pings my phone.
        </p>
        <p style="margin:18px 0 0;line-height:1.55;">
          Sam Winstead<br />
          Render Studio<br />
          <a href="{STUDIO_URL}" style="color:#fb8500;">{STUDIO_URL}</a>
        </p>
      </div>
    </div>
  </body>
</html>"""
    return {"subject": SUBJECT, "text": text, "html": html_body}


def _msgid(token: str) -> str:
    return f"<rs-checkin-{token}@render3d.app>"


def normalize_msgid(raw: str | None) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    if text[0] != "<":
        text = f"<{text}"
    if text[-1] != ">":
        text = f"{text}>"
    return text.lower()


def _header_ids(*values: str | None) -> list[str]:
    found: list[str] = []
    for value in values:
        for part in re.findall(r"<[^>]+>", value or "", flags=re.I):
            nid = normalize_msgid(part)
            if nid and nid not in found:
                found.append(nid)
    return found


def in_window(created_at: str | None, *, now: datetime | None = None) -> bool:
    created = parse_dt(created_at)
    if created is None:
        return False
    moment = now or _now()
    return (moment - created) >= timedelta(days=DELAY_DAYS)


def in_send_hours(*, now: datetime | None = None) -> bool:
    local = (now or _now()).astimezone(SEND_TZ)
    return SEND_HOUR_START <= local.hour < SEND_HOUR_END


def list_users() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, email, display_name, created_at FROM users"
        ).fetchall()
    return [dict(row) for row in rows]


def sent_user_ids() -> set[str]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT user_id FROM signup_checkins WHERE message_id IS NOT NULL AND TRIM(message_id) != ''"
        ).fetchall()
    return {str(row["user_id"]) for row in rows}


def eligible_users(*, now: datetime | None = None) -> list[dict[str, Any]]:
    already = sent_user_ids()
    out: list[dict[str, Any]] = []
    for user in list_users():
        user_id = str(user.get("id") or "").strip()
        if not user_id or user_id in already:
            continue
        if not should_email_address(user.get("email")):
            continue
        if not in_window(user.get("created_at"), now=now):
            continue
        out.append(user)
    out.sort(key=lambda row: str(row.get("created_at") or ""))
    return out


def sent_in_last_hours(hours: float = 1, *, now: datetime | None = None) -> int:
    ensure_schema()
    since = ((now or _now()) - timedelta(hours=hours)).isoformat()
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n FROM signup_checkins
             WHERE sent_at IS NOT NULL AND sent_at >= ?
            """,
            (since,),
        ).fetchone()
    return int(row["n"] if row else 0)


def _claim_send(user: dict[str, Any]) -> dict[str, Any] | None:
    """Reserve a send slot. Returns the row to send, or None if another worker owns it."""
    ensure_schema()
    user_id = str(user.get("id") or "").strip()
    email_addr = str(user.get("email") or "").strip()
    name = greeting_name(user)
    token = secrets.token_hex(10)
    now_iso = _now_iso()
    stale_before = (_now() - timedelta(minutes=SEND_LOCK_MINUTES)).isoformat()
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT OR IGNORE INTO signup_checkins
                (user_id, email, display_name, token)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, email_addr, name, token),
        )
        updated = conn.execute(
            """
            UPDATE signup_checkins
               SET send_started_at = ?,
                   email = ?,
                   display_name = ?
             WHERE user_id = ?
               AND (message_id IS NULL OR TRIM(message_id) = '')
               AND (send_started_at IS NULL OR send_started_at < ?)
            """,
            (now_iso, email_addr, name, user_id, stale_before),
        )
        if updated.rowcount != 1:
            conn.commit()
            return None
        row = conn.execute(
            "SELECT * FROM signup_checkins WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        conn.commit()
    return dict(row) if row else None


def _mark_sent(user_id: str, message_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE signup_checkins
               SET message_id = ?, sent_at = ?
             WHERE user_id = ?
            """,
            (message_id, _now_iso(), user_id),
        )
        conn.commit()


def _clear_send_lock(user_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE signup_checkins
               SET send_started_at = NULL
             WHERE user_id = ?
               AND (message_id IS NULL OR TRIM(message_id) = '')
            """,
            (user_id,),
        )
        conn.commit()


def _send_message(msg: EmailMessage) -> None:
    host = (settings.capacity_alert_smtp_host or "smtp.gmail.com").strip()
    port = int(settings.capacity_alert_smtp_port or 587)
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(settings.capacity_alert_smtp_user.strip(), settings.capacity_alert_smtp_password.strip())
        smtp.send_message(msg)


def build_checkin_message(user: dict[str, Any], *, token: str, now: datetime | None = None) -> EmailMessage:
    template = render_checkin_email(user, now=now)
    from_email = _from_email()
    to_email = str(user.get("email") or "").strip()
    msg = EmailMessage()
    msg["Subject"] = template["subject"]
    msg["From"] = formataddr((FROM_NAME, from_email))
    msg["To"] = to_email
    # Studio mailbox stays on Reply-To so IMAP can match replies. Sam is not
    # CC'd on the outbound; replies notify him via notify_reply().
    msg["Reply-To"] = formataddr((FROM_NAME, from_email))
    msg["Message-ID"] = _msgid(token)
    msg["X-Render3D-Checkin"] = token
    msg.set_content(template["text"])
    msg.add_alternative(template["html"], subtype="html")
    return msg


def send_checkin(user: dict[str, Any]) -> dict[str, Any]:
    if not smtp_configured():
        return {"ok": False, "error": "smtp_not_configured"}
    if not should_email_address(user.get("email")):
        return {"ok": False, "error": "skip_address"}
    claimed = _claim_send(user)
    if not claimed:
        return {"ok": True, "skipped": True, "reason": "already_sent_or_locked"}
    msg = build_checkin_message(user, token=str(claimed["token"]))
    try:
        _send_message(msg)
    except Exception as exc:
        _clear_send_lock(str(claimed["user_id"]))
        logger.warning("Signup check-in SMTP failed for %s: %s", user.get("email"), exc)
        return {"ok": False, "error": str(exc)}
    message_id = normalize_msgid(msg["Message-ID"])
    _mark_sent(str(claimed["user_id"]), message_id)
    logger.info("Signup check-in sent to %s (%s)", user.get("email"), user.get("display_name"))
    return {
        "ok": True,
        "to": str(user.get("email") or ""),
        "message_id": message_id,
        "token": claimed["token"],
    }


def send_due_checkins(
    *,
    now: datetime | None = None,
    limit: int | None = None,
    pause_sec: float | None = None,
    respect_hours: bool = True,
) -> dict[str, Any]:
    if not smtp_configured():
        logger.info("Signup check-in skipped: SMTP is not configured.")
        return {"ok": False, "error": "smtp_not_configured", "sent": 0}
    moment = now or _now()
    if respect_hours and not in_send_hours(now=moment):
        logger.info("Signup check-in trickle paused outside %s–%s %s.", SEND_HOUR_START, SEND_HOUR_END, SEND_TZ.key)
        return {"ok": True, "sent": 0, "paused": True, "reason": "outside_send_hours"}
    already_hour = sent_in_last_hours(1, now=moment)
    cap = TRICKLE_MAX_PER_HOUR if limit is None else int(limit)
    remaining = max(0, cap - already_hour)
    if remaining <= 0:
        return {"ok": True, "sent": 0, "paused": True, "reason": "hourly_cap", "queued": len(eligible_users(now=moment))}
    due = eligible_users(now=moment)[:remaining]
    results: list[dict[str, Any]] = []
    sent = 0
    for index, user in enumerate(due):
        if index and pause_sec != 0:
            wait = TRICKLE_GAP_MIN_SEC if pause_sec is None else float(pause_sec)
            if pause_sec is None:
                wait = random.uniform(TRICKLE_GAP_MIN_SEC, TRICKLE_GAP_MAX_SEC)
            time.sleep(wait)
        result = send_checkin(user)
        results.append({"user_id": user.get("id"), "email": user.get("email"), **result})
        if result.get("ok") and not result.get("skipped"):
            sent += 1
        elif not result.get("ok") and result.get("error") not in {"smtp_not_configured", "skip_address"}:
            logger.warning("Signup check-in trickle stopped after SMTP error.")
            break
    queued = max(0, len(eligible_users(now=moment)))
    return {"ok": True, "sent": sent, "queued": queued, "results": results}


def _decode_header(raw: str | None) -> str:
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return str(raw)


def _message_text(msg: email.message.Message) -> str:
    parts: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = (part.get_content_type() or "").lower()
            if ctype != "text/plain":
                continue
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            parts.append(payload.decode(charset, errors="replace"))
    else:
        payload = msg.get_payload(decode=True)
        if payload is not None:
            charset = msg.get_content_charset() or "utf-8"
            parts.append(payload.decode(charset, errors="replace"))
    return "\n".join(parts).strip()


def _excerpt(text: str, limit: int = 240) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def load_sent_checkins() -> list[dict[str, Any]]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM signup_checkins
             WHERE message_id IS NOT NULL AND TRIM(message_id) != ''
            """
        ).fetchall()
    return [dict(row) for row in rows]


def match_checkin(
    *,
    from_email: str,
    subject: str,
    in_reply_to: str,
    references: str,
    body: str,
    checkins: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    rows = checkins if checkins is not None else load_sent_checkins()
    if not rows:
        return None
    reply_ids = set(_header_ids(in_reply_to, references))
    from_norm = normalize_email(from_email)
    subject_l = (subject or "").lower()
    body_l = (body or "").lower()
    subject_hit = "how's render studio going" in subject_l or "hows render studio going" in subject_l

    for row in rows:
        msgid = normalize_msgid(row.get("message_id"))
        token = str(row.get("token") or "").strip().lower()
        if msgid and msgid in reply_ids:
            return row
        if token and (token in subject_l or token in body_l):
            return row
        if subject_hit and from_norm and from_norm == normalize_email(row.get("email")):
            return row
    return None


def _claim_reply(user_id: str, excerpt: str, reply_from: str) -> bool:
    now_iso = _now_iso()
    with get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        updated = conn.execute(
            """
            UPDATE signup_checkins
               SET reply_at = COALESCE(reply_at, ?),
                   reply_sms_at = ?,
                   reply_excerpt = ?,
                   reply_from = ?
             WHERE user_id = ?
               AND reply_sms_at IS NULL
            """,
            (now_iso, now_iso, excerpt[:800], reply_from[:320], user_id),
        )
        conn.commit()
        return updated.rowcount == 1


def _send_reply_alert_email(row: dict[str, Any], *, body: str, reply_from: str) -> dict[str, Any]:
    """Email Sam who replied and what they said (full reply body)."""
    if not smtp_configured():
        return {"ok": False, "error": "smtp_not_configured"}
    name = str(row.get("display_name") or "Someone").strip() or "Someone"
    email_addr = str(row.get("email") or "").strip()
    text_body = (body or "").strip() or "(no text)"
    if len(text_body) > 20000:
        text_body = text_body[:19999].rstrip() + "…"
    msg = EmailMessage()
    msg["Subject"] = f"Reply from {name} — Render Studio check-in"
    msg["From"] = formataddr((FROM_NAME, _from_email()))
    msg["To"] = SAM_EMAIL
    if email_addr:
        msg["Reply-To"] = email_addr
    msg.set_content(
        f"{name} ({email_addr}) replied to your signup check-in.\n"
        f"From: {reply_from}\n\n"
        f"{text_body}\n"
    )
    try:
        _send_message(msg)
    except Exception as exc:
        logger.warning("Signup check-in reply alert email failed: %s", exc)
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "to": SAM_EMAIL}


def notify_reply(
    row: dict[str, Any],
    *,
    excerpt: str,
    reply_from: str,
    body: str | None = None,
) -> dict[str, Any]:
    user_id = str(row.get("user_id") or "")
    if not user_id:
        return {"ok": False, "error": "missing_user"}
    if not _claim_reply(user_id, excerpt, reply_from):
        return {"ok": True, "skipped": True, "reason": "already_sms"}
    name = str(row.get("display_name") or "Someone").strip() or "Someone"
    email_addr = str(row.get("email") or "").strip()
    sms_body = f"Render Studio reply from {name} ({email_addr}): {excerpt or '(no text)'}"
    sms = sms_notify.send_sms(sms_body, to=sms_notify.DEVELOPER_PHONE)
    if sms.get("ok"):
        logger.info("Signup check-in reply SMS sent for %s", email_addr)
    else:
        logger.warning("Signup check-in reply SMS failed for %s: %s", email_addr, sms.get("error"))
    alert = _send_reply_alert_email(
        row,
        body=body if body is not None else excerpt,
        reply_from=reply_from,
    )
    return {"ok": True, "sms": sms, "alert_email": alert, "user_id": user_id}


def process_inbound_message(
    msg: email.message.Message,
    *,
    checkins: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from_email = normalize_email(parseaddr(_decode_header(msg.get("From")))[1])
    if from_email in SKIP_EMAILS or from_email == normalize_email(_from_email()):
        return {"ok": True, "skipped": True, "reason": "own_mailbox"}
    subject = _decode_header(msg.get("Subject"))
    body = _message_text(msg)
    matched = match_checkin(
        from_email=from_email,
        subject=subject,
        in_reply_to=_decode_header(msg.get("In-Reply-To")),
        references=_decode_header(msg.get("References")),
        body=body,
        checkins=checkins,
    )
    if not matched:
        return {"ok": True, "skipped": True, "reason": "no_match"}
    return notify_reply(
        matched,
        excerpt=_excerpt(body),
        reply_from=from_email,
        body=body,
    )


def _imap_host() -> str:
    smtp = (settings.capacity_alert_smtp_host or "smtp.gmail.com").strip().lower()
    if smtp.startswith("smtp."):
        return "imap." + smtp[5:]
    return "imap.gmail.com"


def _imap_login() -> imaplib.IMAP4_SSL:
    client = imaplib.IMAP4_SSL(_imap_host(), 993, timeout=30)
    client.login(settings.capacity_alert_smtp_user.strip(), settings.capacity_alert_smtp_password.strip())
    return client


def _select_mailbox(client: imaplib.IMAP4_SSL) -> str:
    for box in ("INBOX", "[Gmail]/All Mail"):
        typ, _ = client.select(box, readonly=True)
        if typ == "OK":
            return box
    client.select("INBOX", readonly=True)
    return "INBOX"


def poll_replies() -> dict[str, Any]:
    if not smtp_configured():
        return {"ok": False, "error": "smtp_not_configured", "matched": 0}
    checkins = load_sent_checkins()
    if not checkins:
        return {"ok": True, "matched": 0, "reason": "none_sent"}
    since = (_now() - timedelta(days=IMAP_LOOKBACK_DAYS)).strftime("%d-%b-%Y")
    matched = 0
    scanned = 0
    try:
        client = _imap_login()
    except Exception as exc:
        logger.warning("Signup check-in IMAP login failed: %s", exc)
        return {"ok": False, "error": str(exc), "matched": 0}
    try:
        _select_mailbox(client)
        typ, data = client.search(None, f"(SINCE {since})")
        if typ != "OK":
            return {"ok": False, "error": "imap_search_failed", "matched": 0}
        ids = (data[0] or b"").split()
        for num in ids[-80:]:
            scanned += 1
            typ, fetched = client.fetch(num, "(BODY.PEEK[])")
            if typ != "OK" or not fetched or fetched[0] is None:
                continue
            raw = fetched[0][1] if isinstance(fetched[0], tuple) else None
            if not raw:
                continue
            try:
                parsed = email.message_from_bytes(raw)
            except Exception:
                continue
            result = process_inbound_message(parsed, checkins=checkins)
            if result.get("ok") and not result.get("skipped"):
                matched += 1
        return {"ok": True, "matched": matched, "scanned": scanned}
    except Exception as exc:
        logger.warning("Signup check-in IMAP poll failed: %s", exc)
        return {"ok": False, "error": str(exc), "matched": matched, "scanned": scanned}
    finally:
        try:
            client.logout()
        except Exception:
            pass


def run_cycle(*, now: datetime | None = None) -> dict[str, Any]:
    ensure_schema()
    sent = send_due_checkins(now=now)
    replies: dict[str, Any] = {"ok": True, "matched": 0, "skipped": True, "reason": "send_only_if_smtp_down"}
    try:
        replies = poll_replies()
    except Exception as exc:
        logger.warning("Signup check-in reply poll failed: %s", exc)
        replies = {"ok": False, "error": str(exc), "matched": 0}
    return {"ok": True, "sent": sent, "replies": replies}


def _loop() -> None:
    time.sleep(STARTUP_DELAY_SECONDS)
    while True:
        try:
            run_cycle()
        except Exception:
            logger.exception("Signup check-in cycle failed")
        time.sleep(CYCLE_SECONDS)


def start_background_loop() -> None:
    global _loop_started
    flag = os.environ.get("RENDER3D_SIGNUP_CHECKIN", "1").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        logger.info("Signup check-in loop disabled by RENDER3D_SIGNUP_CHECKIN")
        return
    with _loop_lock:
        if _loop_started:
            return
        _loop_started = True
    threading.Thread(target=_loop, name="signup-checkin", daemon=True).start()
    logger.info(
        "Signup check-in loop started (delay=%sd, trickle=%s/hour %s–%s %s)",
        DELAY_DAYS,
        TRICKLE_MAX_PER_HOUR,
        SEND_HOUR_START,
        SEND_HOUR_END,
        SEND_TZ.key,
    )
