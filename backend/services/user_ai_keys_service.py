"""Encrypted per-user AI provider credentials — multi-key library."""

from __future__ import annotations

import base64
import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from backend.config import settings
from backend.database import get_conn

SUPPORTED_PROVIDERS = {"openai", "anthropic", "kimi", "xai", "gemini", "qwen", "local"}

QWEN_INTL_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
QWEN_CN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

PROVIDER_LABELS: dict[str, str] = {
    "openai": "OpenAI",
    "anthropic": "Claude",
    "kimi": "Kimi",
    "xai": "Grok",
    "gemini": "Gemini",
    "qwen": "Qwen",
    "local": "Local LLM",
}

# Catalog of models owners can allow on a shared key (keep in sync with frontend).
PROVIDER_MODEL_CATALOG: dict[str, list[str]] = {
    "openai": [
        "gpt-6.1-sol",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-6-astra",
        "gpt-6-astra-pro",
        "gpt-5.5",
    ],
    "anthropic": [
        "claude-fable-5-1",
        "claude-opus-5",
        "claude-fable-5",
        "claude-sonnet-4-5",
        "claude-opus-4-8",
        "claude-4.6-sonnet",
    ],
    "kimi": [
        "kimi-k2.6",
        "kimi-k3",
    ],
    "xai": [
        "grok-4.5",
    ],
    "gemini": [
        "gemini-3.8-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
    ],
    "qwen": [
        "qwen3-coder-plus",
        "qwen3-coder-flash",
        "qwen-plus",
        "qwen-max",
        "qwen-turbo",
    ],
    "local": [
        "qwen2.5-coder:32b",
        "qwen2.5-coder:14b",
        "qwen2.5:32b",
        "qwen3:32b",
        "llama3.1:8b",
        "deepseek-coder-v2",
        "gpt-oss:20b",
    ],
}


def _try_fernet(material: str) -> Fernet | None:
    raw = (material or "").strip()
    if not raw:
        return None
    try:
        return Fernet(raw.encode("utf-8"))
    except Exception:
        try:
            digest = hashlib.sha256(raw.encode("utf-8")).digest()
            return Fernet(base64.urlsafe_b64encode(digest))
        except Exception:
            return None


def _fernet() -> Fernet:
    """Prefer dedicated SECRETS_FERNET_KEY; fall back to jwt_secret-derived key."""
    dedicated = _try_fernet(getattr(settings, "secrets_fernet_key", None) or "")
    if dedicated:
        return dedicated
    legacy = _try_fernet(settings.jwt_secret or "")
    if legacy:
        return legacy
    digest = hashlib.sha256(b"change-me-in-production-render3d").digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _fernet_decrypt_candidates() -> list[Fernet]:
    """Try dedicated key first, then legacy jwt_secret (existing ciphertext)."""
    out: list[Fernet] = []
    for material in (
        (getattr(settings, "secrets_fernet_key", None) or "").strip(),
        (settings.jwt_secret or "").strip(),
        "change-me-in-production-render3d",
    ):
        f = _try_fernet(material)
        if f is not None:
            out.append(f)
    # Deduplicate while preserving order
    uniq: list[Fernet] = []
    seen: set[int] = set()
    for f in out:
        i = id(f._signing_key)  # type: ignore[attr-defined]
        if i in seen:
            continue
        seen.add(i)
        uniq.append(f)
    return uniq or [_fernet()]


def normalize_provider(provider: str | None) -> str:
    value = (provider or "openai").strip().lower()
    aliases = {
        "claude": "anthropic",
        "moonshot": "kimi",
        "grok": "xai",
        "x-ai": "xai",
        "spacexai": "xai",
        "google": "gemini",
        "google-ai": "gemini",
        "google_ai": "gemini",
        "qwen": "qwen",
        "dashscope": "qwen",
        "alibaba": "qwen",
        "aliyun": "qwen",
        "tongyi": "qwen",
        "ollama": "local",
        "lmstudio": "local",
        "lm_studio": "local",
        "openai_compat": "local",
        "openai-compatible": "local",
        "openai_compatible": "local",
    }
    value = aliases.get(value, value)
    if value not in SUPPORTED_PROVIDERS:
        raise ValueError("Provider must be openai, anthropic, kimi, xai, gemini, qwen, or local")
    return value


def provider_label(provider: str | None) -> str:
    try:
        return PROVIDER_LABELS[normalize_provider(provider)]
    except ValueError:
        return PROVIDER_LABELS.get(str(provider or "").strip().lower(), "AI")


def _ensure_base_url_column(conn: Any) -> None:
    try:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(user_ai_keys)").fetchall()}
        if "base_url" not in cols:
            conn.execute("ALTER TABLE user_ai_keys ADD COLUMN base_url TEXT")
    except Exception:
        pass


def normalize_base_url(base_url: str | None, provider: str | None = None) -> str | None:
    raw = (base_url or "").strip().rstrip("/")
    if not raw:
        try:
            prov = normalize_provider(provider)
        except ValueError:
            return None
        if prov == "local":
            return "http://127.0.0.1:11434/v1"
        if prov == "qwen":
            return QWEN_INTL_BASE_URL
        return None
    if not re.match(r"^https?://", raw, flags=re.I):
        raise ValueError("Base URL must start with http:// or https://")
    # Accept both …/v1 and bare host; OpenAI client wants /v1.
    if not raw.endswith("/v1") and "localhost" in raw or "127.0.0.1" in raw:
        if "/v1" not in raw:
            raw = raw.rstrip("/") + "/v1"
    return raw[:300]


def default_model(provider: str) -> str:
    provider = normalize_provider(provider)
    if provider == "anthropic":
        return settings.anthropic_model
    if provider == "kimi":
        return getattr(settings, "kimi_model", None) or "kimi-k2.6"
    if provider == "xai":
        return getattr(settings, "xai_model", None) or "grok-4.5"
    if provider == "gemini":
        return getattr(settings, "gemini_model", None) or "gemini-3.8-flash"
    if provider == "qwen":
        return getattr(settings, "qwen_model", None) or "qwen3-coder-plus"
    if provider == "local":
        return "qwen2.5-coder:32b"
    return settings.openai_model


def _parse_allowed_models(raw: Any, provider: str) -> list[str] | None:
    """Return explicit allow-list, or None when unrestricted (legacy / unset)."""
    if raw is None or raw == "":
        return None
    data = raw
    if isinstance(raw, str):
        try:
            import json

            data = json.loads(raw)
        except Exception:
            return None
    if not isinstance(data, list):
        return None
    valid = set(PROVIDER_MODEL_CATALOG.get(normalize_provider(provider), []))
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in data:
        model = str(item or "").strip()
        if not model or model in seen:
            continue
        if valid and model not in valid:
            continue
        seen.add(model)
        cleaned.append(model)
    return cleaned


def _serialize_allowed_models(models: list[str] | None) -> str | None:
    if models is None:
        return None
    import json

    return json.dumps(list(models))


def effective_allowed_models(raw: Any, provider: str) -> list[str]:
    """Models a member may use. Unset allow-list → full provider catalog."""
    provider = normalize_provider(provider)
    parsed = _parse_allowed_models(raw, provider)
    catalog = list(PROVIDER_MODEL_CATALOG.get(provider, []))
    if parsed is None:
        return catalog
    return parsed


def clamp_model_to_allowed(
    model: str | None,
    *,
    provider: str,
    allowed_raw: Any,
    fallback: str | None = None,
) -> str:
    provider = normalize_provider(provider)
    allowed = effective_allowed_models(allowed_raw, provider)
    candidate = (model or "").strip()
    if candidate and candidate in allowed:
        return candidate
    fb = (fallback or "").strip()
    if fb and fb in allowed:
        return fb
    if allowed:
        return allowed[0]
    return candidate or fb or default_model(provider)


def normalize_base_url(base_url: str | None, provider: str | None = None) -> str | None:
    raw = (base_url or "").strip().rstrip("/")
    if not raw:
        try:
            prov = normalize_provider(provider)
        except ValueError:
            return None
        if prov == "local":
            return "http://127.0.0.1:11434/v1"
        if prov == "qwen":
            return QWEN_INTL_BASE_URL
        return None
    if not re.match(r"^https?://", raw, flags=re.I):
        raise ValueError("Base URL must start with http:// or https://")
    # Accept bare host for local servers; OpenAI client wants /v1.
    if ("localhost" in raw or "127.0.0.1" in raw) and "/v1" not in raw:
        raw = raw.rstrip("/") + "/v1"
    return raw[:300]


