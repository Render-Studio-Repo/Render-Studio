"""JWT auth and password helpers."""

from __future__ import annotations

import secrets
import hashlib
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import bcrypt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from starlette.responses import Response

from backend.config import settings
from backend.database import get_conn

security = HTTPBearer(auto_error=False)
_USER_ROW_TTL = 2.0
_user_row_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_user_row_lock = threading.Lock()

# Survives uvicorn/LaunchAgent restarts. Not a password — signed JWT only.
SESSION_COOKIE_NAME = "render3d_session"
DEVICE_SESSION_COOKIE_NAME = "render3d_device_session"
DEVICE_SESSION_DAYS = 365

# Insecure pydantic default — treat as unset so a disk secret can take over.
_JWT_SECRET_PLACEHOLDER = "change-me-in-production-render3d"
_jwt_secret_cache: str | None = None


def jwt_secret_path() -> Path:
    return Path(settings.data_dir) / "jwt_secret"


def reset_jwt_secret_cache() -> None:
    """Test helper: simulate a process restart that reloads the secret from disk."""
    global _jwt_secret_cache
    _jwt_secret_cache = None


def _read_jwt_secret_file() -> str:
    path = jwt_secret_path()
    try:
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
    except OSError:
        pass
    return ""


def _write_jwt_secret_file(secret: str) -> None:
    path = jwt_secret_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secret, encoding="utf-8")
        path.chmod(0o600)
    except OSError:
        pass


def _jwt_secret() -> str:
    """Stable signing key across SIGTERM/KeepAlive restarts.

    Prefer JWT_SECRET when provisioned. Otherwise reuse ``data/jwt_secret`` so
    a new uvicorn process does not invalidate existing localStorage JWTs.
    """
    global _jwt_secret_cache
    if _jwt_secret_cache:
        return _jwt_secret_cache
    env = (settings.jwt_secret or "").strip()
    provisioned = bool(env) and env != _JWT_SECRET_PLACEHOLDER
    file_secret = _read_jwt_secret_file()
    if provisioned:
        secret = env
    elif file_secret:
        secret = file_secret
    else:
        secret = env or secrets.token_urlsafe(48)
    if secret and secret != file_secret:
        _write_jwt_secret_file(secret)
    _jwt_secret_cache = secret
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def session_cookie_max_age() -> int:
    hours = max(1, int(getattr(settings, "jwt_expire_hours", 168) or 168))
    return hours * 3600


def cookie_should_be_secure(request: Request | None) -> bool:
    proto = ""
    try:
        if request is not None:
            proto = str(request.headers.get("x-forwarded-proto") or request.url.scheme or "")
    except Exception:
        proto = ""
    proto = proto.split(",")[0].strip().lower()
    return proto == "https"


def access_token_from_parts(authorization: str | None, cookie: str | None) -> str:
    """Bearer wins; cookie keeps the session when localStorage is empty after a restart."""
    auth = str(authorization or "").strip()
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            return token
    return str(cookie or "").strip()


def access_token_from_request(
    request: Request | None,
    creds: HTTPAuthorizationCredentials | None = None,
) -> str:
    if creds is not None and str(creds.scheme or "").lower() == "bearer" and creds.credentials:
        token = str(creds.credentials).strip()
        if token:
            return token
    authorization = ""
    cookie = ""
    if request is not None:
        try:
            authorization = str(request.headers.get("authorization") or "")
            cookie = str(request.cookies.get(SESSION_COOKIE_NAME) or "")
        except Exception:
            authorization = ""
            cookie = ""
    return access_token_from_parts(authorization, cookie)


