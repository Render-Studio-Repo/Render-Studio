"""User handles, public profiles, and meeting requests."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from backend.database import get_conn

HANDLE_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{2,23}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify_handle(raw: str, *, fallback: str = "user") -> str:
    text = re.sub(r"[^A-Za-z0-9_]", "", (raw or "").strip())
    if text and text[0].isdigit():
        text = f"u{text}"
    text = text[:24] or fallback
    if len(text) < 3:
        text = (text + "user")[:3]
    return text


def validate_handle(handle: str) -> str:
    cleaned = (handle or "").strip().lstrip("@")
    if not HANDLE_RE.match(cleaned):
        raise ValueError("Handle must be 3–24 chars: start with a letter, then letters, numbers, or _")
    return cleaned


def handle_availability(handle: str, *, exclude_user_id: str | None = None) -> dict[str, Any]:
    cleaned = validate_handle(handle)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE lower(handle) = lower(?) LIMIT 1",
            (cleaned,),
        ).fetchone()
    available = not row or (exclude_user_id and row["id"] == exclude_user_id)
    return {
        "handle": cleaned,
        "available": bool(available),
        "is_current": bool(row and exclude_user_id and row["id"] == exclude_user_id),
    }


def ensure_unique_handle(conn, desired: str, *, exclude_user_id: str | None = None) -> str:
    base = slugify_handle(desired)
    candidate = base
    n = 2
    while True:
        row = conn.execute(
            "SELECT id FROM users WHERE lower(handle) = lower(?) LIMIT 1",
            (candidate,),
        ).fetchone()
        if not row or (exclude_user_id and row["id"] == exclude_user_id):
            return candidate
        suffix = str(n)
        candidate = f"{base[: 24 - len(suffix)]}{suffix}"
        n += 1
        if n > 9999:
            return f"u{uuid.uuid4().hex[:8]}"


def migrate_user_handles(conn) -> None:
    try:
        conn.execute("ALTER TABLE users ADD COLUMN handle TEXT")
    except Exception:
        pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN bio TEXT")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN store_settings_json TEXT")
        except Exception:
            pass
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_lower ON users(lower(handle))"
            )
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE model_listings ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'one_time'")
        except Exception:
            pass
        try:
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
        except Exception:
            pass
        try:
            from backend.services.social_service import migrate_social_features

            migrate_social_features(conn)
        except Exception:
            pass
        rows = conn.execute(
            "SELECT id, email, display_name, handle FROM users"
        ).fetchall()
        for row in rows:
            if row["handle"]:
                continue
            seed = row["display_name"] or (row["email"] or "user").split("@")[0]
            handle = ensure_unique_handle(conn, seed, exclude_user_id=row["id"])
            conn.execute("UPDATE users SET handle = ? WHERE id = ?", (handle, row["id"]))


def get_user_row(user_id: str | None = None, *, handle: str | None = None) -> dict[str, Any] | None:
    with get_conn() as conn:
        if user_id:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        elif handle:
            row = conn.execute(
                "SELECT * FROM users WHERE lower(handle) = lower(?)",
                (handle.lstrip("@"),),
            ).fetchone()
        else:
            return None
    if not row:
        return None
    keys = row.keys()
    store_settings = {}
    if "store_settings_json" in keys and row["store_settings_json"]:
        try:
            store_settings = json.loads(row["store_settings_json"] or "{}") or {}
        except Exception:
            store_settings = {}
    last_seen = row["last_seen_at"] if "last_seen_at" in keys else None
    online = False
    try:
        from backend.services.social_service import ONLINE_WINDOW_SECONDS, _parse_iso, _now

        seen = _parse_iso(last_seen)
        online = bool(seen and (_now() - seen).total_seconds() <= ONLINE_WINDOW_SECONDS)
    except Exception:
        online = False
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "handle": row["handle"] if "handle" in keys else None,
        "bio": row["bio"] if "bio" in keys else None,
        "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
        "created_at": row["created_at"],
        "store_settings": store_settings if isinstance(store_settings, dict) else {},
        "status_text": row["status_text"] if "status_text" in keys else None,
        "status_icon": row["status_icon"] if "status_icon" in keys else None,
        "status_updated_at": row["status_updated_at"] if "status_updated_at" in keys else None,
        "last_seen_at": last_seen,
        "online": online,
    }


def update_store_settings(user_id: str, settings: dict[str, Any]) -> dict[str, Any]:
    cleaned = {
        "store_enabled": bool(settings.get("store_enabled", False)),
        "store_title": str(settings.get("store_title") or "").strip()[:80],
        "store_tagline": str(settings.get("store_tagline") or "").strip()[:180],
        "default_license": str(settings.get("default_license") or "proprietary").strip()[:40],
        "default_access_mode": str(settings.get("default_access_mode") or "paid").strip()[:20],
        "default_billing_type": str(settings.get("default_billing_type") or "one_time").strip()[:20],
        "default_currency": str(settings.get("default_currency") or "USD").strip().upper()[:8],
        "default_price_cents": max(0, min(1_000_000, int(settings.get("default_price_cents") or 0))),
        "download_enabled": bool(settings.get("download_enabled", True)),
        "show_on_profile": bool(settings.get("show_on_profile", True)),
    }
    with get_conn() as conn:
        try:
            conn.execute("ALTER TABLE users ADD COLUMN store_settings_json TEXT")
        except Exception:
            pass
        conn.execute(
            "UPDATE users SET store_settings_json = ? WHERE id = ?",
            (json.dumps(cleaned, sort_keys=True), user_id),
        )
        conn.commit()
    user = get_user_row(user_id)
    return user or {}


def update_profile(
    user_id: str,
    *,
    display_name: str | None = None,
    handle: str | None = None,
    bio: str | None = None,
    status_text: str | None = None,
    status_icon: str | None = None,
) -> dict[str, Any]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise KeyError("User not found")
        updates: list[str] = []
        params: list[Any] = []
        if display_name is not None:
            name = display_name.strip()
            if not name or len(name) > 80:
                raise ValueError("Display name must be 1–80 characters")
            updates.append("display_name = ?")
            params.append(name)
        if handle is not None:
            cleaned = validate_handle(handle)
            unique = ensure_unique_handle(conn, cleaned, exclude_user_id=user_id)
            if unique.lower() != cleaned.lower():
                # Collision with another user
                taken = conn.execute(
                    "SELECT id FROM users WHERE lower(handle) = lower(?) AND id != ?",
                    (cleaned, user_id),
                ).fetchone()
                if taken:
                    raise ValueError("That handle is already taken")
            updates.append("handle = ?")
            params.append(cleaned)
        if bio is not None:
            text = bio.strip()
            if len(text) > 500:
                raise ValueError("Bio must be 500 characters or fewer")
            updates.append("bio = ?")
            params.append(text or None)
        if status_text is not None or status_icon is not None:
            from backend.services.social_service import migrate_social_features

            migrate_social_features(conn)
            if status_text is not None:
                updates.append("status_text = ?")
                params.append(status_text.strip()[:80] or None)
            if status_icon is not None:
                updates.append("status_icon = ?")
                params.append(status_icon.strip()[:8] or None)
            updates.append("status_updated_at = ?")
            params.append(_now())
        if updates:
            params.append(user_id)
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
        refreshed = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return get_user_row(refreshed["id"])  # type: ignore[index]


def _user_projects(user_id: str, *, limit: int = 12) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT pa.project_id, pa.created_at, pa.is_public, t.name AS team_name
              FROM project_access pa
              LEFT JOIN teams t ON t.id = pa.team_id
             WHERE pa.created_by = ?
             ORDER BY pa.created_at DESC
             LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    out = []
    root = Path(__file__).resolve().parents[2] / "projects"
    for row in rows:
        pid = row["project_id"]
        meta_name = pid
        project_path = root / pid
        for candidate in ("project.json", "meta.json"):
            p = project_path / candidate
            if p.is_file():
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                    meta_name = data.get("name") or data.get("title") or pid
                except Exception:
                    pass
                break
        models = []
        if project_path.is_dir():
            for ext in (".glb", ".stl", ".step", ".stp", ".obj"):
                models.extend(sorted(project_path.glob(f"*{ext}"))[:4])
        out.append(
            {
                "project_id": pid,
                "name": meta_name,
                "created_at": row["created_at"],
                "is_public": bool(row["is_public"]),
                "team_name": row["team_name"],
                "model_count": len(models),
                "models": [{"filename": m.name} for m in models[:4]],
            }
        )
    return out


def _user_posts(user_id: str, *, limit: int = 8) -> list[dict[str, Any]]:
    """Recent public-ish activity: marketplace apps + recent shared chat snippets are skipped;
    surface agent app listings authored by the user when present."""
    with get_conn() as conn:
        try:
            rows = conn.execute(
                """
                SELECT id, slug, name, tagline, status, published_at, created_at
                  FROM agent_app_listings
                 WHERE created_by = ? AND status IN ('published', 'approved', 'live')
                 ORDER BY COALESCE(published_at, created_at) DESC
                 LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        except Exception:
            rows = []
    return [
        {
            "id": r["id"],
            "slug": r["slug"],
            "title": r["name"],
            "summary": r["tagline"],
            "kind": "app",
            "created_at": r["published_at"] or r["created_at"],
            "href": f"/marketplace.html?app={r['slug']}" if r["slug"] else None,
        }
        for r in rows
    ]