def validate_key(provider: str, api_key: str) -> str:
    provider = normalize_provider(provider)
    key = api_key.strip()
    if provider == "local":
        # Ollama / LM Studio often need no key; accept short placeholders.
        return key or "local-no-key-required"
    if len(key) < 20:
        raise ValueError("API key looks too short")
    if provider == "openai" and not key.startswith("sk-"):
        raise ValueError('OpenAI API keys usually start with "sk-"')
    if provider == "anthropic" and not key.startswith("sk-ant-"):
        raise ValueError('Claude/Anthropic API keys usually start with "sk-ant-"')
    if provider == "xai" and not key.startswith("xai-"):
        raise ValueError('Grok / xAI API keys usually start with "xai-"')
    if provider == "gemini":
        if key.startswith("sk-ant-"):
            raise ValueError("That looks like an Anthropic key — pick Claude / Anthropic as the provider.")
        if key.startswith("xai-"):
            raise ValueError("That looks like a Grok / xAI key — pick Grok / xAI as the provider.")
        if not key.startswith("AIza"):
            raise ValueError('Gemini API keys from Google AI Studio usually start with "AIza"')
    if provider == "qwen":
        if key.startswith("sk-ant-"):
            raise ValueError("That looks like an Anthropic key — pick Claude / Anthropic as the provider.")
        if key.startswith("AIza"):
            raise ValueError("That looks like a Gemini key — pick Gemini / Google as the provider.")
        if key.startswith("xai-"):
            raise ValueError("That looks like a Grok / xAI key — pick Grok / xAI as the provider.")
    if provider == "kimi" and key.startswith("sk-ant-"):
        raise ValueError("That looks like an Anthropic key — pick Claude / Anthropic as the provider.")
    return key


def key_hint(api_key: str | None) -> str | None:
    if not api_key:
        return None
    return f"...{api_key[-4:]}" if len(api_key) >= 8 else "saved"


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def _decrypt(enc: str | None) -> str | None:
    if not enc:
        return None
    raw = enc.encode("ascii")
    for f in _fernet_decrypt_candidates():
        try:
            return f.decrypt(raw).decode("utf-8")
        except (InvalidToken, UnicodeError, ValueError):
            continue
    return None


def _prefer_remote_keys() -> bool:
    try:
        from backend.services import supabase_users_store as sbusers

        return sbusers.prefer_supabase()
    except Exception:
        return False


def _ws_live() -> bool:
    try:
        from backend.services.supabase_workspace_store import live

        return live()
    except Exception:
        return False


def _remote_keys_ready() -> bool:
    try:
        from backend.services import supabase_users_store as sbusers

        return sbusers.source_of_truth()
    except Exception:
        return False


