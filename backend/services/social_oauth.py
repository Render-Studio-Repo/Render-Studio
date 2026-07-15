"""Google, Apple, and Microsoft sign-in helpers."""

from __future__ import annotations

import secrets
import urllib.parse
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from jose import jwt

from backend.config import settings
from backend.database import get_conn


@dataclass(frozen=True)
class ProviderConfig:
    key: str
    label: str
    auth_url: str
    token_url: str
    client_id: str
    client_secret: str
    redirect_uri: str
    scope: str
    userinfo_url: str | None = None
    issuer: str | None = None
    jwks_url: str | None = None
    response_mode: str | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes"}


def _provider(provider: str) -> ProviderConfig:
    key = (provider or "").strip().lower()
    if key == "google":
        return ProviderConfig(
            key="google",
            label="Google",
            auth_url="https://accounts.google.com/o/oauth2/v2/auth",
            token_url="https://oauth2.googleapis.com/token",
            userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            redirect_uri=settings.google_redirect_uri,
            scope="openid email profile",
        )
    if key == "microsoft":
        return ProviderConfig(
            key="microsoft",
            label="Microsoft",
            auth_url="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_url="https://login.microsoftonline.com/common/oauth2/v2.0/token",
            userinfo_url="https://graph.microsoft.com/oidc/userinfo",
            client_id=settings.microsoft_client_id,
            client_secret=settings.microsoft_client_secret,
            redirect_uri=settings.microsoft_redirect_uri,
            scope="openid email profile User.Read",
        )
    if key == "apple":
        return ProviderConfig(
            key="apple",
            label="Apple",
            auth_url="https://appleid.apple.com/auth/authorize",
            token_url="https://appleid.apple.com/auth/token",
            issuer="https://appleid.apple.com",
            jwks_url="https://appleid.apple.com/auth/keys",
            client_id=settings.apple_client_id,
            client_secret=settings.apple_client_secret or _apple_client_secret(),
            redirect_uri=settings.apple_redirect_uri,
            scope="name email",
            response_mode="form_post",
        )
    raise ValueError("Unsupported sign-in provider.")


def _apple_client_secret() -> str:
    if not (settings.apple_team_id and settings.apple_key_id and settings.apple_private_key and settings.apple_client_id):
        return ""
    now = datetime.now(timezone.utc)
    private_key = settings.apple_private_key.replace("\\n", "\n")
    return jwt.encode(
        {
            "iss": settings.apple_team_id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=90)).timestamp()),
            "aud": "https://appleid.apple.com",
            "sub": settings.apple_client_id,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": settings.apple_key_id},
    )


def create_oauth_state(user_id: str | None = None) -> str:
    state = secrets.token_urlsafe(32)
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO oauth_state (state, user_id, created_at) VALUES (?, ?, ?)",
            (state, user_id, _now()),
        )
    return state


def consume_oauth_state(state: str) -> str | None | bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id, created_at FROM oauth_state WHERE state = ?",
            (state,),
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM oauth_state WHERE state = ?", (state,))
    created = datetime.fromisoformat(row["created_at"])
    if datetime.now(timezone.utc) - created > timedelta(minutes=10):
        return False
    return row["user_id"]


def configured_providers() -> list[dict[str, Any]]:
    out = []
    for key in ("google", "apple", "microsoft"):
        cfg = _provider(key)
        if key == "apple":
            configured = bool(
                cfg.client_id
                and (
                    cfg.client_secret
                    or (settings.apple_team_id and settings.apple_key_id and settings.apple_private_key)
                )
            )
        else:
            configured = bool(cfg.client_id and cfg.client_secret)
        out.append({"provider": key, "label": cfg.label, "configured": configured})
    return out


def build_authorization_url(provider: str) -> str:
    cfg = _provider(provider)
    providers = {item["provider"]: item for item in configured_providers()}
    if not providers.get(cfg.key, {}).get("configured"):
        raise RuntimeError(f"{cfg.label} sign-in is not configured.")
    state = create_oauth_state()
    params = {
        "response_type": "code",
        "client_id": cfg.client_id,
        "redirect_uri": cfg.redirect_uri,
        "scope": cfg.scope,
        "state": state,
    }
    if cfg.key == "google":
        params["access_type"] = "online"
        params["prompt"] = "select_account"
    elif cfg.key == "apple" and cfg.response_mode:
        params["response_mode"] = cfg.response_mode
    return f"{cfg.auth_url}?{urllib.parse.urlencode(params)}"


