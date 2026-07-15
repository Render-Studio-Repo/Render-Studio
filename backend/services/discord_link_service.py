"""Discord account linking and bot DM helpers."""

from __future__ import annotations

import urllib.parse
from datetime import datetime, timezone
from typing import Any

import httpx

from backend.config import settings
from backend.database import get_conn
from backend.services.social_oauth import create_oauth_state
from backend.services import discord_updates_service as discord

AUTH_URL = "https://discord.com/oauth2/authorize"
TOKEN_URL = "https://discord.com/api/oauth2/token"
API_BASE = "https://discord.com/api/v10"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_id() -> str:
    return (settings.discord_client_id or settings.discord_application_id or "").strip()


def configured() -> bool:
    return bool(_client_id() and (settings.discord_client_secret or "").strip() and (settings.discord_redirect_uri or "").strip())


def link_url(user_id: str) -> str:
    if not configured():
        raise RuntimeError("Discord OAuth is not configured.")
    state = create_oauth_state(user_id)
    params = {
        "client_id": _client_id(),
        "redirect_uri": settings.discord_redirect_uri,
        "response_type": "code",
        "scope": "identify",
        "state": state,
        "prompt": "consent",
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def _exchange_code(code: str) -> dict[str, Any]:
    resp = httpx.post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.discord_redirect_uri,
        },
        auth=(_client_id(), settings.discord_client_secret),
        headers={"Accept": "application/json"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def _discord_user(access_token: str) -> dict[str, Any]:
    resp = httpx.get(
        f"{API_BASE}/users/@me",
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def avatar_url(row: dict[str, Any]) -> str | None:
    uid = str(row.get("id") or "").strip()
    avatar = str(row.get("avatar") or "").strip()
    if not uid or not avatar:
        return None
    ext = "gif" if avatar.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/avatars/{uid}/{avatar}.{ext}?size=128"


def upsert_link(user_id: str, code: str) -> dict[str, Any]:
    if not configured():
        raise RuntimeError("Discord OAuth is not configured.")
    token = _exchange_code(code)
    access_token = str(token.get("access_token") or "")
    if not access_token:
        raise RuntimeError("Discord did not return an access token.")
    profile = _discord_user(access_token)
    discord_user_id = str(profile.get("id") or "").strip()
    if not discord_user_id:
        raise RuntimeError("Discord did not return a user id.")
    username = str(profile.get("global_name") or profile.get("username") or "Discord user").strip()
    handle = str(profile.get("username") or username).strip()
    picture = avatar_url(profile)
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO social_accounts
               (provider, provider_user_id, user_id, email, display_name, picture_url, created_at, updated_at)
               VALUES ('discord', ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(provider, provider_user_id) DO UPDATE SET
                 user_id = excluded.user_id,
                 email = excluded.email,
                 display_name = excluded.display_name,
                 picture_url = excluded.picture_url,
                 updated_at = excluded.updated_at
            """,
            (discord_user_id, user_id, handle, username, picture, now, now),
        )
    return {"discord_user_id": discord_user_id, "username": username, "handle": handle, "avatar_url": picture}


def linked_account(user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT provider_user_id, email, display_name, picture_url, updated_at
                 FROM social_accounts
                WHERE provider = 'discord' AND user_id = ?
                ORDER BY updated_at DESC
                LIMIT 1""",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "discord_user_id": row["provider_user_id"],
        "handle": row["email"],
        "display_name": row["display_name"],
        "avatar_url": row["picture_url"],
        "updated_at": row["updated_at"],
    }


def unlink(user_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM social_accounts WHERE provider = 'discord' AND user_id = ?", (user_id,))


def status(user: dict[str, Any]) -> dict[str, Any]:
    account = linked_account(user["id"])
    bot_status = discord.connection_status()
    return {
        "configured": configured(),
        "connected": bool(account),
        "account": account,
        "bot": bot_status,
        "requires": {
            "oauth_redirect_uri": settings.discord_redirect_uri,
            "oauth_scopes": ["identify"],
            "bot_permissions": ["Send Messages", "Embed Links", "Read Message History"],
            "gateway_intents": ["Guilds", "Guild Messages", "Direct Messages", "Message Content"],
            "note": "Mentions/DM alerts require a running Discord Gateway listener in addition to this account link.",
        },
    }


def send_dm(discord_user_id: str, content: str) -> dict[str, Any]:
    dm = discord._api("/users/@me/channels", method="POST", body={"recipient_id": str(discord_user_id)})
    channel_id = dm.get("id")
    if not channel_id:
        raise RuntimeError("Discord did not return a DM channel.")
    return discord.send_channel_message(
        {"content": str(content or "")[:1900], "allowed_mentions": {"parse": []}},
        channel_id=str(channel_id),
    )
