"""Chat social features: status, stories, availability, calendar invites."""

from __future__ import annotations

import json
import logging
import re
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email import policy
from email.message import EmailMessage
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.social")

STATUS_ICONS = ("🟢", "🟡", "🔴", "🟣", "🔵", "⚫", "⚪", "💼", "🏠", "✈️", "🎧", "☕", "🛠️", "🤖")
STORY_TTL_HOURS = 24
ONLINE_WINDOW_SECONDS = 120
STORIES_DIR = Path(settings.data_dir) / "stories"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def migrate_social_features(conn) -> None:
    for col, typ in (
        ("status_text", "TEXT"),
        ("status_icon", "TEXT"),
        ("status_updated_at", "TEXT"),
        ("last_seen_at", "TEXT"),
    ):
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")
        except Exception:
            pass

    for col, typ in (
        ("starts_at", "TEXT"),
        ("ends_at", "TEXT"),
        ("timezone", "TEXT"),
        ("ics_uid", "TEXT"),
        ("email_sent_at", "TEXT"),
    ):
        try:
            conn.execute(f"ALTER TABLE meeting_requests ADD COLUMN {col} {typ}")
        except Exception:
            pass

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_stories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          media_url TEXT NOT NULL,
          caption TEXT,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_stories_expires ON user_stories(expires_at)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_availability (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          weekday INTEGER NOT NULL,
          start_minute INTEGER NOT NULL,
          end_minute INTEGER NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          available INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS calendar_connections (
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          access_token TEXT,
          refresh_token TEXT,
          scopes TEXT,
          expires_at TEXT,
          email TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, provider)
        )
        """
    )
    STORIES_DIR.mkdir(parents=True, exist_ok=True)


def touch_presence(user_id: str) -> dict[str, Any]:
    now = _now_iso()
    with get_conn() as conn:
        migrate_social_features(conn)
        conn.execute("UPDATE users SET last_seen_at = ? WHERE id = ?", (now, user_id))
        conn.commit()
    return {"ok": True, "last_seen_at": now, "online": True}


def set_status(user_id: str, *, text: str | None = None, icon: str | None = None) -> dict[str, Any]:
    cleaned_text = (text or "").strip()[:80]
    cleaned_icon = (icon or "").strip()[:8]
    if cleaned_icon and cleaned_icon not in STATUS_ICONS and not re.match(r"^[\U0001F300-\U0001FAFF]$", cleaned_icon):
        # Allow any single emoji-ish glyph; clamp length already
        cleaned_icon = cleaned_icon[:4]
    now = _now_iso()
    with get_conn() as conn:
        migrate_social_features(conn)
        conn.execute(
            """
            UPDATE users
            SET status_text = ?, status_icon = ?, status_updated_at = ?
            WHERE id = ?
            """,
            (cleaned_text or None, cleaned_icon or None, now, user_id),
        )
        conn.commit()
    return get_status(user_id)


def get_status(user_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        migrate_social_features(conn)
        row = conn.execute(
            "SELECT status_text, status_icon, status_updated_at, last_seen_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        raise KeyError("User not found")
    last_seen = _parse_iso(row["last_seen_at"] if "last_seen_at" in row.keys() else None)
    online = bool(last_seen and (_now() - last_seen).total_seconds() <= ONLINE_WINDOW_SECONDS)
    return {
        "status_text": row["status_text"] if "status_text" in row.keys() else None,
        "status_icon": row["status_icon"] if "status_icon" in row.keys() else None,
        "status_updated_at": row["status_updated_at"] if "status_updated_at" in row.keys() else None,
        "last_seen_at": row["last_seen_at"] if "last_seen_at" in row.keys() else None,
        "online": online,
        "icons": list(STATUS_ICONS),
    }


def _user_public_bits(row: Any) -> dict[str, Any]:
    keys = row.keys()
    last_seen = _parse_iso(row["last_seen_at"] if "last_seen_at" in keys else None)
    online = bool(last_seen and (_now() - last_seen).total_seconds() <= ONLINE_WINDOW_SECONDS)
    return {
        "id": row["id"],
        "display_name": row["display_name"],
        "handle": row["handle"] if "handle" in keys else None,
        "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
        "status_text": row["status_text"] if "status_text" in keys else None,
        "status_icon": row["status_icon"] if "status_icon" in keys else None,
        "last_seen_at": row["last_seen_at"] if "last_seen_at" in keys else None,
        "online": online,
    }


def enrich_members(members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ids = [m.get("id") for m in members if m.get("id")]
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    with get_conn() as conn:
        migrate_social_features(conn)
        rows = conn.execute(
            f"""
            SELECT id, display_name, handle, avatar_url, status_text, status_icon, last_seen_at
            FROM users WHERE id IN ({placeholders})
            """,
            tuple(ids),
        ).fetchall()
    by_id = {r["id"]: _user_public_bits(r) for r in rows}
    out = []
    for m in members:
        base = by_id.get(m.get("id")) or {
            "id": m.get("id"),
            "display_name": m.get("display_name"),
            "handle": m.get("handle"),
            "avatar_url": m.get("avatar_url"),
            "online": False,
        }
        out.append({**base, "email": m.get("email"), "role": m.get("role")})
    out.sort(key=lambda u: (not u.get("online"), str(u.get("display_name") or "").lower()))
    return out


def list_active_stories(*, limit: int = 40) -> list[dict[str, Any]]:
    now = _now_iso()
    with get_conn() as conn:
        migrate_social_features(conn)
        conn.execute("DELETE FROM user_stories WHERE expires_at < ?", (now,))
        rows = conn.execute(
            """
            SELECT s.*, u.display_name, u.handle, u.avatar_url, u.status_icon
            FROM user_stories s
            JOIN users u ON u.id = s.user_id
            WHERE s.expires_at >= ?
            ORDER BY s.created_at DESC
            LIMIT ?
            """,
            (now, max(1, min(100, int(limit)))),
        ).fetchall()
        conn.commit()
    # Most recent story per user, keep order of first appearance
    seen: set[str] = set()
    stories: list[dict[str, Any]] = []
    for row in rows:
        uid = row["user_id"]
        if uid in seen:
            continue
        seen.add(uid)
        stories.append(
            {
                "id": row["id"],
                "user_id": uid,
                "display_name": row["display_name"],
                "handle": row["handle"],
                "avatar_url": row["avatar_url"],
                "status_icon": row["status_icon"],
                "media_url": row["media_url"],
                "caption": row["caption"] or "",
                "created_at": row["created_at"],
                "expires_at": row["expires_at"],
            }
        )
    return stories


def list_user_stories(user_id: str) -> list[dict[str, Any]]:
    now = _now_iso()
    with get_conn() as conn:
        migrate_social_features(conn)
        rows = conn.execute(
            """
            SELECT * FROM user_stories
            WHERE user_id = ? AND expires_at >= ?
            ORDER BY created_at DESC
            """,
            (user_id, now),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "media_url": r["media_url"],
            "caption": r["caption"] or "",
            "created_at": r["created_at"],
            "expires_at": r["expires_at"],
        }
        for r in rows
    ]


def create_story(*, user_id: str, media_bytes: bytes, content_type: str, caption: str = "") -> dict[str, Any]:
    if not media_bytes:
        raise ValueError("Story media is required")
    if len(media_bytes) > 8_000_000:
        raise ValueError("Story media must be under 8 MB")
    ext = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get((content_type or "").lower(), ".bin")
    if ext == ".bin":
        raise ValueError("Story must be a PNG, JPEG, WebP, or GIF image")
    story_id = uuid.uuid4().hex[:16]
    user_dir = STORIES_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{story_id}{ext}"
    path = user_dir / filename
    path.write_bytes(media_bytes)
    media_url = f"/api/stories/media/{user_id}/{filename}"
    created = _now()
    expires = created + timedelta(hours=STORY_TTL_HOURS)
    with get_conn() as conn:
        migrate_social_features(conn)
        conn.execute(
            """
            INSERT INTO user_stories (id, user_id, media_url, caption, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (story_id, user_id, media_url, (caption or "").strip()[:280], created.isoformat(), expires.isoformat()),
        )
        conn.commit()
    return {
        "id": story_id,
        "user_id": user_id,
        "media_url": media_url,
        "caption": (caption or "").strip()[:280],
        "created_at": created.isoformat(),
        "expires_at": expires.isoformat(),
    }


