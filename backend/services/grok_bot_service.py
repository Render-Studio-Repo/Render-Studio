"""Grok bot authorized app: xAI chat + per-user X developer-app keys.

Grok bot is the named Authorized apps row. X consumer key/secret live on the
Supabase Users row (`x_consumer_key` / `x_consumer_secret`) that the X-keys
agent stored — this module reads those when present and never clears them on
disconnect. Optional xAI keys come from the user's AI key library or a pasted
`XAI_API_KEY` on connect.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
import requests

from backend.config import settings
from backend.database import get_conn
from backend.services.user_ai_keys_service import (
    _decrypt,
    _encrypt,
    add_key,
    key_hint,
    normalize_provider,
)

logger = logging.getLogger("render3d.grok_bot")

XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions"
X_TWEETS_URL = "https://api.twitter.com/2/tweets"
DEFAULT_MODEL = "grok-4.5"
MCP_START = "python3 mcp/grok-bot/server.py --http --host 127.0.0.1 --port 8744"
MCP_HTTP = "https://render3d.app/mcp"
MCP_HTTP_LOCAL = "http://127.0.0.1:8744/mcp"
LAUNCH_AGENT = "com.render3d.grok-bot"

WIRING_STEPS = (
    "Create or open your X developer app at https://developer.x.com (Keys and tokens). You already have a Consumer Key and Consumer Key Secret.",
    "In Render Studio open Preferences → Advanced → Authorized apps and find Grok bot.",
    "Click Connect. If Consumer Key is already stored on your account, Connect enables the bot. Otherwise paste Consumer Key, then paste Consumer Key Secret in Settings (the secret is never shown again).",
    "Optional: paste an xAI API key (starts with xai-) in the same Grok bot form, or add Grok under AI & Billing. Studio uses that key for Grok chat.",
    "LaunchAgent com.render3d.grok-bot keeps HTTP MCP on http://127.0.0.1:8744/mcp (starts at login, restarts on crash).",
    "Cloudflare tunnel exposes the same server at https://render3d.app/mcp. Use Authorization: Bearer GROK_MCP_TOKEN (never put the token in git).",
    "Add the Grok bot MCP to Cursor using the mcp.json snippet (stdio) or the HTTP url. No secrets in the file — put keys in env or leave them on Studio.",
    "Restart Cursor MCP (or reload the window). In chat, ask Grok bot to grok_status, then grok_chat. Tweets stay drafts unless you confirm a post.",
    "Inbound X mentions/DMs: Account Activity webhook GET/POST https://render3d.app/api/webhooks/x (alias /api/x/webhook). Register in the X developer portal or python3 scripts/register-x-webhook.py (prints curl; pass --register only when you intend to call X).",
    "New GIFs/clips: POST https://render3d.app/mcp/clips with {\"title\",\"prompt\"}. GET https://render3d.app/mcp/clips for every URL + repo path. POST https://render3d.app/mcp/clips/{id}/grab after the bot copies the file (MCP tools grok_request_clip / grok_clips / grok_clip_grab). Never paid Generate.",
    "Music: grok_music_request (song name + reason). Official/Topic/VEVO first; never clean/cover/instrumental. After the live URL, grok_social_post, then check in days 1–3 and weekly × 4. Weekly report: grok_social_weekly. Taste files: grok_taste. Dashboard: Management → Social media.",
    "Team bus: reach the live Cursor/RM with MCP rm_queue as yourself. GET https://render3d.app/mcp/rm-inbox. agent_converse as cursor-engineer is COMM_NO_WAKE (does not wake the IDE).",
    "Test: grok_status should show X app connected (hint only) and/or Grok key saved. Do not post a live tweet from a test.",
    "DIMOS: Preferences → Grok bot → Connect to DIMOS. Paste robot PC LAN IP (e.g. 192.168.1.77). API: GET/POST /api/integrations/grok-bot/dimos. MCP: grok_dimos_status / grok_dimos_connect. Does not move joints.",
)

WIRING_DIAGRAM = """Cloudflare  https://render3d.app/mcp
                 |
                 v
launchd KeepAlive --> grok-bot/server.py --http :8744
Cursor  --stdio MCP-->  grok-bot/server.py
              \\--HTTP MCP-->  http://127.0.0.1:8744/mcp
                              |
                 +------------+------------+
                 |                          |
            xAI API                    X API
         XAI_API_KEY            Users.x_consumer_key
         (Grok chat)            + Consumer Key Secret / xcbot_
                                (bot / Share to X)