def _backup_key_sqlite(
    user_id: str,
    *,
    key_id: str,
    name: str,
    provider: str,
    enc: str,
    model: str,
    created_at: str,
    base_url: str | None,
    activate: bool,
) -> None:
    with get_conn() as conn:
        _ensure_base_url_column(conn)
        existing = conn.execute(
            "SELECT id FROM user_ai_keys WHERE id = ? AND user_id = ?",
            (key_id, user_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE user_ai_keys SET name=?, provider=?, api_key_enc=?, model=?, base_url=? WHERE id=? AND user_id=?",
                (name, provider, enc, model, base_url, key_id, user_id),
            )
        else:
            conn.execute(
                "INSERT INTO user_ai_keys (id, user_id, name, provider, api_key_enc, model, created_at, base_url) VALUES (?,?,?,?,?,?,?,?)",
                (key_id, user_id, name, provider, enc, model, created_at, base_url),
            )
        if activate:
            conn.execute(
                "UPDATE users SET ai_provider=?, ai_api_key_enc=?, ai_model=?, active_ai_key_id=? WHERE id=?",
                (provider, enc, model, key_id, user_id),
            )
        conn.commit()


# ── Multi-key library ─────────────────────────────────────────────────────────

def _migrate_legacy_key(user_id: str, conn: Any) -> None:
    """If user has a key in the legacy users columns but no library entries, import it."""
    count = conn.execute(
        "SELECT COUNT(*) FROM user_ai_keys WHERE user_id = ?", (user_id,)
    ).fetchone()[0]
    if count > 0:
        return  # Already migrated
    row = conn.execute(
        "SELECT ai_provider, ai_api_key_enc, ai_model FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if not row or not row["ai_api_key_enc"]:
        return  # No legacy key
    provider = normalize_provider(row["ai_provider"] or "openai")
    model = (row["ai_model"] or "").strip() or default_model(provider)
    key_name = f"{provider_label(provider)} key"
    key_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO user_ai_keys (id, user_id, name, provider, api_key_enc, model, created_at) VALUES (?,?,?,?,?,?,?)",
        (key_id, user_id, key_name, provider, row["ai_api_key_enc"], model, now),
    )
    conn.execute(
        "UPDATE users SET active_ai_key_id = ? WHERE id = ?", (key_id, user_id)
    )


def list_keys(user_id: str) -> list[dict[str, Any]]:
    """Return all saved keys for a user (no raw key values)."""
    if _prefer_remote_keys():
        if not _remote_keys_ready():
            return []
        from backend.services import supabase_users_store as sbusers

        result = sbusers.list_key_meta(user_id)
        for item in result:
            item["provider_label"] = provider_label(item.get("provider"))
        return result
    with get_conn() as conn:
        _ensure_base_url_column(conn)
        _migrate_legacy_key(user_id, conn)
        conn.commit()

        active_id = conn.execute(
            "SELECT active_ai_key_id FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        active_key_id = (active_id["active_ai_key_id"] if active_id else None)

        rows = conn.execute(
            "SELECT id, name, provider, model, created_at, base_url FROM user_ai_keys WHERE user_id = ? ORDER BY created_at",
            (user_id,),
        ).fetchall()

    result = []
    for row in rows:
        result.append({
            "id": row["id"],
            "name": row["name"],
            "provider": row["provider"],
            "provider_label": provider_label(row["provider"]),
            "model": row["model"],
            "base_url": row["base_url"] if "base_url" in row.keys() else None,
            "created_at": row["created_at"],
            "is_active": row["id"] == active_key_id,
        })
    return result


def add_key(
    user_id: str,
    provider: str,
    api_key: str,
    model: str | None = None,
    name: str | None = None,
    activate: bool = True,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Save a new key to the library and optionally activate it."""
    provider = normalize_provider(provider)
    key = validate_key(provider, api_key)
    enc = _encrypt(key)
    chosen_model = (model or "").strip() or default_model(provider)
    if "codex" in chosen_model.lower():
        chosen_model = default_model(provider)
    chosen_base = normalize_base_url(base_url, provider)
    key_name = (name or "").strip() or (
        f"{provider_label(provider)} key"
    )
    key_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()

    if _prefer_remote_keys():
        if not _remote_keys_ready():
            raise ValueError("User key store is unavailable")
        from backend.services import supabase_users_store as sbusers

        keys = sbusers.personal_keys(user_id)
        keys.append(
            {
                "id": key_id,
                "provider": provider,
                "name": key_name,
                "model": chosen_model,
                "base_url": chosen_base,
                "ciphertext": enc,
                "key_hint": key_hint(key),
                "is_active": bool(activate),
                "created_at": now,
            }
        )
        active_id = key_id if activate else (sbusers.get_by_id(user_id) or {}).get("active_ai_key_id")
        sbusers.replace_personal_keys(
            user_id,
            keys,
            active_id=active_id,
            ai_provider=provider if activate else None,
            ai_model=chosen_model if activate else None,
        )
        try:
            _backup_key_sqlite(
                user_id,
                key_id=key_id,
                name=key_name,
                provider=provider,
                enc=enc,
                model=chosen_model,
                created_at=now,
                base_url=chosen_base,
                activate=bool(activate),
            )
        except Exception:
            pass
        try:
            from backend.services import supabase_secrets_store as sbsec

            sbsec.upsert_ai_key(
                key_id=key_id,
                user_id=user_id,
                provider=provider,
                name=key_name,
                model=chosen_model,
                ciphertext=enc,
                key_hint=key_hint(key),
                is_active=bool(activate),
            )
        except Exception:
            pass
        return status_for_user_id(user_id)

    with get_conn() as conn:
        _ensure_base_url_column(conn)
        conn.execute(
            "INSERT INTO user_ai_keys (id, user_id, name, provider, api_key_enc, model, created_at, base_url) VALUES (?,?,?,?,?,?,?,?)",
            (key_id, user_id, key_name, provider, enc, chosen_model, now, chosen_base),
        )
        if activate:
            conn.execute(
                "UPDATE users SET ai_provider=?, ai_api_key_enc=?, ai_model=?, active_ai_key_id=? WHERE id=?",
                (provider, enc, chosen_model, key_id, user_id),
            )
        conn.commit()

    try:
        from backend.services import supabase_secrets_store as sbsec

        sbsec.upsert_ai_key(
            key_id=key_id,
            user_id=user_id,
            provider=provider,
            name=key_name,
            model=chosen_model,
            ciphertext=enc,
            key_hint=key_hint(key),
            is_active=bool(activate),
        )
    except Exception:
        pass
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.upsert_local_user(user_id)
    except Exception:
        pass

    return status_for_user_id(user_id)


def delete_key(user_id: str, key_id: str) -> dict[str, Any]:
    """Remove a key from the library. If it was active, deactivate."""
    if _prefer_remote_keys():
        if not _remote_keys_ready():
            raise ValueError("User key store is unavailable")
        from backend.services import supabase_users_store as sbusers

        row = sbusers.get_by_id(user_id) or {}
        keys = [k for k in sbusers.personal_keys(user_id) if str(k.get("id") or "") != str(key_id)]
        if len(keys) == len(sbusers.personal_keys(user_id)):
            raise ValueError("Key not found")
        active_id = str(row.get("active_ai_key_id") or "")
        if active_id == str(key_id):
            nxt = keys[-1] if keys else None
            active_id = str(nxt["id"]) if nxt else None
            provider = nxt.get("provider") if nxt else None
            model = nxt.get("model") if nxt else None
        else:
            provider = None
            model = None
        sbusers.replace_personal_keys(user_id, keys, active_id=active_id, ai_provider=provider, ai_model=model)
        try:
            with get_conn() as conn:
                conn.execute("DELETE FROM user_ai_keys WHERE id = ? AND user_id = ?", (key_id, user_id))
                conn.commit()
        except Exception:
            pass
        try:
            from backend.services import supabase_secrets_store as sbsec

            sbsec.delete_ai_key(key_id)
        except Exception:
            pass
        return status_for_user_id(user_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM user_ai_keys WHERE id = ? AND user_id = ?",
            (key_id, user_id),
        ).fetchone()
        if not row:
            raise ValueError("Key not found")

        conn.execute(
            "DELETE FROM user_ai_keys WHERE id = ? AND user_id = ?",
            (key_id, user_id),
        )
        # If this was the active key, clear active or auto-switch to another
        active_row = conn.execute(
            "SELECT active_ai_key_id FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if active_row and active_row["active_ai_key_id"] == key_id:
            # Try to fall back to another key
            other = conn.execute(
                "SELECT id, provider, api_key_enc, model FROM user_ai_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            if other:
                conn.execute(
                    "UPDATE users SET ai_provider=?, ai_api_key_enc=?, ai_model=?, active_ai_key_id=? WHERE id=?",
                    (other["provider"], other["api_key_enc"], other["model"], other["id"], user_id),
                )
            else:
                conn.execute(
                    "UPDATE users SET ai_api_key_enc=NULL, ai_model=NULL, active_ai_key_id=NULL WHERE id=?",
                    (user_id,),
                )
        conn.commit()

    try:
        from backend.services import supabase_secrets_store as sbsec

        sbsec.delete_ai_key(key_id)
    except Exception:
        pass
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.upsert_local_user(user_id)
    except Exception:
        pass

    return status_for_user_id(user_id)


def activate_key(user_id: str, key_id: str) -> dict[str, Any]:
    """Make a saved key the active one."""
    if _prefer_remote_keys():
        if not _remote_keys_ready():
            raise ValueError("User key store is unavailable")
        from backend.services import supabase_users_store as sbusers

        item = sbusers.find_personal_key(user_id, key_id)
        if not item:
            raise ValueError("Key not found")
        keys = sbusers.personal_keys(user_id)
        sbusers.replace_personal_keys(
            user_id,
            keys,
            active_id=key_id,
            ai_provider=item.get("provider"),
            ai_model=item.get("model"),
        )
        try:
            enc = item.get("ciphertext") or ""
            with get_conn() as conn:
                conn.execute(
                    "UPDATE users SET ai_provider=?, ai_api_key_enc=?, ai_model=?, active_ai_key_id=? WHERE id=?",
                    (item.get("provider"), enc, item.get("model"), key_id, user_id),
                )
                conn.commit()
        except Exception:
            pass
        return status_for_user_id(user_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT provider, api_key_enc, model FROM user_ai_keys WHERE id = ? AND user_id = ?",
            (key_id, user_id),
        ).fetchone()
        if not row:
            raise ValueError("Key not found")
        conn.execute(
            "UPDATE users SET ai_provider=?, ai_api_key_enc=?, ai_model=?, active_ai_key_id=? WHERE id=?",
            (row["provider"], row["api_key_enc"], row["model"], key_id, user_id),
        )
        conn.commit()
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.upsert_local_user(user_id)
    except Exception:
        pass
    return status_for_user_id(user_id)


def rename_key(user_id: str, key_id: str, new_name: str) -> dict[str, Any]:
    name = new_name.strip()
    if not name:
        raise ValueError("Name cannot be empty")
    with get_conn() as conn:
        conn.execute(
            "UPDATE user_ai_keys SET name = ? WHERE id = ? AND user_id = ?",
            (name, key_id, user_id),
        )
        conn.commit()
    return status_for_user_id(user_id)


def update_key(user_id: str, key_id: str, *, name: str | None = None, model: str | None = None) -> dict[str, Any]:
    """Update name and/or model for an existing key."""
    if not name and not model:
        raise ValueError("Nothing to update")
    with get_conn() as conn:
        if name is not None:
            name = name.strip()
            if not name:
                raise ValueError("Name cannot be empty")
            conn.execute(
                "UPDATE user_ai_keys SET name = ? WHERE id = ? AND user_id = ?",
                (name, key_id, user_id),
            )
        if model is not None:
            model = model.strip()
            if not model:
                raise ValueError("Model cannot be empty")
            if "codex" in model.lower():
                model = default_model("openai")
            conn.execute(
                "UPDATE user_ai_keys SET model = ? WHERE id = ? AND user_id = ?",
                (model, key_id, user_id),
            )
        conn.commit()
    return status_for_user_id(user_id)


# ── Team-shared keys ──────────────────────────────────────────────────────────

def grant_team_openai_keys_to_member(
    team_id: str,
    target_user_id: str,
    requester_id: str,
) -> list[str]:
    """Grant every shared OpenAI key on this workspace to a member and turn it on."""
    granted_ids: list[str] = []
    with get_conn() as conn:
        keys = conn.execute(
            """
            SELECT id FROM team_shared_ai_keys
            WHERE team_id=? AND lower(provider)='openai' AND COALESCE(enabled,1)=1
            """,
            (team_id,),
        ).fetchall()
    for key in keys:
        set_team_key_member_access(
            team_id,
            key["id"],
            target_user_id,
            granted=True,
            requester_id=requester_id,
            use_key=True,
        )
        granted_ids.append(str(key["id"]))
    return granted_ids


def deny_shared_keys_for_new_member(
    team_id: str,
    user_id: str,
    *,
    updated_by: str | None = None,
) -> None:
    """New teammates start with no access to existing shared keys (except key owners)."""
    now = datetime.now(timezone.utc).isoformat()
    actor = updated_by or user_id
    with get_conn() as conn:
        keys = conn.execute(
            "SELECT id, shared_by FROM team_shared_ai_keys WHERE team_id=?",
            (team_id,),
        ).fetchall()
        for key in keys:
            if key["shared_by"] == user_id:
                continue
            conn.execute(
                "INSERT INTO team_key_grants (key_id,user_id,granted,updated_by,updated_at) VALUES (?,?,0,?,?) "
                "ON CONFLICT(key_id,user_id) DO NOTHING",
                (key["id"], user_id, actor, now),
            )
        conn.commit()
    try:
        from backend.services import supabase_workspace_store as ws

        with get_conn() as conn2:
            rows = conn2.execute(
                "SELECT g.key_id, g.user_id, g.granted, g.updated_by, g.updated_at "
                "FROM team_key_grants g JOIN team_shared_ai_keys k ON k.id = g.key_id "
                "WHERE k.team_id=? AND g.user_id=?",
                (team_id, user_id),
            ).fetchall()
        for row in rows:
            ws.upsert_grant(dict(row))
    except Exception:
        pass
    try:
        from backend.services.chatgpt_share_service import deny_shared_chatgpt_for_new_member

        deny_shared_chatgpt_for_new_member(team_id, user_id, updated_by=actor)
    except Exception:
        pass


def deny_members_for_new_shared_key(
    team_id: str,
    key_id: str,
    shared_by: str,
) -> None:
    """When a shared key is created, existing members stay denied until explicitly granted."""
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        members = conn.execute(
            "SELECT user_id FROM team_members WHERE team_id=?",
            (team_id,),
        ).fetchall()
        for member in members:
            uid = member["user_id"]
            if uid == shared_by:
                continue
            conn.execute(
                "INSERT INTO team_key_grants (key_id,user_id,granted,updated_by,updated_at) VALUES (?,?,0,?,?) "
                "ON CONFLICT(key_id,user_id) DO NOTHING",
                (key_id, uid, shared_by, now),
            )
        conn.commit()
    _mirror_team_grants(key_id, shared_by, now)


def _mirror_team_key_row(row: dict[str, Any]) -> None:
    try:
        from backend.services import supabase_workspace_store as ws

        ws.upsert_team_key(row)
    except Exception:
        pass


def _mirror_team_grants(key_id: str, shared_by: str, now: str) -> None:
    try:
        from backend.services import supabase_workspace_store as ws

        with get_conn() as conn:
            rows = conn.execute(
                "SELECT key_id, user_id, granted, updated_by, updated_at FROM team_key_grants WHERE key_id=?",
                (key_id,),
            ).fetchall()
        for row in rows:
            ws.upsert_grant(dict(row))
    except Exception:
        pass


def add_team_shared_key(
    team_id: str,
    shared_by: str,
    provider: str,
    api_key: str,
    model: str | None = None,
    name: str | None = None,
    scope_type: str | None = None,
    scope_project_id: str | None = None,
    scope_label: str | None = None,
) -> dict[str, Any]:
    """Owner adds an encrypted key shared with the whole team."""
    provider = normalize_provider(provider)
    key = validate_key(provider, api_key)
    enc = _encrypt(key)
    chosen_model = (model or "").strip() or default_model(provider)
    if "codex" in chosen_model.lower():
        chosen_model = default_model(provider)
    key_name = (name or "").strip() or (f"Team {provider_label(provider)} key")
    scope_type, scope_project_id, scope_label = _normalize_team_key_scope(scope_type, scope_project_id, scope_label)
    key_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        # Verify sharer is a team member
        row = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?", (team_id, shared_by)
        ).fetchone()
        if not row:
            raise ValueError("Not a team member")
        conn.execute(
            "INSERT INTO team_shared_ai_keys (id,team_id,name,provider,api_key_enc,model,shared_by,enabled,created_at,scope_type,scope_project_id,scope_label) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)",
            (key_id, team_id, key_name, provider, enc, chosen_model, shared_by, now, scope_type, scope_project_id, scope_label),
        )
        conn.commit()
    _mirror_team_key_row(
        {
            "id": key_id,
            "team_id": team_id,
            "name": key_name,
            "provider": provider,
            "api_key_enc": enc,
            "model": chosen_model,
            "shared_by": shared_by,
            "enabled": 1,
            "created_at": now,
            "scope_type": scope_type,
            "scope_project_id": scope_project_id,
            "scope_label": scope_label,
        }
    )
    deny_members_for_new_shared_key(team_id, key_id, shared_by)
    return list_team_shared_keys(team_id, shared_by)


def add_team_shared_key_from_user_key(
    team_id: str,
    shared_by: str,
    source_key_id: str,
    model: str | None = None,
    name: str | None = None,
    scope_type: str | None = None,
    scope_project_id: str | None = None,
    scope_label: str | None = None,
) -> list[dict[str, Any]]:
    """Share one of the user's already-saved personal keys with a team.

    The encrypted key is copied server-side so the client never receives or
    re-submits the raw secret.
    """
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, shared_by),
        ).fetchone()
        if not member:
            raise ValueError("Not a team member")
        source = conn.execute(
            "SELECT name, provider, api_key_enc, model FROM user_ai_keys WHERE id=? AND user_id=?",
            (source_key_id, shared_by),
        ).fetchone()
        if not source and _prefer_remote_keys() and _remote_keys_ready():
            from backend.services import supabase_users_store as sbusers

            remote = sbusers.find_personal_key(shared_by, source_key_id)
            if remote:
                class _Row(dict):
                    def __getitem__(self, key):
                        if key == "api_key_enc":
                            return self.get("ciphertext") or dict.get(self, "api_key_enc")
                        return dict.__getitem__(self, key)

                source = _Row(
                    {
                        "name": remote.get("name"),
                        "provider": remote.get("provider"),
                        "api_key_enc": remote.get("ciphertext") or remote.get("api_key_enc"),
                        "model": remote.get("model"),
                    }
                )
        if not source:
            raise ValueError("Saved key not found")
        chosen_model = (model or "").strip() or source["model"] or default_model(source["provider"])
        if "codex" in str(chosen_model or "").lower():
            chosen_model = default_model(source["provider"])
        key_name = (name or "").strip() or f"Shared {source['name']}"
        scope_type, scope_project_id, scope_label = _normalize_team_key_scope(scope_type, scope_project_id, scope_label)
        key_id = str(uuid.uuid4())[:8]
        conn.execute(
            "INSERT INTO team_shared_ai_keys (id,team_id,name,provider,api_key_enc,model,shared_by,enabled,created_at,scope_type,scope_project_id,scope_label) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)",
            (key_id, team_id, key_name, source["provider"], source["api_key_enc"], chosen_model, shared_by, now, scope_type, scope_project_id, scope_label),
        )
        conn.commit()
    _mirror_team_key_row(
        {
            "id": key_id,
            "team_id": team_id,
            "name": key_name,
            "provider": source["provider"],
            "api_key_enc": source["api_key_enc"],
            "model": chosen_model,
            "shared_by": shared_by,
            "enabled": 1,
            "created_at": now,
            "scope_type": scope_type,
            "scope_project_id": scope_project_id,
            "scope_label": scope_label,
        }
    )
    deny_members_for_new_shared_key(team_id, key_id, shared_by)
    return list_team_shared_keys(team_id, shared_by)


def _is_team_owner(conn: Any, team_id: str, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id=? AND user_id=? AND role='owner'",
        (team_id, user_id),
    ).fetchone()
    return bool(row)


def _normalize_team_key_scope(
    scope_type: str | None,
    scope_project_id: str | None,
    scope_label: str | None,
) -> tuple[str, str | None, str | None]:
    scope = (scope_type or "all").strip().lower()
    project_id = (scope_project_id or "").strip() or None
    label = (scope_label or "").strip() or None
    if scope not in {"all", "project", "folder"}:
        scope = "all"
    if scope in {"project", "folder"} and not project_id:
        raise ValueError(f"Choose a {scope} for this shared key scope")
    if scope == "all":
        project_id = None
        label = None
    return scope, project_id, label


def _team_key_scope_allows(conn: Any, row: Any, project_id: str | None) -> bool:
    scope = (row["scope_type"] if "scope_type" in row.keys() else None) or "all"
    if scope == "project":
        return bool(project_id) and str(row["scope_project_id"] or "") == str(project_id)
    if scope == "folder":
        if not project_id:
            return False
        project_row = conn.execute(
            "SELECT folder_id FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        return bool(project_row) and str(project_row["folder_id"] or "") == str(row["scope_project_id"] or "")
    return True


def _list_team_shared_keys_remote(team_id: str, user_id: str) -> list[dict[str, Any]]:
    from backend.services import supabase_workspace_store as ws

    keys = ws.list_team_keys(team_id)
    key_ids = [str(k.get("id")) for k in keys if k.get("id")]
    grants = {(g.get("key_id"), g.get("user_id")): ws._as_bool(g.get("granted")) for g in ws.list_grants_for_keys(key_ids)}
    opt_rows = ws.list_opts_for_keys(key_ids)
    opts = {
        (o.get("key_id"), o.get("user_id")): o
        for o in opt_rows
    }
    members = ws.list_members(team_id)
    requester_is_team_owner = any(
        str(m.get("user_id")) == str(user_id) and str(m.get("role") or "") == "owner" for m in members
    )
    out = []
    for r in keys:
        kid = str(r.get("id") or "")
        owner = str(r.get("shared_by") or "") == str(user_id)
        if not owner and not grants.get((kid, user_id), False):
            continue
        opt = opts.get((kid, user_id)) or {}
        provider = normalize_provider(r.get("provider"))
        access_members = []
        for m in members:
            uid = str(m.get("user_id") or "")
            is_owner = uid == str(r.get("shared_by") or "")
            granted = is_owner or grants.get((kid, uid), False)
            if not granted:
                continue
            mopt = opts.get((kid, uid)) or {}
            access_members.append(
                {
                    "user_id": uid,
                    "display_name": uid,
                    "email": "",
                    "granted": True,
                    "use_key": ws._as_bool(mopt.get("use_key"), False),
                    "model": mopt.get("model") or r.get("model"),
                    "daily_limit_usd": mopt.get("daily_limit_usd"),
                    "daily_token_limit": mopt.get("daily_token_limit"),
                    "allowed_models": effective_allowed_models(mopt.get("allowed_models"), provider),
                }
            )
        out.append(
            {
                "id": kid,
                "team_id": team_id,
                "name": r.get("name"),
                "provider": r.get("provider"),
                "provider_label": provider_label(r.get("provider")),
                "model": clamp_model_to_allowed(
                    opt.get("model") or r.get("model"),
                    provider=provider,
                    allowed_raw=opt.get("allowed_models"),
                    fallback=r.get("model"),
                ),
                "key_model": r.get("model"),
                "allowed_models": effective_allowed_models(opt.get("allowed_models"), provider),
                "enabled": ws._as_bool(r.get("enabled"), True),
                "shared_by": r.get("shared_by"),
                "shared_by_name": "",
                "scope_type": r.get("scope_type") or "all",
                "scope_project_id": r.get("scope_project_id"),
                "scope_label": r.get("scope_label"),
                "use_key": ws._as_bool(opt.get("use_key"), False),
                "effective_model": clamp_model_to_allowed(
                    opt.get("model") or r.get("model"),
                    provider=provider,
                    allowed_raw=opt.get("allowed_models"),
                    fallback=r.get("model"),
                ),
                "daily_limit_usd": opt.get("daily_limit_usd"),
                "daily_token_limit": opt.get("daily_token_limit"),
                "is_owner": owner,
                "can_manage": owner or requester_is_team_owner,
                "access_members": access_members,
            }
        )
    return out


def list_team_shared_keys(team_id: str, user_id: str) -> list[dict[str, Any]]:
    """Return team shared keys. Raw key is never returned."""
    if _ws_live():
        return _list_team_shared_keys_remote(team_id, user_id)
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT k.id, k.name, k.provider, k.model, k.enabled, k.shared_by,
                      k.scope_type, k.scope_project_id, k.scope_label,
                      u.display_name AS shared_by_name,
                      COALESCE(opt.use_key, 0) AS use_key,
                      opt.model AS member_model,
                      opt.daily_limit_usd AS daily_limit_usd,
                      opt.daily_token_limit AS daily_token_limit,
                      opt.allowed_models AS allowed_models
               FROM team_shared_ai_keys k
               JOIN users u ON u.id = k.shared_by
               LEFT JOIN user_team_key_opts opt ON opt.key_id = k.id AND opt.user_id = ?
               LEFT JOIN team_key_grants g ON g.key_id = k.id AND g.user_id = ?
               WHERE k.team_id = ?
                 AND (k.shared_by = ? OR COALESCE(g.granted, 0) = 1)
               ORDER BY k.created_at""",
            (user_id, user_id, team_id, user_id),
        ).fetchall()
        member_rows = conn.execute(
            """SELECT tm.user_id, u.display_name, u.email
               FROM team_members tm
               JOIN users u ON u.id = tm.user_id
               WHERE tm.team_id = ?
               ORDER BY u.display_name""",
            (team_id,),
        ).fetchall()
        opt_rows = conn.execute(
            """SELECT opt.user_id, opt.key_id, opt.use_key, opt.model, opt.daily_limit_usd,
                      opt.daily_token_limit, opt.allowed_models
               FROM user_team_key_opts opt
               JOIN team_shared_ai_keys k ON k.id = opt.key_id
               WHERE k.team_id = ?""",
            (team_id,),
        ).fetchall()
        grant_rows = conn.execute(
            """SELECT g.key_id, g.user_id, g.granted
               FROM team_key_grants g
               JOIN team_shared_ai_keys k ON k.id = g.key_id
               WHERE k.team_id = ?""",
            (team_id,),
        ).fetchall()
        requester_is_team_owner = _is_team_owner(conn, team_id, user_id)
        grants = {(g["key_id"], g["user_id"]): bool(g["granted"]) for g in grant_rows}
        opts = {
            (o["key_id"], o["user_id"]): {
                "use_key": bool(o["use_key"]),
                "model": o["model"],
                "daily_limit_usd": o["daily_limit_usd"],
                "daily_token_limit": o["daily_token_limit"],
                "allowed_models": o["allowed_models"],
            }
            for o in opt_rows
        }
        members_by_key: dict[str, list[dict[str, Any]]] = {}
        for key in rows:
            key_id = key["id"]
            provider = normalize_provider(key["provider"])
            members_by_key[key_id] = [
                {
                    "user_id": m["user_id"],
                    "display_name": m["display_name"] or m["email"] or "Team member",
                    "email": m["email"],
                    "granted": grants.get((key_id, m["user_id"]), False) or m["user_id"] == key["shared_by"],
                    "use_key": opts.get((key_id, m["user_id"]), {}).get("use_key", False),
                    "model": opts.get((key_id, m["user_id"]), {}).get("model") or key["model"],
                    "daily_limit_usd": opts.get((key_id, m["user_id"]), {}).get("daily_limit_usd"),
                    "daily_token_limit": opts.get((key_id, m["user_id"]), {}).get("daily_token_limit"),
                    "allowed_models": effective_allowed_models(
                        opts.get((key_id, m["user_id"]), {}).get("allowed_models"),
                        provider,
                    ),
                }
                for m in member_rows
                if grants.get((key_id, m["user_id"]), False) or m["user_id"] == key["shared_by"]
            ]
    return [
        {
            "id": r["id"],
            "team_id": team_id,
            "name": r["name"],
            "provider": r["provider"],
            "provider_label": provider_label(r["provider"]),
            "model": clamp_model_to_allowed(
                r["member_model"] or r["model"],
                provider=r["provider"],
                allowed_raw=r["allowed_models"],
                fallback=r["model"],
            ),
            "key_model": r["model"],
            "allowed_models": effective_allowed_models(r["allowed_models"], r["provider"]),
            "enabled": bool(r["enabled"]),
            "shared_by": r["shared_by"],
            "shared_by_name": r["shared_by_name"],
            "scope_type": r["scope_type"] or "all",
            "scope_project_id": r["scope_project_id"],
            "scope_label": r["scope_label"],
            "use_key": bool(r["use_key"]),
            "effective_model": clamp_model_to_allowed(
                r["member_model"] or r["model"],
                provider=r["provider"],
                allowed_raw=r["allowed_models"],
                fallback=r["model"],
            ),
            "daily_limit_usd": r["daily_limit_usd"],
            "daily_token_limit": r["daily_token_limit"],
            "is_owner": r["shared_by"] == user_id,
            "can_manage": r["shared_by"] == user_id or requester_is_team_owner,
            "access_members": members_by_key.get(r["id"], []),
        }
        for r in rows
    ]


def list_team_key_members(team_id: str, key_id: str, requester_id: str) -> list[dict[str, Any]]:
    """Return all team members with their access status for a specific shared key.
    Only the key sharer or a team owner may call this."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?", (team_id, requester_id)
        ).fetchone()
        if not row:
            raise PermissionError("Not a team member")
        key_row = conn.execute(
            "SELECT shared_by, provider, model FROM team_shared_ai_keys WHERE id=? AND team_id=?", (key_id, team_id)
        ).fetchone()
        if not key_row:
            raise ValueError("Key not found")
        if key_row["shared_by"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError("Only the key owner or team owner can manage shared-key access")

        try:
            rows = conn.execute(
                """SELECT tm.user_id, u.display_name, u.email, u.handle,
                          tm.role,
                          CASE WHEN tm.user_id = ? THEN 1 ELSE COALESCE(g.granted, 0) END AS granted,
                          COALESCE(opt.use_key, 0) AS use_key,
                          opt.model AS member_model,
                          opt.daily_limit_usd AS daily_limit_usd,
                          opt.daily_token_limit AS daily_token_limit,
                          opt.allowed_models AS allowed_models
                   FROM team_members tm
                   JOIN users u ON u.id = tm.user_id
                   LEFT JOIN team_key_grants g ON g.key_id = ? AND g.user_id = tm.user_id
                   LEFT JOIN user_team_key_opts opt ON opt.key_id = ? AND opt.user_id = tm.user_id
                   WHERE tm.team_id = ?
                   ORDER BY u.display_name""",
                (key_row["shared_by"], key_id, key_id, team_id),
            ).fetchall()
        except Exception:
            rows = conn.execute(
                """SELECT tm.user_id, u.display_name, u.email,
                          tm.role,
                          CASE WHEN tm.user_id = ? THEN 1 ELSE COALESCE(g.granted, 0) END AS granted,
                          COALESCE(opt.use_key, 0) AS use_key,
                          opt.model AS member_model,
                          opt.daily_limit_usd AS daily_limit_usd,
                          opt.daily_token_limit AS daily_token_limit,
                          opt.allowed_models AS allowed_models
                   FROM team_members tm
                   JOIN users u ON u.id = tm.user_id
                   LEFT JOIN team_key_grants g ON g.key_id = ? AND g.user_id = tm.user_id
                   LEFT JOIN user_team_key_opts opt ON opt.key_id = ? AND opt.user_id = tm.user_id
                   WHERE tm.team_id = ?
                   ORDER BY u.display_name""",
                (key_row["shared_by"], key_id, key_id, team_id),
            ).fetchall()
    provider = normalize_provider(key_row["provider"])
    return [
        {
            "user_id": r["user_id"],
            "display_name": r["display_name"],
            "email": r["email"],
            "handle": (r["handle"] if "handle" in r.keys() else None),
            "role": r["role"],
            "granted": bool(r["granted"]),
            "use_key": bool(r["use_key"]),
            "provider": provider,
            "model": clamp_model_to_allowed(
                r["member_model"] or key_row["model"],
                provider=provider,
                allowed_raw=r["allowed_models"],
                fallback=key_row["model"],
            ),
            "key_model": key_row["model"],
            "allowed_models": effective_allowed_models(r["allowed_models"], provider),
            "daily_limit_usd": r["daily_limit_usd"],
            "daily_token_limit": r["daily_token_limit"],
            "is_key_owner": r["user_id"] == key_row["shared_by"],
        }
        for r in rows
    ]


def set_team_key_member_access(
    team_id: str,
    key_id: str,
    target_user_id: str,
    granted: bool | None,
    requester_id: str,
    *,
    use_key: bool | None = None,
    model: str | None = None,
    allowed_models: list[str] | None = None,
    allowed_models_provided: bool = False,
    daily_limit_usd: float | None = None,
    daily_limit_provided: bool = False,
    daily_token_limit: int | None = None,
    daily_token_limit_provided: bool = False,
) -> list[dict[str, Any]]:
    """Manage a member's access, shared-key preference, and model for a team key."""
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        key_row = conn.execute(
            "SELECT shared_by, provider, model FROM team_shared_ai_keys WHERE id=? AND team_id=?", (key_id, team_id)
        ).fetchone()
        if not key_row:
            raise ValueError("Key not found")
        self_limit_only = (
            requester_id == target_user_id
            and granted is None
            and use_key is None
            and model is None
            and not allowed_models_provided
            and (daily_limit_provided or daily_token_limit_provided)
        )
        if not self_limit_only and key_row["shared_by"] != requester_id and not _is_team_owner(conn, team_id, requester_id):
            raise PermissionError("Only the key owner or team owner can manage shared-key access")
        requester_member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, requester_id),
        ).fetchone()
        if not requester_member:
            raise PermissionError("Not a team member")
        target_member = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=?",
            (team_id, target_user_id),
        ).fetchone()
        if not target_member:
            raise ValueError("Target user is not a team member")
        if self_limit_only:
            if target_user_id != key_row["shared_by"]:
                grant = conn.execute(
                    "SELECT granted FROM team_key_grants WHERE key_id=? AND user_id=?",
                    (key_id, target_user_id),
                ).fetchone()
                if grant is None or not bool(grant["granted"]):
                    raise PermissionError("You do not have access to this shared key")
        if target_user_id == key_row["shared_by"] and granted is False:
            raise PermissionError("The key owner must keep access to their own shared key")
        if granted is True and use_key is None:
            use_key = True
        elif granted is False:
            use_key = False
        if granted is not None:
            conn.execute(
                "INSERT INTO team_key_grants (key_id,user_id,granted,updated_by,updated_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(key_id,user_id) DO UPDATE SET granted=excluded.granted, updated_by=excluded.updated_by, updated_at=excluded.updated_at",
                (key_id, target_user_id, 1 if granted else 0, requester_id, now),
            )
        if (
            use_key is not None
            or model is not None
            or allowed_models_provided
            or daily_limit_provided
            or daily_token_limit_provided
        ):
            current = conn.execute(
                "SELECT use_key, model, daily_limit_usd, daily_token_limit, allowed_models "
                "FROM user_team_key_opts WHERE user_id=? AND key_id=?",
                (target_user_id, key_id),
            ).fetchone()
            chosen_use = (bool(current["use_key"]) if current else False) if use_key is None else bool(use_key)
            chosen_limit = daily_limit_usd if daily_limit_provided else (current["daily_limit_usd"] if current else None)
            chosen_token_limit = daily_token_limit if daily_token_limit_provided else (current["daily_token_limit"] if current else None)
            if allowed_models_provided:
                chosen_allowed = _parse_allowed_models(allowed_models or [], key_row["provider"])
                if not chosen_allowed:
                    raise ValueError("Select at least one allowed model for this member")
                chosen_allowed_raw = _serialize_allowed_models(chosen_allowed)
            else:
                chosen_allowed_raw = current["allowed_models"] if current else None
                chosen_allowed = _parse_allowed_models(chosen_allowed_raw, key_row["provider"])
            raw_model = (current["model"] if current else None) if model is None else (model.strip() or None)
            if raw_model is None:
                raw_model = key_row["model"]
            chosen_model = clamp_model_to_allowed(
                raw_model,
                provider=key_row["provider"],
                allowed_raw=chosen_allowed_raw if allowed_models_provided else chosen_allowed_raw,
                fallback=key_row["model"],
            )
            # If an explicit model was requested but is not allowed, reject instead of silently switching.
            if model is not None and chosen_allowed is not None:
                requested = (model or "").strip()
                if requested and requested not in effective_allowed_models(chosen_allowed_raw, key_row["provider"]):
                    raise ValueError("That model is not allowed for this member on the shared key")
            conn.execute(
                "INSERT INTO user_team_key_opts "
                "(user_id,key_id,use_key,model,daily_limit_usd,daily_token_limit,allowed_models) "
                "VALUES (?,?,?,?,?,?,?) "
                "ON CONFLICT(user_id,key_id) DO UPDATE SET "
                "use_key=excluded.use_key, model=excluded.model, "
                "daily_limit_usd=excluded.daily_limit_usd, daily_token_limit=excluded.daily_token_limit, "
                "allowed_models=excluded.allowed_models",
                (
                    target_user_id,
                    key_id,
                    1 if chosen_use else 0,
                    chosen_model,
                    chosen_limit,
                    chosen_token_limit,
                    chosen_allowed_raw,
                ),
            )
        conn.commit()
    try:
        from backend.services import supabase_workspace_store as ws

        if granted is not None:
            ws.upsert_grant(
                {
                    "key_id": key_id,
                    "user_id": target_user_id,
                    "granted": granted,
                    "updated_by": requester_id,
                    "updated_at": now,
                }
            )
        opt = None
        with get_conn() as conn2:
            opt = conn2.execute(
                "SELECT * FROM user_team_key_opts WHERE user_id=? AND key_id=?",
                (target_user_id, key_id),
            ).fetchone()
        if opt:
            ws.upsert_opt(dict(opt))
    except Exception:
        pass
    if self_limit_only:
        return []
    return list_team_key_members(team_id, key_id, requester_id)