def story_media_path(user_id: str, filename: str) -> Path:
    safe_user = re.sub(r"[^a-zA-Z0-9_-]", "", user_id or "")
    safe_name = Path(filename).name
    if not safe_user or safe_name != filename or ".." in filename:
        raise ValueError("Invalid story media path")
    path = (STORIES_DIR / safe_user / safe_name).resolve()
    if not str(path).startswith(str(STORIES_DIR.resolve())):
        raise ValueError("Invalid story media path")
    if not path.is_file():
        raise FileNotFoundError("Story media not found")
    return path


def get_availability(user_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        migrate_social_features(conn)
        rows = conn.execute(
            """
            SELECT id, weekday, start_minute, end_minute, timezone, available
            FROM user_availability WHERE user_id = ?
            ORDER BY weekday, start_minute
            """,
            (user_id,),
        ).fetchall()
    windows = [
        {
            "id": r["id"],
            "weekday": int(r["weekday"]),
            "start_minute": int(r["start_minute"]),
            "end_minute": int(r["end_minute"]),
            "timezone": r["timezone"] or "UTC",
            "available": bool(r["available"]),
        }
        for r in rows
    ]
    return {"user_id": user_id, "windows": windows}


def set_availability(user_id: str, windows: list[dict[str, Any]]) -> dict[str, Any]:
    cleaned: list[dict[str, Any]] = []
    for raw in windows or []:
        try:
            weekday = int(raw.get("weekday"))
            start_minute = int(raw.get("start_minute"))
            end_minute = int(raw.get("end_minute"))
        except Exception as exc:
            raise ValueError("Invalid availability window") from exc
        if weekday < 0 or weekday > 6:
            raise ValueError("weekday must be 0–6 (Mon–Sun)")
        if not (0 <= start_minute < end_minute <= 24 * 60):
            raise ValueError("start/end minutes must be within the day")
        cleaned.append(
            {
                "id": str(raw.get("id") or uuid.uuid4().hex[:12]),
                "weekday": weekday,
                "start_minute": start_minute,
                "end_minute": end_minute,
                "timezone": str(raw.get("timezone") or "UTC")[:64],
                "available": 1 if raw.get("available", True) else 0,
            }
        )
    with get_conn() as conn:
        migrate_social_features(conn)
        conn.execute("DELETE FROM user_availability WHERE user_id = ?", (user_id,))
        for w in cleaned:
            conn.execute(
                """
                INSERT INTO user_availability
                  (id, user_id, weekday, start_minute, end_minute, timezone, available)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (w["id"], user_id, w["weekday"], w["start_minute"], w["end_minute"], w["timezone"], w["available"]),
            )
        conn.commit()
    return get_availability(user_id)


def suggested_slots(user_id: str, *, days: int = 7) -> list[dict[str, Any]]:
    data = get_availability(user_id)
    windows = [w for w in data["windows"] if w.get("available")]
    if not windows:
        return []
    now = _now()
    out: list[dict[str, Any]] = []
    for offset in range(max(1, min(14, days))):
        day = now + timedelta(days=offset)
        # Python weekday: Mon=0 … Sun=6 — matches our schema
        wd = day.weekday()
        for w in windows:
            if int(w["weekday"]) != wd:
                continue
            start = day.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=int(w["start_minute"]))
            end = day.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=int(w["end_minute"]))
            if end <= now:
                continue
            out.append(
                {
                    "starts_at": start.isoformat(),
                    "ends_at": end.isoformat(),
                    "timezone": w.get("timezone") or "UTC",
                    "label": f"{start.strftime('%a %b %d %H:%M')}–{end.strftime('%H:%M')}",
                }
            )
            if len(out) >= 12:
                return out
    return out


def _ics_escape(text: str) -> str:
    return (
        str(text or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def build_ics(
    *,
    uid: str,
    title: str,
    description: str,
    starts_at: datetime,
    ends_at: datetime,
    organizer_email: str,
    attendee_emails: list[str],
) -> str:
    def fmt(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Render Studio//Meetings//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{fmt(_now())}",
        f"DTSTART:{fmt(starts_at)}",
        f"DTEND:{fmt(ends_at)}",
        f"SUMMARY:{_ics_escape(title)}",
        f"DESCRIPTION:{_ics_escape(description)}",
        f"ORGANIZER;CN=Render Studio:mailto:{organizer_email}",
    ]
    for email in attendee_emails:
        if email:
            lines.append(f"ATTENDEE;RSVP=TRUE:mailto:{email}")
    lines.extend(["END:VEVENT", "END:VCALENDAR", ""])
    return "\r\n".join(lines)


def smtp_configured() -> bool:
    return bool((settings.capacity_alert_smtp_user or "").strip() and (settings.capacity_alert_smtp_password or "").strip())


def send_calendar_invite_email(
    *,
    to_emails: list[str],
    subject: str,
    body_text: str,
    ics_body: str,
) -> dict[str, Any]:
    recipients = [e.strip() for e in to_emails if e and "@" in e and not e.endswith("@social.render3d.local")]
    if not recipients:
        return {"ok": False, "error": "no_recipients"}
    if not smtp_configured():
        logger.info("Calendar invite not emailed: SMTP not configured")
        return {"ok": False, "error": "smtp_not_configured"}

    from_addr = (settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    msg = EmailMessage(policy=policy.SMTP)
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg.set_content(body_text)
    msg.add_attachment(
        ics_body.encode("utf-8"),
        maintype="text",
        subtype="calendar",
        filename="invite.ics",
        params={"method": "REQUEST", "charset": "UTF-8", "name": "invite.ics"},
    )

    host = (settings.capacity_alert_smtp_host or "smtp.gmail.com").strip()
    port = int(settings.capacity_alert_smtp_port or 587)
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(settings.capacity_alert_smtp_user.strip(), settings.capacity_alert_smtp_password.strip())
        smtp.send_message(msg)
    return {"ok": True, "to": recipients}


def google_template_url(*, title: str, details: str, starts_at: datetime | None = None, ends_at: datetime | None = None) -> str:
    params = {
        "action": "TEMPLATE",
        "text": title,
        "details": details,
    }
    if starts_at and ends_at:
        params["dates"] = (
            f"{starts_at.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}/"
            f"{ends_at.astimezone(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        )
    return "https://calendar.google.com/calendar/render?" + urlencode(params)


def outlook_deeplink(*, title: str, details: str, starts_at: datetime | None = None, ends_at: datetime | None = None) -> str:
    params = {
        "path": "/calendar/action/compose",
        "rru": "addevent",
        "subject": title,
        "body": details,
    }
    if starts_at:
        params["startdt"] = starts_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if ends_at:
        params["enddt"] = ends_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return "https://outlook.live.com/calendar/0/deeplink/compose?" + urlencode(params)


def list_calendar_connections(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        migrate_social_features(conn)
        rows = conn.execute(
            "SELECT provider, email, expires_at, updated_at, scopes FROM calendar_connections WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    return [
        {
            "provider": r["provider"],
            "email": r["email"],
            "expires_at": r["expires_at"],
            "updated_at": r["updated_at"],
            "connected": True,
            "scopes": r["scopes"],
        }
        for r in rows
    ]


def upsert_calendar_connection(
    user_id: str,
    *,
    provider: str,
    access_token: str,
    refresh_token: str | None,
    scopes: str,
    expires_at: str | None,
    email: str | None,
) -> None:
    provider = (provider or "").strip().lower()
    if provider not in {"google", "microsoft"}:
        raise ValueError("Unsupported calendar provider")
    with get_conn() as conn:
        migrate_social_features(conn)
        conn.execute(
            """
            INSERT INTO calendar_connections
              (user_id, provider, access_token, refresh_token, scopes, expires_at, email, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
              access_token = excluded.access_token,
              refresh_token = COALESCE(excluded.refresh_token, calendar_connections.refresh_token),
              scopes = excluded.scopes,
              expires_at = excluded.expires_at,
              email = excluded.email,
              updated_at = excluded.updated_at
            """,
            (
                user_id,
                provider,
                access_token,
                refresh_token,
                scopes,
                expires_at,
                email,
                _now_iso(),
            ),
        )
        conn.commit()


def disconnect_calendar(user_id: str, provider: str) -> None:
    with get_conn() as conn:
        migrate_social_features(conn)
        conn.execute(
            "DELETE FROM calendar_connections WHERE user_id = ? AND provider = ?",
            (user_id, (provider or "").strip().lower()),
        )
        conn.commit()


def calendar_oauth_start_url(provider: str, *, user_id: str, state: str) -> str:
    """Build Google/Outlook calendar consent URL (separate from login scopes)."""
    provider = (provider or "").strip().lower()
    if provider == "google":
        if not settings.google_client_id:
            raise ValueError("Google Calendar is not configured")
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri.replace("/oauth/social/callback", "/oauth/calendar/callback")
            if "/oauth/social/callback" in (settings.google_redirect_uri or "")
            else f"{settings.google_redirect_uri.rsplit('/', 1)[0]}/calendar/callback"
            if settings.google_redirect_uri
            else "https://render3d.app/oauth/calendar/callback",
            "response_type": "code",
            "scope": "openid email profile https://www.googleapis.com/auth/calendar.events",
            "access_type": "offline",
            "prompt": "consent",
            "state": f"calendar:google:{user_id}:{state}",
        }
        # Prefer dedicated calendar redirect if configured via same host pattern
        redirect = "https://render3d.app/oauth/calendar/callback"
        params["redirect_uri"] = redirect
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    if provider == "microsoft":
        if not settings.microsoft_client_id:
            raise ValueError("Outlook Calendar is not configured")
        params = {
            "client_id": settings.microsoft_client_id,
            "redirect_uri": "https://render3d.app/oauth/calendar/callback",
            "response_type": "code",
            "scope": "openid email profile offline_access Calendars.ReadWrite",
            "state": f"calendar:microsoft:{user_id}:{state}",
        }
        return "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + urlencode(params)
    raise ValueError("Unsupported calendar provider")