def public_profile(user_id: str | None = None, *, handle: str | None = None, viewer: dict[str, Any] | None = None) -> dict[str, Any]:
    user = get_user_row(user_id, handle=handle)
    if not user:
        raise KeyError("User not found")
    handle_value = user.get("handle") or slugify_handle(user.get("display_name") or "user")
    profile_path = f"/u/{handle_value}"
    store = user.get("store_settings") or {}
    profile = {
        "id": user["id"],
        "display_name": user["display_name"],
        "handle": handle_value,
        "bio": user.get("bio") or "",
        "avatar_url": user.get("avatar_url"),
        "status_text": user.get("status_text") or "",
        "status_icon": user.get("status_icon") or "",
        "online": bool(user.get("online")),
        "created_at": user.get("created_at"),
        "profile_url": profile_path,
        "profile_link": f"https://render3d.app{profile_path}",
        "is_self": bool(viewer and viewer.get("id") == user["id"]),
        "store": store,
        "availability": {"windows": []},
        "suggested_slots": [],
        "projects": _user_projects(user["id"]),
        "posts": _user_posts(user["id"]),
        "stats": {
            "projects": len(_user_projects(user["id"], limit=100)),
            "posts": len(_user_posts(user["id"], limit=100)),
        },
    }
    try:
        from backend.services.social_service import get_availability, suggested_slots

        profile["availability"] = get_availability(user["id"])
        profile["suggested_slots"] = suggested_slots(user["id"])
    except Exception:
        pass
    return profile


