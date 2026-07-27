"""Post Render Studio product updates to a Discord channel via bot token."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

API_BASE = "https://discord.com/api/v10"
USER_AGENT = "Render3DUpdatesBot (https://render3d.app, 1.0)"
POSTED_STATE = ROOT_DIR / "data" / "discord_posted_updates.json"
PUBLIC_BASE = (getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")


def _token() -> str:
    return (getattr(settings, "discord_bot_token", None) or "").strip()


def _channel_id() -> str:
    return (getattr(settings, "discord_updates_channel_id", None) or "").strip()


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


def _api(path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
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


def send_channel_message_with_file(
    content: str,
    file_path: Path,
    *,
    filename: str | None = None,
) -> dict[str, Any]:
    """Post text + one attachment via bot API or webhook (multipart)."""
    import mimetypes
    import uuid

    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(str(path))
    name = filename or path.name
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    payload = {"content": str(content or "")[:2000], "allowed_mentions": {"parse": []}}
    boundary = f"----Render Studio{uuid.uuid4().hex}"
    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="payload_json"\r\n')
    body.extend(b"Content-Type: application/json\r\n\r\n")
    body.extend(json.dumps(payload).encode())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(
        f'Content-Disposition: form-data; name="files[0]"; filename="{name}"\r\n'.encode()
    )
    body.extend(f"Content-Type: {mime}\r\n\r\n".encode())
    body.extend(path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())

    webhook = _webhook_url()
    if webhook:
        url = webhook if "wait=" in webhook else (
            f"{webhook}{'&' if '?' in webhook else '?'}wait=true"
        )
        headers = {
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": USER_AGENT,
        }
    else:
        channel = _channel_id()
        token = _token()
        if not channel or not token:
            raise RuntimeError("Discord bot token/channel or webhook required")
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
