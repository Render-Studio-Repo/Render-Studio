"""Post Render Studio product updates to a Discord channel via bot token."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

API_BASE = "https://discord.com/api/v10"
USER_AGENT = "Render3DUpdatesBot (https://render3d.app, 1.0)"
POSTED_STATE = ROOT_DIR / "data" / "discord_posted_updates.json"
PUBLIC_BASE = (getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")


DEFAULT_UPDATES_CHANNEL_ID = "1512906649822560508"


def _token() -> str:
    return (getattr(settings, "discord_bot_token", None) or "").strip()


def _channel_id() -> str:
    return (
        getattr(settings, "discord_updates_channel_id", None) or DEFAULT_UPDATES_CHANNEL_ID
    ).strip() or DEFAULT_UPDATES_CHANNEL_ID


def default_share_channel_id() -> str:
    """Preferred Share to Discord channel from DISCORD_UPDATES_CHANNEL_ID."""
    return _channel_id()


def _webhook_url() -> str:
    return (getattr(settings, "discord_updates_webhook_url", None) or "").strip()


def configured() -> bool:
    """Bot token+channel, or a channel webhook URL."""
    return bool(_webhook_url()) or bool(_token() and _channel_id())


def invite_url() -> str:
    """Bot invite with View + Send + Embed Links + Attach Files."""
    client_id = (getattr(settings, "discord_application_id", None) or "").strip() or "1527052867742076958"
    # 1024 view + 2048 send + 16384 embed links + 32768 attach files
    return f"https://discord.com/oauth2/authorize?client_id={client_id}&permissions=52224&scope=bot"


def _load_posted() -> set[str]:
    if not POSTED_STATE.is_file():
        return set()
    try:
        data = json.loads(POSTED_STATE.read_text(encoding="utf-8"))
        ids = data.get("ids") if isinstance(data, dict) else data
        return {str(x) for x in (ids or []) if x}
    except Exception:
        return set()


def _save_posted(ids: set[str]) -> None:
    POSTED_STATE.parent.mkdir(parents=True, exist_ok=True)
    POSTED_STATE.write_text(
        json.dumps(
            {
                "ids": sorted(ids),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _api(path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    token = _token()
    if not token:
        raise RuntimeError("DISCORD_BOT_TOKEN is not configured")
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return json.loads(raw)
    except urllib.error.HTTPError as err:
        detail = ""
        try:
            detail = err.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            pass
        raise RuntimeError(f"Discord API {err.code}: {detail or err}") from err


def bot_identity() -> dict[str, Any]:
    return _api("/users/@me")


def connection_status() -> dict[str, Any]:
    out: dict[str, Any] = {
        "configured": configured(),
        "channel_id": _channel_id() or None,
        "webhook_configured": bool(_webhook_url()),
        "invite_url": invite_url(),
        "bot": None,
        "guild_count": 0,
        "channel_ok": False,
        "error": None,
    }
    if _webhook_url():
        out["channel_ok"] = True
        out["via"] = "webhook"
        return out
    if not (_token() and _channel_id()):
        out["error"] = (
            "Missing Discord credentials. Set DISCORD_UPDATES_WEBHOOK_URL, "
            "or DISCORD_BOT_TOKEN + DISCORD_UPDATES_CHANNEL_ID"
        )
        return out
    try:
        me = bot_identity()
        out["bot"] = {"id": me.get("id"), "username": me.get("username")}
        out["via"] = "bot"
        guilds = _api("/users/@me/guilds")
        if isinstance(guilds, list):
            out["guild_count"] = len(guilds)
        try:
            ch = _api(f"/channels/{_channel_id()}")
            out["channel_ok"] = True
            out["channel_name"] = ch.get("name")
            out["guild_id"] = ch.get("guild_id")
        except Exception as err:
            out["error"] = str(err)
            if out["guild_count"] == 0:
                out["error"] = (
                    "Bot is not in any Discord server yet. "
                    f"Invite it first: {invite_url()} "
                    "(or set DISCORD_UPDATES_WEBHOOK_URL for the updates channel)"
                )
    except Exception as err:
        out["error"] = str(err)
    return out


def _absolute_url(path: str | None) -> str | None:
    if not path:
        return None
    p = str(path).strip()
    if not p:
        return None
    if p.startswith("http://") or p.startswith("https://"):
        return p
    if not p.startswith("/"):
        p = "/" + p
    return f"{PUBLIC_BASE}{p}"


def build_update_payload(update: dict[str, Any]) -> dict[str, Any]:
    title = str(update.get("title") or update.get("id") or "Update").strip()
    summary = str(update.get("summary") or "").strip()
    kind = str(update.get("kind") or "feature").strip().lower() or "feature"
    date_s = str(update.get("date") or datetime.now(timezone.utc).date().isoformat())
    href = _absolute_url(update.get("href") or "/updates.html")
    visual = _absolute_url(update.get("visual"))
    color = {
        "feature": 0x58A6FF,
        "tool": 0x3FB950,
        "fix": 0xF85149,
        "improve": 0xD2A8FF,
    }.get(kind, 0x58A6FF)

    kind_label = {
        "feature": "Feature",
        "tool": "Tool",
        "fix": "Fix",
        "improve": "Improve",
    }.get(kind, kind.title())

    embed: dict[str, Any] = {
        "title": title[:256],
        "description": (summary or "New Render Studio update.")[:4000],
        "color": color,
        "timestamp": f"{date_s}T12:00:00.000Z" if len(date_s) == 10 else datetime.now(timezone.utc).isoformat(),
        "footer": {"text": f"Render Studio · {kind_label}"},
        "fields": [
            {"name": "Type", "value": f"**{kind_label}**", "inline": True},
        ],
    }
    if href:
        embed["url"] = href
        embed["fields"].append({"name": "Open", "value": f"[View update]({href})", "inline": True})
    if visual:
        embed["image"] = {"url": visual}

    author_handle = str(update.get("author_handle") or "").strip().lstrip("@")
    if author_handle:
        profile = f"{PUBLIC_BASE}/u/{author_handle}"
        embed["fields"].append(
            {
                "name": "Author",
                "value": f"[@{author_handle}]({profile})",
                "inline": True,
            }
        )
        content = f"**{kind_label}** · **New Render Studio update** · [@{author_handle}]({profile})"
    else:
        content = f"**{kind_label}** · **New Render Studio update**"
    return {"content": content, "embeds": [embed], "allowed_mentions": {"parse": []}}


def send_channel_message(payload: dict[str, Any], *, channel_id: str | None = None) -> dict[str, Any]:
    webhook = _webhook_url()
    if webhook and not channel_id:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            webhook,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8") or "{}"
                return json.loads(raw) if raw.strip() else {"ok": True}
        except urllib.error.HTTPError as err:
            detail = ""
            try:
                detail = err.read().decode("utf-8", errors="replace")[:800]
            except Exception:
                pass
            raise RuntimeError(f"Discord webhook {err.code}: {detail or err}") from err

    channel = (channel_id or _channel_id()).strip()
    if not channel:
        raise RuntimeError("DISCORD_UPDATES_CHANNEL_ID is not configured")
    if not _token():
        raise RuntimeError("DISCORD_BOT_TOKEN is not configured")
    return _api(f"/channels/{channel}/messages", method="POST", body=payload)


DISCORD_TEXT_CHANNEL_TYPES = {0, 5}  # GUILD_TEXT, GUILD_ANNOUNCEMENT
DISCORD_DM_CHANNEL_TYPES = {1, 3}  # DM, GROUP_DM


def _user_row(user: dict[str, Any] | None, *, nick: str = "", dm_channel_id: str = "") -> dict[str, Any] | None:
    if not isinstance(user, dict) or user.get("bot"):
        return None
    uid = str(user.get("id") or "").strip()
    if not uid:
        return None
    username = str(user.get("username") or "").strip() or "user"
    display = str(nick or user.get("global_name") or username).strip() or username
    row: dict[str, Any] = {
        "id": uid,
        "name": display,
        "username": username,
        "kind": "user",
        "preferred": False,
    }
    if dm_channel_id:
        row["dm_channel_id"] = dm_channel_id
    return row


def _collect_dm_users() -> list[dict[str, Any]]:
    try:
        channels = _api("/users/@me/channels")
    except Exception:
        return []
    if not isinstance(channels, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ch in channels:
        if not isinstance(ch, dict) or ch.get("type") not in DISCORD_DM_CHANNEL_TYPES:
            continue
        dm_id = str(ch.get("id") or "").strip()
        recips = ch.get("recipients") if isinstance(ch.get("recipients"), list) else []
        for user in recips:
            row = _user_row(user if isinstance(user, dict) else None, dm_channel_id=dm_id)
            if not row or row["id"] in seen:
                continue
            seen.add(row["id"])
            out.append(row)
    return out


def _collect_guild_users(guild_id: str, query: str) -> list[dict[str, Any]]:
    q = str(query or "").strip()
    members: Any = None
    if q:
        qs = urllib.parse.urlencode({"query": q[:32], "limit": 25})
        try:
            members = _api(f"/guilds/{guild_id}/members/search?{qs}")
        except Exception:
            members = None
        if not isinstance(members, list):
            try:
                members = _api(f"/guilds/{guild_id}/members?limit=40")
            except Exception:
                return []
    else:
        try:
            members = _api(f"/guilds/{guild_id}/members?limit=40")
        except Exception:
            return []
    if not isinstance(members, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for member in members:
        if not isinstance(member, dict):
            continue
        user = member.get("user") if isinstance(member.get("user"), dict) else None
        row = _user_row(user, nick=str(member.get("nick") or ""))
        if not row or row["id"] in seen:
            continue
        seen.add(row["id"])
        out.append(row)
    return out


def open_dm_channel(user_id: str) -> dict[str, Any]:
    """Open (or reuse) a DM with a user. Never returns DISCORD_BOT_TOKEN."""
    uid = str(user_id or "").strip()
    if not uid:
        raise RuntimeError("A Discord user id is required")
    ch = _api("/users/@me/channels", method="POST", body={"recipient_id": uid})
    if not isinstance(ch, dict):
        raise RuntimeError("Could not open Discord DM")
    cid = str(ch.get("id") or "").strip()
    if not cid:
        raise RuntimeError("Could not open Discord DM")
    return ch


def send_dm_message_with_file(
    content: str,
    *,
    user_id: str,
    filename: str | None = None,
    file_bytes: bytes | None = None,
    mime: str | None = None,
) -> dict[str, Any]:
    ch = open_dm_channel(user_id)
    return send_channel_message_with_file(
        content,
        filename=filename,
        channel_id=str(ch.get("id") or ""),
        file_bytes=file_bytes,
        mime=mime,
    )


def list_share_channels(query: str | None = None) -> dict[str, Any]:
    """Guild text channels + DM users the bot can see. Never returns DISCORD_BOT_TOKEN."""
    preferred = _channel_id()
    empty = {
        "ok": False,
        "configured": False,
        "channels": [],
        "users": [],
        "default_channel_id": preferred or None,
        "default_guild_id": None,
        "error": "DISCORD_BOT_TOKEN is not configured",
    }
    if not _token():
        return empty
    try:
        guilds = _api("/users/@me/guilds")
    except Exception as err:
        return {
            "ok": False,
            "configured": True,
            "channels": [],
            "users": [],
            "default_channel_id": preferred or None,
            "default_guild_id": None,
            "error": str(err)[:240],
        }
    if not isinstance(guilds, list):
        guilds = []
    q = str(query or "").strip().lower()
    out: list[dict[str, Any]] = []
    users: list[dict[str, Any]] = []
    seen_users: set[str] = set()
    default_guild_id = None
    for guild in guilds:
        gid = str(guild.get("id") or "").strip()
        gname = str(guild.get("name") or "Server").strip() or "Server"
        if not gid:
            continue
        try:
            channels = _api(f"/guilds/{gid}/channels")
        except Exception:
            channels = []
        if isinstance(channels, list):
            for ch in channels:
                ctype = ch.get("type") if isinstance(ch, dict) else None
                cid = str((ch or {}).get("id") or "").strip() if isinstance(ch, dict) else ""
                if not cid or ctype not in DISCORD_TEXT_CHANNEL_TYPES:
                    continue
                name = str(ch.get("name") or "channel").strip() or "channel"
                if q and q not in name.lower() and q not in gname.lower() and q not in cid:
                    continue
                is_pref = bool(preferred and cid == preferred)
                if is_pref:
                    default_guild_id = gid
                out.append(
                    {
                        "id": cid,
                        "name": name,
                        "guild_id": gid,
                        "guild_name": gname,
                        "kind": "channel",
                        "preferred": is_pref,
                    }
                )
        for row in _collect_guild_users(gid, str(query or "").strip()):
            if row["id"] in seen_users:
                continue
            if q and q not in str(row.get("name") or "").lower() and q not in str(row.get("username") or "").lower():
                continue
            seen_users.add(row["id"])
            users.append(row)
    for row in _collect_dm_users():
        if row["id"] in seen_users:
            continue
        if q and q not in str(row.get("name") or "").lower() and q not in str(row.get("username") or "").lower():
            continue
        seen_users.add(row["id"])
        users.append(row)
    if preferred and not any(c.get("id") == preferred for c in out):
        meta_name = "updates"
        meta_guild = ""
        try:
            ch = _api(f"/channels/{preferred}")
            if isinstance(ch, dict):
                meta_name = str(ch.get("name") or meta_name).strip() or meta_name
                meta_guild = str(ch.get("guild_id") or "").strip()
                default_guild_id = default_guild_id or meta_guild or None
        except Exception:
            pass
        if not q or q in meta_name.lower() or q in preferred:
            out.insert(
                0,
                {
                    "id": preferred,
                    "name": meta_name,
                    "guild_id": meta_guild,
                    "guild_name": "Discord",
                    "kind": "channel",
                    "preferred": True,
                },
            )
    out.sort(key=lambda row: (not row.get("preferred"), str(row.get("guild_name") or ""), str(row.get("name") or "")))
    users.sort(key=lambda row: str(row.get("name") or "").lower())
    return {
        "ok": True,
        "configured": True,
        "channels": out,
        "users": users,
        "default_channel_id": preferred or None,
        "default_guild_id": default_guild_id,
    }


def send_channel_message_with_file(
    content: str,
    file_path: Path | None = None,
    *,
    filename: str | None = None,
    channel_id: str | None = None,
    file_bytes: bytes | None = None,
    mime: str | None = None,
) -> dict[str, Any]:
    """Post text + one attachment via bot API or webhook (multipart)."""
    import mimetypes
    import uuid

    data = file_bytes
    name = filename or "clip.mp4"
    if data is None:
        path = Path(file_path) if file_path is not None else None
        if path is None or not path.is_file():
            raise FileNotFoundError(str(file_path))
        name = filename or path.name
        data = path.read_bytes()
        mime = mime or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    else:
        mime = mime or mimetypes.guess_type(name)[0] or "application/octet-stream"
    payload = {"content": str(content or "")[:2000], "allowed_mentions": {"parse": []}}
    boundary = f"----RenderStudio{uuid.uuid4().hex}"
    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="payload_json"\r\n')
    body.extend(b"Content-Type: application/json\r\n\r\n")
    body.extend(json.dumps(payload).encode())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}\r\n".encode())
    safe_name = str(name).replace('"', "_")[:180]
    body.extend(
        f'Content-Disposition: form-data; name="files[0]"; filename="{safe_name}"\r\n'.encode()
    )
    body.extend(f"Content-Type: {mime}\r\n\r\n".encode())
    body.extend(data)
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())

    channel = str(channel_id or "").strip() or _channel_id()
    webhook = _webhook_url()
    if webhook and not channel_id:
        url = webhook if "wait=" in webhook else (
            f"{webhook}{'&' if '?' in webhook else '?'}wait=true"
        )
        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": USER_AGENT,
        }
    else:
        token = _token()
        if not channel or not token:
            raise RuntimeError("DISCORD_BOT_TOKEN and a channel id are required")
        url = f"{API_BASE}/channels/{channel}/messages"
        headers = {
            "Authorization": f"Bot {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": USER_AGENT,
        }

    req = urllib.request.Request(url, data=bytes(body), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return json.loads(raw) if raw.strip() else {"ok": True}
    except urllib.error.HTTPError as err:
        detail = ""
        try:
            detail = err.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            pass
        raise RuntimeError(f"Discord multipart {err.code}: {detail or err}") from err


def announce_update(update: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
    """Post one product update embed. Skips if already posted unless force=True."""
    if not configured():
        return {"ok": False, "skipped": True, "reason": "not_configured"}
    uid = str(update.get("id") or "").strip()
    posted = _load_posted()
    if uid and uid in posted and not force:
        return {"ok": True, "skipped": True, "reason": "already_posted", "id": uid}
    msg = send_channel_message(build_update_payload(update))
    if uid:
        posted.add(uid)
        _save_posted(posted)
    return {"ok": True, "skipped": False, "id": uid or None, "message_id": msg.get("id")}


def announce_updates(updates: list[dict[str, Any]], *, force: bool = False) -> dict[str, Any]:
    results = []
    for row in updates:
        try:
            results.append(announce_update(row, force=force))
        except Exception as err:
            results.append({"ok": False, "id": row.get("id"), "error": str(err)})
    return {
        "ok": all(r.get("ok") for r in results) if results else True,
        "posted": sum(1 for r in results if r.get("ok") and not r.get("skipped")),
        "skipped": sum(1 for r in results if r.get("skipped")),
        "failed": sum(1 for r in results if not r.get("ok")),
        "results": results,
    }


def announce_text(content: str) -> dict[str, Any]:
    text = str(content or "").strip()
    if not text:
        raise ValueError("content is required")
    msg = send_channel_message({"content": text[:1900], "allowed_mentions": {"parse": []}})
    return {"ok": True, "message_id": msg.get("id")}
