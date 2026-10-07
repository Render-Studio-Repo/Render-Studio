"""Google Calendar / Outlook connections, privacy, busy/free, and Meet accept flow."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlencode

import httpx

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.calendar")

GOOGLE_CALENDAR_SCOPES = (
    "openid email profile "
    "https://www.googleapis.com/auth/calendar.events "
    "https://www.googleapis.com/auth/calendar.freebusy"
)
MICROSOFT_CALENDAR_SCOPES = "openid email profile offline_access Calendars.ReadWrite"
REMINDER_MINUTES = 30
SLOT_MINUTES = 30
BUSY_LOOKAHEAD_DAYS = 7
DEFAULT_WORK_START_MINUTE = 9 * 60
DEFAULT_WORK_END_MINUTE = 17 * 60

HttpPost = Callable[..., Any]
HttpGet = Callable[..., Any]


def org_invite_email() -> str:
    return (settings.capacity_alert_from or settings.capacity_alert_smtp_user or "info@render3d.app").strip()


def calendar_redirect_uri() -> str:
    explicit = (getattr(settings, "google_redirect_uri", "") or "").strip()
    if "/oauth/calendar/callback" in explicit:
        return explicit
    base = (settings.public_base_url or "https://render3d.app").rstrip("/")
    return f"{base}/oauth/calendar/callback"


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


def migrate_calendar_schema(conn) -> None:
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_calendar_privacy (
          user_id TEXT PRIMARY KEY,
          visibility TEXT NOT NULL DEFAULT 'internal',
          show_titles INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS calendar_busy_cache (
          user_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (user_id, provider)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meeting_requests (
          id TEXT PRIMARY KEY,
          from_user_id TEXT NOT NULL,
          to_user_id TEXT NOT NULL,
          message TEXT,
          proposed_time TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          channel TEXT NOT NULL DEFAULT 'chat',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    for col, typ in (
        ("visibility", "TEXT"),
        ("show_titles", "INTEGER"),
    ):
        try:
            conn.execute(f"ALTER TABLE calendar_connections ADD COLUMN {col} {typ}")
        except Exception:
            pass
    for col, typ in (
        ("starts_at", "TEXT"),
        ("ends_at", "TEXT"),
        ("timezone", "TEXT"),
        ("ics_uid", "TEXT"),
        ("email_sent_at", "TEXT"),
        ("meet_url", "TEXT"),
        ("google_event_id", "TEXT"),
        ("outlook_event_id", "TEXT"),
        ("accepted_at", "TEXT"),
        ("declined_at", "TEXT"),
        ("organizer_email", "TEXT"),
        ("accept_payload_json", "TEXT"),
        ("meet_error", "TEXT"),
        ("reminder_due_at", "TEXT"),
        ("reminder_sent_at", "TEXT"),
    ):
        try:
            conn.execute(f"ALTER TABLE meeting_requests ADD COLUMN {col} {typ}")
        except Exception:
            pass


def _ensure(conn=None) -> None:
    if conn is not None:
        migrate_calendar_schema(conn)
        return
    with get_conn() as owned:
        migrate_calendar_schema(owned)
        owned.commit()


def get_privacy(user_id: str) -> dict[str, Any]:
    _ensure()
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        row = conn.execute(
            "SELECT visibility, show_titles, updated_at FROM user_calendar_privacy WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return {"visibility": "internal", "show_titles": False, "updated_at": None}
    vis = str(row["visibility"] or "internal").strip().lower()
    if vis not in {"internal", "public"}:
        vis = "internal"
    return {
        "visibility": vis,
        "show_titles": bool(row["show_titles"]),
        "updated_at": row["updated_at"],
    }


def set_privacy(user_id: str, *, visibility: str | None = None, show_titles: bool | None = None) -> dict[str, Any]:
    current = get_privacy(user_id)
    vis = (visibility if visibility is not None else current["visibility"]) or "internal"
    vis = str(vis).strip().lower()
    if vis not in {"internal", "public"}:
        raise ValueError("Calendar visibility must be internal or public")
    titles = current["show_titles"] if show_titles is None else bool(show_titles)
    now = _now_iso()
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        conn.execute(
            """
            INSERT INTO user_calendar_privacy (user_id, visibility, show_titles, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              visibility = excluded.visibility,
              show_titles = excluded.show_titles,
              updated_at = excluded.updated_at
            """,
            (user_id, vis, int(titles), now),
        )
        conn.commit()
    return get_privacy(user_id)


def viewer_can_view_calendar(*, owner_id: str, viewer: dict[str, Any] | None) -> bool:
    if viewer and viewer.get("id") == owner_id:
        return True
    return get_privacy(owner_id).get("visibility") == "public"


def oauth_start_url(provider: str, *, user_id: str, state: str) -> str:
    provider = _normalize_provider(provider)
    redirect = calendar_redirect_uri()
    if provider == "google":
        if not settings.google_client_id:
            raise ValueError("Google Calendar is not configured")
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": GOOGLE_CALENDAR_SCOPES,
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": f"calendar:google:{user_id}:{state}",
        }
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    if provider == "microsoft":
        if not settings.microsoft_client_id:
            raise ValueError("Outlook Calendar is not configured")
        params = {
            "client_id": settings.microsoft_client_id,
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": MICROSOFT_CALENDAR_SCOPES,
            "state": f"calendar:microsoft:{user_id}:{state}",
        }
        return "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + urlencode(params)
    raise ValueError("Unsupported calendar provider")


def _normalize_provider(provider: str) -> str:
    key = (provider or "").strip().lower()
    if key in {"outlook", "ms", "office365"}:
        return "microsoft"
    if key in {"google", "gcal", "google_calendar"}:
        return "google"
    return key


def parse_oauth_state(state: str | None) -> tuple[str, str]:
    parts = str(state or "").split(":")
    if len(parts) < 4 or parts[0] != "calendar":
        raise ValueError("Invalid calendar OAuth state")
    return _normalize_provider(parts[1]), parts[2]


def _store_connection(
    user_id: str,
    *,
    provider: str,
    access_token: str,
    refresh_token: str | None,
    scopes: str,
    expires_at: str | None,
    email: str | None,
) -> None:
    from backend.services import social_service

    social_service.upsert_calendar_connection(
        user_id,
        provider=provider,
        access_token=access_token,
        refresh_token=refresh_token,
        scopes=scopes,
        expires_at=expires_at,
        email=email,
    )


def complete_oauth(*, code: str, state: str) -> dict[str, Any]:
    provider, user_id = parse_oauth_state(state)
    redirect = calendar_redirect_uri()
    if provider == "google":
        token, email = _exchange_google(code, redirect)
        _store_connection(
            user_id,
            provider="google",
            access_token=token.get("access_token") or "",
            refresh_token=token.get("refresh_token"),
            scopes=token.get("scope") or GOOGLE_CALENDAR_SCOPES,
            expires_at=_expiry_from_seconds(token.get("expires_in")),
            email=email,
        )
    elif provider == "microsoft":
        token, email = _exchange_microsoft(code, redirect)
        _store_connection(
            user_id,
            provider="microsoft",
            access_token=token.get("access_token") or "",
            refresh_token=token.get("refresh_token"),
            scopes=token.get("scope") or MICROSOFT_CALENDAR_SCOPES,
            expires_at=_expiry_from_seconds(token.get("expires_in")),
            email=email,
        )
    else:
        raise ValueError("Unsupported calendar provider")
    try:
        refresh_busy(user_id, provider=provider)
    except Exception:
        logger.exception("Busy sync after calendar OAuth failed user_id=%s provider=%s", user_id, provider)
    return {"ok": True, "provider": provider, "user_id": user_id}


def _expiry_from_seconds(expires_in: Any) -> str | None:
    try:
        seconds = int(expires_in)
    except (TypeError, ValueError):
        return None
    return (_now() + timedelta(seconds=max(0, seconds))).isoformat()


def _exchange_google(code: str, redirect: str) -> tuple[dict[str, Any], str | None]:
    with httpx.Client(timeout=30) as client:
        token_res = client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect,
                "grant_type": "authorization_code",
            },
        )
        token_res.raise_for_status()
        token = token_res.json()
        info = client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {token.get('access_token')}"},
        )
        info.raise_for_status()
        email = (info.json() or {}).get("email")
    return token, email


def _exchange_microsoft(code: str, redirect: str) -> tuple[dict[str, Any], str | None]:
    with httpx.Client(timeout=30) as client:
        token_res = client.post(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            data={
                "code": code,
                "client_id": settings.microsoft_client_id,
                "client_secret": settings.microsoft_client_secret,
                "redirect_uri": redirect,
                "grant_type": "authorization_code",
                "scope": MICROSOFT_CALENDAR_SCOPES,
            },
        )
        token_res.raise_for_status()
        token = token_res.json()
        info = client.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {token.get('access_token')}"},
        )
        info.raise_for_status()
        me = info.json() or {}
        email = me.get("mail") or me.get("userPrincipalName")
    return token, email


def _connection_row(user_id: str, provider: str) -> dict[str, Any] | None:
    provider = _normalize_provider(provider)
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        row = conn.execute(
            "SELECT * FROM calendar_connections WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
    if not row:
        return None
    return {k: row[k] for k in row.keys()}


def _valid_access_token(row: dict[str, Any]) -> str | None:
    token = (row.get("access_token") or "").strip()
    if not token:
        return None
    expires = _parse_iso(row.get("expires_at"))
    if expires and expires <= _now() + timedelta(seconds=60):
        refreshed = _refresh_connection_token(row)
        return (refreshed or {}).get("access_token")
    return token


def _refresh_connection_token(row: dict[str, Any]) -> dict[str, Any] | None:
    refresh = (row.get("refresh_token") or "").strip()
    if not refresh:
        return None
    provider = _normalize_provider(row.get("provider") or "")
    try:
        if provider == "google":
            with httpx.Client(timeout=30) as client:
                res = client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": settings.google_client_id,
                        "client_secret": settings.google_client_secret,
                        "refresh_token": refresh,
                        "grant_type": "refresh_token",
                    },
                )
                res.raise_for_status()
                token = res.json()
        elif provider == "microsoft":
            with httpx.Client(timeout=30) as client:
                res = client.post(
                    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                    data={
                        "client_id": settings.microsoft_client_id,
                        "client_secret": settings.microsoft_client_secret,
                        "refresh_token": refresh,
                        "grant_type": "refresh_token",
                        "scope": MICROSOFT_CALENDAR_SCOPES,
                    },
                )
                res.raise_for_status()
                token = res.json()
        else:
            return None
    except Exception:
        logger.warning("Calendar token refresh failed provider=%s user_id=%s", provider, row.get("user_id"))
        return None
    access = token.get("access_token") or ""
    new_refresh = token.get("refresh_token") or refresh
    _store_connection(
        row["user_id"],
        provider=provider,
        access_token=access,
        refresh_token=new_refresh,
        scopes=token.get("scope") or row.get("scopes") or "",
        expires_at=_expiry_from_seconds(token.get("expires_in")),
        email=row.get("email"),
    )
    return {**row, "access_token": access, "refresh_token": new_refresh}


def connected_providers(user_id: str) -> list[str]:
    from backend.services import social_service

    return [c["provider"] for c in social_service.list_calendar_connections(user_id)]


def unique_attendee_emails(*emails: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    org = org_invite_email().lower()
    for raw in emails:
        email = (raw or "").strip()
        if not email or "@" not in email:
            continue
        if email.lower().endswith("@social.render3d.local"):
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(email)
    if org and org not in seen and "@" in org_invite_email():
        out.append(org_invite_email())
    return out


def google_meet_event_payload(
    *,
    title: str,
    description: str,
    starts_at: datetime,
    ends_at: datetime,
    attendee_emails: list[str],
    include_email_reminder: bool = True,
    request_id: str | None = None,
) -> dict[str, Any]:
    attendees = [{"email": email} for email in unique_attendee_emails(*attendee_emails)]
    overrides: list[dict[str, Any]] = [{"method": "popup", "minutes": REMINDER_MINUTES}]
    if include_email_reminder:
        overrides.append({"method": "email", "minutes": REMINDER_MINUTES})
    return {
        "summary": title,
        "description": description,
        "start": {"dateTime": starts_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "timeZone": "UTC"},
        "end": {"dateTime": ends_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "timeZone": "UTC"},
        "attendees": attendees,
        "conferenceData": {
            "createRequest": {
                "requestId": request_id or uuid.uuid4().hex,
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
        "reminders": {"useDefault": False, "overrides": overrides},
    }


def outlook_event_payload(
    *,
    title: str,
    description: str,
    starts_at: datetime,
    ends_at: datetime,
    attendee_emails: list[str],
    include_email_reminder: bool = True,
) -> dict[str, Any]:
    attendees = [
        {"emailAddress": {"address": email}, "type": "required"}
        for email in unique_attendee_emails(*attendee_emails)
    ]
    return {
        "subject": title,
        "body": {"contentType": "text", "content": description},
        "start": {"dateTime": starts_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "end": {"dateTime": ends_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "attendees": attendees,
        "isReminderOn": True,
        "reminderMinutesBeforeStart": REMINDER_MINUTES,
        "isOnlineMeeting": False,
        "_include_email_reminder": include_email_reminder,
    }


def _busy_window() -> tuple[datetime, datetime]:
    start = _now().replace(second=0, microsecond=0)
    end = start + timedelta(days=BUSY_LOOKAHEAD_DAYS)
    return start, end


def _cache_busy(user_id: str, provider: str, blocks: list[dict[str, Any]], error: str | None = None) -> None:
    payload = {"busy": blocks, "error": error}
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        conn.execute(
            """
            INSERT INTO calendar_busy_cache (user_id, provider, payload_json, fetched_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
              payload_json = excluded.payload_json,
              fetched_at = excluded.fetched_at
            """,
            (user_id, _normalize_provider(provider), json.dumps(payload), _now_iso()),
        )
        conn.commit()


def cached_busy(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        rows = conn.execute(
            "SELECT payload_json FROM calendar_busy_cache WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    blocks: list[dict[str, Any]] = []
    for row in rows:
        try:
            data = json.loads(row["payload_json"] or "{}") or {}
        except Exception:
            data = {}
        for item in data.get("busy") or []:
            start = _parse_iso(item.get("starts_at") or item.get("start"))
            end = _parse_iso(item.get("ends_at") or item.get("end"))
            if not start or not end:
                continue
            blocks.append(
                {
                    "starts_at": start.isoformat(),
                    "ends_at": end.isoformat(),
                    "title": item.get("title") or "",
                    "provider": item.get("provider"),
                }
            )
    blocks.sort(key=lambda b: b["starts_at"])
    return blocks


def refresh_busy(user_id: str, *, provider: str | None = None) -> list[dict[str, Any]]:
    providers = [_normalize_provider(provider)] if provider else ["google", "microsoft"]
    for key in providers:
        row = _connection_row(user_id, key)
        if not row:
            continue
        token = _valid_access_token(row)
        if not token:
            continue
        try:
            if key == "google":
                blocks = _fetch_google_busy(token)
            else:
                blocks = _fetch_microsoft_busy(token)
            for block in blocks:
                block["provider"] = key
            _cache_busy(user_id, key, blocks)
        except Exception as exc:
            logger.warning("Busy fetch failed user_id=%s provider=%s: %s", user_id, key, exc)
            _cache_busy(user_id, key, [], error=str(exc)[:180])
    return cached_busy(user_id)


def _fetch_google_busy(access_token: str) -> list[dict[str, Any]]:
    start, end = _busy_window()
    with httpx.Client(timeout=30) as client:
        res = client.post(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json={
                "timeMin": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "timeMax": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "items": [{"id": "primary"}],
            },
        )
        res.raise_for_status()
        data = res.json() or {}
    busy = ((data.get("calendars") or {}).get("primary") or {}).get("busy") or []
    blocks = []
    for item in busy:
        s = _parse_iso(item.get("start"))
        e = _parse_iso(item.get("end"))
        if s and e:
            blocks.append({"starts_at": s.isoformat(), "ends_at": e.isoformat(), "title": ""})
    return blocks


def _fetch_microsoft_busy(access_token: str) -> list[dict[str, Any]]:
    start, end = _busy_window()
    with httpx.Client(timeout=30) as client:
        res = client.get(
            "https://graph.microsoft.com/v1.0/me/calendarView",
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "startDateTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "endDateTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "$select": "start,end,showAs,subject,sensitivity",
                "$top": "80",
            },
        )
        res.raise_for_status()
        data = res.json() or {}
    blocks = []
    for item in data.get("value") or []:
        show_as = str(item.get("showAs") or "").lower()
        if show_as in {"free", "workingelsewhere"}:
            continue
        s = _parse_iso((item.get("start") or {}).get("dateTime"))
        e = _parse_iso((item.get("end") or {}).get("dateTime"))
        if s and e:
            title = ""
            if str(item.get("sensitivity") or "").lower() not in {"private", "confidential"}:
                title = str(item.get("subject") or "")
            blocks.append({"starts_at": s.isoformat(), "ends_at": e.isoformat(), "title": title})
    return blocks


def overlaps(start: datetime, end: datetime, busy: list[dict[str, Any]]) -> bool:
    for block in busy:
        b_start = _parse_iso(block.get("starts_at"))
        b_end = _parse_iso(block.get("ends_at"))
        if not b_start or not b_end:
            continue
        if start < b_end and end > b_start:
            return True
    return False


def suggested_open_slots(user_id: str, *, days: int = 7) -> list[dict[str, Any]]:
    from backend.services.social_service import get_availability

    busy = cached_busy(user_id)
    windows = []
    try:
        windows = [w for w in (get_availability(user_id).get("windows") or []) if w.get("available")]
    except Exception:
        windows = []
    now = _now()
    out: list[dict[str, Any]] = []
    horizon = max(1, min(14, int(days)))
    for offset in range(horizon):
        day = (now + timedelta(days=offset)).replace(second=0, microsecond=0)
        day_start = day.replace(hour=0, minute=0)
        candidates: list[tuple[datetime, datetime]] = []
        if windows:
            wd = day.weekday()
            for w in windows:
                if int(w["weekday"]) != wd:
                    continue
                start = day_start + timedelta(minutes=int(w["start_minute"]))
                end = day_start + timedelta(minutes=int(w["end_minute"]))
                cursor = max(start, now + timedelta(minutes=5))
                while cursor + timedelta(minutes=SLOT_MINUTES) <= end:
                    slot_end = cursor + timedelta(minutes=SLOT_MINUTES)
                    candidates.append((cursor, slot_end))
                    cursor += timedelta(minutes=SLOT_MINUTES)
        else:
            if day.weekday() >= 5:
                continue
            start = day_start + timedelta(minutes=DEFAULT_WORK_START_MINUTE)
            end = day_start + timedelta(minutes=DEFAULT_WORK_END_MINUTE)
            cursor = max(start, now + timedelta(minutes=5))
            while cursor + timedelta(minutes=SLOT_MINUTES) <= end:
                slot_end = cursor + timedelta(minutes=SLOT_MINUTES)
                candidates.append((cursor, slot_end))
                cursor += timedelta(minutes=60)
        for start, end in candidates:
            if overlaps(start, end, busy):
                continue
            out.append(
                {
                    "starts_at": start.isoformat(),
                    "ends_at": end.isoformat(),
                    "timezone": "UTC",
                    "label": f"{start.strftime('%a %b %d %H:%M')}–{end.strftime('%H:%M')} UTC",
                }
            )
            if len(out) >= 12:
                return out
    return out


def sanitize_busy_for_viewer(blocks: list[dict[str, Any]], *, show_titles: bool) -> list[dict[str, Any]]:
    cleaned = []
    for block in blocks:
        item = {
            "starts_at": block.get("starts_at"),
            "ends_at": block.get("ends_at"),
            "busy": True,
        }
        if show_titles:
            item["title"] = block.get("title") or "Busy"
        else:
            item["title"] = "Busy"
        cleaned.append(item)
    return cleaned


def calendar_view_for_viewer(owner_id: str, viewer: dict[str, Any] | None) -> dict[str, Any]:
    privacy = get_privacy(owner_id)
    is_self = bool(viewer and viewer.get("id") == owner_id)
    connected = connected_providers(owner_id)
    can_view = is_self or privacy["visibility"] == "public"
    suggested = suggested_open_slots(owner_id)
    payload: dict[str, Any] = {
        "user_id": owner_id,
        "visibility": privacy["visibility"],
        "show_titles": bool(privacy["show_titles"]) if can_view else False,
        "connected": bool(connected),
        "providers": connected if is_self else [],
        "can_view": can_view,
        "busy": [],
        "suggested_slots": suggested,
        "internal_only": privacy["visibility"] == "internal" and not is_self,
    }
    if can_view:
        payload["busy"] = sanitize_busy_for_viewer(
            cached_busy(owner_id),
            show_titles=bool(privacy["show_titles"] or is_self),
        )
    else:
        # Internal-only: Studio still suggests open slots, but never returns busy/titles.
        payload["busy"] = []
        payload["show_titles"] = False
    return payload


def list_meeting_requests(user_id: str) -> dict[str, Any]:
    from backend.services.profile_service import get_user_row

    with get_conn() as conn:
        migrate_calendar_schema(conn)
        incoming = conn.execute(
            """
            SELECT * FROM meeting_requests
            WHERE to_user_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
        outgoing = conn.execute(
            """
            SELECT * FROM meeting_requests
            WHERE from_user_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()

    def pack(row) -> dict[str, Any]:
        from_user = get_user_row(row["from_user_id"]) or {}
        to_user = get_user_row(row["to_user_id"]) or {}
        return {
            "id": row["id"],
            "status": row["status"],
            "message": row["message"],
            "proposed_time": row["proposed_time"],
            "starts_at": row["starts_at"] if "starts_at" in row.keys() else None,
            "ends_at": row["ends_at"] if "ends_at" in row.keys() else None,
            "created_at": row["created_at"],
            "from_user": {
                "id": from_user.get("id"),
                "display_name": from_user.get("display_name"),
                "handle": from_user.get("handle"),
                "email": from_user.get("email"),
            },
            "to_user": {
                "id": to_user.get("id"),
                "display_name": to_user.get("display_name"),
                "handle": to_user.get("handle"),
                "email": to_user.get("email"),
            },
        }

    incoming_list = [pack(r) for r in incoming]
    outgoing_list = [pack(r) for r in outgoing]
    return {
        "incoming": incoming_list,
        "outgoing": outgoing_list,
        "count": len(incoming_list),
    }


def _want_email_reminder(user_ids: list[str]) -> bool:
    from backend.services import email_notification_service

    checked = False
    for uid in user_ids:
        if not uid:
            continue
        checked = True
        prefs = email_notification_service.get_preferences(uid)
        if prefs.get("meeting_reminders", True):
            return True
    return not checked


def _meet_link_from_google_event(event: dict[str, Any]) -> str:
    entry = event.get("hangoutLink") or ""
    if entry:
        return str(entry)
    conf = event.get("conferenceData") or {}
    for ep in conf.get("entryPoints") or []:
        if ep.get("entryPointType") in {"video", "hangoutsMeet"} and ep.get("uri"):
            return str(ep["uri"])
    return ""


def create_google_meet_event(
    access_token: str,
    payload: dict[str, Any],
    *,
    post: HttpPost | None = None,
) -> dict[str, Any]:
    if post is None:
        def post(url, **kwargs):
            with httpx.Client(timeout=30) as client:
                res = client.post(url, **kwargs)
                res.raise_for_status()
                return res.json()

    return post(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        params={"conferenceDataVersion": 1, "sendUpdates": "all"},
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json=payload,
    )


def create_outlook_event(
    access_token: str,
    payload: dict[str, Any],
    *,
    post: HttpPost | None = None,
) -> dict[str, Any]:
    body = {k: v for k, v in payload.items() if not k.startswith("_")}
    if post is None:
        def post(url, **kwargs):
            with httpx.Client(timeout=30) as client:
                res = client.post(url, **kwargs)
                res.raise_for_status()
                return res.json()

    return post(
        "https://graph.microsoft.com/v1.0/me/events",
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        json=body,
    )


def accept_meeting_request(
    req_id: str,
    user: dict[str, Any],
    *,
    google_post: HttpPost | None = None,
    outlook_post: HttpPost | None = None,
) -> dict[str, Any]:
    from backend.services import email_notification_service, profile_service, social_service

    row = profile_service.get_meeting_request(req_id)
    if not row:
        raise KeyError("Meeting request not found")
    if row.get("to_user_id") != user.get("id"):
        raise PermissionError("Only the invited person can accept this meeting")
    if row.get("status") not in {"pending", "accepted"}:
        raise ValueError("This meeting request is no longer pending")

    from_user = profile_service.get_user_row(row["from_user_id"]) or {}
    to_user = profile_service.get_user_row(row["to_user_id"]) or {}
    start_dt = _parse_iso(row.get("starts_at"))
    end_dt = _parse_iso(row.get("ends_at"))
    if start_dt and not end_dt:
        end_dt = start_dt + timedelta(minutes=SLOT_MINUTES)
    if start_dt and end_dt and overlaps(start_dt, end_dt, cached_busy(to_user.get("id") or "")):
        logger.info("Accepting meeting that overlaps cached busy time req_id=%s", req_id)

    title = (
        f"Render Studio meeting: {from_user.get('display_name') or 'User'} ↔ "
        f"{to_user.get('display_name') or 'User'}"
    )
    details = (row.get("message") or "Render Studio meeting").strip()
    attendees = unique_attendee_emails(from_user.get("email") or "", to_user.get("email") or "", org_invite_email())
    include_email_reminder = _want_email_reminder([from_user.get("id"), to_user.get("id")])
    meet_url = ""
    google_event_id = None
    outlook_event_id = None
    meet_error = None
    accept_payload: dict[str, Any] | None = None
    organizer_email = org_invite_email()

    if start_dt and end_dt:
        google_row = _connection_row(to_user.get("id") or "", "google") or _connection_row(from_user.get("id") or "", "google")
        accept_payload = google_meet_event_payload(
            title=title,
            description=details,
            starts_at=start_dt,
            ends_at=end_dt,
            attendee_emails=attendees,
            include_email_reminder=include_email_reminder,
            request_id=req_id,
        )
        if google_row:
            token = _valid_access_token(google_row)
            organizer_email = google_row.get("email") or organizer_email
            if token:
                try:
                    event = create_google_meet_event(token, accept_payload, post=google_post)
                    google_event_id = event.get("id")
                    meet_url = _meet_link_from_google_event(event)
                except Exception as exc:
                    meet_error = str(exc)[:180]
                    logger.warning("Google Meet create failed req_id=%s: %s", req_id, exc)
        if not meet_url:
            outlook_row = _connection_row(to_user.get("id") or "", "microsoft") or _connection_row(
                from_user.get("id") or "", "microsoft"
            )
            if outlook_row:
                token = _valid_access_token(outlook_row)
                if token:
                    try:
                        ol_payload = outlook_event_payload(
                            title=title,
                            description=details + (f"\n\nGoogle Meet: {meet_url}" if meet_url else ""),
                            starts_at=start_dt,
                            ends_at=end_dt,
                            attendee_emails=attendees,
                            include_email_reminder=include_email_reminder,
                        )
                        event = create_outlook_event(token, ol_payload, post=outlook_post)
                        outlook_event_id = event.get("id")
                    except Exception as exc:
                        meet_error = meet_error or str(exc)[:180]
                        logger.warning("Outlook event create failed req_id=%s: %s", req_id, exc)

        ics_body = social_service.build_ics(
            uid=row.get("ics_uid") or f"{req_id}@render3d.app",
            title=title,
            description=details + (f"\n\nJoin: {meet_url}" if meet_url else ""),
            starts_at=start_dt,
            ends_at=end_dt,
            organizer_email=organizer_email,
            attendee_emails=attendees,
            reminder_minutes=REMINDER_MINUTES,
            reminder_email=include_email_reminder,
        )
        email_to = []
        for uid, email in ((from_user.get("id"), from_user.get("email")), (to_user.get("id"), to_user.get("email"))):
            if email_notification_service.user_allows_email(uid, "calendar_meetings"):
                email_to.append(email or "")
        social_service.send_calendar_invite_email(
            to_emails=email_to,
            subject=title,
            body_text=(
                f"{details}\n\n"
                + (f"Google Meet: {meet_url}\n" if meet_url else "")
                + "A calendar invite is attached. Reminder: 30 minutes before."
            ),
            ics_body=ics_body,
        )

    now = _now_iso()
    reminder_due = (start_dt - timedelta(minutes=REMINDER_MINUTES)).isoformat() if start_dt else None
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        conn.execute(
            """
            UPDATE meeting_requests
               SET status = 'accepted',
                   updated_at = ?,
                   accepted_at = ?,
                   meet_url = ?,
                   google_event_id = ?,
                   outlook_event_id = ?,
                   organizer_email = ?,
                   accept_payload_json = ?,
                   meet_error = ?,
                   reminder_due_at = ?
             WHERE id = ?
            """,
            (
                now,
                now,
                meet_url or None,
                google_event_id,
                outlook_event_id,
                organizer_email,
                json.dumps(accept_payload) if accept_payload else None,
                meet_error,
                reminder_due,
                req_id,
            ),
        )
        conn.commit()

    result = {
        "id": req_id,
        "status": "accepted",
        "meet_url": meet_url,
        "google_event_id": google_event_id,
        "outlook_event_id": outlook_event_id,
        "organizer_email": organizer_email,
        "attendees": attendees,
        "reminder_minutes": REMINDER_MINUTES,
        "email_reminder": include_email_reminder,
        "accept_payload": accept_payload,
        "meet_error": meet_error,
        "starts_at": start_dt.isoformat() if start_dt else row.get("starts_at"),
        "ends_at": end_dt.isoformat() if end_dt else row.get("ends_at"),
        "from_user": from_user,
        "to_user": to_user,
        "org_email": org_invite_email(),
    }
    return result


def decline_meeting_request(req_id: str, user: dict[str, Any]) -> dict[str, Any]:
    from backend.services import profile_service

    row = profile_service.get_meeting_request(req_id)
    if not row:
        raise KeyError("Meeting request not found")
    if row.get("to_user_id") != user.get("id"):
        raise PermissionError("Only the invited person can decline this meeting")
    now = _now_iso()
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        conn.execute(
            "UPDATE meeting_requests SET status = 'declined', updated_at = ?, declined_at = ? WHERE id = ?",
            (now, now, req_id),
        )
        conn.commit()
    return {"id": req_id, "status": "declined"}


def send_due_meeting_reminders(*, now: datetime | None = None) -> dict[str, Any]:
    """Email both attendees 30 minutes before accepted meetings (pref-gated)."""
    from backend.services import email_notification_service, profile_service

    moment = now or _now()
    sent = 0
    skipped = 0
    with get_conn() as conn:
        migrate_calendar_schema(conn)
        rows = conn.execute(
            """
            SELECT * FROM meeting_requests
             WHERE status = 'accepted'
               AND reminder_sent_at IS NULL
               AND reminder_due_at IS NOT NULL
               AND reminder_due_at <= ?
               AND (starts_at IS NULL OR starts_at >= ?)
            """,
            (moment.isoformat(), (moment - timedelta(minutes=5)).isoformat()),
        ).fetchall()
    for row in rows:
        req_id = row["id"]
        from_user = profile_service.get_user_row(row["from_user_id"]) or {}
        to_user = profile_service.get_user_row(row["to_user_id"]) or {}
        meet_url = row["meet_url"] if "meet_url" in row.keys() else ""
        starts = row["starts_at"] if "starts_at" in row.keys() else ""
        title = (
            f"Render Studio meeting: {from_user.get('display_name') or 'User'} ↔ "
            f"{to_user.get('display_name') or 'User'}"
        )
        emailed_any = False
        for person in (from_user, to_user):
            uid = person.get("id")
            email = person.get("email") or ""
            if not uid or not email:
                continue
            if not email_notification_service.user_allows_email(uid, "meeting_reminders"):
                skipped += 1
                continue
            result = email_notification_service.send_meeting_reminder_email(
                to_email=email,
                title=title,
                starts_at=starts or "",
                meet_url=meet_url or "",
                user_id=uid,
            )
            if result.get("ok"):
                emailed_any = True
                sent += 1
            else:
                skipped += 1
        with get_conn() as conn:
            migrate_calendar_schema(conn)
            conn.execute(
                "UPDATE meeting_requests SET reminder_sent_at = ? WHERE id = ?",
                (_now_iso(), req_id),
            )
            conn.commit()
        if not emailed_any:
            skipped += 1
    return {"ok": True, "sent": sent, "skipped": skipped, "checked": len(rows)}


_reminder_lock = threading.Lock()
_reminder_started = False


def _reminder_loop() -> None:
    time.sleep(25)
    while True:
        try:
            send_due_meeting_reminders()
        except Exception:
            logger.exception("Meeting reminder cycle failed")
        time.sleep(60)


def start_reminder_loop() -> None:
    global _reminder_started
    flag = os.environ.get("RENDER3D_MEETING_REMINDERS", "1").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        logger.info("Meeting reminder loop disabled by RENDER3D_MEETING_REMINDERS")
        return
    with _reminder_lock:
        if _reminder_started:
            return
        _reminder_started = True
    threading.Thread(target=_reminder_loop, name="meeting-reminders", daemon=True).start()
    logger.info("Meeting reminder loop started (every 60s, 30 minutes before)")
