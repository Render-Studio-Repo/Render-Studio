"""Encrypted API-key vault mirrored to Supabase (ciphertext only).

Plaintext keys are never written to Supabase. Decryption uses a dedicated
SECRETS_FERNET_KEY on the app server (falls back to legacy jwt_secret-derived key).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from backend.services import supabase_client

logger = logging.getLogger("render3d.supabase_secrets")


def enabled() -> bool:
    return supabase_client.configured()


def _sb():
    return supabase_client.get_admin_client()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def upsert_ai_key(
    *,
    key_id: str,
    user_id: str,
    provider: str,
    name: str,
    model: str,
    ciphertext: str,
    key_hint: str | None,
    is_active: bool = False,
) -> None:
    if not enabled() or not ciphertext:
        return
    try:
        _sb().table("render_user_secrets").upsert(
            {
                "id": key_id,
                "user_id": user_id,
                "kind": "ai_key",
                "provider": provider,
                "name": name or "",
                "model": model or "",
                "ciphertext": ciphertext,
                "key_hint": key_hint,
                "is_active": bool(is_active),
                "updated_at": _now(),
            },
            on_conflict="id",
        ).execute()
    except Exception:
        logger.warning("Supabase upsert_ai_key failed for %s", key_id, exc_info=True)


def delete_ai_key(key_id: str) -> None:
    if not enabled():
        return
    try:
        _sb().table("render_user_secrets").delete().eq("id", key_id).execute()
    except Exception:
        logger.warning("Supabase delete_ai_key failed for %s", key_id, exc_info=True)


def sync_user_keys_from_sqlite(user_id: str) -> dict[str, Any]:
    """Push all local encrypted keys for a user to Supabase."""
    if not enabled():
        return {"ok": False, "error": "not_configured"}
    from backend.database import get_conn

    with get_conn() as conn:
        active = conn.execute(
            "SELECT active_ai_key_id, email, display_name, handle FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        rows = conn.execute(
            "SELECT id, name, provider, model, api_key_enc, created_at FROM user_ai_keys WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    if active:
        try:
            from backend.services import supabase_auth_service as sbauth

            sbauth.upsert_profile(
                user_id=user_id,
                email=str(active["email"] or f"{user_id}@local.placeholder"),
                display_name=str(active["display_name"] or ""),
                handle=active["handle"] if "handle" in active.keys() else None,
            )
        except Exception:
            pass
    active_id = str(active["active_ai_key_id"] or "") if active else ""
    synced = 0
    for row in rows:
        enc = str(row["api_key_enc"] or "")
        if not enc:
            continue
        hint = f"...{enc[-4:]}" if len(enc) >= 8 else "saved"
        # Prefer last-4 of plaintext if we can decrypt; never send plaintext
        try:
            from backend.services.user_ai_keys_service import _decrypt, key_hint as _hint

            plain = _decrypt(enc)
            if plain:
                hint = _hint(plain) or hint
        except Exception:
            pass
        upsert_ai_key(
            key_id=str(row["id"]),
            user_id=user_id,
            provider=str(row["provider"] or "openai"),
            name=str(row["name"] or ""),
            model=str(row["model"] or ""),
            ciphertext=enc,
            key_hint=hint,
            is_active=str(row["id"]) == active_id,
        )
        synced += 1
    return {"ok": True, "synced": synced}


def sync_all_keys(*, limit_users: int = 500) -> dict[str, Any]:
    if not enabled():
        return {"ok": False, "error": "not_configured"}
    from backend.database import get_conn

    with get_conn() as conn:
        users = conn.execute(
            "SELECT DISTINCT user_id FROM user_ai_keys LIMIT ?",
            (int(limit_users),),
        ).fetchall()
    total = 0
    for u in users:
        result = sync_user_keys_from_sqlite(str(u["user_id"]))
        total += int(result.get("synced") or 0)
    return {"ok": True, "users": len(users), "keys_synced": total}
