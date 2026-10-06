"""Account linking for live stream destinations (X Live, Twitch, Kick).

Stores connected flags + optional OAuth tokens. Live RTMP/WHIP ingest is not
implemented here — the studio opens the laptop capture/share path instead.
"""

from __future__ import annotations

import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.config import settings
from backend.database import get_conn

STREAM_PROVIDERS = (
    {"id": "x_live", "label": "X Live", "auth_hint": "https://x.com/i/oauth2/authorize"},
    {"id": "twitch", "label": "Twitch", "auth_hint": "https://id.twitch.tv/oauth2/authorize"},
    {"id": "kick", "label": "Kick", "auth_hint": "https://id.kick.com/oauth/authorize"},
)
PROVIDER_IDS = frozenset(p["id"] for p in STREAM_PROVIDERS)
WS_TYPE = "stream.link.changed"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _ensure_tables() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS user_stream_links (
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                connected INTEGER NOT NULL DEFAULT 0,
                handle TEXT,
                access_token TEXT,
                refresh_token TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, provider),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS stream_link_pending (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                provider TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                consumed_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )


def normalize_provider(raw: str | None) -> str:
    key = str(raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    if key in {"x", "twitter", "x_live", "xlive"}:
        return "x_live"
    if key in PROVIDER_IDS:
        return key
    raise ValueError(f"Unknown stream provider: {raw}")


def provider_list() -> list[dict[str, str]]:
    return [dict(p) for p in STREAM_PROVIDERS]


def configured(provider: str) -> bool:
    pid = normalize_provider(provider)
    if pid == "x_live":
        return bool(getattr(settings, "twitter_client_id", "") or getattr(settings, "twitch_client_id", ""))
    if pid == "twitch":
        return bool(getattr(settings, "twitch_client_id", ""))
    if pid == "kick":
        return bool(getattr(settings, "kick_client_id", ""))
    return False


def status(user: dict[str, Any] | None) -> dict[str, Any]:
    _ensure_tables()
    uid = str((user or {}).get("id") or "")
    rows: dict[str, dict] = {}
    if uid:
        with get_conn() as conn:
            for row in conn.execute(
                "SELECT provider, connected, handle FROM user_stream_links WHERE user_id = ?",
                (uid,),
            ):
                rows[str(row["provider"])] = dict(row)
    providers = []
    for spec in STREAM_PROVIDERS:
        pid = spec["id"]
        row = rows.get(pid) or {}
        providers.append({
            "id": pid,
            "label": spec["label"],
            "connected": bool(int(row.get("connected") or 0)),
            "handle": row.get("handle") or "",
            "configured": configured(pid),
            "auth_hint": spec["auth_hint"],
            "live_ingest": False,
        })
    return {
        "providers": providers,
        "live_ingest": False,
        "note": "Account linking is stored. Live RTMP/WHIP ingest is not configured — Stream opens the laptop studio.",
    }


def set_connected(user_id: str, provider: str, *, connected: bool = True, handle: str = "") -> dict[str, Any]:
    _ensure_tables()
    pid = normalize_provider(provider)
    uid = str(user_id)
    now = _iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_stream_links (user_id, provider, connected, handle, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                connected = excluded.connected,
                handle = excluded.handle,
                updated_at = excluded.updated_at
            """,
            (uid, pid, 1 if connected else 0, handle[:80], now, now),
        )
    return {"ok": True, "provider": pid, "connected": connected, "handle": handle}


def unlink(user_id: str, provider: str) -> dict[str, Any]:
    return set_connected(user_id, provider, connected=False, handle="")


def create_pending(user_id: str, provider: str | None = None) -> dict[str, Any]:
    _ensure_tables()
    token = secrets.token_urlsafe(18)
    now = _now()
    expires = now + timedelta(minutes=20)
    pid = ""
    if provider:
        pid = normalize_provider(provider)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO stream_link_pending (token, user_id, provider, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (token, str(user_id), pid or None, _iso(now), _iso(expires)),
        )
    return {"token": token, "provider": pid or None, "expires_at": _iso(expires)}


def peek_pending(token: str) -> dict[str, Any] | None:
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM stream_link_pending WHERE token = ?",
            (str(token),),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def consume_pending(token: str, provider: str | None = None, *, handle: str = "") -> dict[str, Any]:
    row = peek_pending(token)
    if not row:
        raise FileNotFoundError("Unknown or expired stream link token.")
    if row.get("consumed_at"):
        raise RuntimeError("This QR / link was already used.")
    expires = str(row.get("expires_at") or "")
    if expires and expires < _iso():
        raise RuntimeError("This QR / link expired. Ask the headset to send again.")
    pid = normalize_provider(provider or row.get("provider") or "")
    uid = str(row["user_id"])
    result = set_connected(uid, pid, connected=True, handle=handle)
    with get_conn() as conn:
        conn.execute(
            "UPDATE stream_link_pending SET consumed_at = ?, provider = ? WHERE token = ?",
            (_iso(), pid, str(token)),
        )
    result["user_id"] = uid
    result["token"] = token
    return result


def authorize_url(provider: str, *, redirect_uri: str, state: str) -> str:
    pid = normalize_provider(provider)
    if pid == "twitch" and getattr(settings, "twitch_client_id", ""):
        q = urllib.parse.urlencode({
            "client_id": settings.twitch_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "user:read:email",
            "state": state,
        })
        return f"https://id.twitch.tv/oauth2/authorize?{q}"
    if pid == "kick" and getattr(settings, "kick_client_id", ""):
        q = urllib.parse.urlencode({
            "client_id": settings.kick_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "user:read",
            "state": state,
        })
        return f"https://id.kick.com/oauth/authorize?{q}"
    if pid == "x_live" and getattr(settings, "twitter_client_id", ""):
        q = urllib.parse.urlencode({
            "client_id": settings.twitter_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "tweet.read users.read offline.access",
            "state": state,
        })
        return f"https://x.com/i/oauth2/authorize?{q}"
    # Documented connect URL when secrets are not configured.
    hints = {p["id"]: p["auth_hint"] for p in STREAM_PROVIDERS}
    return hints[pid]


def ws_payload(*, reason: str = "connected", provider: str = "", user_id: str = "") -> dict[str, Any]:
    out = {"type": WS_TYPE, "reason": reason}
    if provider:
        out["provider"] = provider
    if user_id:
        out["user_id"] = user_id
    return out