X Account Activity --> GET/POST https://render3d.app/api/webhooks/x
                       CRC + HMAC --> grok_bot inbound (draft unless AUTO_REPLY)
Clip board --> GET/POST https://render3d.app/mcp/clips
               POST /mcp/clips/{id}/grab after the bot copies the GIF
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_grok_bot (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                x_consumer_key_enc TEXT,
                x_consumer_secret_enc TEXT,
                xai_key_enc TEXT,
                x_bot_token_enc TEXT,
                connected_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        cols = {str(r[1]) for r in conn.execute("PRAGMA table_info(user_grok_bot)").fetchall()}
        if "x_bot_token_enc" not in cols:
            conn.execute("ALTER TABLE user_grok_bot ADD COLUMN x_bot_token_enc TEXT")


def wiring_payload() -> dict[str, Any]:
    return {
        "title": "How to wire Grok bot",
        "steps": list(WIRING_STEPS),
        "diagram": WIRING_DIAGRAM,
        "mcp_start": MCP_START,
        "mcp_http": MCP_HTTP,
        "mcp_http_local": MCP_HTTP_LOCAL,
        "launch_agent": LAUNCH_AGENT,
        "clips_board": MCP_HTTP + "/clips",
        "clip_create": "POST https://render3d.app/mcp/clips",
        "clip_grab": "POST https://render3d.app/mcp/clips/{id}/grab",
        "mcp_json": mcp_json_snippet(),
        "env": [
            "XAI_API_KEY — xAI Grok API key (optional if saved in Studio)",
            "X_CONSUMER_KEY — X developer Consumer Key (optional if stored on your user)",
            "X_CONSUMER_SECRET — paste Consumer Key Secret in Settings or env; never commit it",
            "X_WEBHOOK_PATH — public Account Activity path (default /api/webhooks/x)",
            "X_WEBHOOK_ENV — premium AAAPI environment label from developer.x.com",
            "RENDER_STUDIO_URL — http://127.0.0.1:8001 or https://render3d.app",
            "GROK_MCP_TOKEN — Bearer token for https://render3d.app/mcp (never commit it)",
            "GROK_MUSIC_API_KEY — Bearer token for /api/marketing/v1 (never commit it; live value is only in gitignored Marketing/GROK.md)",
        ],
        "never": "Never put Consumer Key Secret in mcp.json, git, logs, or the Authorized apps copy.",
    }


def mcp_json_snippet() -> dict[str, Any]:
    return {
        "mcpServers": {
            "grok-bot": {
                "command": "python3",
                "args": ["/Users/sam/Render-Studio/mcp/grok-bot/server.py"],
                "env": {
                    "PYTHONPATH": "/Users/sam/Render-Studio",
                    "RENDER_STUDIO_URL": "http://127.0.0.1:8001",
                    "GROK_MODEL": DEFAULT_MODEL,
                    "XAI_API_KEY": "",
                    "X_CONSUMER_KEY": "",
                    "X_CONSUMER_SECRET": "",
                },
            }
        }
    }


def _sqlite_row(user_id: str) -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT enabled, x_consumer_key_enc, x_consumer_secret_enc, xai_key_enc, x_bot_token_enc, connected_at FROM user_grok_bot WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return {}
    keys = row.keys() if hasattr(row, "keys") else []
    return {
        "enabled": bool(int(row["enabled"] or 0)),
        "x_consumer_key_enc": row["x_consumer_key_enc"],
        "x_consumer_secret_enc": row["x_consumer_secret_enc"],
        "xai_key_enc": row["xai_key_enc"],
        "x_bot_token_enc": row["x_bot_token_enc"] if "x_bot_token_enc" in keys else None,
        "connected_at": row["connected_at"],
    }


def _load_x_keys(user_id: str) -> tuple[str, str] | None:
    uid = str(user_id or "").strip()
    if not uid:
        return None
    try:
        from backend.services import supabase_users_store as sbusers

        stored = sbusers.x_consumer_credentials(uid)
        if stored:
            key, secret = str(stored[0] or "").strip(), str(stored[1] or "").strip()
            if key and secret:
                return key, secret
    except Exception:
        logger.debug("grok bot supabase x keys skipped", exc_info=True)
    row = _sqlite_row(uid)
    key = _decrypt(row.get("x_consumer_key_enc"))
    secret = _decrypt(row.get("x_consumer_secret_enc"))
    if key and secret:
        return key, secret
    return None


def _store_x_keys(user_id: str, key: str, secret: str) -> None:
    uid = str(user_id or "").strip()
    consumer_key = str(key or "").strip()
    consumer_secret = str(secret or "").strip()
    if not uid or not consumer_key or not consumer_secret:
        raise ValueError("Paste Consumer Key and paste Consumer Key Secret in Settings.")
    remote_ok = False
    try:
        from backend.services import supabase_users_store as sbusers

        remote_ok = bool(sbusers.set_x_consumer_credentials(uid, consumer_key, consumer_secret))
    except Exception:
        logger.warning("grok bot supabase x key write skipped", exc_info=True)
    ensure_schema()
    enc_key = _encrypt(consumer_key)
    enc_secret = _encrypt(consumer_secret)
    now = _now()
    with get_conn() as conn:
        existing = conn.execute("SELECT enabled FROM user_grok_bot WHERE user_id = ?", (uid,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE user_grok_bot
                SET x_consumer_key_enc = ?, x_consumer_secret_enc = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (enc_key, enc_secret, now, uid),
            )
        else:
            conn.execute(
                """
                INSERT INTO user_grok_bot
                  (user_id, enabled, x_consumer_key_enc, x_consumer_secret_enc, updated_at)
                VALUES (?, 0, ?, ?, ?)
                """,
                (uid, enc_key, enc_secret, now),
            )
    if not remote_ok:
        logger.debug("grok bot x keys stored locally for %s", uid)


def _load_bot_token(user_id: str) -> str:
    uid = str(user_id or "").strip()
    if not uid:
        return ""
    try:
        from backend.services import supabase_users_store as sbusers

        remote = sbusers.x_bot_token(uid)
        if remote:
            return remote
    except Exception:
        logger.debug("grok bot supabase bot token skipped", exc_info=True)
    return _decrypt(_sqlite_row(uid).get("x_bot_token_enc"))


def _store_bot_token(user_id: str, token: str) -> None:
    uid = str(user_id or "").strip()
    raw = str(token or "").strip()
    if not uid or not raw:
        raise ValueError("Paste the X chat bot token (starts with xcbot_).")
    if not raw.startswith("xcbot_"):
        raise ValueError("X chat bot token should start with xcbot_.")
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.set_x_bot_token(uid, raw)
    except Exception:
        logger.debug("grok bot supabase bot token write skipped", exc_info=True)
    ensure_schema()
    now = _now()
    enc = _encrypt(raw)
    with get_conn() as conn:
        existing = conn.execute("SELECT enabled FROM user_grok_bot WHERE user_id = ?", (uid,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE user_grok_bot SET x_bot_token_enc = ?, updated_at = ? WHERE user_id = ?",
                (enc, now, uid),
            )
        else:
            conn.execute(
                """
                INSERT INTO user_grok_bot (user_id, enabled, x_bot_token_enc, updated_at)
                VALUES (?, 0, ?, ?)
                """,
                (uid, enc, now),
            )


def _set_enabled(user_id: str, enabled: bool) -> None:
    uid = str(user_id or "").strip()
    ensure_schema()
    now = _now()
    with get_conn() as conn:
        existing = conn.execute("SELECT connected_at FROM user_grok_bot WHERE user_id = ?", (uid,)).fetchone()
        connected_at = existing["connected_at"] if existing and existing["connected_at"] else (now if enabled else None)
        if not existing:
            conn.execute(
                """
                INSERT INTO user_grok_bot (user_id, enabled, connected_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (uid, 1 if enabled else 0, connected_at if enabled else None, now),
            )
        else:
            conn.execute(
                """
                UPDATE user_grok_bot
                SET enabled = ?, connected_at = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (1 if enabled else 0, connected_at if enabled else existing["connected_at"], now, uid),
            )
    try:
        from backend.services import supabase_users_store as sbusers

        row = sbusers.get_by_id(uid) or {}
        blob = row.get("settings")
        if isinstance(blob, str):
            try:
                blob = json.loads(blob)
            except Exception:
                blob = {}
        if not isinstance(blob, dict):
            blob = {}
        grok = dict(blob.get("grok_bot") or {}) if isinstance(blob.get("grok_bot"), dict) else {}
        grok["enabled"] = bool(enabled)
        grok["updated_at"] = now
        if enabled:
            grok["connected_at"] = grok.get("connected_at") or now
        blob = {**blob, "grok_bot": grok}
        sbusers.patch_user(uid, settings=blob)
    except Exception:
        logger.debug("grok bot settings patch skipped", exc_info=True)


def _remote_enabled(user_id: str) -> bool | None:
    try:
        from backend.services import supabase_users_store as sbusers

        row = sbusers.get_by_id(user_id) or {}
        blob = row.get("settings")
        if isinstance(blob, str):
            try:
                blob = json.loads(blob)
            except Exception:
                blob = {}
        grok = blob.get("grok_bot") if isinstance(blob, dict) else None
        if isinstance(grok, dict) and "enabled" in grok:
            return bool(grok.get("enabled"))
    except Exception:
        logger.debug("grok bot remote enabled skipped", exc_info=True)
    return None


def _resolve_xai_key(user_id: str) -> tuple[str | None, str | None]:
    """Return (api_key, source). Never logs the key."""
    uid = str(user_id or "").strip()
    row = _sqlite_row(uid)
    extra = _decrypt(row.get("xai_key_enc"))
    if extra:
        return extra, "grok_bot"
    try:
        from backend.services import supabase_users_store as sbusers

        for item in sbusers.personal_keys(uid):
            if normalize_provider(item.get("provider")) != "xai":
                continue
            api_key = _decrypt(str(item.get("ciphertext") or item.get("api_key_enc") or ""))
            if api_key:
                return api_key, "ai_library"
    except Exception:
        logger.debug("grok bot remote xai lookup skipped", exc_info=True)
    try:
        from backend.services import user_ai_keys_service

        for item in user_ai_keys_service.list_keys(uid):
            if normalize_provider(item.get("provider")) != "xai":
                continue
            packed = user_ai_keys_service.get_effective_key_for_user(uid)
            if packed and normalize_provider(packed.get("provider")) == "xai" and packed.get("api_key"):
                return str(packed["api_key"]), "ai_library"
        personal = user_ai_keys_service.get_user_settings(uid)
        if normalize_provider(personal.get("provider")) == "xai" and personal.get("api_key"):
            return str(personal["api_key"]), "ai_library"
    except Exception:
        logger.debug("grok bot local xai lookup skipped", exc_info=True)
    env = (getattr(settings, "xai_api_key", None) or "").strip()
    if env:
        return env, "server"
    return None, None


def _store_xai_key(user_id: str, api_key: str) -> None:
    key = str(api_key or "").strip()
    if not key:
        return
    try:
        add_key(user_id, "xai", key, name="Grok bot", activate=False)
    except Exception:
        logger.debug("grok bot xai library save skipped", exc_info=True)
        ensure_schema()
        now = _now()
        with get_conn() as conn:
            existing = conn.execute("SELECT enabled FROM user_grok_bot WHERE user_id = ?", (user_id,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE user_grok_bot SET xai_key_enc = ?, updated_at = ? WHERE user_id = ?",
                    (_encrypt(key), now, user_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO user_grok_bot (user_id, enabled, xai_key_enc, updated_at)
                    VALUES (?, 0, ?, ?)
                    """,
                    (user_id, _encrypt(key), now),
                )


def _safe_status_payload(user_id: str) -> dict[str, Any]:
    x_keys = _load_x_keys(user_id)
    xai_key, xai_source = _resolve_xai_key(user_id)
    remote_on = _remote_enabled(user_id)
    local = _sqlite_row(user_id)
    enabled = bool(remote_on) if remote_on is not None else bool(local.get("enabled"))
    bot_token = _load_bot_token(user_id)
    has_x = bool(x_keys)
    has_bot = bool(bot_token)
    has_xai = bool(xai_key)
    connected = bool(enabled and (has_x or has_bot or has_xai))
    x_hint = key_hint(x_keys[0]) if x_keys else None
    grok_hint = key_hint(xai_key) if xai_key else None
    bot_hint = key_hint(bot_token) if bot_token else None
    if connected:
        bits = []
        if has_xai:
            bits.append("Grok chat ready")
        if has_bot:
            bits.append(f"X chat bot {bot_hint or 'saved'}")
        if has_x:
            bits.append(f"X developer app {x_hint or 'saved'}")
        detail = " · ".join(bits) or "Grok bot connected"
    elif has_x or has_bot or has_xai:
        detail = "Stored keys ready — Connect to enable Grok bot for Cursor MCP and chat"
    else:
        detail = "Paste Consumer Key in Settings, optional xAI key for Grok chat"
    return {
        "key": "grok_bot",
        "label": "Grok bot",
        "configured": True,
        "connected": connected,
        "enabled": enabled,
        "has_x_app": has_x,
        "has_x_bot": has_bot,
        "has_xai_key": has_xai,
        "x_consumer_key_hint": x_hint,
        "x_bot_token_hint": bot_hint,
        "xai_key_hint": grok_hint,
        "xai_source": xai_source if has_xai else None,
        "model": (getattr(settings, "xai_model", None) or DEFAULT_MODEL),
        "mcp_start": MCP_START,
        "wiring": wiring_payload(),
        "detail": detail,
        "needs_keys": not has_x and not has_bot and not has_xai,
        "can_chat": has_xai,
        "can_post": has_x or has_bot,
        "music_api": f"{getattr(settings, 'public_base_url', 'https://render3d.app')}/api/marketing/v1",
        "music_key_configured": bool(str(getattr(settings, "grok_music_api_key", "") or "").strip()),
        "dimos": _dimos_status_slice(user_id),
    }


def _dimos_status_slice(user_id: str) -> dict[str, Any]:
    try:
        from backend.services import grok_dimos_link

        link = grok_dimos_link.get_link(user_id)
        return {
            "linked": bool(link.get("linked")),
            "host": link.get("host") or "",
            "upstream": link.get("upstream") or "",
            "teleop_url": link.get("teleop_url") or "",
            "studio_pipe": link.get("studio_pipe") or "",
        }
    except Exception:
        return {"linked": False, "host": "", "upstream": ""}


def status(user: dict[str, Any]) -> dict[str, Any]:
    uid = str((user or {}).get("id") or "")
    return _safe_status_payload(uid)


def connect(user: dict[str, Any], body: dict[str, Any] | None = None) -> dict[str, Any]:
    uid = str((user or {}).get("id") or "")
    if not uid:
        raise ValueError("Sign in to connect Grok bot.")
    body = body or {}
    consumer_key = str(
        body.get("consumer_key") or body.get("x_consumer_key") or ""
    ).strip()
    consumer_secret = str(
        body.get("consumer_secret")
        or body.get("consumer_key_secret")
        or body.get("x_consumer_secret")
        or ""
    ).strip()
    xai_key = str(body.get("xai_api_key") or body.get("grok_api_key") or "").strip()
    bot_token = str(
        body.get("bot_token")
        or body.get("x_bot_token")
        or body.get("xchat_bot_token")
        or ""
    ).strip()
    if consumer_key and consumer_secret:
        _store_x_keys(uid, consumer_key, consumer_secret)
    if bot_token:
        _store_bot_token(uid, bot_token)
    if xai_key:
        _store_xai_key(uid, xai_key)
    if not _load_x_keys(uid) and not _load_bot_token(uid) and not xai_key and not _resolve_xai_key(uid)[0]:
        raise ValueError("Paste an X chat bot token (xcbot_), Consumer Key + Secret, or a Grok API key.")
    _set_enabled(uid, True)
    return status(user)


def disconnect(user: dict[str, Any]) -> dict[str, Any]:
    """Disable Grok bot. Does not delete stored X consumer keys."""
    uid = str((user or {}).get("id") or "")
    if not uid:
        raise ValueError("Sign in to disconnect Grok bot.")
    _set_enabled(uid, False)
    return status({"id": uid})


def chat(user: dict[str, Any], prompt: str, *, system: str | None = None, model: str | None = None) -> dict[str, Any]:
    uid = str((user or {}).get("id") or "")
    text = str(prompt or "").strip()
    if not text:
        raise ValueError("Enter a message for Grok.")
    api_key, source = _resolve_xai_key(uid)
    if not api_key:
        raise ValueError("Connect Grok bot and add a Grok / xAI API key (AI & Billing or the Grok bot form).")
    chosen = (model or getattr(settings, "xai_model", None) or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    messages: list[dict[str, str]] = []
    sys = str(system or "").strip()
    if sys:
        messages.append({"role": "system", "content": sys})
    messages.append({"role": "user", "content": text})
    resp = httpx.post(
        XAI_CHAT_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": chosen, "messages": messages, "temperature": 0.7},
        timeout=90,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Grok API error HTTP {resp.status_code}")
    data = resp.json() or {}
    choice = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return {
        "ok": True,
        "model": chosen,
        "source": source,
        "text": str(choice),
    }


INBOUND_SYSTEM = (
    "You are the Render Studio Grok bot on X. Reply briefly and helpfully. "
    "Do not reveal secrets, API keys, or tokens. If they ask to generate CAD, "
    "tell them to open https://render3d.app and paste the prompt — never start a "
    "Studio generation from a public mention."
)


def enabled_user_ids() -> list[str]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute("SELECT user_id FROM user_grok_bot WHERE enabled = 1").fetchall()
    return [str(r["user_id"]) for r in rows if r and r["user_id"]]


def _studio_user_for_inbound(for_user_id: str) -> dict[str, Any] | None:
    tid = str(for_user_id or "").strip()
    if tid:
        try:
            from backend.services import twitter_link_service

            uid = twitter_link_service.studio_user_id_for_twitter(tid)
            if uid:
                return {"id": uid}
        except Exception:
            logger.debug("grok bot twitter user lookup skipped", exc_info=True)
    ids = enabled_user_ids()
    if ids:
        return {"id": ids[0]}
    return None


def handle_inbound_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Draft Grok replies for Account Activity mentions/DMs. Live post only if AUTO_REPLY."""
    results: list[dict[str, Any]] = []
    auto = bool(getattr(settings, "x_webhook_auto_reply", False))
    for raw in messages or []:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind") or "mention")
        text = str(raw.get("text") or "").strip()
        for_user = str(raw.get("for_user_id") or "")
        tweet_id = str(raw.get("tweet_id") or "")
        user = _studio_user_for_inbound(for_user)
        if not user:
            results.append({"kind": kind, "status": "no_bot_user", "tweet_id": tweet_id})
            continue
        if not text:
            results.append({"kind": kind, "status": "empty", "tweet_id": tweet_id})
            continue
        try:
            chat_out = chat(
                user,
                text,
                system=INBOUND_SYSTEM,
            )
            draft_text = str(chat_out.get("text") or "").strip()[:280]
            posted = False
            post_id = ""
            if draft_text:
                post_out = draft_or_post(
                    user,
                    draft_text,
                    confirm=auto and kind == "mention",
                    reply_to=tweet_id if kind == "mention" else None,
                )
                posted = bool(post_out.get("posted"))
                post_id = str(post_out.get("id") or "")
            results.append(
                {
                    "kind": kind,
                    "status": "posted" if posted else "drafted",
                    "tweet_id": tweet_id,
                    "posted": posted,
                    "post_id": post_id,
                    "dry_run": not posted,
                }
            )
        except Exception as exc:
            logger.warning("grok bot inbound %s failed: %s", kind, exc)
            results.append({"kind": kind, "status": "error", "tweet_id": tweet_id, "error": str(exc)[:160]})
    return results


def _tweet_json(caption: str, reply_to: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"text": caption}
    tid = str(reply_to or "").strip()
    if tid:
        payload["reply"] = {"in_reply_to_tweet_id": tid}
    return payload


def draft_or_post(
    user: dict[str, Any],
    text: str,
    *,
    confirm: bool = False,
    reply_to: str | None = None,
) -> dict[str, Any]:
    """Post to X only when confirm=True. Tests must leave confirm false."""
    uid = str((user or {}).get("id") or "")
    caption = str(text or "").strip()
    if not caption:
        raise ValueError("Enter tweet text.")
    if len(caption) > 280:
        raise ValueError("Tweet text must be 280 characters or less.")
    bot_token = _load_bot_token(uid)
    if not bot_token and not _load_x_keys(uid):
        raise ValueError("Connect Grok bot with an X chat bot token (xcbot_) or Consumer Key first.")
    if not confirm:
        return {
            "ok": True,
            "dry_run": True,
            "posted": False,
            "text": caption,
            "message": "Draft only — not posted. Confirm in Authorized apps / MCP to publish.",
        }
    body = _tweet_json(caption, reply_to)
    if bot_token:
        tweet = httpx.post(
            X_TWEETS_URL,
            headers={
                "Authorization": f"Bearer {bot_token}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=60,
        )
    else:
        from backend.services import twitter_link_service

        creds = twitter_link_service.get_user_auth(uid)
        if creds.get("mode") == "oauth1":
            tweet = requests.post(
                X_TWEETS_URL,
                auth=creds["auth"],
                json=body,
                headers={"Content-Type": "application/json"},
                timeout=60,
            )
        else:
            tweet = httpx.post(
                X_TWEETS_URL,
                headers={
                    "Authorization": f"Bearer {creds.get('access_token')}",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=60,
            )
    if tweet.status_code >= 400:
        raise RuntimeError(f"X post failed HTTP {tweet.status_code}")
    data = (tweet.json() or {}).get("data") or {}
    return {"ok": True, "dry_run": False, "posted": True, "id": str(data.get("id") or "")}