def delete_team_shared_key(team_id: str, key_id: str, user_id: str) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT shared_by FROM team_shared_ai_keys WHERE id=? AND team_id=?",
            (key_id, team_id),
        ).fetchone()
        if not row:
            raise ValueError("Key not found")
        # Only the sharer or team owner can delete
        is_owner = conn.execute(
            "SELECT 1 FROM team_members WHERE team_id=? AND user_id=? AND role='owner'",
            (team_id, user_id),
        ).fetchone()
        if row["shared_by"] != user_id and not is_owner:
            raise PermissionError("Only the key owner or team admin can remove this key")
        conn.execute("DELETE FROM team_shared_ai_keys WHERE id=?", (key_id,))
        conn.commit()
    try:
        from backend.services import supabase_workspace_store as ws

        ws.delete_team_key(key_id)
    except Exception:
        pass


def toggle_team_key(user_id: str, key_id: str, use_key: bool, model: str | None = None) -> None:
    """Per-user opt in/out of a shared team key.

    Enabling a key is exclusive: other shared keys for this user are turned off so
    picking Claude Fable/Opus cannot silently fall back to an older OpenAI shared key.
    """
    with get_conn() as conn:
        key = conn.execute(
            "SELECT model, provider FROM team_shared_ai_keys WHERE id=?",
            (key_id,),
        ).fetchone()
        if not key:
            raise ValueError("Shared key not found")
        current = conn.execute(
            "SELECT allowed_models FROM user_team_key_opts WHERE user_id=? AND key_id=?",
            (user_id, key_id),
        ).fetchone()
        allowed_raw = current["allowed_models"] if current else None
        allowed = effective_allowed_models(allowed_raw, key["provider"])
        requested = (model or "").strip()
        if requested and allowed_raw is not None and requested not in allowed:
            raise ValueError("That model is not allowed on this shared key for your account")
        chosen_model = clamp_model_to_allowed(
            requested or None,
            provider=key["provider"],
            allowed_raw=allowed_raw,
            fallback=key["model"],
        )
        if use_key:
            # Only one shared key can be the active default at a time.
            conn.execute(
                "UPDATE user_team_key_opts SET use_key=0 WHERE user_id=? AND key_id!=?",
                (user_id, key_id),
            )
        conn.execute(
            "INSERT INTO user_team_key_opts (user_id,key_id,use_key,model,allowed_models) VALUES (?,?,?,?,?) "
            "ON CONFLICT(user_id,key_id) DO UPDATE SET use_key=excluded.use_key, "
            "model=COALESCE(excluded.model, user_team_key_opts.model), "
            "allowed_models=COALESCE(user_team_key_opts.allowed_models, excluded.allowed_models)",
            (user_id, key_id, 1 if use_key else 0, chosen_model, allowed_raw),
        )
        conn.commit()