def exchange_code_for_profile(provider: str, code: str) -> dict[str, Any]:
    cfg = _provider(provider)
    providers = {item["provider"]: item for item in configured_providers()}
    if not providers.get(cfg.key, {}).get("configured"):
        raise RuntimeError(f"{cfg.label} sign-in is not configured.")
    # Apple may mint client_secret from the private key at request time.
    if cfg.key == "apple" and not cfg.client_secret:
        cfg = ProviderConfig(
            key=cfg.key,
            label=cfg.label,
            auth_url=cfg.auth_url,
            token_url=cfg.token_url,
            client_id=cfg.client_id,
            client_secret=_apple_client_secret(),
            redirect_uri=cfg.redirect_uri,
            scope=cfg.scope,
            userinfo_url=cfg.userinfo_url,
            issuer=cfg.issuer,
            jwks_url=cfg.jwks_url,
            response_mode=cfg.response_mode,
        )
    token = _exchange_code(cfg, code)
    if cfg.key == "apple":
        return _apple_profile(cfg, token)
    return _userinfo_profile(cfg, token)


def _exchange_code(cfg: ProviderConfig, code: str) -> dict[str, Any]:
    resp = httpx.post(
        cfg.token_url,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": cfg.redirect_uri,
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
        },
        headers={"Accept": "application/json"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def _userinfo_profile(cfg: ProviderConfig, token: dict[str, Any]) -> dict[str, Any]:
    access_token = token.get("access_token")
    if not access_token or not cfg.userinfo_url:
        raise RuntimeError(f"{cfg.label} did not return an access token.")
    resp = httpx.get(
        cfg.userinfo_url,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    provider_user_id = str(data.get("sub") or data.get("id") or "").strip()
    email = str(data.get("email") or data.get("preferred_username") or data.get("mail") or "").strip().lower()
    return {
        "provider": cfg.key,
        "provider_user_id": provider_user_id,
        "email": email,
        "email_verified": data.get("email_verified", True),
        "display_name": data.get("name") or data.get("displayName") or email.split("@")[0] or cfg.label,
        "picture_url": data.get("picture"),
    }


def _apple_profile(cfg: ProviderConfig, token: dict[str, Any]) -> dict[str, Any]:
    id_token = token.get("id_token")
    if not id_token:
        raise RuntimeError("Apple did not return an identity token.")
    headers = jwt.get_unverified_header(id_token)
    jwks = httpx.get(cfg.jwks_url or "", timeout=15).json()
    key = next((item for item in jwks.get("keys", []) if item.get("kid") == headers.get("kid")), None)
    if not key:
        raise RuntimeError("Could not verify Apple identity token.")
    claims = jwt.decode(
        id_token,
        key,
        algorithms=[headers.get("alg") or "RS256"],
        audience=cfg.client_id,
        issuer=cfg.issuer,
    )
    email = str(claims.get("email") or "").strip().lower()
    return {
        "provider": cfg.key,
        "provider_user_id": str(claims.get("sub") or "").strip(),
        "email": email,
        "email_verified": str(claims.get("email_verified", "true")).lower() == "true",
        "display_name": email.split("@")[0] if email else "Apple User",
        "picture_url": None,
    }


def upsert_social_user(profile: dict[str, Any]) -> dict[str, Any]:
    provider = str(profile.get("provider") or "").strip().lower()
    provider_user_id = str(profile.get("provider_user_id") or "").strip()
    if not provider or not provider_user_id:
        raise RuntimeError("Social provider did not return a stable user id.")
    email = str(profile.get("email") or "").strip().lower()
    email_verified = _truthy(profile.get("email_verified"))
    display_name = str(profile.get("display_name") or "").strip() or (email.split("@")[0] if email else "Render3D User")
    picture_url = str(profile.get("picture_url") or "").strip() or None
    now = _now()
    created_new_user = False

    with get_conn() as conn:
        row = conn.execute(
            "SELECT user_id FROM social_accounts WHERE provider = ? AND provider_user_id = ?",
            (provider, provider_user_id),
        ).fetchone()
        if row:
            user_id = row["user_id"]
        else:
            user_id = ""
            if email and email_verified:
                existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
                if existing:
                    user_id = existing["id"]
            if not user_id:
                user_id = str(uuid.uuid4())[:12]
                safe_email = email if email and email_verified else f"{provider}_{provider_user_id}@social.render3d.local"
                conn.execute(
                    "INSERT INTO users (id, email, display_name, password_hash, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, safe_email, display_name, "", picture_url, now),
                )
                team_id = str(uuid.uuid4())[:8]
                conn.execute(
                    "INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
                    (team_id, f"{display_name}'s Team", user_id, now),
                )
                conn.execute(
                    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
                    (team_id, user_id, "owner", now),
                )
                created_new_user = True

        if picture_url:
            conn.execute(
                "UPDATE users SET avatar_url = COALESCE(avatar_url, ?) WHERE id = ?",
                (picture_url, user_id),
            )
        conn.execute(
            """INSERT INTO social_accounts
               (provider, provider_user_id, user_id, email, display_name, picture_url, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(provider, provider_user_id) DO UPDATE SET
                 user_id = excluded.user_id,
                 email = excluded.email,
                 display_name = excluded.display_name,
                 picture_url = excluded.picture_url,
                 updated_at = excluded.updated_at
            """,
            (provider, provider_user_id, user_id, email, display_name, picture_url, now, now),
        )
        user = conn.execute(
            "SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    out = dict(user)
    out["_created_new_user"] = created_new_user
    return out