def create_meeting_request(
    *,
    from_user: dict[str, Any],
    to_user_id: str,
    message: str = "",
    proposed_time: str = "",
    channel: str = "chat",
    starts_at: str = "",
    ends_at: str = "",
    timezone_name: str = "UTC",
    send_email: bool = True,
) -> dict[str, Any]:
    if from_user.get("id") == to_user_id:
        raise ValueError("You can't request a meeting with yourself")
    target = get_user_row(to_user_id)
    if not target:
        raise KeyError("User not found")
    channel = (channel or "chat").strip().lower()
    if channel not in {"chat", "calendar", "both"}:
        channel = "chat"
    req_id = str(uuid.uuid4())[:12]
    ics_uid = f"{req_id}@render3d.app"
    now = _now()

    from backend.services.social_service import (
        _parse_iso,
        build_ics,
        google_template_url,
        outlook_deeplink,
        send_calendar_invite_email,
        settings as _settings_unused,
    )
    from backend.config import settings as app_settings

    start_dt = _parse_iso(starts_at)
    end_dt = _parse_iso(ends_at)
    if start_dt and not end_dt:
        end_dt = start_dt + __import__("datetime").timedelta(minutes=30)
    if start_dt and end_dt and end_dt <= start_dt:
        raise ValueError("Meeting end must be after start")

    with get_conn() as conn:
        try:
            from backend.services.social_service import migrate_social_features

            migrate_social_features(conn)
        except Exception:
            pass
        conn.execute(
            """
            INSERT INTO meeting_requests
              (id, from_user_id, to_user_id, message, proposed_time, status, channel,
               created_at, updated_at, starts_at, ends_at, timezone, ics_uid)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                req_id,
                from_user["id"],
                to_user_id,
                (message or "").strip()[:1000],
                (proposed_time or "").strip()[:120],
                channel,
                now,
                now,
                start_dt.isoformat() if start_dt else None,
                end_dt.isoformat() if end_dt else None,
                (timezone_name or "UTC")[:64],
                ics_uid,
            ),
        )
        conn.commit()

    from_handle = from_user.get("handle") or slugify_handle(from_user.get("display_name") or "user")
    to_handle = target.get("handle") or slugify_handle(target.get("display_name") or "user")
    meeting_title = f"Render Studio meeting: {from_user.get('display_name') or from_handle} ↔ {target.get('display_name') or to_handle}"
    details = (
        (message or f"Meeting request from @{from_handle} on Render Studio").strip()
        + f"\n\nProfiles:\n- https://render3d.app/u/{from_handle}\n- https://render3d.app/u/{to_handle}"
    )
    if proposed_time and not start_dt:
        details += f"\nProposed time: {proposed_time}"

    calendar_url = google_template_url(title=meeting_title, details=details, starts_at=start_dt, ends_at=end_dt)
    outlook_url = outlook_deeplink(title=meeting_title, details=details, starts_at=start_dt, ends_at=end_dt)
    ics_body = None
    ics_download = f"/api/meeting-requests/{req_id}/ics"
    email_result = {"ok": False, "error": "no_time"}
    if start_dt and end_dt:
        organizer = (app_settings.capacity_alert_from or "info@render3d.app").strip()
        ics_body = build_ics(
            uid=ics_uid,
            title=meeting_title,
            description=details,
            starts_at=start_dt,
            ends_at=end_dt,
            organizer_email=organizer,
            attendee_emails=[from_user.get("email") or "", target.get("email") or ""],
        )
        if send_email and channel in {"calendar", "both"}:
            email_result = send_calendar_invite_email(
                to_emails=[from_user.get("email") or "", target.get("email") or ""],
                subject=meeting_title,
                body_text=f"{details}\n\nA calendar invite (.ics) is attached.",
                ics_body=ics_body,
            )
            if email_result.get("ok"):
                with get_conn() as conn:
                    conn.execute(
                        "UPDATE meeting_requests SET email_sent_at = ? WHERE id = ?",
                        (_now(), req_id),
                    )
                    conn.commit()

    chat_body = (
        f"📅 Meeting request for @[{target.get('display_name')}](user:{to_user_id})\n"
        f"From @[{from_user.get('display_name')}](user:{from_user['id']})"
    )
    if start_dt and end_dt:
        chat_body += f"\nWhen: {start_dt.isoformat()} → {end_dt.isoformat()}"
    elif proposed_time:
        chat_body += f"\nProposed: {proposed_time}"
    if message:
        chat_body += f"\n\n{message.strip()}"
    chat_body += f"\n\nGoogle Calendar: {calendar_url}"
    chat_body += f"\nOutlook: {outlook_url}"
    chat_body += f"\nDownload .ics: https://render3d.app{ics_download}"

    return {
        "id": req_id,
        "status": "pending",
        "channel": channel,
        "from_user": {
            "id": from_user["id"],
            "display_name": from_user.get("display_name"),
            "handle": from_handle,
            "email": from_user.get("email"),
        },
        "to_user": {
            "id": target["id"],
            "display_name": target.get("display_name"),
            "handle": to_handle,
            "email": target.get("email"),
        },
        "message": (message or "").strip(),
        "proposed_time": proposed_time,
        "starts_at": start_dt.isoformat() if start_dt else None,
        "ends_at": end_dt.isoformat() if end_dt else None,
        "timezone": timezone_name or "UTC",
        "calendar_url": calendar_url,
        "outlook_url": outlook_url,
        "ics_download_url": ics_download,
        "ics_uid": ics_uid,
        "email": email_result,
        "chat_body": chat_body,
        "created_at": now,
    }


def get_meeting_request(req_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM meeting_requests WHERE id = ?", (req_id,)).fetchone()
    if not row:
        return None
    keys = row.keys()
    return {k: row[k] for k in keys}


def meeting_ics_payload(req_id: str) -> tuple[str, str]:
    from backend.services.social_service import _parse_iso, build_ics
    from backend.config import settings as app_settings

    row = get_meeting_request(req_id)
    if not row:
        raise KeyError("Meeting not found")
    start_dt = _parse_iso(row.get("starts_at"))
    end_dt = _parse_iso(row.get("ends_at"))
    if not start_dt or not end_dt:
        # Fallback: 30-min slot from now
        start_dt = datetime.now(timezone.utc) + __import__("datetime").timedelta(hours=1)
        end_dt = start_dt + __import__("datetime").timedelta(minutes=30)
    from_user = get_user_row(row["from_user_id"]) or {}
    to_user = get_user_row(row["to_user_id"]) or {}
    title = f"Render Studio meeting: {from_user.get('display_name') or 'User'} ↔ {to_user.get('display_name') or 'User'}"
    details = (row.get("message") or "Render Studio meeting").strip()
    organizer = (app_settings.capacity_alert_from or "info@render3d.app").strip()
    ics = build_ics(
        uid=row.get("ics_uid") or f"{req_id}@render3d.app",
        title=title,
        description=details,
        starts_at=start_dt,
        ends_at=end_dt,
        organizer_email=organizer,
        attendee_emails=[from_user.get("email") or "", to_user.get("email") or ""],
    )
    return ics, f"render3d-meeting-{req_id}.ics"


# Keep old symbol path for callers that imported create_meeting_request earlier content
_UNUSED_QUOTE = quote


def profile_mention_markdown(user: dict[str, Any]) -> str:
    handle = user.get("handle") or slugify_handle(user.get("display_name") or "user")
    name = user.get("display_name") or handle
    return f"[@{handle}](https://render3d.app/u/{handle}) ({name})"
