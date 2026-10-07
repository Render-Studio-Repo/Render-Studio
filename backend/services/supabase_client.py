"""Server-side Supabase client (secret key only — never expose to the browser)."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.supabase")

USERS_TABLE = "Users"
PROJECT_REF = "gudszkmcgncdnezfwidm"
MANAGEMENT_API = "https://api.supabase.com"


def _is_management_pat(value: str) -> bool:
    return (value or "").strip().startswith("sbp_")


def rest_key() -> str:
    """Key for PostgREST / Auth admin (never the management PAT)."""
    for attr in ("supabase_service_role_key", "supabase_secret_key", "supabase_key"):
        raw = (getattr(settings, attr, None) or "").strip()
        if raw and not _is_management_pat(raw):
            return raw
    return ""


def management_token() -> str:
    raw = (getattr(settings, "supabase_access_token", None) or "").strip()
    return raw if _is_management_pat(raw) else ""


def configured() -> bool:
    url = (getattr(settings, "supabase_url", None) or "").strip()
    return bool(url.startswith("http") and rest_key())


def publishable_key() -> str:
    """Browser-safe publishable/anon key — used for Auth password grant."""
    return (getattr(settings, "supabase_publishable_key", None) or "").strip()


def project_url() -> str:
    return (getattr(settings, "supabase_url", None) or "").strip()


def password_grant_configured() -> bool:
    """True when GoTrue sign_in_with_password can be attempted."""
    url = project_url()
    return bool(url.startswith("http") and (publishable_key() or rest_key()))


def supabase_login_misconfigured() -> str:
    """User-facing reason when Supabase login env is partial or explicitly required.

    Uses the same names as ``Settings`` / the rest of the app:
    SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
    (aliases SUPABASE_SECRET_KEY, SUPABASE_KEY). Empty when sqlite login is OK.
    """
    mode = str(getattr(settings, "users_backend", "") or "").strip().lower()
    if mode in {"local", "sqlite"}:
        return ""
    url_ok = bool(project_url().startswith("http"))
    has_key = bool(publishable_key() or rest_key())
    grant_ok = password_grant_configured()
    admin_ok = configured()
    key_hint = (
        "SUPABASE_PUBLISHABLE_KEY or SUPABASE_SERVICE_ROLE_KEY "
        "(aliases: SUPABASE_SECRET_KEY, SUPABASE_KEY)"
    )
    if mode in {"supabase", "remote"} and not (grant_ok or admin_ok):
        return (
            "Account service is not configured. Set SUPABASE_URL and "
            f"{key_hint}."
        )
    if url_ok and not has_key:
        return f"Account service is missing a Supabase key. Set {key_hint}."
    if has_key and not url_ok:
        return "Account service is missing SUPABASE_URL."
    return ""


def management_configured() -> bool:
    return bool(management_token())


@lru_cache(maxsize=1)
def _client_cached(url: str, secret: str):
    from supabase import create_client

    return create_client(url, secret)


@lru_cache(maxsize=4)
def _auth_client_cached(url: str, key: str):
    from supabase import create_client

    return create_client(url, key)


def get_admin_client():
    """Return a secret-key Supabase client, or None if not configured."""
    if not configured():
        return None
    url = settings.supabase_url.strip()
    secret = rest_key()
    try:
        return _client_cached(url, secret)
    except Exception:
        logger.warning("Supabase client init failed", exc_info=True)
        return None


def get_auth_client():
    """Client for password grant. Prefer publishable/anon; fall back to service role."""
    url = project_url()
    key = publishable_key() or rest_key()
    if not url.startswith("http") or not key:
        return None
    try:
        return _auth_client_cached(url, key)
    except Exception:
        logger.warning("Supabase auth client init failed", exc_info=True)
        return None


def iter_auth_clients():
    """Publishable first, then service role — password grant must not skip GoTrue."""
    url = project_url()
    if not url.startswith("http"):
        return
    seen: set[str] = set()
    for key in (publishable_key(), rest_key()):
        if not key or key in seen:
            continue
        seen.add(key)
        try:
            yield _auth_client_cached(url, key)
        except Exception:
            logger.warning("Supabase auth client init failed", exc_info=True)


def clear_client_cache() -> None:
    _client_cached.cache_clear()
    _auth_client_cached.cache_clear()


def status() -> dict[str, Any]:
    return {
        "configured": configured(),
        "url_set": bool((getattr(settings, "supabase_url", None) or "").strip()),
        "secret_set": bool(rest_key()),
        "publishable_set": bool((getattr(settings, "supabase_publishable_key", None) or "").strip()),
        "access_token_set": bool(management_token()),
        "service_role_set": bool((getattr(settings, "supabase_service_role_key", None) or "").strip()),
    }


def run_management_sql(sql: str) -> dict[str, Any]:
    """Run SQL via Supabase Management API. Never logs the PAT or result rows."""
    token = management_token()
    if not token:
        return {"ok": False, "error": "no_access_token"}
    import httpx

    url = f"{MANAGEMENT_API}/v1/projects/{PROJECT_REF}/database/query"
    try:
        res = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"query": sql},
            timeout=60.0,
        )
        if res.status_code >= 400:
            return {"ok": False, "status": res.status_code, "error": (res.text or "")[:240]}
        return {"ok": True, "status": res.status_code}
    except Exception as exc:
        logger.warning("Supabase management SQL failed", exc_info=True)
        return {"ok": False, "error": str(exc)[:240]}


def fetch_project_api_keys() -> dict[str, str]:
    """Return named API keys from Management API. Values are not logged."""
    token = management_token()
    if not token:
        return {}
    import httpx

    out: dict[str, str] = {}
    for url in (
        f"{MANAGEMENT_API}/v1/projects/{PROJECT_REF}/api-keys?reveal=true",
        f"{MANAGEMENT_API}/v1/projects/{PROJECT_REF}/api-keys",
    ):
        try:
            res = httpx.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=30.0,
            )
            if res.status_code >= 400:
                continue
            payload = res.json()
            rows = payload if isinstance(payload, list) else (payload.get("api_keys") or payload.get("keys") or [])
            if isinstance(payload, dict) and not rows:
                for key, val in payload.items():
                    if isinstance(val, str) and val.strip():
                        out[str(key)] = val.strip()
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or row.get("id") or row.get("type") or "").strip().lower()
                value = str(row.get("api_key") or row.get("apiKey") or row.get("key") or "").strip()
                if name and value:
                    out[name] = value
            if out:
                return out
        except Exception:
            logger.warning("Supabase api-keys fetch failed", exc_info=True)
    return out


AUTH_CONFIG_URL = f"{MANAGEMENT_API}/v1/projects/{PROJECT_REF}/config/auth"
GITHUB_OAUTH_REDIRECTS = (
    "https://render3d.app/oauth/github/callback",
    "https://render3d.app/oauth/github",
    "http://127.0.0.1:8001/oauth/github/callback",
)


def _auth_config_headers() -> dict[str, str] | None:
    token = management_token()
    if not token:
        return None
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def get_auth_config() -> dict[str, Any]:
    """GoTrue/Auth config from the Management API. Never logs secret fields."""
    headers = _auth_config_headers()
    if not headers:
        return {}
    import httpx

    try:
        res = httpx.get(AUTH_CONFIG_URL, headers=headers, timeout=30.0)
        if res.status_code >= 400:
            logger.warning("Supabase get auth config failed status=%s", res.status_code)
            return {}
        payload = res.json()
        return payload if isinstance(payload, dict) else {}
    except Exception:
        logger.warning("Supabase get auth config failed", exc_info=True)
        return {}


def patch_auth_config(updates: dict[str, Any]) -> dict[str, Any]:
    """PATCH Auth config. Callers must not log ``updates`` (may contain secrets)."""
    headers = _auth_config_headers()
    if not headers:
        return {"ok": False, "error": "no_access_token"}
    if not updates:
        return {"ok": False, "error": "empty"}
    import httpx

    try:
        res = httpx.patch(
            AUTH_CONFIG_URL,
            headers=headers,
            json=updates,
            timeout=30.0,
        )
        if res.status_code >= 400:
            return {"ok": False, "status": res.status_code, "error": (res.text or "")[:240]}
        return {"ok": True, "status": res.status_code}
    except Exception as exc:
        logger.warning("Supabase patch auth config failed", exc_info=True)
        return {"ok": False, "error": str(exc)[:240]}


def github_auth_provider_status() -> dict[str, Any]:
    """Public flags only — never includes client secret."""
    cfg = get_auth_config()
    client_id = str(cfg.get("external_github_client_id") or "").strip()
    enabled = cfg.get("external_github_enabled")
    if isinstance(enabled, str):
        enabled = enabled.strip().lower() in {"true", "1", "yes"}
    return {
        "enabled": bool(enabled) or bool(client_id),
        "client_id_set": bool(client_id),
        "client_id_hint": (client_id[:6] + "…") if len(client_id) >= 8 else "",
    }


def configure_github_auth_provider(client_id: str, client_secret: str) -> dict[str, Any]:
    """Store OAuth App credentials on the official GitHub Auth provider slot."""
    cid = str(client_id or "").strip()
    secret = str(client_secret or "").strip()
    if len(cid) < 8 or len(secret) < 8:
        return {"ok": False, "error": "invalid_credentials"}
    current = get_auth_config()
    allow = str(current.get("uri_allow_list") or "")
    parts = [p.strip() for p in allow.split(",") if p.strip()]
    for uri in GITHUB_OAUTH_REDIRECTS:
        if uri not in parts:
            parts.append(uri)
    return patch_auth_config(
        {
            "external_github_enabled": True,
            "external_github_client_id": cid,
            "external_github_secret": secret,
            "uri_allow_list": ",".join(parts),
        }
    )
