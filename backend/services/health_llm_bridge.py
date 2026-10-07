"""AutoPrep → Render Studio LLM bridge (internal, service-token gated).

AutoPrep on :5050 should use the same OpenAI subscription and currently
selected models as CAD Studio, instead of a disconnected Health .env / gpt-4o-mini.
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Any

from fastapi import HTTPException, Request

logger = logging.getLogger("render3d.health_llm")

OPENAI_HEALTH_MODELS = (
    "gpt-6.1-sol",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-astra",
    "gpt-6-astra-pro",
    "gpt-5.5",
)


def service_token() -> str:
    from backend.config import settings
    return (
        (os.getenv("HEALTH_STUDIO_SERVICE_TOKEN") or "").strip()
        or (getattr(settings, "health_studio_service_token", None) or "").strip()
    )


def require_token(request: Request) -> None:
    expected = service_token()
    got = (
        (request.headers.get("X-Health-Studio-Token") or "")
        or (request.headers.get("Authorization") or "").removeprefix("Bearer ")
    ).strip()
    if not expected or not got or len(got) != len(expected) or not hmac.compare_digest(got, expected):
        raise HTTPException(status_code=401, detail="Invalid health studio token")


def owner_user() -> dict[str, Any]:
    from backend.auth import get_user_by_id
    from backend.config import settings
    from backend.database import get_conn

    pinned = (
        (os.getenv("HEALTH_STUDIO_OWNER_USER_ID") or "").strip()
        or (getattr(settings, "health_studio_owner_user_id", None) or "").strip()
    )
    if pinned:
        user = get_user_by_id(pinned)
        if user:
            return user
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT user_id FROM ai_subscriptions
             WHERE provider = 'openai'
             ORDER BY connected_at DESC
             LIMIT 1
            """
        ).fetchone()
        if row:
            user = get_user_by_id(str(row["user_id"]))
            if user:
                return user
        row = conn.execute(
            """
            SELECT user_id FROM user_ai_keys
             WHERE lower(provider) = 'openai'
             ORDER BY created_at DESC
             LIMIT 1
            """
        ).fetchone()
        if row:
            user = get_user_by_id(str(row["user_id"]))
            if user:
                return user
    raise HTTPException(status_code=503, detail="No Render Studio OpenAI subscription owner is configured")


def selected_model_meta(user: dict[str, Any], requested: str | None = None) -> dict[str, str]:
    from backend.config import settings
    from backend.database import get_conn
    from backend.services import ai_credit_service, user_ai_keys_service

    def _is_astra(model: str) -> bool:
        return str(model or "").strip().lower().startswith("gpt-6-astra")

    def _is_cli(model: str) -> bool:
        m = str(model or "").strip().lower()
        return m.startswith("gpt-6-astra") or m.startswith("gpt-6.1-sol") or m.startswith("gpt-5.6-")

    def _picker(model: str | None) -> str:
        m = str(model or "").strip()
        if not m or m.lower() in {"chatgpt", "codex", "default", "chatgpt-default"}:
            return "gpt-5.6-sol"
        return m

    want = str(requested or "").strip()
    if want and want not in set(OPENAI_HEALTH_MODELS):
        want = ""

    credits = {}
    try:
        credits = ai_credit_service.status(user) or {}
    except Exception:
        credits = {}
    chatgpt_on = False
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM ai_subscriptions WHERE user_id = ? AND provider = 'openai'",
                (user.get("id"),),
            ).fetchone()
            chatgpt_on = bool(row)
    except Exception:
        chatgpt_on = False

    platform_model = str(credits.get("platform_model") or "").strip()
    if credits.get("use_platform_key") and platform_model:
        model = want or platform_model
        source = "platform"
        if chatgpt_on and (_is_astra(model) or _is_cli(model)):
            source = "chatgpt_subscription"
            model = _picker(model)
        return {"model": model, "source": source, "provider": "openai"}

    effective = None
    try:
        effective = user_ai_keys_service.get_effective_key_for_user(user["id"])
    except Exception:
        effective = None
    if effective and effective.get("api_key"):
        model = want or str(effective.get("model") or "").strip() or settings.openai_model
        source = str(effective.get("source") or "personal")
        provider = str(effective.get("provider") or "openai")
        if provider == "openai" and chatgpt_on and (_is_astra(model) or _is_cli(model)):
            source = "chatgpt_subscription"
        return {"model": model, "source": source, "provider": provider}

    if chatgpt_on:
        return {
            "model": _picker(want or "gpt-5.6-sol"),
            "source": "chatgpt_subscription",
            "provider": "openai",
        }
    return {
        "model": want or settings.openai_model or "gpt-5.5",
        "source": "studio_env",
        "provider": "openai",
    }


def _split_messages(messages: list[dict[str, Any]]) -> tuple[str, str]:
    system_parts: list[str] = []
    user_parts: list[str] = []
    for msg in messages or []:
        role = str(msg.get("role") or "user")
        content = msg.get("content") or ""
        if not isinstance(content, str):
            content = str(content)
        if role == "system":
            system_parts.append(content)
        else:
            prefix = "Assistant: " if role == "assistant" else ""
            user_parts.append(prefix + content)
    return "\n\n".join(system_parts).strip(), "\n\n".join(user_parts).strip()


def status_payload(requested: str | None = None) -> dict[str, Any]:
    user = owner_user()
    meta = selected_model_meta(user, requested)
    return {
        "ready": True,
        "model": meta["model"],
        "source": meta["source"],
        "provider": meta["provider"],
        "models": list(OPENAI_HEALTH_MODELS),
        "label": "Render Studio OpenAI",
    }


def complete(
    messages: list[dict[str, Any]],
    *,
    json_mode: bool = False,
    max_tokens: int = 1400,
    image: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    import sys

    main = sys.modules.get("backend.main")
    if main is None:
        raise HTTPException(status_code=503, detail="Studio CAD backend is not loaded")
    _get_ai_for_user = main._get_ai_for_user

    user = owner_user()
    meta = selected_model_meta(user, model)
    source = meta["source"]
    key_source = "chatgpt" if source == "chatgpt_subscription" else (
        "platform" if source == "platform" else None
    )
    ai = _get_ai_for_user(
        user,
        speed="fast",
        requested_model=meta["model"],
        allow_chatgpt_subscription=True,
        key_source=key_source,
    )
    system, user_text = _split_messages(messages)
    if not user_text:
        user_text = "Respond helpfully."
    images = None
    if image and str(image).startswith("data:image/"):
        images = [{"name": "health-photo", "data_url": str(image)}]
    raw, _trace = ai._call_model(
        system or "You are a helpful nutrition assistant.",
        user_text,
        images=images,
        max_tokens=max_tokens,
        json_response=bool(json_mode),
    )
    used = str(getattr(ai, "model", None) or meta["model"])
    billing = str(getattr(ai, "billing_source", None) or source)
    return {"text": (raw or "").strip(), "model": used, "source": billing}
