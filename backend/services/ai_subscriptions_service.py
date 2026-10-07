"""Linked Cloud (studio credits) and OpenAI/Codex subscription accounts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.database import get_conn
from backend.services import user_ai_keys_service

PROVIDERS = ("cursor", "claude", "openai", "cloud")
# Cursor stays available for existing CLI sessions. Connect exposes Cloud,
# ChatGPT, and the per-user Claude Code login.
LISTING_PROVIDERS = ("cloud", "openai", "claude")

PROVIDER_META: dict[str, dict[str, Any]] = {
    "cloud": {
        "id": "cloud",
        "label": "Cloud",
        "subtitle": "Render Studio credits",
        "login_url": "",
        "manage_urls": [],
        "key_provider": None,
        "sign_in_label": "Use studio credits",
        "device_code_label": "",
        "blurb": "Run CAD and Render on Render Studio cloud credits — the shared platform key, billed from this account. Buy credits under AI & billing if the balance is empty.",
    },
    "cursor": {
        "id": "cursor",
        "label": "Cursor",
        "subtitle": "Pro / Pro+ / Ultra via Cursor Agent",
        "login_url": "https://cursor.com/loginDeepControl",
        "manage_urls": [
            {"id": "usage", "label": "Usage", "url": "https://cursor.com/dashboard/usage"},
            {"id": "billing", "label": "Billing", "url": "https://cursor.com/dashboard"},
            {"id": "settings", "label": "Settings", "url": "https://cursor.com/settings"},
        ],
        "key_provider": None,
        "sign_in_label": "Sign in with Cursor",
        "device_code_label": "",
        "blurb": "Same pattern as ChatGPT: Sign in with Cursor Agent CLI. After this window shows Signed in, CAD 2.0, Architect, VibeCAD, and Mesh run on your Cursor plan — no API key.",
    },
    "claude": {
        "id": "claude",
        "label": "Claude",
        "subtitle": "Claude Code via Pro / Max",
        "login_url": "https://claude.ai/login",
        "manage_urls": [
            {"id": "claude", "label": "Claude", "url": "https://claude.ai/settings"},
            {"id": "keys", "label": "API keys", "url": "https://console.anthropic.com/settings/keys"},
            {"id": "billing", "label": "API billing", "url": "https://console.anthropic.com/settings/billing"},
        ],
        "key_provider": "anthropic",
        "sign_in_label": "Sign in with Claude",
        "device_code_label": "",
        "blurb": "Run `claude setup-token` on your computer, then save that Claude Code subscription token here. Claude Pro/Max runs CAD 2.0, Architect, VibeCAD, and Mesh through the isolated Claude CLI. An Anthropic API key remains the recommended integration fallback.",
    },
    "openai": {
        "id": "openai",
        "label": "ChatGPT subscription",
        "subtitle": "Codex via ChatGPT Plus / Pro",
        "login_url": "https://auth.openai.com/codex/device",
        "manage_urls": [
            {"id": "chatgpt", "label": "ChatGPT", "url": "https://chatgpt.com/#settings"},
            {"id": "apps", "label": "Connected apps", "url": "https://chatgpt.com/#settings"},
            {"id": "usage", "label": "API usage", "url": "https://platform.openai.com/usage"},
            {"id": "limits", "label": "API limits", "url": "https://platform.openai.com/settings/organization/limits"},
            {"id": "billing", "label": "API billing", "url": "https://platform.openai.com/settings/organization/billing"},
        ],
        "key_provider": "openai",
        "sign_in_label": "Sign in with ChatGPT",
        "device_code_label": "Use device code",
        "blurb": "Device-code ChatGPT login. Once signed in, CAD 2.0, Architect, and VibeCAD run Codex on this ChatGPT subscription. API key is the fallback for Mesh and Render.",
    },
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_table(conn: Any) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_subscriptions (
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            account_email TEXT,
            plan_label TEXT,
            connected_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, provider),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def normalize_provider(provider: str | None) -> str:
    value = str(provider or "").strip().lower()
    aliases = {
        "anthropic": "claude",
        "chatgpt": "openai",
        "codex": "openai",
        "gpt": "openai",
        "openai/codex": "openai",
        "openai-codex": "openai",
        "studio": "cloud",
        "credits": "cloud",
        "studio-credits": "cloud",
        "render": "cloud",
        "render-cloud": "cloud",
    }
    value = aliases.get(value, value)
    if value not in PROVIDERS:
        raise ValueError("Provider must be cloud or openai")
    return value


def _credits_status(user_id: str) -> dict[str, Any]:
    try:
        from backend.services import ai_credit_service

        return ai_credit_service.status({"id": user_id}) or {}
    except Exception:
        return {"available": False, "balance_cents": 0, "use_platform_key": False}


def _key_match(keys: list[dict[str, Any]], key_provider: str | None) -> dict[str, Any] | None:
    if not key_provider:
        return None
    for row in keys:
        if str(row.get("provider") or "").strip().lower() == key_provider:
            return row
    return None


def list_subscriptions(user_id: str) -> dict[str, Any]:
    keys = user_ai_keys_service.list_keys(user_id)
    with get_conn() as conn:
        _ensure_table(conn)
        rows = conn.execute(
            """
            SELECT provider, account_email, plan_label, connected_at, updated_at
              FROM ai_subscriptions
             WHERE user_id = ?
            """,
            (user_id,),
        ).fetchall()
    linked = {str(row["provider"]): dict(row) for row in rows}
    chatgpt = {}
    cursor = {}
    claude = {}
    try:
        from backend.services import chatgpt_codex_auth

        chatgpt = chatgpt_codex_auth.device_auth_status(user_id)
    except Exception:
        chatgpt = {"available": False, "status": "not_signed_in", "signed_in": False}
    try:
        from backend.services import cursor_cli_auth

        cursor = cursor_cli_auth.login_status(user_id)
    except Exception:
        cursor = {"available": False, "status": "not_signed_in", "signed_in": False}
    try:
        from backend.services import claude_cli_auth

        claude = claude_cli_auth.login_status(user_id)
    except Exception:
        claude = {"available": False, "status": "not_signed_in", "signed_in": False}
    credits = _credits_status(user_id)
    cli_auth = {"openai": chatgpt, "cursor": cursor, "claude": claude}
    providers = []
    connected = 0
    for pid in LISTING_PROVIDERS:
        meta = PROVIDER_META[pid]
        row = linked.get(pid)
        key = _key_match(keys, meta.get("key_provider"))
        auth = cli_auth.get(pid) or {}
        cli_on = bool(auth.get("signed_in"))
        credits_blob = credits if pid == "cloud" else None
        if pid == "cloud":
            balance = int(credits.get("balance_cents") or 0)
            using = bool(credits.get("use_platform_key")) and balance > 0
            is_linked = using
            cad_ready = using
            email = ""
            plan = f"${balance / 100:.2f} credits" if balance else "Studio credits"
            if using:
                auth_status = "signed_in"
            elif balance > 0:
                auth_status = "verified"
            else:
                auth_status = "not_signed_in"
        elif pid == "openai":
            is_linked = cli_on or bool(row)
            cad_ready = cli_on or bool(key)
            email = str(auth.get("account_email") or (row or {}).get("account_email") or "")
            plan = str(auth.get("plan_label") or (row or {}).get("plan_label") or "")
            auth_status = "not_signed_in"
            if cli_on:
                auth_status = "signed_in"
            elif str(auth.get("status") or "") in {"starting", "awaiting_browser", "error"}:
                auth_status = str(auth.get("status") or "starting")
            elif key:
                auth_status = "verified"
        else:
            is_linked = cli_on or bool(row)
            cad_ready = cli_on
            email = str(auth.get("account_email") or (row or {}).get("account_email") or "")
            plan = str(auth.get("plan_label") or (row or {}).get("plan_label") or "")
            auth_status = "signed_in" if cli_on else "not_signed_in"
            if not cli_on and auth.get("status") in {"starting", "awaiting_browser", "error"}:
                auth_status = auth["status"]
        if is_linked:
            connected += 1
        providers.append({
            **meta,
            "connected": is_linked,
            "account_email": email,
            "plan_label": plan,
            "connected_at": (row or {}).get("connected_at"),
            "has_api_key": bool(key),
            "api_key_name": (key or {}).get("name") or "",
            "api_key_model": (key or {}).get("model") or "",
            "auth_status": auth_status,
            "cad_ready": cad_ready,
            "needs_code": bool(auth.get("needs_code")) if pid == "claude" else False,
            "login_url": (auth.get("login_url") or "") if pid == "claude" else (auth.get("login_url") or meta.get("login_url")),
            "auth_error": auth.get("error") or "",
            "cli_available": bool(auth.get("available")) if pid != "cloud" else False,
            "chatgpt": chatgpt if pid == "openai" else None,
            "cursor": None,
            "claude": None,
            "credits": credits_blob,
            "balance_cents": int(credits.get("balance_cents") or 0) if pid == "cloud" else None,
        })
    return {
        "providers": providers,
        "connected_count": connected,
        "chatgpt": chatgpt,
        "cursor": cursor,
        "claude": claude,
        "credits": credits,
    }


def connect_subscription(
    user_id: str,
    provider: str,
    *,
    account_email: str | None = None,
    plan_label: str | None = None,
) -> dict[str, Any]:
    pid = normalize_provider(provider)
    if pid == "cloud":
        from backend.services import ai_credit_service

        ai_credit_service.update_settings(user_id, use_platform_key=True)
        return list_subscriptions(user_id)
    email = str(account_email or "").strip()[:160]
    plan = str(plan_label or "").strip()[:80]
    now = _now()
    with get_conn() as conn:
        _ensure_table(conn)
        existing = conn.execute(
            "SELECT connected_at FROM ai_subscriptions WHERE user_id = ? AND provider = ?",
            (user_id, pid),
        ).fetchone()
        connected_at = existing["connected_at"] if existing else now
        conn.execute(
            """
            INSERT INTO ai_subscriptions (user_id, provider, account_email, plan_label, connected_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                account_email = excluded.account_email,
                plan_label = excluded.plan_label,
                updated_at = excluded.updated_at
            """,
            (user_id, pid, email, plan, connected_at, now),
        )
        conn.commit()
    return list_subscriptions(user_id)


def disconnect_subscription(user_id: str, provider: str) -> dict[str, Any]:
    pid = normalize_provider(provider)
    if pid == "cloud":
        try:
            from backend.services import ai_credit_service

            ai_credit_service.update_settings(user_id, use_platform_key=False)
        except Exception:
            pass
        return list_subscriptions(user_id)
    if pid == "openai":
        try:
            from backend.services import chatgpt_codex_auth

            chatgpt_codex_auth.logout_chatgpt(user_id)
        except Exception:
            pass
    elif pid == "cursor":
        try:
            from backend.services import cursor_cli_auth

            cursor_cli_auth.logout_cursor(user_id)
        except Exception:
            pass
    elif pid == "claude":
        try:
            from backend.services import claude_cli_auth

            claude_cli_auth.logout_claude(user_id)
        except Exception:
            pass
    with get_conn() as conn:
        _ensure_table(conn)
        conn.execute(
            "DELETE FROM ai_subscriptions WHERE user_id = ? AND provider = ?",
            (user_id, pid),
        )
        conn.commit()
    return list_subscriptions(user_id)
