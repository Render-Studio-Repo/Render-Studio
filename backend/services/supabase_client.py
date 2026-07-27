"""Server-side Supabase client (secret key only — never expose to the browser)."""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.supabase")


def configured() -> bool:
    url = (getattr(settings, "supabase_url", None) or "").strip()
    secret = (getattr(settings, "supabase_secret_key", None) or "").strip()
    return bool(url.startswith("http") and secret)


@lru_cache(maxsize=1)
def _client_cached(url: str, secret: str):
    from supabase import create_client

    return create_client(url, secret)


def get_admin_client():
    """Return a secret-key Supabase client, or None if not configured."""
    if not configured():
        return None
    url = settings.supabase_url.strip()
    secret = settings.supabase_secret_key.strip()
    try:
        return _client_cached(url, secret)
    except Exception:
        logger.warning("Supabase client init failed", exc_info=True)
        return None


def clear_client_cache() -> None:
    _client_cached.cache_clear()


def status() -> dict[str, Any]:
    return {
        "configured": configured(),
        "url_set": bool((getattr(settings, "supabase_url", None) or "").strip()),
        "secret_set": bool((getattr(settings, "supabase_secret_key", None) or "").strip()),
        "publishable_set": bool((getattr(settings, "supabase_publishable_key", None) or "").strip()),
    }