def _effective_from_remote(
    user_id: str,
    project_id: str | None,
    *,
    prefer_opt_in: bool,
) -> dict[str, Any] | None:
    from backend.services import supabase_workspace_store as ws

    memberships = ws.list_user_memberships(user_id)
    team_ids = [str(m.get("team_id")) for m in memberships if m.get("team_id")]
    if not team_ids:
        return None
    keys: list[dict[str, Any]] = []
    for tid in team_ids:
        keys.extend(ws.list_team_keys(tid))
    keys = [k for k in keys if ws._as_bool(k.get("enabled"), True)]
    if not keys:
        return None
    key_ids = [str(k.get("id")) for k in keys if k.get("id")]
    grants = {(g.get("key_id"), g.get("user_id")): ws._as_bool(g.get("granted")) for g in ws.list_grants_for_keys(key_ids)}
    opts = {(o.get("key_id"), o.get("user_id")): o for o in ws.list_opts_for_user(user_id)}
    folder_id = None
    if project_id:
        access = ws.get_project_access(project_id)
        folder_id = (access or {}).get("folder_id")
    chosen = None
    fallback = None
    for key in keys:
        kid = str(key.get("id") or "")
        owner = str(key.get("shared_by") or "") == str(user_id)
        if not owner and not grants.get((kid, user_id), False):
            continue
        scope = str(key.get("scope_type") or "all")
        if scope == "project" and project_id and str(key.get("scope_project_id") or "") != str(project_id):
            continue
        if scope == "folder" and project_id and str(key.get("scope_project_id") or "") != str(folder_id or ""):
            continue
        opt = opts.get((kid, user_id)) or {}
        use_key = ws._as_bool(opt.get("use_key"), False if prefer_opt_in else True)
        packed = {**key, "opt": opt}
        if prefer_opt_in:
            if use_key:
                chosen = packed
                break
        else:
            if not ws._as_bool(opt.get("use_key"), True) and opt:
                continue
            fallback = packed
            break
    row = chosen or fallback
    if not row:
        return None
    api_key = _decrypt(str(row.get("api_key_enc") or ""))
    if not api_key:
        return None
    opt = row.get("opt") or {}
    provider = normalize_provider(row.get("provider"))
    model = opt.get("model") or row.get("model")
    return {
        "provider": provider,
        "api_key": api_key,
        "model": clamp_model_to_allowed(
            model,
            provider=provider,
            allowed_raw=opt.get("allowed_models"),
            fallback=row.get("model"),
        ),
        "allowed_models": effective_allowed_models(opt.get("allowed_models"), provider),
        "source": "team",
        "key_id": row.get("id"),
        "key_name": row.get("name"),
        "shared_by_name": "",
        "scope_type": row.get("scope_type") or "all",
        "scope_project_id": row.get("scope_project_id"),
        "scope_label": row.get("scope_label"),
        "daily_limit_usd": opt.get("daily_limit_usd"),
        "daily_token_limit": opt.get("daily_token_limit"),
    }


