"""X (Twitter) account linking + tweet posting for viewport video / screenshot shares.

Supports:
  - OAuth 1.0a (API Key + API Key Secret) — default; matches Keys and tokens in the portal
  - OAuth 2.0 PKCE (Client ID + Client Secret) when TWITTER_OAUTH_MODE=oauth2

Stores user tokens so the browser can Connect X once and post without leaving Render Studio.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import subprocess
import tempfile
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import requests
from requests_oauthlib import OAuth1

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.twitter")

AUTH_URL = "https://x.com/i/oauth2/authorize"
TOKEN_URL = "https://api.twitter.com/2/oauth2/token"
OAUTH1_REQUEST_TOKEN = "https://api.twitter.com/oauth/request_token"
OAUTH1_AUTHORIZE = "https://api.twitter.com/oauth/authorize"
OAUTH1_ACCESS_TOKEN = "https://api.twitter.com/oauth/access_token"
API_BASE = "https://api.twitter.com/2"
OAUTH1_SECRET_PREFIX = "oauth1:"
MEDIA_INIT = f"{API_BASE}/media/upload/initialize"
MEDIA_STATUS = f"{API_BASE}/media/upload"
SCOPES = "tweet.read tweet.write users.read offline.access media.write"
CHUNK_SIZE = 4 * 1024 * 1024
MAX_VIDEO_BYTES = 512 * 1024 * 1024
MAX_VIDEO_SECONDS = 140


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def configured() -> bool:
    return bool(
        (settings.twitter_client_id or "").strip()
        and (settings.twitter_client_secret or "").strip()
        and (settings.twitter_redirect_uri or "").strip()
    )


def auth_mode() -> str:
    """oauth1 (API Key) by default; set TWITTER_OAUTH_MODE=oauth2 for Client ID flow."""
    mode = str(getattr(settings, "twitter_oauth_mode", "") or "").strip().lower()
    if mode in {"oauth2", "oauth1", "auto"}:
        if mode != "auto":
            return mode
    # Heuristic: OAuth 2 Client IDs from the portal are usually longer than API Keys (~25).
    cid = (settings.twitter_client_id or "").strip()
    if len(cid) > 30:
        return "oauth2"
    return "oauth1"


def _ensure_tables() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS twitter_oauth_tokens (
                user_id TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at TEXT,
                scope TEXT,
                twitter_user_id TEXT,
                username TEXT,
                display_name TEXT,
                picture_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS twitter_oauth_pending (
                state TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                code_verifier TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:128]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")
    return verifier, challenge


def _basic_auth_header() -> str:
    raw = f"{settings.twitter_client_id}:{settings.twitter_client_secret}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _request_oauth1_token(callback_uri: str) -> tuple[str, str]:
    oauth = OAuth1(
        settings.twitter_client_id,
        client_secret=settings.twitter_client_secret,
        callback_uri=callback_uri,
        signature_method="HMAC-SHA1",
    )
    resp = requests.post(OAUTH1_REQUEST_TOKEN, auth=oauth, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(resp.text[:400] or f"request_token HTTP {resp.status_code}")
    parsed = dict(urllib.parse.parse_qsl(resp.text))
    oauth_token = parsed.get("oauth_token") or ""
    oauth_token_secret = parsed.get("oauth_token_secret") or ""
    if not oauth_token or not oauth_token_secret:
        raise RuntimeError("X did not return an OAuth request token.")
    return oauth_token, oauth_token_secret


def _store_oauth1_pending(user_id: str, oauth_token: str, oauth_token_secret: str, *, oob: bool) -> str:
    """Store pending request token. Returns opaque state for the browser."""
    state = oauth_token if not oob else secrets.token_urlsafe(24)
    # For oob, keep request token in code_verifier payload: secret\ntoken
    verifier_payload = oauth_token_secret if not oob else f"{oauth_token_secret}\n{oauth_token}"
    pending_key = oauth_token if not oob else state
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM twitter_oauth_pending WHERE created_at < ?",
            ((_now() - timedelta(minutes=30)).isoformat(),),
        )
        conn.execute(
            "INSERT INTO twitter_oauth_pending (state, user_id, code_verifier, created_at) VALUES (?, ?, ?, ?)",
            (pending_key, user_id, verifier_payload, _now_iso()),
        )
    return state


def _link_url_oauth1(user_id: str) -> dict[str, Any]:
    """3-legged OAuth 1.0a using API Key / API Key Secret.

    Web apps: callback redirect.
    Desktop apps (portal type): only oob/PIN is allowed — return mode=oob.
    """
    _ensure_tables()
    mode = "redirect"
    try:
        oauth_token, oauth_token_secret = _request_oauth1_token(settings.twitter_redirect_uri)
    except RuntimeError as exc:
        detail = str(exc)
        if "oob" in detail.lower() or "417" in detail or "Desktop applications" in detail:
            oauth_token, oauth_token_secret = _request_oauth1_token("oob")
            mode = "oob"
        else:
            raise RuntimeError(
                "X OAuth 1.0a request_token failed. In Developer Portal enable User authentication, "
                "set App type to Web App (or Native for PIN), Callback URI "
                f"{settings.twitter_redirect_uri}, permissions Read and write. Detail: {detail[:240]}"
            ) from exc
    state = _store_oauth1_pending(user_id, oauth_token, oauth_token_secret, oob=(mode == "oob"))
    url = f"{OAUTH1_AUTHORIZE}?{urllib.parse.urlencode({'oauth_token': oauth_token})}"
    return {"url": url, "mode": mode, "state": state}


def _link_url_oauth2(user_id: str) -> str:
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(24)
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM twitter_oauth_pending WHERE created_at < ?",
            ((_now() - timedelta(minutes=30)).isoformat(),),
        )
        conn.execute(
            "INSERT INTO twitter_oauth_pending (state, user_id, code_verifier, created_at) VALUES (?, ?, ?, ?)",
            (state, user_id, verifier, _now_iso()),
        )
    params = {
        "response_type": "code",
        "client_id": settings.twitter_client_id,
        "redirect_uri": settings.twitter_redirect_uri,
        "scope": SCOPES,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def link_url(user_id: str) -> str:
    """Back-compat: authorize URL only."""
    return str(link_start(user_id).get("url") or "")


def link_start(user_id: str) -> dict[str, Any]:
    if not configured():
        raise RuntimeError("X (Twitter) OAuth is not configured. Set TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, and TWITTER_REDIRECT_URI.")
    _ensure_tables()
    if auth_mode() == "oauth2":
        url = _link_url_oauth2(user_id)
        # Extract state from URL for completeness
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        return {"url": url, "mode": "oauth2", "state": q.get("state") or ""}
    return _link_url_oauth1(user_id)


def complete_oob(user_id: str, state: str, pin: str) -> dict[str, Any]:
    """Finish Desktop/Native (oob) OAuth using the PIN shown on X."""
    if not configured():
        raise RuntimeError("X OAuth is not configured.")
    state = str(state or "").strip()
    pin = str(pin or "").strip()
    if not state or not pin:
        raise RuntimeError("Enter the PIN from X to finish connecting.")
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, code_verifier, created_at FROM twitter_oauth_pending WHERE state = ?",
            (state,),
        ).fetchone()
        conn.execute("DELETE FROM twitter_oauth_pending WHERE state = ?", (state,))
    if not row:
        raise RuntimeError("Invalid or expired connect session. Click Connect X again.")
    if str(row["user_id"]) != str(user_id):
        raise RuntimeError("Connect session belongs to another user.")
    created = datetime.fromisoformat(str(row["created_at"]))
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if _now() - created > timedelta(minutes=20):
        raise RuntimeError("Connect session expired. Click Connect X again.")
    payload = str(row["code_verifier"] or "")
    if "\n" in payload:
        oauth_token_secret, oauth_token = payload.split("\n", 1)
    else:
        raise RuntimeError("Connect session is not a PIN flow. Try Connect X again.")
    return upsert_link_oauth1(oauth_token.strip(), pin, user_id=user_id, request_secret=oauth_token_secret.strip())


def _exchange_code(code: str, code_verifier: str) -> dict[str, Any]:
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.twitter_redirect_uri,
            "code_verifier": code_verifier,
            "client_id": settings.twitter_client_id,
        },
        headers={
            "Authorization": _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"X token exchange failed: {resp.text[:300]}")
    return resp.json()


def _refresh_access_token(refresh_token: str) -> dict[str, Any]:
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.twitter_client_id,
        },
        headers={
            "Authorization": _basic_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"X token refresh failed: {resp.text[:300]}")
    return resp.json()


def _x_me(access_token: str) -> dict[str, Any]:
    resp = httpx.get(
        f"{API_BASE}/users/me",
        params={"user.fields": "profile_image_url,name,username"},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=20,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"X user lookup failed: {resp.text[:300]}")
    return (resp.json() or {}).get("data") or {}


def _store_tokens(user_id: str, token: dict[str, Any], profile: dict[str, Any] | None = None) -> dict[str, Any]:
    access = str(token.get("access_token") or "")
    if not access:
        raise RuntimeError("X did not return an access token.")
    refresh = str(token.get("refresh_token") or "") or None
    expires_in = int(token.get("expires_in") or 7200)
    expires_at = (_now() + timedelta(seconds=max(60, expires_in - 60))).isoformat()
    scope = str(token.get("scope") or SCOPES)
    profile = profile or _x_me(access)
    twitter_user_id = str(profile.get("id") or "").strip() or None
    username = str(profile.get("username") or "").strip() or None
    display_name = str(profile.get("name") or username or "X user").strip()
    picture = str(profile.get("profile_image_url") or "").strip() or None
    now = _now_iso()
    _ensure_tables()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT refresh_token FROM twitter_oauth_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not refresh and existing:
            refresh = existing["refresh_token"]
        conn.execute(
            """
            INSERT INTO twitter_oauth_tokens
              (user_id, access_token, refresh_token, expires_at, scope,
               twitter_user_id, username, display_name, picture_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              access_token = excluded.access_token,
              refresh_token = COALESCE(excluded.refresh_token, twitter_oauth_tokens.refresh_token),
              expires_at = excluded.expires_at,
              scope = excluded.scope,
              twitter_user_id = COALESCE(excluded.twitter_user_id, twitter_oauth_tokens.twitter_user_id),
              username = COALESCE(excluded.username, twitter_oauth_tokens.username),
              display_name = COALESCE(excluded.display_name, twitter_oauth_tokens.display_name),
              picture_url = COALESCE(excluded.picture_url, twitter_oauth_tokens.picture_url),
              updated_at = excluded.updated_at
            """,
            (
                user_id,
                access,
                refresh,
                expires_at,
                scope,
                twitter_user_id,
                username,
                display_name,
                picture,
                now,
                now,
            ),
        )
        # Keep a social_accounts row for Authorized apps / profile consistency.
        if twitter_user_id:
            conn.execute(
                """
                INSERT INTO social_accounts
                  (provider, provider_user_id, user_id, email, display_name, picture_url, created_at, updated_at)
                VALUES ('twitter', ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider, provider_user_id) DO UPDATE SET
                  user_id = excluded.user_id,
                  email = excluded.email,
                  display_name = excluded.display_name,
                  picture_url = excluded.picture_url,
                  updated_at = excluded.updated_at
                """,
                (twitter_user_id, user_id, username, display_name, picture, now, now),
            )
    return {
        "twitter_user_id": twitter_user_id,
        "username": username,
        "display_name": display_name,
        "picture_url": picture,
    }


def upsert_link(user_id: str, code: str, state: str) -> dict[str, Any]:
    if not configured():
        raise RuntimeError("X OAuth is not configured.")
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, code_verifier, created_at FROM twitter_oauth_pending WHERE state = ?",
            (state,),
        ).fetchone()
        conn.execute("DELETE FROM twitter_oauth_pending WHERE state = ?", (state,))
    if not row or str(row["user_id"]) != str(user_id):
        # State encodes the linking user; tolerate consume-by-state alone.
        if not row:
            raise RuntimeError("Invalid or expired X OAuth state.")
        user_id = str(row["user_id"])
    created = datetime.fromisoformat(str(row["created_at"]))
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if _now() - created > timedelta(minutes=20):
        raise RuntimeError("X OAuth state expired. Try connecting again.")
    token = _exchange_code(code, str(row["code_verifier"]))
    return _store_tokens(user_id, token)


def upsert_link_oauth1(
    oauth_token: str,
    oauth_verifier: str,
    *,
    user_id: str | None = None,
    request_secret: str | None = None,
) -> dict[str, Any]:
    """Finish OAuth 1.0a after X redirects back (or PIN entry) with oauth_token + verifier."""
    if not configured():
        raise RuntimeError("X OAuth is not configured.")
    oauth_token = str(oauth_token or "").strip()
    oauth_verifier = str(oauth_verifier or "").strip()
    if not oauth_token or not oauth_verifier:
        raise RuntimeError("Missing OAuth verifier from X.")
    _ensure_tables()
    if user_id and request_secret:
        # PIN / oob path — pending already consumed by complete_oob
        pass
    else:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT user_id, code_verifier, created_at FROM twitter_oauth_pending WHERE state = ?",
                (oauth_token,),
            ).fetchone()
            conn.execute("DELETE FROM twitter_oauth_pending WHERE state = ?", (oauth_token,))
        if not row:
            raise RuntimeError("Invalid or expired X OAuth request token.")
        user_id = str(row["user_id"])
        request_secret = str(row["code_verifier"] or "")
        # oob pending stores "secret\ntoken" — strip if somehow hit
        if "\n" in request_secret:
            request_secret = request_secret.split("\n", 1)[0]
        created = datetime.fromisoformat(str(row["created_at"]))
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if _now() - created > timedelta(minutes=20):
            raise RuntimeError("X OAuth state expired. Try connecting again.")
    oauth = OAuth1(
        settings.twitter_client_id,
        client_secret=settings.twitter_client_secret,
        resource_owner_key=oauth_token,
        resource_owner_secret=request_secret,
        verifier=oauth_verifier,
        signature_method="HMAC-SHA1",
    )
    resp = requests.post(OAUTH1_ACCESS_TOKEN, auth=oauth, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"X OAuth 1.0a access_token failed: {resp.text[:300]}")
    parsed = dict(urllib.parse.parse_qsl(resp.text))
    access_token = parsed.get("oauth_token") or ""
    access_secret = parsed.get("oauth_token_secret") or ""
    twitter_user_id = parsed.get("user_id") or ""
    username = parsed.get("screen_name") or ""
    if not access_token or not access_secret:
        raise RuntimeError("X did not return user access tokens.")
    # Look up profile display fields when possible.
    profile: dict[str, Any] = {"id": twitter_user_id, "username": username, "name": username}
    try:
        auth = OAuth1(
            settings.twitter_client_id,
            client_secret=settings.twitter_client_secret,
            resource_owner_key=access_token,
            resource_owner_secret=access_secret,
            signature_method="HMAC-SHA1",
        )
        me = requests.get(
            f"{API_BASE}/users/me",
            params={"user.fields": "profile_image_url,name,username"},
            auth=auth,
            timeout=20,
        )
        if me.status_code < 400:
            profile = (me.json() or {}).get("data") or profile
    except Exception as exc:
        logger.info("X profile lookup skipped: %s", exc)
    token = {
        "access_token": access_token,
        "refresh_token": f"{OAUTH1_SECRET_PREFIX}{access_secret}",
        "expires_in": 60 * 60 * 24 * 365 * 10,  # OAuth1 user tokens do not expire the same way
        "scope": "oauth1",
    }
    return _store_tokens(user_id, token, profile)


def linked_account(user_id: str) -> dict[str, Any] | None:
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT twitter_user_id, username, display_name, picture_url, updated_at, expires_at, refresh_token
              FROM twitter_oauth_tokens
             WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "twitter_user_id": row["twitter_user_id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "picture_url": row["picture_url"],
        "updated_at": row["updated_at"],
        "has_refresh": bool(row["refresh_token"]),
    }


def unlink(user_id: str) -> None:
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT twitter_user_id FROM twitter_oauth_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        conn.execute("DELETE FROM twitter_oauth_tokens WHERE user_id = ?", (user_id,))
        if row and row["twitter_user_id"]:
            conn.execute(
                "DELETE FROM social_accounts WHERE provider = 'twitter' AND provider_user_id = ? AND user_id = ?",
                (row["twitter_user_id"], user_id),
            )


def status(user: dict[str, Any]) -> dict[str, Any]:
    account = linked_account(user["id"])
    return {
        "configured": configured(),
        "connected": bool(account),
        "account": account,
        "auth_mode": auth_mode(),
    }


def get_user_auth(user_id: str) -> dict[str, Any]:
    """Return auth material for API calls.

    oauth1: {mode, access_token, token_secret, auth}  (requests OAuth1 instance)
    oauth2: {mode, access_token}
    """
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, expires_at, scope FROM twitter_oauth_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        raise RuntimeError("Connect your X account first.")
    access = str(row["access_token"] or "")
    refresh = str(row["refresh_token"] or "")
    if refresh.startswith(OAUTH1_SECRET_PREFIX) or str(row["scope"] or "") == "oauth1":
        secret = refresh[len(OAUTH1_SECRET_PREFIX):] if refresh.startswith(OAUTH1_SECRET_PREFIX) else refresh
        if not access or not secret:
            raise RuntimeError("X session incomplete. Reconnect your X account.")
        auth = OAuth1(
            settings.twitter_client_id,
            client_secret=settings.twitter_client_secret,
            resource_owner_key=access,
            resource_owner_secret=secret,
            signature_method="HMAC-SHA1",
        )
        return {"mode": "oauth1", "access_token": access, "token_secret": secret, "auth": auth}

    expires_at = str(row["expires_at"] or "")
    still_valid = False
    if expires_at:
        try:
            exp = datetime.fromisoformat(expires_at)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            still_valid = exp > _now() + timedelta(seconds=30)
        except ValueError:
            still_valid = False
    if still_valid and access:
        return {"mode": "oauth2", "access_token": access}
    if not refresh:
        raise RuntimeError("X session expired. Reconnect your X account.")
    token = _refresh_access_token(refresh)
    _store_tokens(user_id, token)
    return {"mode": "oauth2", "access_token": str(token.get("access_token") or "")}


def get_valid_access_token(user_id: str) -> str:
    """Compat: OAuth2 bearer token only. Prefer get_user_auth for posting."""
    creds = get_user_auth(user_id)
    if creds.get("mode") == "oauth1":
        return str(creds.get("access_token") or "")
    return str(creds.get("access_token") or "")


def _ensure_mp4(path: Path, mime: str) -> Path:
    mime = (mime or "").lower()
    if path.suffix.lower() in {".mp4", ".m4v"} or "mp4" in mime:
        return path
    out = path.with_suffix(".mp4")
    # Viewport MediaRecorder WebMs are often video-only (no audio track). Forcing
    # `-c:a aac` then fails with "Nothing was written into output file".
    attempts = [
        [
            "ffmpeg", "-y", "-i", str(path),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-preset", "veryfast", "-crf", "23",
            "-an",
            "-movflags", "+faststart",
            str(out),
        ],
        [
            "ffmpeg", "-y", "-i", str(path),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-ac", "2", "-ar", "44100",
            "-shortest",
            "-movflags", "+faststart",
            str(out),
        ],
        [
            "ffmpeg", "-y", "-fflags", "+genpts", "-i", str(path),
            "-vf", "format=yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-an",
            "-movflags", "+faststart",
            str(out),
        ],
    ]
    last_detail = ""
    try:
        for cmd in attempts:
            if out.is_file():
                try:
                    out.unlink()
                except OSError:
                    pass
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if proc.returncode == 0 and out.is_file() and out.stat().st_size > 0:
                return out
            last_detail = (proc.stderr or proc.stdout or "")[-400:]
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg is required to convert WebM recordings for X.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Video conversion timed out.") from exc
    raise RuntimeError(f"Could not convert video for X. {last_detail}")


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _x_error_detail(resp: Any, fallback: str) -> str:
    """Surface useful X API errors (empty 403 bodies, credits, permissions)."""
    status = int(getattr(resp, "status_code", 0) or 0)
    text = (getattr(resp, "text", None) or "").strip()
    if text:
        try:
            payload = resp.json() if hasattr(resp, "json") else json.loads(text)
            detail = (
                (payload.get("detail") if isinstance(payload, dict) else None)
                or (payload.get("title") if isinstance(payload, dict) else None)
                or text
            )
            text = str(detail)[:400]
        except Exception:
            text = text[:400]
    if not text:
        if status == 403:
            text = (
                "X returned 403 with no body (v1.1 media often blocked). "
                "Use v2 media, set App permissions to Read and write, and ensure API credits."
            )
        elif status == 402:
            text = "X API credits depleted — media upload requires available credits on your X developer plan."
        else:
            text = fallback
    lower = text.lower()
    if "credits" in lower or status == 402:
        return (
            "X media upload needs API credits on your X developer plan "
            f"(HTTP {status}: {text}). Share via compose + attach still works."
        )
    if "oauth1" in lower and "permission" in lower:
        return (
            "X app permissions are Read-only. In the X Developer Portal set User authentication "
            "to Read and write, then disconnect and Connect X again."
        )
    return f"{fallback} (HTTP {status}: {text})"


def _upload_video_v2(creds: dict[str, Any], video_path: Path) -> str:
    """Chunked upload via X API v2 media endpoints (works with OAuth1 or bearer)."""
    size = video_path.stat().st_size
    init_body = {
        "media_type": "video/mp4",
        "total_bytes": size,
        "media_category": "tweet_video",
    }
    if creds.get("mode") == "oauth1":
        init = requests.post(
            MEDIA_INIT,
            auth=creds["auth"],
            json=init_body,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
    else:
        access_token = str(creds.get("access_token") or "")
        init = httpx.post(
            MEDIA_INIT,
            headers={**_auth_headers(access_token), "Content-Type": "application/json"},
            json=init_body,
            timeout=60,
        )
    if init.status_code >= 400:
        raise RuntimeError(_x_error_detail(init, "X media INIT failed"))
    media_id = str((init.json() or {}).get("data", {}).get("id") or "").strip()
    if not media_id:
        raise RuntimeError("X media upload did not return a media id.")

    with video_path.open("rb") as fh:
        index = 0
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            append_url = f"{API_BASE}/media/upload/{urllib.parse.quote(media_id)}/append"
            if creds.get("mode") == "oauth1":
                append = requests.post(
                    append_url,
                    auth=creds["auth"],
                    data={"segment_index": str(index)},
                    files={"media": (f"chunk{index}", chunk, "application/octet-stream")},
                    timeout=120,
                )
            else:
                append = httpx.post(
                    append_url,
                    headers=_auth_headers(str(creds.get("access_token") or "")),
                    data={"segment_index": str(index)},
                    files={"media": (f"chunk{index}", chunk, "application/octet-stream")},
                    timeout=120,
                )
            if append.status_code >= 400:
                raise RuntimeError(_x_error_detail(append, "X media APPEND failed"))
            index += 1

    finalize_url = f"{API_BASE}/media/upload/{urllib.parse.quote(media_id)}/finalize"
    if creds.get("mode") == "oauth1":
        finalize = requests.post(finalize_url, auth=creds["auth"], timeout=60)
    else:
        finalize = httpx.post(
            finalize_url,
            headers=_auth_headers(str(creds.get("access_token") or "")),
            timeout=60,
        )
    if finalize.status_code >= 400:
        raise RuntimeError(_x_error_detail(finalize, "X media finalize failed"))

    for _ in range(60):
        if creds.get("mode") == "oauth1":
            status = requests.get(
                MEDIA_STATUS,
                params={"media_id": media_id, "command": "STATUS"},
                auth=creds["auth"],
                timeout=30,
            )
        else:
            status = httpx.get(
                MEDIA_STATUS,
                params={"media_id": media_id, "command": "STATUS"},
                headers=_auth_headers(str(creds.get("access_token") or "")),
                timeout=30,
            )
        if status.status_code >= 400:
            break
        payload = status.json() or {}
        info = ((payload.get("data") or {}).get("processing_info")
                or (payload.get("processing_info") or {}))
        state = str(info.get("state") or "").lower()
        if not state or state in {"succeeded", "succeeded_state", "success"}:
            break
        if state in {"failed", "failed_state"}:
            raise RuntimeError(f"X media processing failed: {json.dumps(info)[:300]}")
        wait = int(info.get("check_after_secs") or 2)
        time.sleep(max(1, min(wait, 5)))
    return media_id


def _upload_video(user_id: str, video_path: Path) -> str:
    creds = get_user_auth(user_id)
    size = video_path.stat().st_size
    if size <= 0:
        raise RuntimeError("Video file is empty.")
    if size > MAX_VIDEO_BYTES:
        raise RuntimeError("Video is too large for X (max 512 MB).")

    try:
        return _upload_video_v2(creds, video_path)
    except RuntimeError as exc:
        msg = str(exc)
        # Fall back to v1.1 only when v2 is unavailable (not credits/permissions).
        if "credits" in msg.lower() or "permission" in msg.lower() or "Read-only" in msg:
            raise
        logger.warning("X v2 media upload failed, trying v1.1: %s", msg[:200])
        if creds.get("mode") == "oauth1":
            return _upload_video_v1_oauth1(creds["auth"], video_path)
        return _upload_video_v1_bearer(str(creds.get("access_token") or ""), video_path)


def _upload_video_v1_bearer(access_token: str, video_path: Path) -> str:
    size = video_path.stat().st_size
    init = httpx.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        headers=_auth_headers(access_token),
        data={
            "command": "INIT",
            "media_type": "video/mp4",
            "total_bytes": str(size),
            "media_category": "tweet_video",
        },
        timeout=60,
    )
    if init.status_code >= 400:
        raise RuntimeError(_x_error_detail(init, "X media INIT failed"))
    media_id = str((init.json() or {}).get("media_id_string") or (init.json() or {}).get("media_id") or "")
    if not media_id:
        raise RuntimeError("X media INIT returned no media id.")

    with video_path.open("rb") as fh:
        index = 0
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            append = httpx.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                headers=_auth_headers(access_token),
                data={"command": "APPEND", "media_id": media_id, "segment_index": str(index)},
                files={"media": (f"chunk{index}", chunk, "application/octet-stream")},
                timeout=120,
            )
            if append.status_code >= 400:
                raise RuntimeError(_x_error_detail(append, "X media APPEND failed"))
            index += 1

    finalize = httpx.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        headers=_auth_headers(access_token),
        data={"command": "FINALIZE", "media_id": media_id},
        timeout=60,
    )
    if finalize.status_code >= 400:
        raise RuntimeError(_x_error_detail(finalize, "X media FINALIZE failed"))
    info = (finalize.json() or {}).get("processing_info") or {}
    for _ in range(60):
        state = str(info.get("state") or "").lower()
        if not state or state == "succeeded":
            break
        if state == "failed":
            raise RuntimeError(f"X media processing failed: {json.dumps(info)[:300]}")
        time.sleep(max(1, int(info.get("check_after_secs") or 2)))
        status = httpx.get(
            "https://upload.twitter.com/1.1/media/upload.json",
            params={"command": "STATUS", "media_id": media_id},
            headers=_auth_headers(access_token),
            timeout=30,
        )
        if status.status_code >= 400:
            break
        info = (status.json() or {}).get("processing_info") or {}
    return media_id


def _upload_video_v1_oauth1(auth: OAuth1, video_path: Path) -> str:
    size = video_path.stat().st_size
    init = requests.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        auth=auth,
        data={
            "command": "INIT",
            "media_type": "video/mp4",
            "total_bytes": str(size),
            "media_category": "tweet_video",
        },
        timeout=60,
    )
    if init.status_code >= 400:
        raise RuntimeError(_x_error_detail(init, "X media INIT failed"))
    media_id = str((init.json() or {}).get("media_id_string") or (init.json() or {}).get("media_id") or "")
    if not media_id:
        raise RuntimeError("X media INIT returned no media id.")

    with video_path.open("rb") as fh:
        index = 0
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            append = requests.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                auth=auth,
                data={"command": "APPEND", "media_id": media_id, "segment_index": str(index)},
                files={"media": (f"chunk{index}", chunk, "application/octet-stream")},
                timeout=120,
            )
            if append.status_code >= 400:
                raise RuntimeError(_x_error_detail(append, "X media APPEND failed"))
            index += 1

    finalize = requests.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        auth=auth,
        data={"command": "FINALIZE", "media_id": media_id},
        timeout=60,
    )
    if finalize.status_code >= 400:
        raise RuntimeError(_x_error_detail(finalize, "X media FINALIZE failed"))
    info = (finalize.json() or {}).get("processing_info") or {}
    for _ in range(60):
        state = str(info.get("state") or "").lower()
        if not state or state == "succeeded":
            break
        if state == "failed":
            raise RuntimeError(f"X media processing failed: {json.dumps(info)[:300]}")
        time.sleep(max(1, int(info.get("check_after_secs") or 2)))
        status = requests.get(
            "https://upload.twitter.com/1.1/media/upload.json",
            params={"command": "STATUS", "media_id": media_id},
            auth=auth,
            timeout=30,
        )
        if status.status_code >= 400:
            break
        info = (status.json() or {}).get("processing_info") or {}
    return media_id


def _tweet_with_media(user_id: str, media_id: str, caption: str) -> dict[str, Any]:
    creds = get_user_auth(user_id)
    payload = {"text": caption, "media": {"media_ids": [media_id]}}
    if creds.get("mode") == "oauth1":
        tweet = requests.post(
            f"{API_BASE}/tweets",
            auth=creds["auth"],
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
    else:
        tweet = httpx.post(
            f"{API_BASE}/tweets",
            headers={**_auth_headers(str(creds.get("access_token") or "")), "Content-Type": "application/json"},
            json=payload,
            timeout=60,
        )
    if tweet.status_code >= 400:
        raise RuntimeError(_x_error_detail(tweet, "X post failed"))
    data = (tweet.json() or {}).get("data") or {}
    tweet_id = str(data.get("id") or "")
    account = linked_account(user_id) or {}
    username = account.get("username") or ""
    url = f"https://x.com/{username}/status/{tweet_id}" if username and tweet_id else (
        f"https://x.com/i/web/status/{tweet_id}" if tweet_id else None
    )
    return {
        "ok": True,
        "tweet_id": tweet_id,
        "url": url,
        "username": username,
        "text": caption,
    }


def _upload_image(user_id: str, image_bytes: bytes, mime_type: str = "image/png") -> str:
    """Simple media upload for still images (PNG/JPEG/WebP)."""
    if not image_bytes:
        raise RuntimeError("Image file is empty.")
    if len(image_bytes) > 5 * 1024 * 1024:
        raise RuntimeError("Image is too large for X (max 5 MB).")
    mime = (mime_type or "image/png").split(";")[0].strip().lower() or "image/png"
    if mime not in {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}:
        mime = "image/png"
    ext = "png"
    if "jpeg" in mime or "jpg" in mime:
        ext = "jpg"
    elif "webp" in mime:
        ext = "webp"
    elif "gif" in mime:
        ext = "gif"
    creds = get_user_auth(user_id)
    # Prefer v2 media (v1.1 upload often returns empty 403 for current X apps).
    init_body = {
        "media_type": mime if mime != "image/jpg" else "image/jpeg",
        "total_bytes": len(image_bytes),
        "media_category": "tweet_image",
    }
    if creds.get("mode") == "oauth1":
        init = requests.post(
            MEDIA_INIT,
            auth=creds["auth"],
            json=init_body,
            headers={"Content-Type": "application/json"},
            timeout=60,
        )
    else:
        init = httpx.post(
            MEDIA_INIT,
            headers={**_auth_headers(str(creds.get("access_token") or "")), "Content-Type": "application/json"},
            json=init_body,
            timeout=60,
        )
    if init.status_code < 400:
        media_id = str((init.json() or {}).get("data", {}).get("id") or "").strip()
        if not media_id:
            raise RuntimeError("X image upload did not return a media id.")
        append_url = f"{API_BASE}/media/upload/{urllib.parse.quote(media_id)}/append"
        if creds.get("mode") == "oauth1":
            append = requests.post(
                append_url,
                auth=creds["auth"],
                data={"segment_index": "0"},
                files={"media": (f"render3d.{ext}", image_bytes, "application/octet-stream")},
                timeout=60,
            )
            finalize = requests.post(
                f"{API_BASE}/media/upload/{urllib.parse.quote(media_id)}/finalize",
                auth=creds["auth"],
                timeout=60,
            )
        else:
            token = str(creds.get("access_token") or "")
            append = httpx.post(
                append_url,
                headers=_auth_headers(token),
                data={"segment_index": "0"},
                files={"media": (f"render3d.{ext}", image_bytes, "application/octet-stream")},
                timeout=60,
            )
            finalize = httpx.post(
                f"{API_BASE}/media/upload/{urllib.parse.quote(media_id)}/finalize",
                headers=_auth_headers(token),
                timeout=60,
            )
        if append.status_code >= 400:
            raise RuntimeError(_x_error_detail(append, "X image append failed"))
        if finalize.status_code >= 400:
            raise RuntimeError(_x_error_detail(finalize, "X image finalize failed"))
        return media_id

    # Fallback: simple v1.1 upload
    if creds.get("mode") == "oauth1":
        upload = requests.post(
            "https://upload.twitter.com/1.1/media/upload.json",
            auth=creds["auth"],
            files={"media": (f"render3d.{ext}", image_bytes, mime)},
            timeout=60,
        )
        if upload.status_code >= 400:
            b64 = base64.b64encode(image_bytes).decode("ascii")
            upload = requests.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                auth=creds["auth"],
                data={"media_data": b64},
                timeout=60,
            )
    else:
        access_token = str(creds.get("access_token") or "")
        upload = httpx.post(
            "https://upload.twitter.com/1.1/media/upload.json",
            headers=_auth_headers(access_token),
            files={"media": (f"render3d.{ext}", image_bytes, mime)},
            timeout=60,
        )
        if upload.status_code >= 400:
            b64 = base64.b64encode(image_bytes).decode("ascii")
            upload = httpx.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                headers=_auth_headers(access_token),
                data={"media_data": b64},
                timeout=60,
            )
    if upload.status_code >= 400:
        raise RuntimeError(_x_error_detail(upload, "X image upload failed"))
    media_id = str((upload.json() or {}).get("media_id_string") or (upload.json() or {}).get("media_id") or "")
    if not media_id:
        raise RuntimeError("X image upload returned no media id.")
    return media_id


def _caption_with_site_link(text: str, *, default: str = "Built on Render Studio") -> str:
    caption = (text or default).strip() or default
    if "render3d.app" not in caption.lower():
        # X auto-links URLs; keep under tweet limit.
        suffix = " https://render3d.app"
        caption = (caption[: max(0, 270 - len(suffix))] + suffix).strip()
    return caption[:270]


def post_image(
    user_id: str,
    *,
    image_bytes: bytes,
    filename: str = "render3d-screenshot.png",
    mime_type: str = "image/png",
    text: str = "",
) -> dict[str, Any]:
    if not image_bytes:
        raise RuntimeError("No image data to post.")
    caption = _caption_with_site_link(text)
    media_id = _upload_image(user_id, image_bytes, mime_type or "image/png")
    return _tweet_with_media(user_id, media_id, caption)


def post_video(
    user_id: str,
    *,
    video_bytes: bytes,
    filename: str = "render3d-video.webm",
    mime_type: str = "video/webm",
    text: str = "",
) -> dict[str, Any]:
    if not video_bytes:
        raise RuntimeError("No video data to post.")
    caption = _caption_with_site_link(text)

    with tempfile.TemporaryDirectory(prefix="r3d-x-") as tmp:
        raw_path = Path(tmp) / (filename or "clip.webm")
        raw_path.write_bytes(video_bytes)
        mp4_path = _ensure_mp4(raw_path, mime_type)
        media_id = _upload_video(user_id, mp4_path)

    return _tweet_with_media(user_id, media_id, caption)
