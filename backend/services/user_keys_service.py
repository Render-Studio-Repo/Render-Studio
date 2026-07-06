"""Per-user OpenAI API keys (encrypted). Owner emails use server .env key."""

from __future__ import annotations

import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from backend.config import settings
from backend.database import get_conn


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.jwt_secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _owner_emails() -> set[str]:
    raw = settings.openai_owner_emails or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def uses_shared_server_key(email: str) -> bool:
    return email.strip().lower() in _owner_emails()


def _validate_key_format(api_key: str) -> str:
    key = api_key.strip()
    if len(key) < 20:
        raise ValueError("API key looks too short")
    if not key.startswith("sk-"):
        raise ValueError('OpenAI API keys usually start with "sk-"')
    return key


def set_user_key(user_id: str, api_key: str) -> None:
    key = _validate_key_format(api_key)
    enc = _fernet().encrypt(key.encode("utf-8")).decode("ascii")
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET openai_api_key_enc = ? WHERE id = ?",
            (enc, user_id),
        )
        conn.commit()


def clear_user_key(user_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET openai_api_key_enc = NULL WHERE id = ?",
            (user_id,),
        )
        conn.commit()


def get_user_key(user_id: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT openai_api_key_enc FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if not row or not row["openai_api_key_enc"]:
        return None
    try:
        return _fernet().decrypt(row["openai_api_key_enc"].encode("ascii")).decode("utf-8")
    except InvalidToken:
        return None


def resolve_api_key_for_user(user: dict[str, Any]) -> str | None:
    if uses_shared_server_key(user.get("email", "")):
        return settings.openai_api_key or None
    return get_user_key(user["id"])


def key_hint(api_key: str) -> str:
    return f"…{api_key[-4:]}" if len(api_key) >= 8 else "saved"


def openai_status(user: dict[str, Any]) -> dict[str, Any]:
    email = user.get("email") or ""
    shared = uses_shared_server_key(email)
    user_key = None if shared else get_user_key(user["id"])
    has_key = bool(settings.openai_api_key) if shared else bool(user_key)
    return {
        "uses_shared_key": shared,
        "needs_user_key": not shared,
        "has_user_key": has_key,
        "ai_ready": has_key,
        "key_hint": key_hint(user_key) if user_key else None,
        "model": settings.openai_model,
    }