def get_effective_key_for_user(user_id: str, project_id: str | None = None) -> dict[str, Any] | None:
    """Return the best available API key for a user.
    Priority: explicitly selected team key → personal active key → fallback team key."""
    if _ws_live():
        packed = _effective_from_remote(user_id, project_id, prefer_opt_in=True)
        if packed:
            return packed
        personal = get_user_settings(user_id)
        if personal.get("api_key"):
            return {**personal, "source": "personal"}
        return _effective_from_remote(user_id, project_id, prefer_opt_in=False)
    # Explicitly selected shared key wins so users can choose shared vs own.
    with get_conn() as conn:
        row = conn.execute(
            """SELECT k.api_key_enc, k.provider, COALESCE(opt.model, k.model) AS model,
                      opt.daily_limit_usd AS daily_limit_usd,
                      opt.daily_token_limit AS daily_token_limit,
                      opt.allowed_models AS allowed_models,
                      k.id AS key_id, k.name AS key_name, u.display_name AS shared_by_name,
                      k.scope_type, k.scope_project_id, k.scope_label
               FROM user_team_key_opts opt
               JOIN team_shared_ai_keys k ON k.id = opt.key_id
               JOIN team_members tm ON tm.team_id = k.team_id AND tm.user_id = opt.user_id
               JOIN users u ON u.id = k.shared_by
               LEFT JOIN team_key_grants g ON g.key_id = k.id AND g.user_id = opt.user_id
               WHERE opt.user_id = ?
                 AND opt.use_key = 1
                 AND k.enabled = 1
                 AND (k.shared_by = opt.user_id OR COALESCE(g.granted, 0) = 1)
               ORDER BY k.created_at DESC LIMIT 1""",
            (user_id,),
        ).fetchone()
        if row and _team_key_scope_allows(conn, row, project_id):
            api_key = _decrypt(row["api_key_enc"])
            if api_key:
                provider = normalize_provider(row["provider"])
                return {
                    "provider": provider,
                    "api_key": api_key,
                    "model": clamp_model_to_allowed(
                        row["model"],
                        provider=provider,
                        allowed_raw=row["allowed_models"],
                        fallback=row["model"],
                    ),
                    "allowed_models": effective_allowed_models(row["allowed_models"], provider),
                    "source": "team",
                    "key_id": row["key_id"],
                    "key_name": row["key_name"],
                    "shared_by_name": row["shared_by_name"],
                    "scope_type": row["scope_type"] or "all",
                    "scope_project_id": row["scope_project_id"],
                    "scope_label": row["scope_label"],
                    "daily_limit_usd": row["daily_limit_usd"],
                    "daily_token_limit": row["daily_token_limit"],
                }

    personal = get_user_settings(user_id)
    if personal.get("api_key"):
        return {**personal, "source": "personal"}

    # Fall back to a team shared key the user hasn't been blocked from and hasn't opted out of
    with get_conn() as conn:
        row = conn.execute(
            """SELECT k.api_key_enc, k.provider, COALESCE(opt.model, k.model) AS model,
                      opt.daily_limit_usd AS daily_limit_usd,
                      opt.daily_token_limit AS daily_token_limit,
                      opt.allowed_models AS allowed_models,
                      k.id AS key_id, k.name AS key_name, u.display_name AS shared_by_name,
                      k.scope_type, k.scope_project_id, k.scope_label
               FROM team_shared_ai_keys k
               JOIN team_members tm ON tm.team_id = k.team_id AND tm.user_id = ?
               JOIN users u ON u.id = k.shared_by
               LEFT JOIN user_team_key_opts opt ON opt.key_id = k.id AND opt.user_id = ?
               LEFT JOIN team_key_grants g ON g.key_id = k.id AND g.user_id = ?
               WHERE k.enabled = 1
                 AND COALESCE(opt.use_key, 1) = 1
                 AND (k.shared_by = ? OR COALESCE(g.granted, 0) = 1)
                 AND (
                   COALESCE(k.scope_type, 'all') = 'all'
                   OR (k.scope_type = 'project' AND k.scope_project_id = ?)
                   OR (
                     k.scope_type = 'folder'
                     AND k.scope_project_id = (
                       SELECT folder_id FROM project_access WHERE project_id = ?
                     )
                   )
                 )
               ORDER BY k.created_at LIMIT 1""",
            (user_id, user_id, user_id, user_id, project_id, project_id),
        ).fetchone()
    if not row:
        return None
    api_key = _decrypt(row["api_key_enc"])
    if not api_key:
        return None
    provider = normalize_provider(row["provider"])
    return {
        "provider": provider,
        "api_key": api_key,
        "model": clamp_model_to_allowed(
            row["model"],
            provider=provider,
            allowed_raw=row["allowed_models"],
            fallback=row["model"],
        ),
        "allowed_models": effective_allowed_models(row["allowed_models"], provider),
        "source": "team",
        "key_id": row["key_id"],
        "key_name": row["key_name"],
        "shared_by_name": row["shared_by_name"],
        "scope_type": row["scope_type"] or "all",
        "scope_project_id": row["scope_project_id"],
        "scope_label": row["scope_label"],
        "daily_limit_usd": row["daily_limit_usd"],
        "daily_token_limit": row["daily_token_limit"],
    }