def attach_session_cookie(response: Response, token: str, *, secure: bool = True) -> None:
    value = str(token or "").strip()
    if not value:
        return
    response.set_cookie(
        SESSION_COOKIE_NAME,
        value,
        max_age=session_cookie_max_age(),
        httponly=True,
        secure=bool(secure),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


def _device_session_hash(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def attach_device_session_cookie(response: Response, user_id: str, *, secure: bool = True, replace_token: str = "") -> None:
    token = secrets.token_urlsafe(48)
    now = time.time()
    expires_at = now + DEVICE_SESSION_DAYS * 86400
    with get_conn() as conn:
        if replace_token:
            conn.execute("DELETE FROM auth_device_sessions WHERE token_hash = ?", (_device_session_hash(replace_token),))
        conn.execute("DELETE FROM auth_device_sessions WHERE expires_at <= ?", (now,))
        conn.execute(
            "INSERT INTO auth_device_sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (_device_session_hash(token), str(user_id), now, now, expires_at),
        )
    response.set_cookie(
        DEVICE_SESSION_COOKIE_NAME,
        token,
        max_age=DEVICE_SESSION_DAYS * 86400,
        httponly=True,
        secure=bool(secure),
        samesite="lax",
        path="/",
    )


def device_session_from_request(request: Request | None) -> tuple[str, str]:
    try:
        token = str(request.cookies.get(DEVICE_SESSION_COOKIE_NAME) or "") if request else ""
    except Exception:
        token = ""
    if not token:
        return "", ""
    now = time.time()
    token_hash = _device_session_hash(token)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, expires_at FROM auth_device_sessions WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        if not row or float(row["expires_at"] or 0) <= now:
            conn.execute("DELETE FROM auth_device_sessions WHERE token_hash = ?", (token_hash,))
            return "", ""
        conn.execute("UPDATE auth_device_sessions SET last_used_at = ? WHERE token_hash = ?", (now, token_hash))
    return str(row["user_id"] or ""), token


def clear_device_session(response: Response, request: Request | None = None) -> None:
    try:
        token = str(request.cookies.get(DEVICE_SESSION_COOKIE_NAME) or "") if request else ""
    except Exception:
        token = ""
    if token:
        with get_conn() as conn:
            conn.execute("DELETE FROM auth_device_sessions WHERE token_hash = ?", (_device_session_hash(token),))
    response.delete_cookie(DEVICE_SESSION_COOKIE_NAME, path="/")


def decode_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
        return payload.get("sub")
    except JWTError:
        return None


def user_row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    keys = row.keys()
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
        "handle": row["handle"] if "handle" in keys else None,
        "bio": row["bio"] if "bio" in keys else None,
        "avatar_url": row["avatar_url"] if "avatar_url" in keys else None,
        "created_at": row["created_at"],
        "profile_url": f"/u/{row['handle']}" if ("handle" in keys and row["handle"]) else None,
    }


def _cache_user(user_id: str, user: dict[str, Any] | None, now: float) -> None:
    if not user:
        return
    with _user_row_lock:
        _user_row_cache[user_id] = (now, user)
        if len(_user_row_cache) > 256:
            for key in list(_user_row_cache)[:128]:
                _user_row_cache.pop(key, None)


def invalidate_user_cache(user_id: str | None = None) -> None:
    with _user_row_lock:
        if user_id:
            _user_row_cache.pop(str(user_id), None)
        else:
            _user_row_cache.clear()


def _with_platform_role(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    try:
        from backend.services.platform_roles_service import attach_role_fields

        return attach_role_fields(user)
    except Exception:
        user = dict(user)
        user.setdefault("role", "user")
        user.setdefault("platform_admin", False)
        user.setdefault("super_admin", False)
        user.setdefault("management", False)
        return user


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _user_row_lock:
        hit = _user_row_cache.get(user_id)
        if hit and now - hit[0] < _USER_ROW_TTL:
            return hit[1]
    user = None
    try:
        from backend.services import supabase_users_store as sbusers

        if sbusers.prefer_supabase() and sbusers.source_of_truth():
            user = sbusers.profile_from_row(sbusers.get_by_id(user_id))
    except Exception:
        user = None
    if not user:
        with get_conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        user = user_row_to_dict(row)
    user = _with_platform_role(user)
    _cache_user(user_id, user, now)
    return user


def get_user_by_email(email: str) -> dict[str, Any] | None:
    address = email.strip().lower()
    try:
        from backend.services import supabase_users_store as sbusers

        if sbusers.prefer_supabase() and sbusers.source_of_truth():
            found = sbusers.profile_from_row(sbusers.get_by_email(address))
            if found:
                return _with_platform_role(found)
    except Exception:
        pass
    with get_conn() as conn:
        from backend.services.account_email_identity import find_email_user

        try:
            row = find_email_user(conn, address)
        except ValueError:
            return None
    return _with_platform_role(user_row_to_dict(row))


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any]:
    token = access_token_from_request(request, creds)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = decode_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any] | None:
    token = access_token_from_request(request, creds)
    if not token:
        return None
    user_id = decode_token(token)
    if not user_id:
        return None
    return get_user_by_id(user_id)
