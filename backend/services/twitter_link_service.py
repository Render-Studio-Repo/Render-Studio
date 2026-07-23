"""X (Twitter) account linking + tweet posting for viewport video shares.

OAuth 2.0 with PKCE. Stores refreshable user tokens so the browser can
connect once and post recordings without leaving Render3D.
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

from backend.config import settings
from backend.database import get_conn

logger = logging.getLogger("render3d.twitter")

AUTH_URL = "https://twitter.com/i/oauth2/authorize"
TOKEN_URL = "https://api.twitter.com/2/oauth2/token"
API_BASE = "https://api.twitter.com/2"
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


def link_url(user_id: str) -> str:
    if not configured():
        raise RuntimeError("X (Twitter) OAuth is not configured. Set TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, and TWITTER_REDIRECT_URI.")
    _ensure_tables()
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
    }


def get_valid_access_token(user_id: str) -> str:
    _ensure_tables()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT access_token, refresh_token, expires_at FROM twitter_oauth_tokens WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        raise RuntimeError("Connect your X account first.")
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
    if still_valid and row["access_token"]:
        return str(row["access_token"])
    refresh = str(row["refresh_token"] or "")
    if not refresh:
        raise RuntimeError("X session expired. Reconnect your X account.")
    token = _refresh_access_token(refresh)
    _store_tokens(user_id, token)
    return str(token.get("access_token") or "")


def _ensure_mp4(path: Path, mime: str) -> Path:
    mime = (mime or "").lower()
    if path.suffix.lower() in {".mp4", ".m4v"} or "mp4" in mime:
        return path
    out = path.with_suffix(".mp4")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(path),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(out),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg is required to convert WebM recordings for X.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Video conversion timed out.") from exc
    if proc.returncode != 0 or not out.is_file():
        detail = (proc.stderr or proc.stdout or "")[-400:]
        raise RuntimeError(f"Could not convert video for X. {detail}")
    return out


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _upload_video(access_token: str, video_path: Path) -> str:
    size = video_path.stat().st_size
    if size <= 0:
        raise RuntimeError("Video file is empty.")
    if size > MAX_VIDEO_BYTES:
        raise RuntimeError("Video is too large for X (max 512 MB).")

    init = httpx.post(
        MEDIA_INIT,
        headers={**_auth_headers(access_token), "Content-Type": "application/json"},
        json={
            "media_type": "video/mp4",
            "total_bytes": size,
            "media_category": "tweet_video",
        },
        timeout=60,
    )
    if init.status_code >= 400:
        # Fallback to classic v1.1 chunked upload if v2 initialize is unavailable.
        return _upload_video_v1(access_token, video_path)
    media_id = str((init.json() or {}).get("data", {}).get("id") or "").strip()
    if not media_id:
        raise RuntimeError("X media upload did not return a media id.")

    with video_path.open("rb") as fh:
        index = 0
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            append = httpx.post(
                f"{API_BASE}/media/upload/{urllib.parse.quote(media_id)}/append",
                headers=_auth_headers(access_token),
                data={"segment_index": str(index)},
                files={"media": (f"chunk{index}", chunk, "application/octet-stream")},
                timeout=120,
            )
            if append.status_code >= 400:
                raise RuntimeError(f"X media append failed: {append.text[:300]}")
            index += 1

    finalize = httpx.post(
        f"{API_BASE}/media/upload/{urllib.parse.quote(media_id)}/finalize",
        headers=_auth_headers(access_token),
        timeout=60,
    )
    if finalize.status_code >= 400:
        raise RuntimeError(f"X media finalize failed: {finalize.text[:300]}")

    # Poll processing.
    for _ in range(60):
        status = httpx.get(
            MEDIA_STATUS,
            params={"media_id": media_id, "command": "STATUS"},
            headers=_auth_headers(access_token),
            timeout=30,
        )
        if status.status_code >= 400:
            # Some tenants omit STATUS; assume ready.
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


def _upload_video_v1(access_token: str, video_path: Path) -> str:
    """Legacy chunked upload endpoint used when v2 initialize is unavailable."""
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
        raise RuntimeError(f"X media INIT failed: {init.text[:300]}")
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
                raise RuntimeError(f"X media APPEND failed: {append.text[:300]}")
            index += 1

    finalize = httpx.post(
        "https://upload.twitter.com/1.1/media/upload.json",
        headers=_auth_headers(access_token),
        data={"command": "FINALIZE", "media_id": media_id},
        timeout=60,
    )
    if finalize.status_code >= 400:
        raise RuntimeError(f"X media FINALIZE failed: {finalize.text[:300]}")
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
    access = get_valid_access_token(user_id)
    caption = (text or "Recorded in Render3D").strip()[:270]

    with tempfile.TemporaryDirectory(prefix="r3d-x-") as tmp:
        raw_path = Path(tmp) / (filename or "clip.webm")
        raw_path.write_bytes(video_bytes)
        mp4_path = _ensure_mp4(raw_path, mime_type)
        media_id = _upload_video(access, mp4_path)

    tweet = httpx.post(
        f"{API_BASE}/tweets",
        headers={**_auth_headers(access), "Content-Type": "application/json"},
        json={
            "text": caption,
            "media": {"media_ids": [media_id]},
        },
        timeout=60,
    )
    if tweet.status_code >= 400:
        raise RuntimeError(f"X post failed: {tweet.text[:400]}")
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