def resolve_key_for_user(
    user_id: str,
    key_id: str,
    key_source: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Load a specific personal or team key for one request (e.g. prompt override)."""
    key_id = (key_id or "").strip()
    if not key_id:
        raise ValueError("Key id is required")
    source = (key_source or "personal").strip().lower()
    if source == "team":
        return _resolve_team_key_for_user(user_id, key_id, project_id=project_id)
    if source != "personal":
        raise ValueError("Key source must be personal or team")
    return _resolve_personal_key_for_user(user_id, key_id)


def _resolve_personal_key_for_user(user_id: str, key_id: str) -> dict[str, Any]:
    if _prefer_remote_keys():
        if not _remote_keys_ready():
            raise ValueError("Key store unavailable")
        from backend.services import supabase_users_store as sbusers

        row = sbusers.find_personal_key(user_id, key_id)
        if not row:
            raise ValueError("Key not found")
        api_key = _decrypt(str(row.get("ciphertext") or row.get("api_key_enc") or ""))
        if not api_key:
            raise ValueError("Key not available")
        provider = normalize_provider(row.get("provider"))
        base = row.get("base_url")
        return {
            "provider": provider,
            "api_key": api_key,
            "model": (row.get("model") or "").strip() or default_model(provider),
            "base_url": normalize_base_url(base, provider) if (provider in {"local", "qwen"} or base) else None,
            "source": "personal",
            "key_id": key_id,
            "key_name": row.get("name"),
        }
    with get_conn() as conn:
        _ensure_base_url_column(conn)
        row = conn.execute(
            """SELECT name, provider, api_key_enc, model, base_url
               FROM user_ai_keys WHERE id = ? AND user_id = ?""",
            (key_id, user_id),
        ).fetchone()
    if not row:
        raise ValueError("Key not found")
    api_key = _decrypt(row["api_key_enc"])
    if not api_key:
        raise ValueError("Key not available")
    provider = normalize_provider(row["provider"])
    base = None
    try:
        base = row["base_url"]
    except Exception:
        base = None
    return {
        "provider": provider,
        "api_key": api_key,
        "model": (row["model"] or "").strip() or default_model(provider),
        "base_url": normalize_base_url(base, provider) if (provider in {"local", "qwen"} or base) else None,
        "source": "personal",
        "key_id": key_id,
        "key_name": row["name"],
    }


def _resolve_team_key_for_user(user_id: str, key_id: str, *, project_id: str | None = None) -> dict[str, Any]:
    if _ws_live():
        from backend.services import supabase_workspace_store as ws

        packed = ws.resolve_team_key_for_user(user_id, key_id)
        if not packed:
            raise ValueError("Shared key not found or not accessible")
        api_key = _decrypt(str(packed.get("api_key_enc") or ""))
        if not api_key:
            raise ValueError("Shared key not available")
        opt = packed.get("opt") or {}
        provider = normalize_provider(packed.get("provider"))
        return {
            "provider": provider,
            "api_key": api_key,
            "model": clamp_model_to_allowed(
                opt.get("model") or packed.get("model"),
                provider=provider,
                allowed_raw=opt.get("allowed_models"),
                fallback=packed.get("model"),
            ),
            "allowed_models": effective_allowed_models(opt.get("allowed_models"), provider),
            "source": "team",
            "key_id": packed.get("id"),
            "key_name": packed.get("name"),
            "shared_by_name": "",
            "scope_type": packed.get("scope_type") or "all",
            "scope_project_id": packed.get("scope_project_id"),
            "scope_label": packed.get("scope_label"),
            "daily_limit_usd": opt.get("daily_limit_usd"),
            "daily_token_limit": opt.get("daily_token_limit"),
        }
    with get_conn() as conn:
        row = conn.execute(
            """SELECT k.api_key_enc, k.provider, COALESCE(opt.model, k.model) AS model,
                      opt.daily_limit_usd AS daily_limit_usd,
                      opt.daily_token_limit AS daily_token_limit,
                      opt.allowed_models AS allowed_models,
                      k.id AS key_id, k.name AS key_name, u.display_name AS shared_by_name,
                      k.scope_type, k.scope_project_id, k.scope_label
               FROM team_shared_ai_keys k
               JOIN team_members tm ON tm.team_id = k.team_id AND tm.user_id = ?
               JOIN users u ON u.id = k.shared_by
               LEFT JOIN user_team_key_opts opt ON opt.key_id = k.id AND opt.user_id = ?
               LEFT JOIN team_key_grants g ON g.key_id = k.id AND g.user_id = ?
               WHERE k.id = ?
                 AND k.enabled = 1
                 AND (k.shared_by = ? OR COALESCE(g.granted, 0) = 1)""",
            (user_id, user_id, user_id, key_id, user_id),
        ).fetchone()
        if not row:
            raise ValueError("Shared key not found or not accessible")
        if not _team_key_scope_allows(conn, row, project_id):
            label = row["scope_label"] or row["scope_project_id"] or "the scoped project"
            raise ValueError(f"Shared key \"{row['key_name']}\" is restricted to {label}")
    api_key = _decrypt(row["api_key_enc"])
    if not api_key:
        raise ValueError("Shared key not available")
    provider = normalize_provider(row["provider"])
    return {
        "provider": provider,
        "api_key": api_key,
        "model": clamp_model_to_allowed(
            row["model"],
            provider=provider,
            allowed_raw=row["allowed_models"],
            fallback=row["model"],
        ),
        "allowed_models": effective_allowed_models(row["allowed_models"], provider),
        "source": "team",
        "key_id": row["key_id"],
        "key_name": row["key_name"],
        "shared_by_name": row["shared_by_name"],
        "scope_type": row["scope_type"] or "all",
        "scope_project_id": row["scope_project_id"],
        "scope_label": row["scope_label"],
        "daily_limit_usd": row["daily_limit_usd"],
        "daily_token_limit": row["daily_token_limit"],
    }


# ── Legacy single-key API (kept for backwards compat) ─────────────────────────

def set_user_key(user_id: str, provider: str, api_key: str, model: str | None = None) -> dict[str, Any]:
    """Legacy: save and activate a single key."""
    return add_key(user_id, provider, api_key, model=model, activate=True)


def clear_user_key(user_id: str) -> dict[str, Any]:
    """Legacy: clear all keys."""
    with get_conn() as conn:
        conn.execute("DELETE FROM user_ai_keys WHERE user_id = ?", (user_id,))
        conn.execute(
            "UPDATE users SET ai_api_key_enc = NULL, ai_model = NULL, active_ai_key_id = NULL WHERE id = ?",
            (user_id,),
        )
        conn.commit()
    return status_for_user_id(user_id)


def get_user_settings(user_id: str) -> dict[str, Any]:
    """Return the user's active personal key settings (no team key fallback here)."""
    if _prefer_remote_keys():
        if not _remote_keys_ready():
            return {"provider": "openai", "api_key": None, "model": settings.openai_model, "base_url": None}
        from backend.services import supabase_users_store as sbusers

        row = sbusers.get_by_id(user_id) or {}
        active_id = str(row.get("active_ai_key_id") or "")
        item = sbusers.find_personal_key(user_id, active_id) if active_id else None
        if not item:
            keys = sbusers.personal_keys(user_id)
            item = keys[-1] if keys else None
        if not item:
            return {"provider": "openai", "api_key": None, "model": settings.openai_model, "base_url": None}
        provider = normalize_provider(item.get("provider") or row.get("ai_provider") or "openai")
        api_key = _decrypt(str(item.get("ciphertext") or item.get("api_key_enc") or ""))
        model = (item.get("model") or row.get("ai_model") or "").strip() or default_model(provider)
        base_url = item.get("base_url")
        return {
            "provider": provider,
            "api_key": api_key,
            "model": model,
            "base_url": normalize_base_url(base_url, provider) if (provider in {"local", "qwen"} or base_url) else None,
            "key_id": item.get("id"),
            "key_name": item.get("name"),
        }
    with get_conn() as conn:
        _ensure_base_url_column(conn)
        row = conn.execute(
            "SELECT ai_provider, ai_api_key_enc, ai_model, active_ai_key_id FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        base_url = None
        if row and row["active_ai_key_id"]:
            key_row = conn.execute(
                "SELECT base_url FROM user_ai_keys WHERE id = ? AND user_id = ?",
                (row["active_ai_key_id"], user_id),
            ).fetchone()
            if key_row:
                try:
                    base_url = key_row["base_url"]
                except Exception:
                    base_url = None
    if not row:
        return {"provider": "openai", "api_key": None, "model": settings.openai_model, "base_url": None}
    provider = normalize_provider(row["ai_provider"] or "openai")
    api_key = _decrypt(row["ai_api_key_enc"])
    model = (row["ai_model"] or "").strip() or default_model(provider)
    return {
        "provider": provider,
        "api_key": api_key,
        "model": model,
        "base_url": normalize_base_url(base_url, provider) if (provider in {"local", "qwen"} or base_url) else None,
    }


def status_for_user_id(user_id: str) -> dict[str, Any]:
    settings_for_user = get_user_settings(user_id)
    api_key = settings_for_user["api_key"]
    provider = settings_for_user["provider"]
    keys = list_keys(user_id)
    active_id = settings_for_user.get("key_id")
    if _prefer_remote_keys() and _remote_keys_ready():
        try:
            from backend.services import supabase_users_store as sbusers

            remote = sbusers.get_by_id(user_id) or {}
            active_id = remote.get("active_ai_key_id") or active_id
        except Exception:
            pass
    else:
        with get_conn() as conn:
            row = conn.execute("SELECT active_ai_key_id FROM users WHERE id=?", (user_id,)).fetchone()
        active_id = row["active_ai_key_id"] if row else active_id

    # Check for effective key (personal or team fallback)
    effective = get_effective_key_for_user(user_id)
    ai_ready = bool(effective)

    # Gather team shared keys visible to this user
    with get_conn() as conn:
        team_rows = conn.execute(
            "SELECT team_id FROM team_members WHERE user_id=?", (user_id,)
        ).fetchall()
    team_keys: list[dict] = []
    seen_team_ids: set[str] = set()
    for tr in team_rows:
        tid = tr["team_id"]
        if tid not in seen_team_ids:
            seen_team_ids.add(tid)
            team_keys.extend(list_team_shared_keys(tid, user_id))

    return {
        "provider": effective["provider"] if effective else provider,
        "provider_label": provider_label(effective["provider"] if effective else provider),
        "model": effective["model"] if effective else settings_for_user["model"],
        "has_key": bool(api_key) or bool(team_keys),
        "ai_ready": ai_ready,
        "key_hint": key_hint(api_key),
        "requires_user_key": not ai_ready,
        "active_key_id": active_id,
        "keys": keys,
        "team_keys": team_keys,
        "effective": {
            "source": effective.get("source", "personal"),
            "provider": effective["provider"],
            "provider_label": provider_label(effective["provider"]),
            "model": effective["model"],
            "key_id": effective.get("key_id"),
            "key_name": effective.get("key_name") or ("Personal key" if effective.get("source") == "personal" else "Shared key"),
            "shared_by_name": effective.get("shared_by_name"),
            "daily_limit_usd": effective.get("daily_limit_usd"),
            "daily_token_limit": effective.get("daily_token_limit"),
        } if effective else None,
    }


def status_for_user(user: dict[str, Any]) -> dict[str, Any]:
    return status_for_user_id(user["id"])
