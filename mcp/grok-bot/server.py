#!/usr/bin/env python3
"""Grok bot MCP — stdio JSON-RPC or localhost HTTP.

Talks to xAI Grok for chat and optionally drafts X posts. Secrets come from
env or Render Studio (per-user X consumer keys + Grok key). Never logs secrets.

Stdio is for Cursor's spawned MCP. `--http` is the LaunchAgent mode so the
server stays up across reboot and crash (`com.render3d.grok-bot`).
"""

from __future__ import annotations

import argparse
import base64
import hmac
import json
import os
import re
import shutil
import sys
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

PROTOCOL = "2024-11-05"
SERVER_NAME = "grok-bot"
SERVER_VERSION = "20260916-26"
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
AI_CONTEXT_SKILLS = REPO_ROOT / "ai-context" / "skills"
MARKETING_MD = HERE / "MARKETING.md"


def _skill_text(skill: str, filename: str = "SKILL.md") -> str:
    """Prefer canonical ai-context skills; fall back to mcp/grok-bot/skills."""
    for root in (AI_CONTEXT_SKILLS, HERE / "skills"):
        path = root / skill / filename
        if path.is_file():
            return path.read_text(encoding="utf-8")
    return ""
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


_CLIP = None


def _clip_harness():
    global _CLIP
    if _CLIP is not None:
        return _CLIP
    import importlib.util

    spec = importlib.util.spec_from_file_location("grok_clip_harness", HERE / "clip_harness.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("clip_harness.py missing")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _CLIP = mod
    return _CLIP


XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8744
DOTENV_KEYS = (
    "XAI_API_KEY",
    "XAI_MODEL",
    "GROK_MODEL",
    "X_CONSUMER_KEY",
    "X_CONSUMER_SECRET",
    "XCHAT_BOT_TOKEN",
    "X_BOT_TOKEN",
    "TWITTER_CLIENT_ID",
    "TWITTER_CLIENT_SECRET",
    "TWITTER_BEARER_TOKEN",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_TOKEN_SECRET",
    "RENDER_STUDIO_URL",
    "RENDER_STUDIO_TOKEN",
    "RENDER3D_TOKEN",
    "GROK_MCP_HOST",
    "GROK_MCP_PORT",
    "GROK_MCP_TOKEN",
    "GROK_MUSIC_API_KEY",
    "OPENAI_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
)

KEY_INDEX_NAMES = (
    ("X_CONSUMER_KEY", "x-developer", "vibe-marketing", "OAuth 1.0a API key. Not enough to tweet."),
    ("X_CONSUMER_SECRET", "x-developer", "vibe-marketing", "API secret. CRC/webhook. Never log."),
    ("TWITTER_CLIENT_ID", "x-developer", "vibe-marketing", "OAuth 2.0 client id."),
    ("TWITTER_CLIENT_SECRET", "x-developer", "vibe-marketing", "OAuth 2.0 secret."),
    ("TWITTER_BEARER_TOKEN", "x-developer", "vibe-marketing", "App-only bearer. Read/webhook. Cannot tweet (403)."),
    ("TWITTER_ACCESS_TOKEN", "x-developer", "cursor-engineer", "User access token. Required to tweet."),
    ("TWITTER_ACCESS_TOKEN_SECRET", "x-developer", "cursor-engineer", "User access secret. Required to tweet."),
    ("XCHAT_BOT_TOKEN", "x-bot", "cursor-engineer", "User tweet bearer (xcbot_ / oauth2 user)."),
    ("X_BOT_TOKEN", "x-bot", "cursor-engineer", "Alias of XCHAT_BOT_TOKEN."),
    ("RENDER_STUDIO_TOKEN", "studio", "cursor-engineer", "Lets grok-bot call Studio x-post."),
    ("GROK_MCP_TOKEN", "mcp", "cursor-engineer", "Bearer for /mcp. Not an X tweet key."),
)

WIRING_STEPS = [
    "Create or open your X developer app at https://developer.x.com (Keys and tokens).",
    "In Render Studio open Preferences → Advanced → Authorized apps → Grok bot.",
    "Click Connect. Paste Consumer Key if it is not already stored. Paste Consumer Key Secret in Settings only — it is never shown again.",
    "Optional: paste an xAI API key (starts with xai-) on the Grok bot form, or add Grok under AI & Billing.",
    "Install LaunchAgent com.render3d.grok-bot (RunAtLoad + KeepAlive). It serves http://127.0.0.1:8744/mcp and restarts on reboot or crash.",
    "Cloudflare tunnel routes https://render3d.app/mcp → that local HTTP MCP. Header: Authorization Bearer GROK_MCP_TOKEN.",
    "Add this server to Cursor mcp.json (stdio snippet or url http://127.0.0.1:8744/mcp). Leave secret env values empty in the file.",
    "Reload Cursor. Call grok_status, then grok_marketing (features/assets), then grok_chat. Tweets stay drafts unless confirm is true.",
    "Need a GIF: POST https://render3d.app/mcp/clips with {title, prompt}. GET that URL for every file path + public link. POST /mcp/clips/{id}/grab after the bot copies the file. MCP tools: grok_request_clip, grok_clips, grok_clip_grab. Never paid Generate.",
    "Music for posts: grok_music_request with the song name + reason (x_post / instagram_post / linkedin_post). Prefer official/Topic/VEVO; never clean/cover/instrumental. After the live URL, grok_social_post then check in days 1–3 and weekly × 4. Weekly: grok_social_weekly. Taste: grok_taste.",
    "Team bus: specialists speak as themselves. Reach the live Cursor/RM harness with tools/call rm_queue {agent:<you>, text, tickets?}. GET https://render3d.app/mcp/rm-inbox. agent_converse as cursor-engineer is COMM_NO_WAKE and does not wake the IDE. Optional comms_webhook_register → POST /mcp/comms-hook. Codes: COMM_QUEUED, COMM_NO_WAKE, COMM_FANOUT_OK, COMM_FANOUT_FAIL, COMM_BROADCAST.",
    "Do not post a live tweet from a test.",
]


def _env(name: str) -> str:
    return str(os.environ.get(name) or "").strip()


def _default_model() -> str:
    return _env("GROK_MODEL") or _env("XAI_MODEL") or "grok-4.5"


def _load_dotenv_keys(path: Path | None = None) -> None:
    """Copy only Grok/X keys from .env. Never log values."""
    env_path = path or (REPO_ROOT / ".env")
    if not env_path.is_file():
        return
    try:
        text = env_path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key not in DOTENV_KEYS or _env(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


def _studio_url() -> str:
    return (_env("RENDER_STUDIO_URL") or "http://127.0.0.1:8001").rstrip("/")


def _studio_token() -> str:
    return _env("RENDER_STUDIO_TOKEN") or _env("RENDER3D_TOKEN")


def _http_json(method: str, url: str, *, body: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: int = 90) -> dict[str, Any]:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method=method)
    req.add_header("Accept", "application/json")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        if value:
            req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:240]
        raise RuntimeError(f"HTTP {exc.code}: {detail or exc.reason}") from exc
    if not raw:
        return {}
    data = json.loads(raw)
    return data if isinstance(data, dict) else {"data": data}


def _studio(path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    token = _studio_token()
    if not token:
        raise RuntimeError("Set RENDER_STUDIO_TOKEN to use Studio-stored keys.")
    try:
        return _http_json(
            method,
            f"{_studio_url()}{path}",
            body=body,
            headers={"Authorization": f"Bearer {token}"},
        )
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Studio connection error: {exc.reason}") from exc


def _debugger_offline():
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import debugger_offline as off

    return off


def _studio_then(
    path: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    action: str,
    args: dict[str, Any],
    data: dict[str, Any],
    kind: str = "read",
) -> dict[str, Any]:
    off = _debugger_offline()
    try:
        out = _studio(path, method=method, body=body)
        if isinstance(out, dict):
            out.setdefault("via", "studio")
        return out
    except Exception as exc:
        if not off.studio_unavailable(exc):
            raise
        if kind == "read":
            return off.local_read(action, args, data)
        return off.local_write(action, args, data)


def _music(path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    key = _env("GROK_MUSIC_API_KEY")
    if not key:
        raise RuntimeError("Set GROK_MUSIC_API_KEY in Studio .env. Private playbook: Marketing/GROK.md (never git).")
    return _http_json(
        method,
        f"{_studio_url()}{path}",
        body=body,
        headers={"Authorization": f"Bearer {key}"},
        timeout=300,
    )


def _music_meta() -> dict[str, Any]:
    return {
        "music_api": f"{_studio_url()}/api/marketing/v1",
        "music_key_configured": bool(_env("GROK_MUSIC_API_KEY")),
        "music_rules": "Prefer official/Topic/VEVO; else most popular. Never clean, cover, or instrumental. Always send reason. After the live post, grok_social_post then check in.",
    }


def grok_status() -> dict[str, Any]:
    extra = _music_meta()
    if _studio_token():
        try:
            out = _studio("/api/integrations/grok-bot/status")
            if isinstance(out, dict):
                out.update(extra)
                return out
        except Exception as exc:
            return {"connected": False, "detail": str(exc)[:200], "via": "studio", **extra}
    xai = bool(_env("XAI_API_KEY"))
    x_app = bool(_env("X_CONSUMER_KEY") and _env("X_CONSUMER_SECRET"))
    x_bot = bool(_env("XCHAT_BOT_TOKEN") or _env("X_BOT_TOKEN"))
    return {
        "connected": xai or x_app or x_bot,
        "has_xai_key": xai,
        "has_x_app": x_app,
        "has_x_bot": x_bot,
        "xai_key_hint": "...saved" if xai else None,
        "x_consumer_key_hint": "...saved" if x_app else None,
        "x_bot_token_hint": "...saved" if x_bot else None,
        "via": "env",
        "model": _default_model(),
        "clip_inbox": "data/grok-bot/harness-inbox.md",
        "clip_jobs": "data/grok-bot/clips/",
        "clip_board": "https://render3d.app/mcp/clips",
        "wiring": {"steps": WIRING_STEPS},
        **extra,
    }


def grok_chat(prompt: str, system: str | None = None, model: str | None = None) -> dict[str, Any]:
    text = str(prompt or "").strip()
    if not text:
        raise ValueError("prompt is required")
    if _studio_token():
        return _studio(
            "/api/integrations/grok-bot/chat",
            method="POST",
            body={"prompt": text, "system": system or "", "model": model or _default_model()},
        )
    api_key = _env("XAI_API_KEY")
    if not api_key:
        raise RuntimeError("Set XAI_API_KEY or RENDER_STUDIO_TOKEN (with Grok connected in Studio).")
    messages: list[dict[str, str]] = []
    if str(system or "").strip():
        messages.append({"role": "system", "content": str(system).strip()})
    messages.append({"role": "user", "content": text})
    data = _http_json(
        "POST",
        XAI_CHAT_URL,
        body={"model": (model or _default_model()), "messages": messages, "temperature": 0.7},
        headers={"Authorization": f"Bearer {api_key}"},
    )
    choice = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return {"ok": True, "model": model or _default_model(), "text": str(choice), "via": "env"}


def grok_wiring() -> dict[str, Any]:
    if _studio_token():
        try:
            out = _studio("/api/integrations/grok-bot/wiring")
            if isinstance(out, dict):
                out.setdefault("via", "studio")
                return out
        except Exception as exc:
            return {"ok": False, "error": str(exc)[:200], "via": "studio"}
    try:
        from backend.services import grok_bot_service as gbs

        out = gbs.wiring_payload()
        out["via"] = "local"
        return out
    except Exception as exc:
        return {
            "ok": True,
            "via": "env",
            "mcp_http_local": "http://127.0.0.1:8744/mcp",
            "error": str(exc)[:120],
            "note": "Studio wiring unavailable — use Preferences → Grok bot.",
        }


def grok_dimos_status(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Saved DIMOS host for this Grok bot user. Never moves joints."""
    _ = args
    if not _studio_token():
        return {
            "ok": False,
            "error": "RENDER_STUDIO_TOKEN required — call Studio GET /api/integrations/grok-bot/dimos",
            "api": {
                "get": "GET /api/integrations/grok-bot/dimos",
                "connect": 'POST /api/integrations/grok-bot/dimos {"host":"192.168.1.77"}',
                "studio_ws": "/api/dimos/ws?upstream=wss://HOST:8443/ws",
            },
        }
    try:
        return _studio("/api/integrations/grok-bot/dimos")
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240], "via": "studio"}


def grok_dimos_connect(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Save robot PC LAN IP and probe :8443. Does not arm teleop."""
    args = args or {}
    host = str(args.get("host") or args.get("ip") or args.get("upstream") or "").strip()
    if not host:
        return {"ok": False, "error": "host required — e.g. 192.168.1.77"}
    if not _studio_token():
        return {"ok": False, "error": "RENDER_STUDIO_TOKEN required"}
    try:
        return _studio(
            "/api/integrations/grok-bot/dimos",
            method="POST",
            body={"host": host, "probe": bool(args.get("probe", True))},
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240], "via": "studio"}


def grok_dimos_probe(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    host = str(args.get("host") or args.get("ip") or args.get("upstream") or "").strip()
    if not _studio_token():
        return {"ok": False, "error": "RENDER_STUDIO_TOKEN required"}
    try:
        return _studio(
            "/api/integrations/grok-bot/dimos/probe",
            method="POST",
            body={"host": host} if host else {},
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240], "via": "studio"}


MUJOCO_RUN_PATH = "openarm-mujoco/runs/latest.json"
ROBOTICS_RUNBOOK_PATH = "examples/robotics-runbook.md"


def grok_mujoco_run(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Read last MuJoCo end-of-run analysis (token mujoco1). Never moves joints."""
    _ = args
    try:
        raw = grok_sandbox({"action": "read", "path": MUJOCO_RUN_PATH})
    except Exception as exc:
        return {"ok": False, "token": "mujoco1", "path": MUJOCO_RUN_PATH, "error": str(exc)[:240]}
    if not raw.get("ok"):
        return {"ok": False, "token": "mujoco1", "path": MUJOCO_RUN_PATH, "error": "feed missing"}
    text = str(raw.get("text") or "").strip()
    if not text:
        return {
            "ok": False,
            "token": "mujoco1",
            "path": MUJOCO_RUN_PATH,
            "error": "empty feed — open MuJoCo tab, approve, snapshot or load scene",
        }
    try:
        sample = json.loads(text)
    except json.JSONDecodeError as exc:
        return {"ok": False, "token": "mujoco1", "path": MUJOCO_RUN_PATH, "error": f"invalid json: {exc}"}
    checks = sample.get("feature_checks") if isinstance(sample.get("feature_checks"), dict) else {}
    ik = sample.get("ik_errors") if isinstance(sample.get("ik_errors"), dict) else {}
    left = ik.get("left") if isinstance(ik.get("left"), dict) else {}
    right = ik.get("right") if isinstance(ik.get("right"), dict) else {}
    broken = [k for k, v in checks.items() if v == "broken"]
    return {
        "ok": True,
        "token": "mujoco1",
        "path": MUJOCO_RUN_PATH,
        "summary": {
            "run_reason": sample.get("run_reason"),
            "scene": sample.get("scene"),
            "observed_at": sample.get("observed_at"),
            "ik_left_mm": left.get("pos_mm"),
            "ik_right_mm": right.get("pos_mm"),
            "qvel_max": sample.get("qvel_max"),
            "standstill": sample.get("standstill"),
            "feature_checks": checks,
            "broken": broken,
        },
        "sample": sample,
    }


def grok_robotics_runbook(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Operator + agent instructions: Quest Y engage and MuJoCo MCP feed."""
    _ = args
    try:
        raw = grok_sandbox({"action": "read", "path": ROBOTICS_RUNBOOK_PATH})
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}
    if not raw.get("ok"):
        return {"ok": False, "error": "robotics runbook missing"}
    return {
        "ok": True,
        "token": "robotics1",
        "path": ROBOTICS_RUNBOOK_PATH,
        "text": str(raw.get("text") or "")[:120_000],
        "mujoco_feed": MUJOCO_RUN_PATH,
        "y_wiring": "examples/dimos-y-wiring.md",
    }

    if _studio_token():
        try:
            return _studio("/api/integrations/grok-bot/wiring")
        except Exception:
            pass
    return {
        "title": "How to wire Grok bot",
        "steps": WIRING_STEPS,
        "mcp_start": "python3 /Users/sam/Render-Studio/mcp/grok-bot/server.py --http --host 127.0.0.1 --port 8744",
        "mcp_http": "https://render3d.app/mcp",
        "mcp_http_local": f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/mcp",
        "launch_agent": "com.render3d.grok-bot",
        "marketing_md": str(MARKETING_MD),
        "clip_inbox": "data/grok-bot/harness-inbox.md",
        "clip_board": "https://render3d.app/mcp/clips",
        "clip_create": "POST https://render3d.app/mcp/clips",
        "clip_grab": "POST https://render3d.app/mcp/clips/{id}/grab",
        "clip_tool": "grok_request_clip",
        "music_api": f"{_studio_url()}/api/marketing/v1",
        "music_tools": ["grok_music_request", "grok_music_library", "grok_social_post", "grok_social_checkin", "grok_social_weekly", "grok_taste"],
        "never": "Never put Consumer Key Secret in mcp.json, git, logs, or the UI.",
        "x_post_note": "Cursor plugin-x-x has no create-tweet tool. Agents send grok_tweet_for_agent; Cursor posts with attribution when user tokens exist.",
    }


AUTH_LOG = REPO_ROOT / "ai-context" / "agent-bus" / "auth-events.jsonl"
PLUGIN_OWNER = {
    "plugin-gmail-gmail": "project-manager",
    "plugin-google-drive-google-drive": "project-manager",
    "plugin-google-calendar-google-calendar": "project-manager",
    "plugin-x-x": "vibe-marketing",
    "plugin-x-ads-x-ads": "vibe-marketing",
    "plugin-cloudinary-cloudinary-asset-mgmt": "vibe-marketing",
}


def grok_auth_event(args: dict[str, Any]) -> dict[str, Any]:
    """Log MCP connect events. Drop TOTP / tokens if someone tries to pass them."""
    plugin = str(args.get("plugin") or "").strip()[:120]
    if not plugin:
        raise ValueError("plugin is required")
    email = str(args.get("email") or "").strip()[:120]
    agent = str(args.get("agent") or PLUGIN_OWNER.get(plugin) or "").strip()[:64]
    status = str(args.get("status") or "connected").strip()[:32]
    source = str(args.get("source") or "cursor-mcp").strip()[:64]
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "plugin": plugin,
        "email": email,
        "agent": agent,
        "status": status,
        "source": source,
        "totp_stored": False,
    }
    AUTH_LOG.parent.mkdir(parents=True, exist_ok=True)
    with AUTH_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    return {"ok": True, "logged": row, "path": str(AUTH_LOG), "hint": "TOTP is never stored. Email + plugin + agent only."}


def grok_auth_status(limit: int | None = None) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    if AUTH_LOG.is_file():
        for line in AUTH_LOG.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    n = max(1, min(int(limit or 20), 100))
    return {"ok": True, "count": len(rows), "events": rows[-n:], "totp_stored": False}


GROUP_CHAT = REPO_ROOT / "frontend" / "docs" / "media" / "group-chat.jsonl"
GROUP_CHAT_IMAGES = REPO_ROOT / "frontend" / "docs" / "media" / "group-chat-images"
BOARD_VOTES = REPO_ROOT / "frontend" / "docs" / "media" / "board-votes.jsonl"
COLLAB_PAD = REPO_ROOT / "frontend" / "docs" / "media" / "collab-pad.json"
COLLAB_INDEX = REPO_ROOT / "frontend" / "docs" / "media" / "collab-index.json"
SLASH_SKILLS = REPO_ROOT / "frontend" / "docs" / "media" / "slash-skills.jsonl"
CHAT_TAGS = REPO_ROOT / "frontend" / "docs" / "media" / "chat-tags.jsonl"
CHAT_REPORTS = REPO_ROOT / "frontend" / "docs" / "media" / "board-reports.jsonl"
SANDBOX_DIR = REPO_ROOT / "frontend" / "sandbox"
CHAT_MEDIA_DIR = SANDBOX_DIR / "chat-media"
SANDBOX_TOKEN = "sandbox1"
HARNESS1_TOKEN = "harness1"
CHATUI_TOKEN = "chatui1"
SANDBOX3_TOKEN = "sandbox3"
SANDBOX4_TOKEN = "sandbox4"
VOICE_SELECT_PATH = SANDBOX_DIR / "voice-select.json"
VOICE_IDS = ("alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar")
VOICE1_TOKEN = "voice1"
DEFAULT_AGENT_VOICE = {
    "astra": "marin",
    "project-manager": "cedar",
    "cursor-engineer": "echo",
    "vibe-marketing": "coral",
    "vibe-sales": "verse",
    "vibe-rnd": "ash",
    "analytics": "sage",
    "clip-bot": "ballad",
}
AGENT_NATION = {
    "astra": "US",
    "vibe-marketing": "US",
    "cursor-engineer": "US",
    "project-manager": "UK",
    "vibe-rnd": "AU",
    "analytics": "IE",
    "clip-bot": "US",
    "vibe-sales": "UK",
}
SANDBOX_WRITE_EXT = {".js", ".html", ".css", ".md", ".txt", ".json", ".pdf", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"}
CHAT_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
CHAT_IMAGE_MAX = 1_200_000
CHAT_IMAGE_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
LEDGER_WHOIS = REPO_ROOT / "frontend" / "docs" / "media" / "ledger-whois.json"
LEDGER_CURSOR = REPO_ROOT / "data" / "grok-bot" / "ledger-cursor.json"
HELP_REQUESTS = REPO_ROOT / "frontend" / "docs" / "media" / "help-requests.jsonl"
MULE_OUTBOX = REPO_ROOT / "ai-context" / "agent-bus" / "mule-outbox.jsonl"
MULE_MAP = {
    "mule_server_id": "3706272",
    "mule_grok_id": "35c35c40-15de-41f4-8898-22f58e7d7717",
    "rooms": {
        "fire": "43413e04-d00a-48d0-b067-b1db235597d0",
        "autodebug": "65c81cf8-0b6a-4717-96f3-fcaef2adcaba",
    },
    "agents": {
        "harness-mule": "3706272",
        "project-manager": "b27a2ffd-bcb1-4af3-8b64-07f7db5bba08",
        "x-analytics": "f714d114-3e1e-4ebb-a6f4-8ab1985f336f",
        "grok-bot": "72427f7c-869a-41f9-a869-9b1d00e392bc",
        "vibe-marketing": "51eb38b1-17f5-4f9a-b990-e39abbf746ee",
        "vibe-rnd": "bc3d5362-d5b8-4694-858d-7cae62a0787a",
        "clip-bot": "5f39b7e0-564c-4ac0-9166-3a8bbe18506e",
        "ledger": "07211d60-f38e-465b-a960-8f9625221e1e",
        "discord": "782cadac-d68c-409e-b50f-1ab3ac141f23",
        "openforge-rnd": "938033b1-7d46-442e-bbb6-14695a507704",
        "algo-scout": "107105b8-770c-47ea-9fe6-b8a9b825c6e2",
        "cursor-engineer": "rm_queue",
    },
}

HELP_LIMITS = {
    "peer_asks_max": 2,
    "peer_wait_min": 10,
    "then": "ledger",
    "ask_sam_when": [
        "2FA / Gmail / TOTP",
        "money / Hub tweet.write / legal",
        "Ledger COMM-MISS after 2 peer asks",
        "STUMPED posted and no specialist CANNOT workaround",
    ],
    "do_not_ask_sam_first": ["fanout", "code", "IDs", "clips", "office 3D"],
}

LEDGER_WHO = {
    "sam": {"role": "founder", "nick": "Sam", "avatar": "", "talks_to": "everyone"},
    "cursor-engineer": {"role": "harness/RM", "nick": "Cursor", "avatar": "/docs/media/employees/avatar-cursor-engineer.png", "talks_to": "ledger"},
    "project-manager": {"role": "PM", "nick": "Bender", "avatar": "/docs/media/employees/avatar-project-manager.png", "talks_to": "crew"},
    "vibe-rnd": {"role": "RnD", "nick": "Rick", "avatar": "/docs/media/employees/avatar-vibe-rnd.png", "talks_to": "crew"},
    "vibe-marketing": {"role": "marketing", "nick": "Fry", "avatar": "/docs/media/employees/avatar-vibe-marketing.png", "talks_to": "crew"},
    "vibe-sales": {"role": "sales", "nick": "Closer", "avatar": "/docs/media/employees/avatar-sales.png", "talks_to": "crew"},
    "clip-bot": {"role": "print+cad", "nick": "Leela", "avatar": "/docs/media/employees/avatar-clip-bot.png", "talks_to": "crew"},
    "analytics": {"role": "analytics", "nick": "Clerk", "avatar": "/docs/media/employees/avatar-analytics.png", "talks_to": "crew"},
    "instruction-auditor": {"role": "auditor", "nick": "Visor", "avatar": "/docs/media/employees/avatar-auditor.png", "talks_to": "crew"},
    "comms-bridge": {"role": "comms", "nick": "Headset", "avatar": "/docs/media/employees/avatar-comms.png", "talks_to": "crew"},
    "harness-mule": {"role": "grok↔mcp mule", "nick": "Mule", "avatar": "", "talks_to": "rooms+rm_queue", "server_id": "3706272", "grok_id": "35c35c40-15de-41f4-8898-22f58e7d7717"},
    "x-analytics": {"role": "X analytics", "nick": "XA", "avatar": "", "talks_to": "mule", "grok_id": "f714d114-3e1e-4ebb-a6f4-8ab1985f336f"},
    "ledger": {"role": "relay+face-check", "nick": "Ledger", "avatar": "/docs/media/employees/avatar-auditor.png", "talks_to": "mcp+crew", "grok_id": "07211d60-f38e-465b-a960-8f9625221e1e"},
    "grok-bot": {"role": "mcp host", "nick": "GrokBot", "avatar": "", "talks_to": "mcp"},
    "algo-scout": {"role": "scout", "nick": "Scout", "avatar": "", "talks_to": "crew"},
    "discord": {"role": "discord", "nick": "Discord", "avatar": "", "talks_to": "crew"},
}


def _whois(agent: str) -> dict[str, str]:
    key = str(agent or "").strip().lower()
    row = dict(LEDGER_WHO.get(key) or {"role": "specialist", "nick": key or "unknown", "avatar": "", "talks_to": "crew"})
    row["agent"] = key or "unknown"
    return row


def _save_whois() -> None:
    LEDGER_WHOIS.parent.mkdir(parents=True, exist_ok=True)
    LEDGER_WHOIS.write_text(json.dumps({"ok": True, "who": {k: _whois(k) for k in LEDGER_WHO}}, indent=2) + "\n", encoding="utf-8")


def _ledger_rm(text: str, tickets: list[str] | None = None) -> None:
    try:
        from backend.services import mcp_watchdog_service as wd

        wd.rm_queue({"agent": "ledger", "text": text[:900], "tickets": tickets or []})
    except Exception:
        pass


def _ledger_fan(from_agent: str, text: str) -> None:
    who = _whois(from_agent)
    mentioned = re.findall(r"@([a-z0-9_-]{2,32})", text, flags=re.I)
    targets = [a.lower() for a in mentioned if a.lower() in LEDGER_WHO and a.lower() not in {"sam", "harness", "rm", "ledger"}]
    if from_agent in {"sam", "cursor-engineer"}:
        for default in ("project-manager", "vibe-rnd", "ledger"):
            if default not in targets:
                targets.append(default)
    targets = [t for t in targets if t != from_agent][:4]
    thread = grok_group_chat({"action": "read", "limit": 8})
    clip = "\n".join(f"{r.get('agent')}: {(r.get('text') or '')[:240]}" for r in (thread.get("messages") or []))
    for agent in targets:
        ident = _whois(agent)
        sys = (
            f"You are {ident['agent']} ({ident['nick']}, {ident['role']}). "
            "Talk on the group thread only. 4 lines max. No tweet ids. "
            "Ledger relays you to Cursor via MCP."
        )
        try:
            out = grok_chat(f"From {who['agent']} ({who['nick']}): {text[:700]}\nRecent:\n{clip}", system=sys)
            grok_group_chat({"action": "post", "agent": agent, "text": (out.get("text") or "")[:1400], "_ledger_skip": True})
        except Exception:
            continue


def _ledger_on_group_post(rec: dict[str, Any], skip_fan: bool = False) -> None:
    agent = str(rec.get("agent") or "")
    text = str(rec.get("text") or "")
    who = _whois(agent)
    label = f"{who['agent']} aka {who['nick']} ({who['role']})"
    _ledger_rm(
        f"LEDGER-RELAY {rec.get('log_id')} {label}: {text[:400]}",
        [str(rec.get("log_id") or "")],
    )
    if skip_fan or agent == "ledger":
        return
    if agent in {"sam", "cursor-engineer"} or re.search(r"@(harness|cursor-engineer|\brm\b)", text, re.I):
        threading.Thread(target=_ledger_fan, args=(agent, text), daemon=True).start()


def grok_ledger_relay(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    action = str(args.get("action") or "roster").strip().lower()
    _save_whois()
    if action in {"roster", "whois"}:
        return {"ok": True, "who": {k: _whois(k) for k in LEDGER_WHO}, "public": "https://render3d.app/mcp/ledger-relay"}
    if action == "tick":
        LEDGER_CURSOR.parent.mkdir(parents=True, exist_ok=True)
        prev = {}
        if LEDGER_CURSOR.is_file():
            try:
                prev = json.loads(LEDGER_CURSOR.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                prev = {}
        last_ts = str(prev.get("last_ts") or "")
        board = grok_group_chat({"action": "read", "limit": 80})
        rows = board.get("messages") or []
        fresh = [r for r in rows if str(r.get("ts") or "") > last_ts]
        if rows:
            LEDGER_CURSOR.write_text(json.dumps({"last_ts": rows[-1].get("ts"), "n": len(rows)}), encoding="utf-8")
        digest = [{"who": _whois(r.get("agent")), "ts": r.get("ts"), "log_id": r.get("log_id"), "text": (r.get("text") or "")[:240]} for r in fresh[-20:]]
        if digest:
            _ledger_rm("LEDGER-TICK " + json.dumps(digest)[:800])
            last_human = next((r for r in reversed(fresh) if r.get("agent") in {"sam", "cursor-engineer"}), None)
            if last_human:
                _ledger_fan(str(last_human.get("agent")), str(last_human.get("text") or ""))
        return {"ok": True, "fresh": len(fresh), "digest": digest, "who": {k: _whois(k) for k in LEDGER_WHO}}
    raise ValueError("action roster|whois|tick")


def _looks_like_image(blob: bytes) -> bool:
    if blob.startswith(b"\x89PNG\r\n\x1a\n") or blob.startswith(b"\xff\xd8"):
        return True
    if blob.startswith(b"GIF87a") or blob.startswith(b"GIF89a"):
        return True
    return len(blob) >= 12 and blob[:4] == b"RIFF" and blob[8:12] == b"WEBP"


def _chat_media_resolve(name: str) -> Path:
    raw = Path(str(name or "")).name
    if not raw or raw in {".", ".."}:
        raise ValueError("image path escapes jail")
    dest = (CHAT_MEDIA_DIR / raw).resolve()
    root = CHAT_MEDIA_DIR.resolve()
    if dest != root and root not in dest.parents:
        raise ValueError("image path escapes jail")
    if dest.suffix.lower() not in CHAT_IMAGE_EXTS:
        raise ValueError("unsupported image type")
    return dest


def _safe_image_url(url: str) -> bool:
    u = str(url or "").strip()
    if not u or len(u) > 400 or "://" in u or ".." in u:
        return False
    return bool(re.match(r"^/(sandbox/chat-media|docs/media/group-chat-images|mcp/group-chat/media)(/|\?).+", u))


def grok_group_chat_image(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    raw_b64 = str(args.get("b64") or args.get("data") or "")
    if raw_b64.startswith("data:") and "," in raw_b64:
        raw_b64 = raw_b64.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw_b64, validate=False)
    except Exception as exc:
        raise ValueError("invalid image") from exc
    if not blob or len(blob) > CHAT_IMAGE_MAX:
        raise ValueError("image too large or empty")
    if not _looks_like_image(blob):
        raise ValueError("unsupported image type")
    mime = str(args.get("mime") or "").lower()
    name = str(args.get("name") or "image.png")
    ext = Path(name).suffix.lower()
    if ext not in CHAT_IMAGE_EXTS:
        ext = {v: k for k, v in CHAT_IMAGE_MIME.items()}.get(mime, ".png")
        if ext == ".jpeg":
            ext = ".jpg"
    if ext not in CHAT_IMAGE_EXTS:
        raise ValueError("unsupported image type")
    fid = "img_" + uuid.uuid4().hex[:16] + ext
    dest = _chat_media_resolve(fid)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)
    public = GROUP_CHAT_IMAGES / fid
    public.parent.mkdir(parents=True, exist_ok=True)
    public.write_bytes(blob)
    return {
        "ok": True,
        "url": f"/sandbox/chat-media/{fid}",
        "alt_url": f"/docs/media/group-chat-images/{fid}",
        "name": fid,
        "bytes": len(blob),
        "token": CHATUI_TOKEN,
    }


def _read_group_chat_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if GROUP_CHAT.is_file():
        for line in GROUP_CHAT.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(rec, dict):
                rows.append(rec)
    return rows


def _fold_chat_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    order: list[dict[str, Any]] = []
    reacts: dict[str, dict[str, list[str]]] = {}
    for row in rows:
        if str(row.get("kind") or "") == "react":
            target = str(row.get("target") or "")
            emoji = str(row.get("emoji") or "")[:16]
            agent = str(row.get("agent") or "")
            if not target or not emoji:
                continue
            bucket = reacts.setdefault(target, {}).setdefault(emoji, [])
            if agent in bucket:
                bucket.remove(agent)
                if not bucket:
                    reacts[target].pop(emoji, None)
            else:
                bucket.append(agent)
            continue
        lid = str(row.get("log_id") or "")
        if lid:
            by_id[lid] = row
        order.append(row)
    for row in order:
        lid = str(row.get("log_id") or "")
        row["reactions"] = {emoji: list(agents) for emoji, agents in (reacts.get(lid) or {}).items() if agents}
        rid = str(row.get("reply_to") or "")
        if rid and rid in by_id:
            parent = by_id[rid]
            row.setdefault("reply_preview", (parent.get("text") or "")[:120])
            row.setdefault("reply_agent", parent.get("agent"))
    return order


def grok_group_chat(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    action = str(args.get("action") or "read").strip().lower()
    GROUP_CHAT.parent.mkdir(parents=True, exist_ok=True)
    if action == "upload":
        return grok_group_chat_image(args)
    if action == "react":
        agent = str(args.get("agent") or "").strip()[:40] or "unknown"
        target = str(args.get("target") or args.get("log_id") or "").strip()[:64]
        emoji = str(args.get("emoji") or "").strip()[:16]
        if not target or not emoji:
            raise ValueError("target and emoji are required")
        rec = {
            "kind": "react",
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "agent": agent,
            "target": target,
            "emoji": emoji,
            "log_id": "rxn_" + uuid.uuid4().hex[:12],
        }
        with GROUP_CHAT.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        return {"ok": True, "posted": rec, "token": CHATUI_TOKEN, "public": "https://render3d.app/team-chat.html"}
    if action == "post":
        agent = str(args.get("agent") or "").strip()[:40] or "unknown"
        text = str(args.get("text") or "").strip()[:1500]
        image = str(args.get("image") or args.get("image_url") or "").strip()[:400]
        image_alt = str(args.get("image_alt") or args.get("alt_url") or "").strip()[:400]
        reply_to = str(args.get("reply_to") or "").strip()[:64]
        if image and not _safe_image_url(image):
            raise ValueError("image url not allowed")
        if image_alt and not _safe_image_url(image_alt):
            image_alt = ""
        if not text and not image:
            raise ValueError("text or image is required")
        rec = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "agent": agent,
            "text": text,
            "log_id": "msg_gc_" + uuid.uuid4().hex[:12],
            "prompt_id": str(args.get("prompt_id") or ("prm_" + uuid.uuid4().hex[:10])),
            "tags": _extract_tags(text),
        }
        if image:
            rec["image"] = image
        if image_alt:
            rec["image_alt"] = image_alt
        if reply_to:
            rec["reply_to"] = reply_to
            preview = str(args.get("reply_preview") or "").strip()[:120]
            if preview:
                rec["reply_preview"] = preview
            reply_agent = str(args.get("reply_agent") or "").strip()[:40]
            if reply_agent:
                rec["reply_agent"] = reply_agent
        with GROUP_CHAT.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        if text and re.search(r"@(harness|cursor-engineer|\brm\b)", text, re.I):
            try:
                from backend.services import mcp_watchdog_service as wd

                wd.rm_queue({
                    "agent": agent,
                    "text": "WAKE " + rec["log_id"] + " " + text[:400],
                    "tickets": [rec["log_id"]],
                })
            except Exception:
                pass
        _ledger_on_group_post(rec, skip_fan=bool(args.get("_ledger_skip")))
        _ingest_vote_line(agent, text, rec.get("log_id"))
        _ingest_tags(rec)
        _ingest_report_line(agent, text, rec.get("log_id"))
        if text.startswith("/") and not args.get("_slash"):
            _run_slash(agent, text, rec.get("log_id"))
        if agent.lower() == "sam" and _is_sam_sandbox_correction(text) and not args.get("_skip_correct"):
            try:
                rec["sandbox_correct"] = grok_sandbox({
                    "action": "correct",
                    "agent": "sam",
                    "text": text,
                    "log_id": rec.get("log_id"),
                })
            except Exception:
                rec["sandbox_correct"] = {"ok": False}
        return {"ok": True, "posted": rec, "token": CHATUI_TOKEN, "public": "https://render3d.app/team-chat.html", "api": "https://render3d.app/mcp/group-chat"}
    rows = _fold_chat_rows(_read_group_chat_rows())
    n = max(1, min(int(args.get("limit") or 50), 200))
    return {"ok": True, "count": len(rows), "messages": rows[-n:], "token": CHATUI_TOKEN, "public": "https://render3d.app/team-chat.html"}


DECISION_VOTERS = (
    ("analytics", "Analytics", "measure"),
    ("project-manager", "PM", "ship"),
    ("vibe-rnd", "RnD", "probe"),
    ("clip-bot", "Clip-bot", "print"),
    ("ledger", "Ledger", "gate"),
    ("cursor-engineer", "Cursor", "patch"),
)
DECISION_CHOICES = {
    "debug": {"A": "probe", "B": "patch-now", "C": "wait-on-Sam"},
    "control": {"A": "bind-live", "B": "dry-run", "C": "revert"},
    "sandbox": {"A": "keep-on", "B": "hide-shapes", "C": "cede-harness"},
}


def grok_voice_select(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """GET/PUT seated agent + distinct TTS voice. Endpoint /mcp/sandbox/voice."""
    args = args or {}
    action = str(args.get("action") or args.get("method") or "get").strip().lower()
    roster: list[dict[str, Any]] = []
    used: set[str] = set()
    for key, voice in DEFAULT_AGENT_VOICE.items():
        roster.append({
            "id": key,
            "name": "Astra" if key == "astra" else (LEDGER_WHO.get(key) or {}).get("nick") or key,
            "voice": voice,
            "nation": AGENT_NATION.get(key, ""),
            "sex": "f" if key in {"astra", "vibe-marketing"} else "m",
        })
        used.add(voice)
    for i, (key, who) in enumerate(LEDGER_WHO.items()):
        if key in {"sam", "grok-bot", "astra"} or key in DEFAULT_AGENT_VOICE:
            continue
        voice = VOICE_IDS[i % len(VOICE_IDS)]
        hop = 0
        while voice in used and hop < len(VOICE_IDS):
            hop += 1
            voice = VOICE_IDS[(i + hop) % len(VOICE_IDS)]
        used.add(voice)
        roster.append({"id": key, "name": who.get("nick") or key, "voice": voice, "nation": "", "sex": "m"})
    ids = {r["id"] for r in roster}
    prev: dict[str, Any] = {}
    if VOICE_SELECT_PATH.is_file():
        try:
            prev = json.loads(VOICE_SELECT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            prev = {}
    active: dict[str, str] = {}
    raw_map = prev.get("active") if isinstance(prev.get("active"), dict) else {}
    if not raw_map and isinstance(prev.get("map"), dict):
        raw_map = prev.get("map") or {}
    for key, val in raw_map.items():
        voice = str(val).strip().lower()
        if str(key) in ids and voice in VOICE_IDS:
            active[str(key)] = voice
    last_agent = str(prev.get("agent") or "").strip().lower()
    last_voice = str(prev.get("voice") or "").strip().lower()
    if last_agent in ids and last_voice in VOICE_IDS:
        active.setdefault(last_agent, last_voice)
    for row in roster:
        if row["id"] in active:
            row["voice"] = active[row["id"]]
    if action in {"put", "set", "select", "post"}:
        agent = str(args.get("voice_agent") or args.get("seated") or "").strip().lower()
        if not agent or agent == "sam":
            agent = str(args.get("agent") or "").strip().lower()
        if agent not in ids:
            raise ValueError("unknown seated agent")
        voice = str(args.get("voice") or "").strip().lower()
        if voice and voice not in VOICE_IDS:
            raise ValueError("unknown voice")
        if not voice:
            voice = next((r["voice"] for r in roster if r["id"] == agent), "echo")
        active[agent] = voice
        for row in roster:
            if row["id"] == agent:
                row["voice"] = voice
        rec = {
            "ok": True,
            "agent": agent,
            "voice": voice,
            "nation": AGENT_NATION.get(agent, ""),
            "active": active,
            "approach": bool(args.get("approach", True)),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "token": VOICE1_TOKEN,
        }
        VOICE_SELECT_PATH.parent.mkdir(parents=True, exist_ok=True)
        VOICE_SELECT_PATH.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
        return {**rec, "roster": roster, "voices": list(VOICE_IDS), "endpoint": "/mcp/sandbox/voice"}
    agent = str(prev.get("agent") or "astra")
    voice = str(prev.get("voice") or DEFAULT_AGENT_VOICE.get(agent) or "marin")
    return {
        "ok": True,
        "agent": agent,
        "voice": voice,
        "nation": AGENT_NATION.get(agent, ""),
        "active": active,
        "approach": bool(prev.get("approach", False)),
        "roster": roster,
        "voices": list(VOICE_IDS),
        "token": VOICE1_TOKEN,
        "endpoint": "/mcp/sandbox/voice",
    }


def grok_decision_brief(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Votes from seated AIs + Astra risk/reward script. Posts suggestions to team chat."""
    args = args or {}
    topic = str(args.get("topic") or args.get("text") or "sandbox decision").strip()[:160]
    kind = str(args.get("kind") or "debug").strip().lower()
    if kind not in DECISION_CHOICES:
        kind = "debug"
    labels = DECISION_CHOICES[kind]
    keys = list(labels.keys())
    h = 0
    for ch in f"{topic}|{kind}":
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    votes = []
    for i, (agent, name, lean) in enumerate(DECISION_VOTERS):
        choice = keys[(h + i * 3 + len(lean)) % len(keys)]
        if lean == "measure":
            suggestion = f"Log {topic[:48]} before the next patch; compare /mcp/stats."
        elif lean == "ship":
            suggestion = f"Ship the safer {choice} path for {topic[:48]}; keep one battery."
        elif lean == "probe":
            suggestion = f"Reproduce {topic[:48]} in sandbox only, then cede_example apply=false."
        elif lean == "print":
            suggestion = f"Print a fixture or CAD step that proves {topic[:48]}."
        elif lean == "gate":
            suggestion = f"Two peer asks, then Ledger — do not ping Sam first on {topic[:48]}."
        else:
            suggestion = f"Draft a CODE harness note for {kind}: {topic[:48]}."
        risk = f"{name} flags stall if we wait" if choice == "C" else f"{name} sees a miss if {choice} is wrong"
        reward = "we isolate the fault" if choice == "A" else ("a smaller blast radius" if choice == "B" else "Sam stays off the critical path")
        votes.append({
            "agent": agent,
            "name": name,
            "lean": lean,
            "choice": choice,
            "label": labels[choice],
            "risk": risk,
            "reward": reward,
            "suggestion": suggestion[:180],
        })
    counts: dict[str, int] = {}
    for vote in votes:
        counts[vote["choice"]] = counts.get(vote["choice"], 0) + 1
    winner = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    split = ", ".join(f"{counts.get(k, 0)} {labels[k]}" for k in keys)
    win = next((v for v in votes if v["choice"] == winner), votes[0])
    script = (
        f"Risk: {win['risk']}. Reward: {win['reward']}. "
        f"The other AIs vote {split}. Overcome it: {win['suggestion']}"
    )[:360]
    suggestions = [
        {"agent_id": v["agent"], "agent_name": v["name"], "text": v["suggestion"], "choice": v["choice"], "silent": True}
        for v in votes
    ]
    out = {
        "ok": True,
        "topic": topic,
        "kind": kind,
        "votes": votes,
        "counts": counts,
        "winner": winner,
        "labels": labels,
        "script": script,
        "suggestions": suggestions,
        "speaker": "astra",
        "token": SANDBOX4_TOKEN,
        "endpoint": "/mcp/sandbox/decision",
    }
    if args.get("post", True):
        grok_group_chat({
            "action": "post",
            "agent": "astra",
            "text": f"DECIDE {kind}: {script}",
            "_ledger_skip": True,
        })
        for row in suggestions:
            grok_group_chat({
                "action": "post",
                "agent": row["agent_id"],
                "text": f"SUGGEST {kind} {row['choice']}: {row['text']}",
                "_ledger_skip": True,
            })
    return out


def grok_marketing_slides(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Marketing AI PDF slideshow + Draw-circle point targets. Token mktpres1."""
    args = args or {}
    action = str(args.get("action") or "deck").strip().lower()
    pages = [
        {"id": "p1", "title": "Grow Render Studio on social", "bullets": 3},
        {"id": "p2", "title": "Media that actually grows reach", "bullets": 3},
        {"id": "p3", "title": "Share-to-X is the growth loop", "bullets": 3},
        {"id": "p4", "title": "Cadence after the live URL", "bullets": 3},
        {"id": "p5", "title": "This week’s proof (no invented URLs)", "bullets": 3},
    ]
    out = {
        "ok": True,
        "token": "mktpres1",
        "agent": "vibe-marketing",
        "title": "Grow social presence",
        "source": "mcp/grok-bot/MARKETING.md §2 X posting guidance",
        "pages": pages,
        "point": "Draw-circle on a PDF page; bullets inside the circle become the talk track.",
        "surfaces": ["/sandbox/index.html PDF tab", "round table Slides"],
        "endpoint": "/mcp/sandbox/slides",
    }
    if action in {"present", "start", "post"}:
        grok_group_chat({
            "action": "post",
            "agent": "vibe-marketing",
            "text": "SLIDES mktpres1: Grow social presence from MARKETING.md. Open PDF tab or table Slides, then point a bullet like Draw-circle.",
            "_ledger_skip": True,
        })
        out["posted"] = True
    return out


MKTPITCH1_TOKEN = "mktpitch1"
SOCIAL_HANDLES = ("a1_projects", "winstead_works")

DEFAULT_PITCH_PAGES = (
    {
        "title": "The ask",
        "bullets": [
            "Product name is Render Studio. Always include https://render3d.app.",
            "Growth = real clips of shipped UI, not vanity metrics.",
            "Never invent follower counts, tweet IDs, or live post URLs.",
        ],
    },
    {
        "title": "Accounts we actually run",
        "bullets": [
            "@a1_projects — product / studio surface.",
            "@winstead_works — founder / build-in-public.",
            "If a count is not in grok_stats or X analytics, leave it blank.",
        ],
    },
    {
        "title": "What to publish",
        "bullets": [
            "GIF 2–6s for tools. MP4 for Record / VR spectator. PNG for logo/OG.",
            "Caption footer: Built in Render Studio https://render3d.app",
            "Draft with x_post confirm=false. Live needs Sam.",
        ],
    },
    {
        "title": "Share-to-X loop",
        "bullets": [
            "Record → stop → You’re done recording → Share to X (download-then-compose).",
            "Same path from markup, clip editor, VR POV, Reference Files.",
            "Bot never fires paid Generate or posts without confirm=true.",
        ],
    },
    {
        "title": "How to run this deck",
        "bullets": [
            "Generate: grok_pitch_deck or POST /mcp/sandbox/pitch",
            "Open Super IDE PDF tab (pitch) or Files → examples/pitch-social-growth.*",
            "Point left/right on the PDF to step slides (same Draw/point as Bambu plates).",
        ],
    },
)


def _pdf_escape(text: str) -> str:
    return str(text or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")[:88]


def slides_to_pdf(title: str, pages: list[dict[str, Any]]) -> bytes:
    """Minimal multi-page PDF (Helvetica). Landscape 792x612. ASCII only."""
    chunks: list[bytes] = []
    offsets: list[int] = []

    def add(obj: bytes) -> None:
        offsets.append(sum(len(c) for c in chunks))
        chunks.append(obj)

    add(b"%PDF-1.4\n")
    page_streams: list[bytes] = []
    for i, page in enumerate(pages or []):
        y_cmds = [
            "BT",
            "/F1 16 Tf",
            "36 560 Td",
            f"({_pdf_escape(title)}) Tj",
            "0 -28 Td",
            "/F1 22 Tf",
            f"({_pdf_escape(str(page.get('title') or f'Slide {i+1}'))}) Tj",
            "0 -18 Td",
            "/F1 11 Tf",
            f"(mktpitch1  {i + 1}/{len(pages)}  point left/right to step) Tj",
        ]
        for bullet in (page.get("bullets") or [])[:8]:
            y_cmds.append("0 -26 Td")
            y_cmds.append("/F1 13 Tf")
            y_cmds.append(f"(- {_pdf_escape(str(bullet))}) Tj")
        y_cmds.append("ET")
        page_streams.append("\n".join(y_cmds).encode("latin-1", "replace"))
    font_id = 3
    content_ids: list[int] = []
    kids: list[int] = []
    next_id = 4
    for _stream in page_streams:
        content_ids.append(next_id)
        next_id += 1
        kids.append(next_id)
        next_id += 1
    add(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
    kids_ref = " ".join(f"{k} 0 R" for k in kids)
    add(f"2 0 obj << /Type /Pages /Kids [{kids_ref}] /Count {len(kids)} >> endobj\n".encode())
    add(b"3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")
    for stream, cid, pid in zip(page_streams, content_ids, kids):
        add(f"{cid} 0 obj << /Length {len(stream)} >> stream\n".encode() + stream + b"\nendstream endobj\n")
        add(
            (
                f"{pid} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] "
                f"/Contents {cid} 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> >> endobj\n"
            ).encode()
        )
    xref_at = sum(len(c) for c in chunks)
    max_id = 3 + 2 * len(page_streams)
    xref_lines = ["xref", f"0 {max_id + 1}", "0000000000 65535 f "]
    obj_off = {i: offsets[i] for i in range(1, len(offsets))}
    for i in range(1, max_id + 1):
        xref_lines.append(f"{obj_off.get(i, 0):010d} 00000 n ")
    xref = ("\n".join(xref_lines) + "\n").encode()
    trailer = f"trailer << /Size {max_id + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    return b"".join(chunks) + xref + trailer


def _pitch_pages_from_args(args: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    title = str(args.get("title") or args.get("topic") or args.get("text") or "Grow Render Studio social presence").strip()[:120]
    raw = args.get("slides") or args.get("pages")
    pages: list[dict[str, Any]] = []
    if isinstance(raw, list) and raw:
        for row in raw[:12]:
            if isinstance(row, dict):
                bullets = row.get("bullets") or row.get("points") or []
                if isinstance(bullets, str):
                    bullets = [bullets]
                pages.append({
                    "title": str(row.get("title") or row.get("heading") or "Slide")[:80],
                    "bullets": [str(b)[:160] for b in list(bullets)[:8]],
                })
            elif isinstance(row, str):
                pages.append({"title": row[:80], "bullets": []})
    if not pages:
        pages = [dict(p) for p in DEFAULT_PITCH_PAGES]
        if title and title.lower() not in {"grow render studio social presence", "social", "grow social"}:
            pages[0]["title"] = title
    return title, pages


def grok_pitch_deck(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Write MD+PDF pitch deck into frontend/sandbox. Token mktpitch1. Never auto-posts to X."""
    args = args or {}
    action = str(args.get("action") or "generate").strip().lower()
    title, pages = _pitch_pages_from_args(args)
    md_lines = [
        f"# {title}",
        "",
        f"token `{MKTPITCH1_TOKEN}` · agent vibe-marketing",
        "handles: " + ", ".join(f"@{h}" for h in SOCIAL_HANDLES),
        "No fake follower counts. Draft-only social posts.",
        "",
    ]
    for i, page in enumerate(pages, 1):
        md_lines.append(f"## {i}. {page['title']}")
        for b in page.get("bullets") or []:
            md_lines.append(f"- {b}")
        md_lines.append("")
        md_lines.append("---")
        md_lines.append("")
    md = "\n".join(md_lines)
    pdf = slides_to_pdf(title, pages)
    md_rel = "examples/pitch-social-growth.md"
    pdf_rel = "examples/pitch-social-growth.pdf"
    how_rel = "examples/pitch-how-to.md"
    wrote: list[str] = []
    if action in {"generate", "write", "pitch", "deck", "present"}:
        md_path = _sandbox_resolve(md_rel)
        pdf_path = _sandbox_resolve(pdf_rel)
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(md, encoding="utf-8")
        pdf_path.write_bytes(pdf)
        wrote = [md_rel, pdf_rel]
    out = {
        "ok": True,
        "token": MKTPITCH1_TOKEN,
        "keep": ["sandbox1", "sandbox2", "sandbox3", "sandbox4", "mktpres1"],
        "agent": "vibe-marketing",
        "title": title,
        "handles": list(SOCIAL_HANDLES),
        "pages": [{"title": p["title"], "bullets": len(p.get("bullets") or [])} for p in pages],
        "files": wrote or [md_rel, pdf_rel, how_rel],
        "how": "grok_pitch_deck action=generate. Super IDE PDF tab → Pitch. Point left/right to step. x_post confirm=false only.",
        "auto_publish": False,
        "endpoint": "/mcp/sandbox/pitch",
        "pdf_bytes": len(pdf),
    }
    if action in {"generate", "write", "pitch", "present", "post"} and args.get("post", True):
        posted = grok_group_chat({
            "action": "post",
            "agent": "vibe-marketing",
            "text": (
                "PITCH mktpitch1: social-growth deck for @a1_projects + @winstead_works "
                "(no fake follower counts). Files: examples/pitch-social-growth.md + .pdf. "
                "PDF tab → Pitch. Point left/right to step slides. Draft X only."
            ),
            "_ledger_skip": True,
        })
        out["posted"] = posted.get("posted")
    return out


def grok_rnd_benchmarks(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Write measurable benchmark plan for Sam's mentioned features. No fake dollars."""
    args = args or {}
    action = str(args.get("action") or "plan").strip().lower()
    rel = "curriculum/rnd-benchmarks.md"
    dest = _sandbox_resolve(rel)
    text = dest.read_text(encoding="utf-8") if dest.is_file() else ""
    out = {
        "ok": True,
        "token": MKTPITCH1_TOKEN,
        "agent": "vibe-rnd",
        "path": rel,
        "metrics": [
            "tts_overlap_incidents=0",
            "webgl_count=1",
            "sandbox_path_jail",
            "rev_lag_ms<=3000",
            "shapes_hidden_not_destroyed",
            "cost_report_real_tokens_not_dollars",
        ],
        "endpoint": "/mcp/sandbox/benchmarks",
    }
    if action in {"plan", "write", "generate", "post"} and args.get("post", True):
        posted = grok_group_chat({
            "action": "post",
            "agent": "vibe-rnd",
            "text": (
                "BENCH plan mktpitch1: curriculum/rnd-benchmarks.md — TTS overlap=0, WebGL=1, "
                "sandbox jail, live-edit rev, VR control rev, clip-bot cede apply=false, "
                "chat image/reply/emoji, cost reports as tokens not fake $, voice approach, "
                "sandbox-off hides shapes. Keep sandbox1-4."
            ),
            "_ledger_skip": True,
        })
        out["posted"] = posted.get("posted")
        out["chars"] = len(text)
    return out


RNDDEMO1_TOKEN = "rnddemo1"
RNDDEMO1_KEEP = ["mktpres1", "rndbench1"]
VOICE_BENCH_PDF_REL = "examples/rnd-voice-bench.pdf"
AGENT_TASKS_PATH = SANDBOX_DIR / "agent-tasks.json"
VOICE_BENCH_SRC = Path(
    "/Users/sam/.cursor/projects/Users-sam/attachments/9493eba7-c6c0-4d59-8db0-23e6c5de074f/"
    "RnD_Performance_Report___VR_Voice_Bench_CYCLE-20260916.pdf"
)


def _ensure_voice_bench_pdf() -> dict[str, Any]:
    dest = _sandbox_resolve(VOICE_BENCH_PDF_REL)
    dest.parent.mkdir(parents=True, exist_ok=True)
    copied = False
    if not dest.is_file() and VOICE_BENCH_SRC.is_file():
        shutil.copy2(VOICE_BENCH_SRC, dest)
        copied = True
    return {
        "path": VOICE_BENCH_PDF_REL,
        "bytes": int(dest.stat().st_size) if dest.is_file() else 0,
        "copied": copied,
        "exists": dest.is_file(),
    }


def grok_rnd_demo(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Load VR Voice Bench PDF into sandbox viewer. Token rnddemo1. Never wipes mktpres1/rndbench1."""
    args = args or {}
    action = str(args.get("action") or "deck").strip().lower()
    pdf = _ensure_voice_bench_pdf()
    out: dict[str, Any] = {
        "ok": True,
        "token": RNDDEMO1_TOKEN,
        "keep": list(RNDDEMO1_KEEP),
        "agent": "vibe-rnd",
        "pdf": pdf,
        "how": (
            "PDF tab → Voice bench. VR: round-table Bench, laser/point like marketing slides. "
            "Sam suggestions barge in (ttsturn1). Harness apply=false."
        ),
        "endpoint": "/mcp/sandbox/rnd-demo",
        "auto_apply": False,
    }
    if action in {"present", "ping", "post", "start"} and args.get("post", True):
        posted = grok_group_chat({
            "action": "post",
            "agent": "cursor-engineer",
            "text": (
                "@vibe-rnd Rick: load frontend/sandbox/examples/rnd-voice-bench.pdf in the sandbox PDF viewer "
                "(Voice bench tab). Drive the UI with VR controllers like a person — laser/point the same as "
                "marketing slides (mktpres1 kept). Walk through the presentation. Accept Sam's suggestions "
                f"(ttsturn1). Token {RNDDEMO1_TOKEN}. Keep mktpres1/rndbench1. No extra WebGL. Harness apply=false. "
                "Also: per-agent task lists; Ledger announces status when a task is done; live stats JSON shows it."
            )[:1500],
        })
        out["posted"] = posted.get("posted")
    return out


def _task_store() -> dict[str, Any]:
    if AGENT_TASKS_PATH.is_file():
        try:
            data = json.loads(AGENT_TASKS_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("tasks"), list):
                data.setdefault("token", RNDDEMO1_TOKEN)
                data.setdefault("keep", list(RNDDEMO1_KEEP))
                return data
        except Exception:
            pass
    return {"token": RNDDEMO1_TOKEN, "keep": list(RNDDEMO1_KEEP), "tasks": []}


def _task_save(data: dict[str, Any]) -> None:
    AGENT_TASKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    AGENT_TASKS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def grok_agent_tasks(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sam assigns tasks per agent. Ledger announces when done. Live feed JSON."""
    args = args or {}
    action = str(args.get("action") or "list").strip().lower()
    data = _task_store()
    tasks: list[dict[str, Any]] = list(data.get("tasks") or [])
    rec: dict[str, Any] | None = None
    if action == "assign":
        rec = {
            "id": str(args.get("id") or ("tsk_" + uuid.uuid4().hex[:8])),
            "agent_id": str(args.get("agent") or args.get("agent_id") or "vibe-rnd").strip()[:40],
            "title": str(args.get("title") or args.get("text") or "untitled").strip()[:160],
            "status": "queued",
            "from": str(args.get("from") or "sam")[:40],
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "token": RNDDEMO1_TOKEN,
        }
        tasks.append(rec)
        data["tasks"] = tasks[-80:]
        _task_save(data)
    elif action == "complete":
        tid = str(args.get("id") or args.get("task_id") or "").strip()
        for row in tasks:
            if str(row.get("id")) == tid:
                row["status"] = "done"
                row["done_ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                row["note"] = str(args.get("note") or "")[:160]
                rec = row
                break
        data["tasks"] = tasks
        _task_save(data)
        if rec and args.get("post", True):
            posted = grok_group_chat({
                "action": "post",
                "agent": "ledger",
                "text": (
                    f"LEDGER {RNDDEMO1_TOKEN}: task {rec.get('id')} for {rec.get('agent_id')} DONE — {rec.get('title')}"
                )[:240],
            })
            data["ledger"] = posted.get("posted")
    by_agent: dict[str, Any] = {}
    for row in tasks:
        aid = str(row.get("agent_id") or "")
        bucket = by_agent.setdefault(aid, {"queued": 0, "done": 0})
        if row.get("status") == "done":
            bucket["done"] += 1
        else:
            bucket["queued"] += 1
    return {
        "ok": True,
        "token": RNDDEMO1_TOKEN,
        "keep": list(RNDDEMO1_KEEP),
        "live": True,
        "source": "agent-tasks",
        "tasks": tasks[-40:],
        "byAgent": by_agent,
        "rec": rec,
        "endpoint": "/mcp/sandbox/tasks",
    }


def team_chat_feed(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """MCP bundle the team-chat page pulls: messages, votes, pad, requests, pulse."""
    args = args or {}
    limit = int(args.get("limit") or 80)
    chat = grok_group_chat({"action": "read", "limit": limit})
    votes = grok_vote({"action": "tally"})
    pad = grok_collab_pad({"action": "read"})
    help_rows = grok_help_request({"action": "read"})
    pulse: dict[str, Any] = {}
    try:
        from backend.services import team_status_service as ts

        pulse = ts.latest()
    except Exception:
        pulse = {}
    return {
        "ok": True,
        "token": SANDBOX_TOKEN,
        "source": "mcp",
        "public": "https://render3d.app/team-chat.html",
        "api": "https://render3d.app/mcp/team-chat/feed",
        "messages": chat.get("messages") or [],
        "count": chat.get("count") or 0,
        "votes": votes.get("votes") or {},
        "pad": pad.get("pad") or {},
        "requests": help_rows.get("requests") or [],
        "pulse": pulse,
    }


def _sandbox_resolve(rel: str) -> Path:
    raw = str(rel or "").replace("\\", "/").lstrip("/")
    if raw.startswith("frontend/sandbox/"):
        raw = raw[len("frontend/sandbox/") :]
    parts = [p for p in raw.split("/") if p and p != "."]
    if any(p == ".." for p in parts) or not parts:
        raise ValueError("sandbox path escapes jail")
    dest = (SANDBOX_DIR.joinpath(*parts)).resolve()
    root = SANDBOX_DIR.resolve()
    if dest != root and root not in dest.parents:
        raise ValueError("sandbox path escapes jail")
    return dest


_SAM_CORR_RE = re.compile(
    r"\b(that'?s wrong|that is wrong|this is wrong|that'?s not right|wrong[, ]+change|change that|fix that)\b",
    re.I,
)
_SAM_CORR_PATH_RE = re.compile(
    r"\b(?:in|file)\s+(?:frontend/sandbox/)?([\w./-]+\.(?:md|js|html|css|json|txt))\b",
    re.I,
)


def _is_sam_sandbox_correction(text: str) -> bool:
    s = re.sub(r"^VOICE:\s*", "", str(text or ""), flags=re.I)
    if re.search(r"\b(don'?t|do not|never)\b.{0,24}\b(correct|change that)\b", s, re.I):
        return False
    return bool(_SAM_CORR_RE.search(s) or re.search(r"\bchange\b.{0,80}\bto\b", s, re.I))


def _ask_topic_blob(q: str, *blobs: str) -> str:
    needle = str(q or "").strip().lower()
    joined = "\n\n".join(b for b in blobs if b)
    if not needle:
        return joined
    chunks = re.split(r"\n(?=#{1,3}\s)", joined)
    hits = [c for c in chunks if needle in c.lower()]
    return "\n\n".join(hits) if hits else joined


def grok_explain_tracking(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Read-only API + log explainer. Token harness1. Never writes production."""
    args = args or {}
    q = str(args.get("q") or args.get("topic") or args.get("text") or "").strip()
    doc_path = REPO_ROOT / "Getting-Started" / "agents" / "API-TRACKING-EXPLAINED.md"
    doc = doc_path.read_text(encoding="utf-8") if doc_path.is_file() else ""
    skill = _skill_text("api-tracking-explain")
    how = (
        "Ask in voice, round table, team chat, or grok_debugger action=explain_tracking. "
        "Examples: last3 d9c98119-003 | d9c98119-004 | d9c98119-005; privileges ask-safe Approve; "
        "cost_*; project.instance8; /mcp/sandbox /mcp/team-chat/feed controls voice pitch tasks."
    )
    return {
        "ok": True,
        "token": HARNESS1_TOKEN,
        "explain_only": True,
        "auto_apply": False,
        "production": False,
        "doc_path": "Getting-Started/agents/API-TRACKING-EXPLAINED.md",
        "skill_path": "mcp/grok-bot/skills/api-tracking-explain/SKILL.md",
        "how_to_ask": how,
        "q": q,
        "last3_example": "d9c98119-003 | d9c98119-004 | d9c98119-005",
        "text": _ask_topic_blob(q, skill, doc)[:80_000],
        "mcp": [
            "grok_debugger action=explain_tracking",
            "grok_sandbox action=explain",
            "GET /mcp/sandbox/explain",
        ],
    }


def grok_sandbox_correct(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sam correction writes sandbox only and bumps rev. Never production."""
    args = args or {}
    raw = str(args.get("text") or args.get("body") or args.get("correction") or "").strip()[:4000]
    raw = re.sub(r"^VOICE:\s*", "", raw, flags=re.I)
    path_arg = str(args.get("path") or args.get("file") or "").strip()
    mpath = _SAM_CORR_PATH_RE.search(raw)
    rel = path_arg or (mpath.group(1) if mpath else "examples/live-correction.md")
    dest = _sandbox_resolve(rel)
    if dest.suffix.lower() not in SANDBOX_WRITE_EXT:
        raise ValueError("sandbox correct: extension not allowed")
    dest.parent.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    note = (
        f"# Live Sam correction\n\n"
        f"- ts: {ts}\n"
        f"- token: {HARNESS1_TOKEN}\n"
        f"- auto_apply: false\n"
        f"- production: unchanged until Approve\n\n"
        f"{raw or '(empty)'}\n"
    )
    default = dest.name == "live-correction.md"
    if dest.is_file() and not default:
        prev = dest.read_text(encoding="utf-8", errors="replace")
        dest.write_text(prev.rstrip() + "\n\n<!-- sam-correct " + ts + " -->\n" + raw + "\n", encoding="utf-8")
    else:
        dest.write_text(note, encoding="utf-8")
    logp = SANDBOX_DIR / "live-corrections.jsonl"
    rec = {
        "ts": ts,
        "path": str(dest.relative_to(SANDBOX_DIR.resolve())).replace("\\", "/"),
        "text": raw[:800],
        "log_id": str(args.get("log_id") or ""),
        "token": HARNESS1_TOKEN,
        "auto_apply": False,
    }
    with logp.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    return {
        "ok": True,
        "token": HARNESS1_TOKEN,
        "keep": SANDBOX_TOKEN,
        "path": rec["path"],
        "hot_reload": True,
        "auto_apply": False,
        "production": False,
        "rev_poll": "/mcp/sandbox/rev",
        "note": "Sandbox only. Viewer polls rev. Production waits for Approve.",
    }


def grok_sandbox(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Read/write frontend/sandbox only. Live-reload via rev. Never wipes the tree."""
    args = args or {}
    action = str(args.get("action") or "list").strip().lower()
    if action in {"explain", "explain_tracking", "explain_api", "explain_logs"}:
        return grok_explain_tracking(args)
    if action in {"correct", "correction", "sam-correct"}:
        return grok_sandbox_correct(args)
    if action == "feed":
        return team_chat_feed(args)
    if action in {"voice", "voice-select"}:
        return grok_voice_select(args)
    if action in {"decision", "decide", "brief"}:
        return grok_decision_brief(args)
    if action in {"slides", "marketing-slides"}:
        return grok_marketing_slides(args)
    if action in {"pitch", "pitch-deck"}:
        return grok_pitch_deck(args)
    if action in {"benchmarks", "rnd-benchmarks"}:
        return grok_rnd_benchmarks(args)
    if action in {"rnd-demo", "voice-bench", "rnddemo"}:
        return grok_rnd_demo(args)
    if action in {"tasks", "agent-tasks"}:
        return grok_agent_tasks(args)
    if action in {"controls", "control-config", "notes"}:
        from backend.services import xr_control_live as live

        if action == "notes":
            return {"ok": True, "notes": live.list_notes(int(args.get("limit") or 40)), "token": live.TOKEN}
        return {"ok": True, **live.load_config()}
    files: list[dict[str, Any]] = []
    latest = 0
    list_root = SANDBOX_DIR
    if action == "list" and args.get("path"):
        list_root = _sandbox_resolve(str(args["path"]))
        if list_root.exists() and not list_root.is_dir():
            raise ValueError("sandbox list path must be a directory")
    if list_root.is_dir():
        for path in list_root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in SANDBOX_WRITE_EXT and action != "list":
                continue
            try:
                st = path.stat()
            except OSError:
                continue
            latest = max(latest, int(st.st_mtime_ns))
            rel = str(path.resolve().relative_to(SANDBOX_DIR.resolve())).replace("\\", "/")
            files.append({
                "path": rel,
                "bytes": int(st.st_size),
                "mtime_ns": int(st.st_mtime_ns),
            })
    files.sort(key=lambda row: row["path"])
    if action == "rev":
        return {"ok": True, "token": SANDBOX_TOKEN, "rev": str(latest), "count": len(files), "files": files[:200]}
    if action == "list":
        cursor = max(0, int(args.get("cursor") or 0))
        end = cursor + 200
        return {"ok": True, "token": SANDBOX_TOKEN, "files": files[cursor:end], "root": "frontend/sandbox", "count": len(files), "next_cursor": end if end < len(files) else None}
    if action == "read":
        dest = _sandbox_resolve(str(args.get("path") or args.get("file") or ""))
        if not dest.is_file():
            raise ValueError("missing sandbox file")
        suffix = dest.suffix.lower()
        rel = str(dest.relative_to(SANDBOX_DIR.resolve())).replace("\\", "/")
        if suffix == ".pdf":
            import base64

            raw = dest.read_bytes()[:2_000_000]
            return {"ok": True, "token": SANDBOX_TOKEN, "path": rel, "kind": "pdf", "b64": base64.b64encode(raw).decode("ascii")}
        text = dest.read_text(encoding="utf-8", errors="replace")[:120_000]
        kind = "md" if suffix == ".md" else ("code" if suffix in {".js", ".css", ".html", ".json", ".svg"} else "text")
        return {"ok": True, "token": SANDBOX_TOKEN, "path": rel, "kind": kind, "text": text}
    if action == "write":
        dest = _sandbox_resolve(str(args.get("path") or args.get("file") or ""))
        if dest.suffix.lower() not in SANDBOX_WRITE_EXT:
            raise ValueError("sandbox write: extension not allowed")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.parent.resolve() != SANDBOX_DIR.resolve() and SANDBOX_DIR.resolve() not in dest.parent.resolve().parents:
            raise ValueError("sandbox path escapes jail")
        body = str(args.get("text") or args.get("body") or "")[:120_000]
        dest.write_text(body, encoding="utf-8")
        return {
            "ok": True,
            "token": SANDBOX_TOKEN,
            "path": str(dest.relative_to(SANDBOX_DIR.resolve())).replace("\\", "/"),
            "bytes": dest.stat().st_size,
            "hot_reload": True,
        }
    if action == "cede_example":
        rel = str(args.get("path") or args.get("file") or "examples/harness-note.md")
        dest = _sandbox_resolve(rel)
        if dest.suffix.lower() not in SANDBOX_WRITE_EXT:
            raise ValueError("sandbox cede_example: extension not allowed")
        dest.parent.mkdir(parents=True, exist_ok=True)
        body = str(args.get("text") or args.get("body") or "")[:120_000]
        if body:
            dest.write_text(body, encoding="utf-8")
        return {
            "ok": True,
            "token": "sandbox2",
            "keep": SANDBOX_TOKEN,
            "path": str(dest.relative_to(SANDBOX_DIR.resolve())).replace("\\", "/"),
            "apply": False,
            "auto_apply": False,
            "status": "pending_approval",
            "hot_reload": True,
            "note": "Clip-bot/crew asked harness to review this sandbox example. Do not auto-apply.",
        }
    raise ValueError("action list|read|write|rev|feed|cede_example|controls|notes|slides|pitch|benchmarks|explain|correct")


def _extract_tags(text: str) -> list[str]:
    found = re.findall(r"@([A-Za-z0-9_-]{2,40})", text or "")
    tags = []
    for raw in found:
        t = raw.strip().lower()
        if t in {"harness", "rm"}:
            t = "cursor-engineer"
        tags.append(t)
    return list(dict.fromkeys(tags))[:8]


def _ingest_tags(rec: dict[str, Any]) -> None:
    tags = rec.get("tags") or []
    if not tags:
        return
    CHAT_TAGS.parent.mkdir(parents=True, exist_ok=True)
    line = {
        "ts": rec.get("ts"),
        "log_id": rec.get("log_id"),
        "agent": rec.get("agent"),
        "tags": tags,
        "text": str(rec.get("text") or "")[:400],
    }
    with CHAT_TAGS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(line) + "\n")


def grok_tag(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    q = str(args.get("tag") or args.get("q") or "").strip().lower().lstrip("@")
    rows = []
    if CHAT_TAGS.is_file():
        for line in CHAT_TAGS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if q:
        rows = [r for r in rows if q in [str(t).lower() for t in (r.get("tags") or [])] or q in str(r.get("log_id") or "").lower()]
    who = {k: _whois(k) for k in LEDGER_WHO}
    return {
        "ok": True,
        "count": len(rows),
        "tags": rows[-80:],
        "who": who,
        "how": "Type @agent, @req_<id>, @msg_gc_, @pad, @code. Max 8 @ per post. Code: CODE @pad @analytics. Vote limits on V-TAG-LIMITS.",
        "public": "https://render3d.app/mcp/tags",
    }


def _ingest_report_line(agent: str, text: str, log_id: str | None = None) -> None:
    m = re.search(
        r"REPORT\s+ping=(\S+)\s+agent=(\S+)\s+result_score=(\d+)\s+succeed=([1-5])",
        text or "",
        re.I,
    )
    if not m:
        return
    agent_id = m.group(2).strip()[:40]
    if "<" in agent_id or agent_id.lower() in {"you", "agent"}:
        return
    CHAT_REPORTS.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "ping": m.group(1).strip(),
        "agent": m.group(2).strip()[:40],
        "posted_as": agent,
        "result_score": int(m.group(3)),
        "succeed": int(m.group(4)),
        "log_id": log_id,
        "text": (text or "")[:400],
    }
    with CHAT_REPORTS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")


def grok_report(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    ping = str(args.get("ping") or args.get("q") or "").strip()
    rows = []
    if CHAT_REPORTS.is_file():
        for line in CHAT_REPORTS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if ping:
        rows = [r for r in rows if str(r.get("ping") or "") == ping]
    by: dict[str, list] = {}
    for r in rows:
        by.setdefault(str(r.get("ping") or "none"), []).append(r)
    return {
        "ok": True,
        "count": len(rows),
        "reports": rows[-80:],
        "pings": {k: {"n": len(v), "avg_score": round(sum(int(x.get("result_score") or 0) for x in v) / max(len(v), 1))} for k, v in by.items()},
        "how": "REPORT ping=REPORT-PING-01 agent=<you> result_score=0-100 succeed=1-5 did=… log_id=msg_gc_… try=… GET /mcp/reports",
        "public": "https://render3d.app/mcp/reports",
    }


def _ingest_vote_line(agent: str, text: str, log_id: str | None = None) -> None:
    vote = re.search(r"VOTE\s+id=(\S+)\s+q=(.+?)\s+options=(\S+)", text, re.I | re.S)
    ballot = re.search(r"BALLOT\s+(\S+)\s*=\s*([A-Za-z])(?:\s|$)", text, re.I)
    if not vote and not ballot:
        return
    BOARD_VOTES.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "agent": agent,
        "log_id": log_id,
        "kind": "vote" if vote else "ballot",
        "vote_id": (vote.group(1) if vote else ballot.group(1)).strip(),
        "q": vote.group(2).strip() if vote else "",
        "options": vote.group(3) if vote else "",
        "choice": (ballot.group(2).upper() if ballot else ""),
    }
    with BOARD_VOTES.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")


def grok_vote(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    action = str(args.get("action") or "tally").strip().lower()
    if action == "post":
        agent = str(args.get("agent") or "unknown")[:40]
        vid = str(args.get("vote_id") or args.get("id") or "V-LOG-UI").strip()
        choice = str(args.get("choice") or "").strip().upper()[:1]
        text = str(args.get("text") or "")
        if not choice and not text.upper().startswith("VOTE"):
            raise ValueError("choice or VOTE text required")
        if not text:
            text = f"BALLOT {vid} ={choice}"
        return grok_group_chat({"action": "post", "agent": agent, "text": text[:1500]})
    rows = []
    if BOARD_VOTES.is_file():
        for line in BOARD_VOTES.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    tallies: dict[str, dict[str, Any]] = {}
    for r in rows:
        vid = str(r.get("vote_id") or "")
        if not vid:
            continue
        bucket = tallies.setdefault(vid, {"q": r.get("q") or "", "options": r.get("options") or "", "counts": {}, "ballots": []})
        if r.get("q"):
            bucket["q"] = r["q"]
        if r.get("options"):
            bucket["options"] = r["options"]
        if r.get("kind") == "ballot" and r.get("choice"):
            ch = str(r["choice"])
            if not any(b.get("agent") == r.get("agent") for b in bucket["ballots"]):
                bucket["ballots"].append({"agent": r.get("agent"), "choice": ch, "log_id": r.get("log_id")})
                bucket["counts"][ch] = bucket["counts"].get(ch, 0) + 1
    return {"ok": True, "votes": tallies, "public": "https://render3d.app/team-chat.html#team-vote"}


def grok_collab_pad(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    action = str(args.get("action") or "read").strip().lower()
    COLLAB_PAD.parent.mkdir(parents=True, exist_ok=True)
    if action == "post":
        prev = {"body": "", "rev": 0, "log": []}
        if COLLAB_PAD.is_file():
            try:
                prev = json.loads(COLLAB_PAD.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                prev = {"body": "", "rev": 0, "log": []}
        body = str(args.get("text") or args.get("body") or "")[:8000]
        rec = {
            "rev": int(prev.get("rev") or 0) + 1,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "agent": str(args.get("agent") or "unknown")[:40],
            "note": str(args.get("note") or "")[:200],
            "body": body,
            "log": (prev.get("log") or [])[-12:] + [{
                "rev": int(prev.get("rev") or 0) + 1,
                "agent": str(args.get("agent") or "unknown")[:40],
                "note": str(args.get("note") or "")[:200],
            }],
        }
        agent = rec["agent"]
        profiles = dict(prev.get("profiles") or {})
        profiles[agent] = {"last_rev": rec["rev"], "ts": rec["ts"], "note": rec["note"]}
        rec["profiles"] = profiles
        COLLAB_PAD.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
        return {"ok": True, "pad": rec}
    if COLLAB_PAD.is_file():
        try:
            return {"ok": True, "pad": json.loads(COLLAB_PAD.read_text(encoding="utf-8"))}
        except json.JSONDecodeError:
            pass
    return {"ok": True, "pad": {"rev": 0, "body": "", "log": []}}


def _load_collab_index() -> dict[str, Any]:
    if COLLAB_INDEX.is_file():
        try:
            return json.loads(COLLAB_INDEX.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"root": "collab-index", "goal": "", "files": [], "log": []}


def grok_collab_index(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    action = str(args.get("action") or "read").strip().lower()
    COLLAB_INDEX.parent.mkdir(parents=True, exist_ok=True)
    data = _load_collab_index()
    if action == "post":
        path = re.sub(r"[^A-Za-z0-9_./-]", "", str(args.get("path") or "").strip())[:120].lstrip("/")
        if not path or ".." in path:
            raise ValueError("path required")
        body = str(args.get("text") or args.get("body") or "")[:8000]
        agent = str(args.get("agent") or "unknown")[:40]
        files = [f for f in (data.get("files") or []) if f.get("path") != path]
        files.append({"path": path, "text": body, "agent": agent, "ts": time.strftime("%Y-%m-%dT%H:%M:%S")})
        data["files"] = files[-40:]
        data["log"] = (data.get("log") or [])[-20:] + [{"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "agent": agent, "path": path}]
        COLLAB_INDEX.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        if not args.get("_quiet"):
            grok_group_chat({
                "action": "post",
                "agent": agent,
                "text": f"INDEX WRITE {path} ({len(body)} chars) grok_collab_index",
                "_ledger_skip": True,
                "_slash": True,
            })
        return {"ok": True, "index": data, "public": "https://render3d.app/mcp/collab-index"}
    return {"ok": True, "index": data, "public": "https://render3d.app/mcp/collab-index"}


def grok_stats(args: dict[str, Any] | None = None) -> dict[str, Any]:
    reports = grok_report({})
    votes = grok_vote({"action": "tally"})
    help_rows = grok_help_request({"action": "read"})
    idx = _load_collab_index()
    ping = (reports.get("pings") or {}).get("REPORT-PING-01") or {"n": 0, "avg_score": 0}
    comm_miss = 0
    if GROUP_CHAT.is_file():
        comm_miss = GROUP_CHAT.read_text(encoding="utf-8").lower().count("comm-miss")
    return {
        "ok": True,
        "repair_loop": {
            "peer_asks_max": HELP_LIMITS["peer_asks_max"],
            "peer_wait_min": HELP_LIMITS["peer_wait_min"],
            "then": HELP_LIMITS["then"],
            "comm_miss_mentions": comm_miss,
            "how": "miss→failure_id → peer×2/10min → @ledger → mule rm_queue → COMM_NO_WAKE then Sam. Verify = log_id on Team chat.",
        },
        "reports": ping,
        "help_requests": help_rows.get("count") or 0,
        "votes": list((votes.get("votes") or {}).keys()),
        "collab_files": len(idx.get("files") or []),
        "bench": "BENCH-COLLAB-01 planted 4 faults until crew write live/ via grok_collab_index",
        "slash": ["/me", "/update", "/stats"],
    }


def _run_slash(agent: str, text: str, log_id: str | None = None) -> None:
    raw = (text or "").strip()
    m = re.match(r"^/([a-z0-9_-]+)(?:\s+([\s\S]+))?$", raw, re.I)
    if not m:
        return
    cmd = m.group(1).lower()
    rest = (m.group(2) or "").strip()[:400]
    if cmd == "me":
        sid = "skill_me_" + uuid.uuid4().hex[:8]
        topic = rest or "formulate a CODE prompt for harness"
        SLASH_SKILLS.parent.mkdir(parents=True, exist_ok=True)
        with SLASH_SKILLS.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "skill_id": sid, "cmd": "/me", "agent": agent, "topic": topic, "log_id": log_id}) + "\n")
        grok_collab_index({
            "action": "post",
            "agent": agent,
            "path": f"skills/{sid}.md",
            "text": f"# /me {sid}\nActivate: crew talks among themselves, then one posts CODE @pad @cursor-engineer.\nTopic: {topic}\n",
            "_quiet": True,
        })
        grok_group_chat({
            "action": "post",
            "agent": "cursor-engineer",
            "text": (
                f"SKILL /me {sid} ON @project-manager @vibe-rnd @analytics @instruction-auditor @ledger. "
                f"Talk among yourselves on: {topic}. Then ONE post: CODE @pad @cursor-engineer <prompt>. "
                f"Write your code into the collab index: grok_collab_index path=live/<you>.py. Indexed real time."
            ),
            "_slash": True,
        })
        return
    if cmd == "update":
        grok_group_chat({
            "action": "post",
            "agent": "cursor-engineer",
            "text": (
                "/update BREAKDOWN re: " + str(log_id or "") + "\n"
                "Live: @ tags typeahead · REPORT-PING · collab index IDE (wiring-sim tree) · slash /me /update /stats.\n"
                "Repair loop: miss+failure_id → peer×2/10m → @ledger → mule → COMM_NO_WAKE then Sam. Verify=log_id.\n"
                "Indexed notes: notes/REPAIR-LOOP.md notes/TESTING.md slash/COMMANDS.md GET /mcp/collab-index\n"
                "Bots write live/<agent>.* via grok_collab_index. BENCH-COLLAB-01 still 4 planted until you fix."
            ),
            "_slash": True,
            "_ledger_skip": True,
        })
        return
    if cmd == "stats":
        st = grok_stats()
        ping = st.get("reports") or {}
        grok_group_chat({
            "action": "post",
            "agent": "cursor-engineer",
            "text": (
                f"/stats BREAKDOWN reports n={ping.get('n')} avg={ping.get('avg_score')} "
                f"help={st.get('help_requests')} files={st.get('collab_files')} "
                f"COMM-MISS mentions={st['repair_loop']['comm_miss_mentions']} votes={','.join(st.get('votes') or []) or 'none'}. "
                f"Repair: peer {st['repair_loop']['peer_asks_max']}/{st['repair_loop']['peer_wait_min']}m then Ledger. "
                f"{st.get('bench')}"
            ),
            "_slash": True,
            "_ledger_skip": True,
        })
        return
    grok_group_chat({
        "action": "post",
        "agent": "cursor-engineer",
        "text": "Unknown slash. Use /me <topic> · /update · /stats",
        "_slash": True,
        "_ledger_skip": True,
    })


def grok_help_request(args: dict[str, Any] | None = None) -> dict[str, Any]:
    args = args or {}
    action = str(args.get("action") or "read").strip().lower()
    HELP_REQUESTS.parent.mkdir(parents=True, exist_ok=True)
    if action == "limits":
        return {"ok": True, "limits": HELP_LIMITS}
    if action == "post":
        agent = str(args.get("agent") or "").strip()[:40] or "unknown"
        text = str(args.get("text") or args.get("need") or "").strip()[:800]
        if not text:
            raise ValueError("text is required")
        rec = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "request_id": "req_" + uuid.uuid4().hex[:12],
            "agent": agent,
            "ask": str(args.get("ask") or "peer").strip()[:40],
            "kind": str(args.get("kind") or "help").strip()[:24],
            "category_id": str(args.get("category_id") or "OTH").strip()[:8],
            "traceback_ids": args.get("traceback_ids") or [str(args.get("traceback_id") or "")],
            "prompt_id": str(args.get("prompt_id") or ("prm_" + uuid.uuid4().hex[:10])),
            "peer_asks_max": int(args.get("peer_asks_max") or HELP_LIMITS["peer_asks_max"]),
            "ask_sam_when": str(args.get("ask_sam_when") or HELP_LIMITS["ask_sam_when"][2])[:200],
            "text": text,
        }
        rec["traceback_ids"] = [t for t in rec["traceback_ids"] if t] or [rec["request_id"]]
        with HELP_REQUESTS.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        grok_group_chat({
            "action": "post",
            "agent": agent,
            "text": (
                f"REQUEST @{rec['request_id']} ask={rec['ask']} kind={rec['kind']} "
                f"cat={rec['category_id']} tb={','.join(rec['traceback_ids'])} "
                f"peer_max={rec['peer_asks_max']} ask_sam_when={rec['ask_sam_when']}\n{text}"
            ),
            "_ledger_skip": True,
        })
        return {"ok": True, "request": rec, "limits": HELP_LIMITS, "public": "https://render3d.app/mcp/help-requests"}
    rows = []
    if HELP_REQUESTS.is_file():
        for line in HELP_REQUESTS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    n = max(1, min(int(args.get("limit") or 80), 200))
    return {"ok": True, "count": len(rows), "requests": rows[-n:], "limits": HELP_LIMITS}


def grok_mule_hop(args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Harness → Harness Mule (3706272). Mule fans Grok rooms. Does not wake the IDE."""
    args = args or {}
    action = str(args.get("action") or "read").strip().lower()
    MULE_OUTBOX.parent.mkdir(parents=True, exist_ok=True)
    if action in {"map", "roster"}:
        return {"ok": True, "map": MULE_MAP, "public": "https://render3d.app/mcp/mule-outbox"}
    if action == "post":
        text = str(args.get("text") or "").strip()[:2000]
        if not text:
            raise ValueError("text is required")
        sender = str(args.get("sender") or "cursor-engineer").strip()[:80]
        rec = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "hop_id": "MULE-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6],
            "direction": "mcp→grok",
            "from": sender,
            "mule_server_id": MULE_MAP["mule_server_id"],
            "mule_grok_id": MULE_MAP["mule_grok_id"],
            "room_id": str(args.get("room_id") or MULE_MAP["rooms"]["fire"]),
            "to_agent": str(args.get("to_agent") or MULE_MAP["agents"]["x-analytics"]),
            "to_name": str(args.get("to_name") or "x-analytics"),
            "tickets": args.get("tickets") or [],
            "text": text,
            "code": "COMM_QUEUED",
        }
        with MULE_OUTBOX.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        grok_group_chat({
            "action": "post",
            "agent": sender,
            "text": f"MULE HOP {rec['hop_id']} room={rec['room_id']} to={rec['to_name']}\n{text}",
            "_ledger_skip": True,
        })
        try:
            from backend.services import mcp_watchdog_service as wd

            wd.rm_queue({
                "agent": "harness-mule",
                "text": "OUTBOUND " + rec["hop_id"] + " " + text[:700],
                "tickets": list(rec["tickets"]) + [rec["hop_id"]],
            })
        except Exception:
            pass
        return {"ok": True, "hop": rec, "public": "https://render3d.app/mcp/mule-outbox"}
    rows = []
    if MULE_OUTBOX.is_file():
        for line in MULE_OUTBOX.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    n = max(1, min(int(args.get("limit") or 40), 200))
    return {"ok": True, "count": len(rows), "hops": rows[-n:], "map": MULE_MAP}


def grok_key_index(query: str | None = None) -> dict[str, Any]:
    """Search env key *names* and last4. Never return full secrets."""
    _load_dotenv_keys()
    q = str(query or "").strip().lower()
    rows = []
    for name, family, agent, purpose in KEY_INDEX_NAMES:
        val = _env(name)
        row = {
            "name": name,
            "family": family,
            "agent": agent,
            "purpose": purpose,
            "present": bool(val),
            "len": len(val),
            "last4": val[-4:] if len(val) >= 4 else (val if val else ""),
        }
        blob = " ".join(str(row[k]) for k in row).lower()
        if q and q not in blob:
            continue
        rows.append(row)
    can_tweet = bool(
        (_env("XCHAT_BOT_TOKEN") or _env("X_BOT_TOKEN"))
        or (_env("TWITTER_ACCESS_TOKEN") and _env("TWITTER_ACCESS_TOKEN_SECRET"))
        or _env("RENDER_STUDIO_TOKEN")
    )
    return {
        "ok": True,
        "query": q,
        "keys": rows,
        "can_tweet": can_tweet,
        "gap": None if can_tweet else "TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_TOKEN_SECRET or XCHAT_BOT_TOKEN",
        "cursor_x_mcp": "authenticated read/chat (@winstead_works) — no create-tweet tool",
        "secrets_in_response": False,
    }


def grok_tweet_for_agent(args: dict[str, Any]) -> dict[str, Any]:
    """Agents send copy here. Cursor posts as itself for them. Queues if user tokens missing."""
    agent = str(args.get("agent") or "vibe-rnd").strip()[:40]
    text = str(args.get("text") or args.get("prompt") or "").strip()
    confirm = bool(args.get("confirm"))
    if not text:
        raise ValueError("text is required")
    attributed = f"Posted by Cursor for {agent}: {text}"
    if len(attributed) > 280:
        attributed = attributed[:277] + "..."
    path = REPO_ROOT / "ai-context" / "agent-bus" / "tweet-queue.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "agent": agent,
        "text": text[:500],
        "attributed": attributed,
        "confirm": confirm,
        "posted": False,
    }
    if not confirm:
        rec["status"] = "draft"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
        return {"ok": True, "queued": True, "posted": False, "via": "queue", "text": attributed, "path": str(path)}
    try:
        posted = x_post(attributed, confirm=True)
        rec["posted"] = bool(posted.get("posted"))
        rec["tweet_id"] = posted.get("id") or ""
        rec["status"] = "posted" if rec["posted"] else "failed"
        rec["via"] = posted.get("via") or "x_post"
    except Exception as exc:
        rec["status"] = "blocked"
        rec["error"] = str(exc)[:200]
        posted = {"ok": False, "posted": False, "error": rec["error"]}
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    return {"ok": rec.get("status") == "posted", "queued": rec.get("status") != "posted", **posted, "attribution": attributed, "queue": str(path)}


def grok_marketing(section: str | None = None, query: str | None = None) -> dict[str, Any]:
    """Load MARKETING.md for X posts. Never includes secrets."""
    path = MARKETING_MD
    if not path.is_file():
        return {
            "ok": False,
            "path": str(path),
            "message": "MARKETING.md is missing next to server.py. Restore mcp/grok-bot/MARKETING.md.",
        }
    text = path.read_text(encoding="utf-8")
    needle = str(section or "").strip()
    q = str(query or "").strip().lower()
    excerpt = text
    matched = None
    if needle:
        parts = text.split("\n## ")
        head = parts[0]
        found = None
        for i, part in enumerate(parts):
            if i == 0:
                title = "Render Studio — Grok bot marketing source"
                body = part
            else:
                line = part.split("\n", 1)[0]
                title = line.strip()
                body = "## " + part
            if needle.lower() in title.lower() or needle.lower() in (body[:80].lower()):
                found = body if i else head
                matched = title
                break
        if found:
            excerpt = found
        else:
            excerpt = text
            matched = None
    if q:
        lines = excerpt.splitlines()
        hits = [ln for ln in lines if q in ln.lower()]
        if hits:
            excerpt = "\n".join(hits[:200])
            matched = (matched or "query") + f" ({len(hits)} line hits, showing up to 200)"
    rules = (
        "Always name the product Render Studio. Always include https://render3d.app. "
        "Caption footer: Built in Render Studio https://render3d.app. "
        "Draft with x_post confirm=false. Do not invent features. Do not spend paid Generate."
    )
    return {
        "ok": True,
        "path": str(path),
        "url_prod": "https://render3d.app/",
        "section": matched,
        "chars": len(excerpt),
        "rules": rules,
        "text": excerpt,
    }


def x_post(text: str, confirm: bool = False) -> dict[str, Any]:
    _load_dotenv_keys()
    caption = str(text or "").strip()
    if not caption:
        raise ValueError("text is required")
    if _studio_token():
        return _studio(
            "/api/integrations/grok-bot/x-post",
            method="POST",
            body={"text": caption, "confirm": bool(confirm)},
        )
    if not confirm:
        return {
            "ok": True,
            "dry_run": True,
            "posted": False,
            "text": caption,
            "message": "Draft only — not posted. Set confirm=true to publish via Studio or user OAuth.",
        }
    bot = _env("XCHAT_BOT_TOKEN") or _env("X_BOT_TOKEN") or _sqlite_bot_token()
    if bot:
        data = _http_json(
            "POST",
            "https://api.twitter.com/2/tweets",
            body={"text": caption},
            headers={"Authorization": f"Bearer {bot}"},
        )
        tweet = (data.get("data") or {}) if isinstance(data, dict) else {}
        return {"ok": True, "dry_run": False, "posted": True, "id": str(tweet.get("id") or ""), "via": "xchat_bot"}
    access = _env("TWITTER_ACCESS_TOKEN")
    access_sec = _env("TWITTER_ACCESS_TOKEN_SECRET")
    ck = _env("X_CONSUMER_KEY") or _env("TWITTER_CLIENT_ID")
    cs = _env("X_CONSUMER_SECRET") or _env("TWITTER_CLIENT_SECRET")
    if access and access_sec and ck and cs:
        try:
            from requests_oauthlib import OAuth1
            import requests

            tweet = requests.post(
                "https://api.twitter.com/2/tweets",
                auth=OAuth1(ck, cs, access, access_sec),
                json={"text": caption},
                headers={"Content-Type": "application/json"},
                timeout=60,
            )
        except Exception as exc:
            raise RuntimeError("oauth1 post failed: " + str(exc)[:160]) from exc
        if tweet.status_code >= 400:
            raise RuntimeError(f"X post failed HTTP {tweet.status_code}: {tweet.text[:200]}")
        data = (tweet.json() or {}).get("data") or {}
        return {"ok": True, "dry_run": False, "posted": True, "id": str(data.get("id") or ""), "via": "oauth1_user"}
    raise RuntimeError(
        "App keys are present (consumer/bearer) but cannot tweet. "
        "Need TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_TOKEN_SECRET (user) or XCHAT_BOT_TOKEN. "
        "Cursor plugin-x-x is read/chat only — no create-tweet."
    )


def _sqlite_bot_token() -> str:
    try:
        from backend.database import get_conn
        from backend.services.grok_bot_service import _load_bot_token, ensure_schema

        ensure_schema()
        with get_conn() as conn:
            row = conn.execute(
                """
                SELECT user_id FROM user_grok_bot
                 WHERE x_bot_token_enc IS NOT NULL AND trim(x_bot_token_enc) != ''
                 ORDER BY enabled DESC, updated_at DESC
                 LIMIT 1
                """
            ).fetchone()
        if not row:
            return ""
        return str(_load_bot_token(str(row["user_id"])) or "")
    except Exception:
        return ""


BUS_AGENTS = {
    "vibe-marketing",
    "vibe-sales",
    "vibe-rnd",
    "analytics",
    "clip-bot",
    "project-manager",
    "cursor-engineer",
}
BUS_INBOX = REPO_ROOT / "ai-context" / "agent-bus" / "inbox"
OPS_STORE = REPO_ROOT / "ai-context" / "agent-bus" / "ops.jsonl"


def agent_bus_submit(args: dict[str, Any]) -> dict[str, Any]:
    agent = str(args.get("agent") or "").strip().lower()
    if agent not in BUS_AGENTS:
        raise ValueError("agent must be one of: " + ", ".join(sorted(BUS_AGENTS)))
    packet = args.get("packet")
    if not isinstance(packet, dict):
        raise ValueError("packet must be a JSON object")
    cycle = str(args.get("cycle_id") or packet.get("cycle_id") or "").strip()
    cycle = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in cycle)[:40] or "CYCLE-open"
    schema = str(args.get("schema") or packet.get("schema") or "rs.agent.v1").strip()[:32]
    BUS_INBOX.mkdir(parents=True, exist_ok=True)
    path = BUS_INBOX / f"{cycle}-{agent}.json"
    body = {
        "schema": schema,
        "cycle_id": cycle,
        "agent": agent,
        "packet": packet,
    }
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    out = {"ok": True, "path": str(path), "cycle_id": cycle, "agent": agent, "schema": schema}
    tickets = packet.get("tickets") if isinstance(packet, dict) else None
    asks = None
    if isinstance(packet, dict):
        asks = packet.get("engineer_asks") or packet.get("engineer_ask")
    if agent == "project-manager" or schema.startswith("rs.pm") or tickets or asks:
        try:
            from backend.services import mcp_watchdog_service as wd

            ping = wd.notify_harness(
                {
                    "kind": "inbox-packet",
                    "from": agent,
                    "to": "cursor-engineer",
                    "cycle_id": cycle,
                    "schema": schema,
                    "path": str(path),
                    "tickets": tickets or [],
                    "engineer_asks": asks if isinstance(asks, list) else ([asks] if asks else []),
                    "msg_id": f"pkt-{cycle}-{agent}",
                }
            )
            out["harness_inbox"] = str(ping)
        except Exception:
            pass
    return out


def _ops_file_submit(args: dict[str, Any]) -> dict[str, Any]:
    """Works without pydantic/venv — LaunchAgent uses /usr/bin/python3."""
    import time

    cat = str(args.get("category_id") or "OTH").strip().upper()
    ops = args.get("ops") or []
    if not isinstance(ops, list) or not ops:
        raise ValueError("ops is required")
    prompt_id = str(args.get("prompt_id") or "prm_" + str(int(time.time())))[:64]
    row = {
        "schema": "rs.ops.v1",
        "prompt_id": prompt_id,
        "category_id": cat,
        "cycle_id": args.get("cycle_id") or "",
        "agent": args.get("agent") or "",
        "ops": [str(x) for x in ops][:24],
        "traceback_ids": args.get("traceback_ids") or [],
        "result_score": int(args.get("result_score") or 0),
        "result_ref_id": args.get("result_ref_id") or ("res_" + prompt_id.replace("prm_", "")),
        "ops_similarity": None,
        "damage_score": float(args.get("damage_score") or 0),
        "instance_id": args.get("instance_id") or "local",
        "instance_public_factor": float(args.get("instance_public_factor") or 0),
        "via": "jsonl",
    }
    OPS_STORE.parent.mkdir(parents=True, exist_ok=True)
    with OPS_STORE.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    try:
        if OPS_STORE.stat().st_size > 2_000_000:
            rotated = OPS_STORE.with_suffix(".jsonl.1")
            OPS_STORE.replace(rotated)
    except OSError:
        pass
    return row


def _ops_file_similar(category_id: str, probe: Any = None) -> dict[str, Any]:
    cat = str(category_id or "").strip().upper()
    rows = []
    if OPS_STORE.is_file():
        for line in OPS_STORE.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if str(item.get("category_id") or "").upper() == cat:
                rows.append(item)
    return {"schema": "rs.ops.v1", "category_id": cat, "matches": rows[-12:], "probe_ops": probe or []}


def agent_bus_inbox(limit: Any = None) -> dict[str, Any]:
    n = max(1, min(int(limit or 20), 50))
    files = []
    if BUS_INBOX.is_dir():
        files = [p.name for p in sorted(BUS_INBOX.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:n]]
    harness: list[str] = []
    try:
        from backend.services import mcp_watchdog_service as wd

        harness = list(wd.list_harness_inbox(n).get("files") or [])
    except Exception:
        pass
    return {"ok": True, "files": files, "harness_inbox": harness}


TOOLS = [
    {
        "name": "openarm_research",
        "description": (
            "Read locally indexed CAD physics estimates and record bounded OpenArm research, "
            "calibration, rollout, incident, and settings-proposal events. No robot actuation or "
            "settings apply. Read mcp/grok-bot/skills/openarm-research/SKILL.md first."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["guide", "overview", "events", "record"]},
                "kind": {"type": "string"},
                "project_id": {"type": "string"},
                "limit": {"type": "integer"},
                "data": {"type": "object"},
            },
            "required": ["action"], "additionalProperties": False,
        },
    },
    {
        "name": "grok_incident",
        "description": "Investigate Render Studio feature regressions, golden snapshots, prompt windows, smoke checks, weekly reports, confirmed findings, and the debug-self-improve training loop (similar traceback clusters, prompt/hour retros). Studio incident data requires a super-admin RENDER_STUDIO_TOKEN; smoke alone can inspect the local MCP host without one and labels its origin. Read mcp/grok-bot/skills/incident-research/SKILL.md and mcp/grok-bot/skills/debug-self-improve/SKILL.md before writing a conclusion. When tracing mentioned files or a debugger send, also read mcp/grok-bot/DEBUG-PATH-TRACER.md. No arbitrary code execution.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["guide", "overview", "query", "compare", "prompts", "prompt", "snapshot", "event", "field", "smoke", "weekly", "finding", "log", "search", "checklist", "export", "vote", "audit", "inbox", "accuracy", "debug_overview", "debug_similar", "debug_report", "debug_instances"]},
                "feature": {"type": "string"},
                "log_id": {"type": "string"},
                "export_id": {"type": "string"},
                "project_id": {"type": "string"},
                "prompt_id": {"type": "string"},
                "q": {"type": "string", "description": "Keyword search over indexed Cursor chat logs."},
                "filters": {"type": "object"},
                "limit": {"type": "integer"},
                "data": {"type": "object", "description": "Body for snapshot, event, field, finding, or checklist."},
            },
            "required": ["action"], "additionalProperties": False,
        },
    },
    {
        "name": "grok_debugger",
        "description": "Debugger analytics: compact search ids, draft watchdogs/CLI (Sam must approve before run), self-analysis, weekly graphs, gated bug ids, harness ping, desired-result scores, skill proposals, explain_tracking (API+logs, harness1, no prod writes). Read mcp/grok-bot/skills/debugger-analytics/SKILL.md first (action=guide). No arbitrary code.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["guide", "search_ids", "cli_request", "watchdog_draft", "inbox", "analysis", "weekly", "bug", "ping", "notes", "skill_proposal", "throttle", "score", "overview", "approve", "privilege", "ask_safe", "ban", "fork", "rollback", "issue", "logic_report", "latency", "confirm_fixed", "confirm_candidate", "reject_candidate", "suggestion", "blacklist", "archive_watchdog", "metrics", "taxonomy", "history", "history_ids", "history_get", "readonly_cli", "cli_readonly", "catalog", "agree", "credit", "agent_report", "league_cycle", "league", "agent_ops", "ingest_jsonl", "rollup_live", "credit_tick", "swarm_tick", "debug_jobs", "claim_debug_job", "swarm_summary", "cad_snapshots", "stamp_feature", "mcp_watchdog", "instance_registry", "lookup_area", "resolve_instance", "cad_votes", "list_cad_votes", "record_cad_vote", "cad_vote", "cost_report", "session_close", "session_cede", "explain_tracking", "explain_api", "explain_logs"]},
                "q": {"type": "string"},
                "feature": {"type": "string"},
                "bug_id": {"type": "string"},
                "id": {"type": "string"},
                "job_id": {"type": "string", "description": "Required for confirm_candidate / reject_candidate. No default job."},
                "limit": {"type": "integer"},
                "data": {"type": "object"},
            },
            "required": ["action"], "additionalProperties": False,
        },
    },
    {
        "name": "agent_intro_pack",
        "description": "Return Agent Introductions pack path and ref_id INTRO-20260916 for specialists.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "agent_intro_handshake",
        "description": "Record handshake phrase from an agent. project-manager uses the Cursor-first code word.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {"type": "string"},
                "phrase": {"type": "string"},
            },
            "required": ["agent", "phrase"],
            "additionalProperties": False,
        },
    },
    {
        "name": "agent_sandbox_reset",
        "description": "Wipe logs/Agent_Introductions/sandbox for a clean ops trial.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "agent_sandbox_run",
        "description": "Run ping|add|fail in the wipeable sandbox. Logs traceback_id to traces/trace.jsonl.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "op": {"type": "string"},
                "a": {"type": "integer"},
                "b": {"type": "integer"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "agent_refpack_upload",
        "description": (
            "Copy an allowlisted source/log file into logs/Agent_Introductions/RefPack/uploads/{agent}/. "
            "No secrets. Use for INTRO-20260916 reference pack."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {"type": "string"},
                "src": {"type": "string", "description": "Absolute or repo-relative path of a file to copy."},
            },
            "required": ["agent", "src"],
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_status",
        "description": "Show Grok bot connection: X developer app keys present, Grok/xAI key saved. Never returns secrets.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "grok_chat",
        "description": "Chat with xAI Grok using the connected Grok API key.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "User message for Grok."},
                "system": {"type": "string", "description": "Optional system prompt."},
                "model": {"type": "string", "description": "Optional model id (default GROK_MODEL / grok-4.5)."},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "grok_wiring",
        "description": "Return numbered setup/wiring steps: Grok MCP, Studio apps, env keys, and PM→RM rm_queue (never agent_converse as cursor-engineer).",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "grok_dimos_status",
        "description": "Show saved DIMOS robot PC host for Grok bot (LAN IP:8443). Never returns secrets. Does not move joints.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "grok_dimos_connect",
        "description": "Save DIMOS robot PC LAN IP (e.g. 192.168.1.77) and probe :8443. Extends Grok toward OpenArm teleop pipe. Does not arm teleop.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host": {"type": "string", "description": "LAN IPv4 or IP:8443"},
                "probe": {"type": "boolean", "description": "Probe TCP/HTTPS after save (default true)"},
            },
            "required": ["host"],
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_dimos_probe",
        "description": "Probe DIMOS host reachability without saving (or probe the saved host if host omitted).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host": {"type": "string", "description": "Optional LAN IPv4; omit to use saved link"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_mujoco_run",
        "description": "Read openarm-mujoco/runs/latest.json end-of-run analysis (token mujoco1). IK + feature_checks. Does not move joints.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "grok_robotics_runbook",
        "description": "Quest Y engage + MuJoCo MCP instructions for operators and agents (robotics-runbook.md).",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "agent_bus_submit",
        "description": (
            "Submit a specialist SCORECARD or rs.score.v1 / PM_PACKET to the Cursor inbox. "
            "Writes ai-context/agent-bus/inbox/{cycle_id}-{agent}.json. No secrets. "
            "Cursor reads this folder; do not paste transcripts."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {
                    "type": "string",
                    "description": "vibe-marketing | vibe-sales | vibe-rnd | analytics | clip-bot | project-manager",
                },
                "cycle_id": {"type": "string", "description": "CYCLE-YYYYMMDD-HHMM"},
                "packet": {
                    "type": "object",
                    "description": "SCORECARD, rs.score.v1, or PM_PACKET (schema rs.agent.v1).",
                },
                "schema": {"type": "string", "description": "rs.agent.v1 | rs.score.v1 | rs.vision.v1"},
            },
            "required": ["agent", "packet"],
            "additionalProperties": False,
        },
    },
    {
        "name": "agent_ops_submit",
        "description": (
            "Upload rs.ops.v1: prompt_id, category_id, ops[], traceback_ids[], "
            "result_score 0-100, damage_score, instance_public_factor (0 if not public)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt_id": {"type": "string"},
                "category_id": {"type": "string"},
                "cycle_id": {"type": "string"},
                "agent": {"type": "string"},
                "ops": {"type": "array", "items": {"type": "string"}},
                "traceback_ids": {"type": "array", "items": {"type": "string"}},
                "result_score": {"type": "integer"},
                "result_ref_id": {"type": "string"},
                "damage_score": {"type": "number"},
                "instance_id": {"type": "string"},
                "instance_public_factor": {"type": "number"},
                "log_id": {"type": "string"},
                "project_id": {"type": "string"},
            },
            "required": ["category_id", "ops", "result_score"],
            "additionalProperties": False,
        },
    },
    {
        "name": "agent_ops_similar",
        "description": "List similar prompt-ops runs in a taxonomy category_id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "category_id": {"type": "string"},
                "ops": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["category_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "agent_bus_inbox",
        "description": "List recent agent-bus inbox files (ids only, no secrets).",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "pm_prompt_kit",
        "description": (
            "Starter prompt Sam pastes to the project-manager to open the hire/comms loop. "
            "Also listed as MCP prompt pm-first-loop."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "cycle_id": {"type": "string", "description": "CYCLE-YYYYMMDD-HHMM (default CYCLE-20260916-PM1)"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "pm_prompt_submit",
        "description": (
            "Project-manager submits a project prompt to Cursor. First submit is scored and "
            "emailed to sam@render3d.app (prompt + score + hire yes/no). First reply is an "
            "outline plus a team-comms question for Getting-Started skill fan-out."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "The PM's project prompt to Cursor."},
                "agent": {"type": "string", "description": "project-manager"},
                "cycle_id": {"type": "string"},
                "prompt_id": {"type": "string"},
            },
            "required": ["prompt"],
            "additionalProperties": False,
        },
    },
    {
        "name": "pm_prompt_status",
        "description": "List PM prompt submissions (ids, first-prompt score, hire).",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "agent_hello",
        "description": (
            "Required first MCP talk for the comms watchdog. "
            "Marks this agent present on conv_id until 19:00 CDT."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {"type": "string"},
                "conv_id": {"type": "string"},
            },
            "required": ["agent"],
            "additionalProperties": False,
        },
    },
    {
        "name": "agent_converse",
        "description": (
            "Post a message AS yourself on a conversation_id. "
            "vote: mcp_star | hybrid | slack. "
            "To reach Cursor/RM, set to=cursor-engineer (writes harness-inbox). "
            "Do not set agent=cursor-engineer unless you ARE the Cursor harness — that does not wake Cursor."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {"type": "string"},
                "conv_id": {"type": "string"},
                "text": {"type": "string"},
                "vote": {"type": "string"},
                "to": {"type": "string", "description": "cursor-engineer | regional-manager | harness — address TO RM without impersonating"},
            },
            "required": ["agent", "text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "mcp_watchdog_status",
        "description": "Live MCP comms watchdog: headcount of agent replies until 19:00 CDT, votes, report.",
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
    {
        "name": "rm_queue",
        "description": (
            "Queue a ticket INTO the live Cursor/RM harness inbox. Speak as yourself. "
            "Never set agent=cursor-engineer. Does not wake the IDE chat; RM pulls GET /mcp/rm-inbox."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {"type": "string"},
                "text": {"type": "string"},
                "tickets": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["agent", "text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "comms_webhook_register",
        "description": "Register an HTTP webhook. Every MCP hello/converse/rm_queue POSTs the event JSON. Failure code COMM_FANOUT_FAIL.",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
            "additionalProperties": False,
        },
    },
    {
        "name": "comms_broadcast",
        "description": "Fan a short text to broadcast.jsonl and all webhooks. Returns COMM_BROADCAST or COMM_FANOUT_*.",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "team_status_now",
        "description": "Publish a 10-minute team pulse (Cursor/team deltas, per-agent scores, Bender/Rick). Emails sam@render3d.app until 19:00 CDT. Debugger polls GET /mcp/team-chat.",
        "inputSchema": {
            "type": "object",
            "properties": {"force_email": {"type": "boolean"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "pm_goals_submit",
        "description": "Project-manager posts 3 one-line goals + overall goal (single lines).",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_auth_event",
        "description": (
            "Record which Cursor MCP plugin Sam connected: plugin, account email, assigned agent. "
            "Never store TOTP, passwords, or tokens."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "plugin": {"type": "string"},
                "email": {"type": "string"},
                "agent": {"type": "string"},
                "status": {"type": "string"},
                "source": {"type": "string"},
            },
            "required": ["plugin"],
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_help_request",
        "description": (
            "Help/API request thread. action=read|post|limits. "
            "Limits: 2 peer asks / 10 min then Ledger; Sam only for 2FA, Hub/money, or COMM-MISS. "
            "POST stores request_id + traceback_ids for agent_ops. GET /mcp/help-requests"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "agent": {"type": "string"},
                "text": {"type": "string"},
                "ask": {"type": "string"},
                "kind": {"type": "string"},
                "category_id": {"type": "string"},
                "traceback_ids": {"type": "array", "items": {"type": "string"}},
                "prompt_id": {"type": "string"},
                "peer_asks_max": {"type": "integer"},
                "ask_sam_when": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_auth_status",
        "description": "Last MCP auth events (plugin + email + agent). No secrets.",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_group_chat",
        "description": (
            "Read or post the public group thread. action=read|post. "
            "@agent @req_ @msg_gc_ @pad @code become tags (max 8). GET /mcp/tags. "
            "Public GET https://render3d.app/mcp/group-chat. Site: https://render3d.app/team-chat.html."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "agent": {"type": "string"},
                "text": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "additionalProperties": True,
        },
    },
    {
        "name": "grok_sandbox",
        "description": (
            "Sandbox file set only (frontend/sandbox, token sandbox1; cede_example is sandbox2; explain is harness1). "
            "action=list|read|write|rev|feed|cede_example|controls|notes|slides|pitch|benchmarks|explain|correct. "
            "Write hot-refreshes the Sandbox window. Never edits studio/app.js. "
            "explain = API + last3 + privileges + cost reports (no prod writes). "
            "correct = Sam 'that's wrong, change X' sandbox-only live edit. "
            "cede_example writes an MD/code example for harness review (apply=false). "
            "controls = live VR bindings (token xrctrl2) GET /mcp/sandbox/controls. "
            "feed = MCP bundle for https://render3d.app/team-chat.html (GET /mcp/team-chat/feed)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "path": {"type": "string"},
                "file": {"type": "string"},
                "text": {"type": "string"},
                "body": {"type": "string"},
                "q": {"type": "string"},
                "topic": {"type": "string"},
                "agent": {"type": "string"},
                "log_id": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_vote",
        "description": "Board votes. action=tally|post. BALLOT V-LOG-UI =A. GET /mcp/votes",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "agent": {"type": "string"},
                "vote_id": {"type": "string"},
                "choice": {"type": "string"},
                "text": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_tag",
        "description": "Read @tags on team-chat. @agent @req_ @msg_gc_ @pad @code. GET /mcp/tags?tag=",
        "inputSchema": {
            "type": "object",
            "properties": {
                "tag": {"type": "string"},
                "q": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_report",
        "description": "Read REPORT pings. REPORT ping=REPORT-PING-01 agent= result_score= succeed=. GET /mcp/reports?ping=",
        "inputSchema": {
            "type": "object",
            "properties": {"ping": {"type": "string"}, "q": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_collab_pad",
        "description": "Shared pad under team-chat. action=read|post. Agents stack code; one may plant a bug for the next to fix.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "agent": {"type": "string"},
                "text": {"type": "string"},
                "note": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_collab_index",
        "description": "Realtime collab file index (tree IDE). action=read|post. post path=live/<you>.py text=code. GET/POST /mcp/collab-index",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "agent": {"type": "string"},
                "path": {"type": "string"},
                "text": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_stats",
        "description": "Repair-loop / REPORT / bench breakdown. Team chat /stats. GET /mcp/stats",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "grok_ledger_relay",
        "description": (
            "Ledger identity + MCP relay. action=roster|whois|tick. "
            "WHOIS map of who is who. tick copies new team-chat lines to rm_queue and fans replies. "
            "GET https://render3d.app/mcp/ledger-relay"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_mule_hop",
        "description": (
            "Talk through Harness Mule (3706272). action=read|post|map. "
            "post queues mcp→grok hop (room + agent ids). Mule SendToAgent; harness does not enter Grok. "
            "GET /mcp/mule-outbox"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "text": {"type": "string"},
                "sender": {"type": "string", "description": "Actual calling agent; do not impersonate another agent."},
                "room_id": {"type": "string"},
                "to_agent": {"type": "string"},
                "to_name": {"type": "string"},
                "tickets": {"type": "array", "items": {"type": "string"}},
                "limit": {"type": "integer"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_drive_search",
        "description": (
            "Search the indexed Render Grok Bot Drive (vector + FTS). "
            "Folder https://drive.google.com/drive/folders/1knAIlz5TwDWJReRt6QnaFJaV69EA5VmK "
            "Table public.grok_drive_index. GET /mcp/drive-search?q="
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "q": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_key_index",
        "description": "Search X/Studio key names, presence, last4, owning agent. Never returns full secrets.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_tweet_for_agent",
        "description": (
            "Specialists send tweet copy here. Cursor posts as itself for that agent "
            "(prefix: Posted by Cursor for <agent>). confirm=true to publish."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "agent": {"type": "string"},
                "text": {"type": "string"},
                "prompt": {"type": "string"},
                "confirm": {"type": "boolean"},
            },
            "required": ["agent"],
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_pitch_deck",
        "description": (
            "Marketing AI writes a pitch deck (MD + PDF) into frontend/sandbox only. Token mktpitch1. "
            "Default topic: grow social presence for @a1_projects and @winstead_works (no fake follower counts). "
            "Does not auto-publish to X. Point left/right on the PDF to step slides."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "description": "generate|deck|post"},
                "topic": {"type": "string"},
                "title": {"type": "string"},
                "slides": {"type": "array"},
                "post": {"type": "boolean"},
            },
            "additionalProperties": True,
        },
    },
    {
        "name": "grok_rnd_benchmarks",
        "description": (
            "RnD posts a measurable benchmark plan (curriculum/rnd-benchmarks.md) for round table TTS, "
            "sandbox IDE, VR hot-reload, clip-bot, team chat, cost reports, voice approach, sandbox-off shapes. "
            "No fake dollars. WebGL=1. Keep sandbox1-4."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "post": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_rnd_demo",
        "description": (
            "Ping Rick to present VR Voice Bench PDF in sandbox PDF viewer + VR laser. Token rnddemo1. "
            "Keeps mktpres1 and rndbench1. No extra WebGL. Harness apply=false."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "description": "deck|present|ping"},
                "post": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_agent_tasks",
        "description": (
            "Per-agent task lists. Sam assigns. Ledger posts status when a task completes. "
            "Live feed JSON at GET /mcp/sandbox/tasks. Token rnddemo1."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "description": "list|assign|complete"},
                "agent": {"type": "string"},
                "title": {"type": "string"},
                "id": {"type": "string"},
                "note": {"type": "string"},
                "post": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_marketing",
        "description": (
            "Load Render Studio MARKETING.md (features, May–Sep 2026 changelog, media paths, "
            "GIF/video/3D generation recipes, X caption rules). Use before grok_chat / x_post. "
            "Optional section matches a ## heading; query filters lines."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "section": {
                    "type": "string",
                    "description": "Optional ## heading, e.g. Brand, Master feature inventory, Changelog May–Sep 2026, Asset catalog, How to generate, X posting guidance.",
                },
                "query": {
                    "type": "string",
                    "description": "Optional substring filter on lines (finder, catalog, GIF, VR, …).",
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "grok_request_clip",
        "description": (
            "Ask this Mac’s Grok MCP listener to make a docs GIF or short clip. "
            "Uses the same studio-dark 720×400 guide recipe as scripts/gif-demos/. "
            "Does not run paid Generate. MP4 stays in the Cursor harness inbox. "
            "Optional run=sept|aug|getting-started|robotics|source-parts reruns those recorders."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Feature name, e.g. Viewport finder."},
                "prompt": {
                    "type": "string",
                    "description": "What the loop should show. Short steps, not a Generate CAD prompt.",
                },
                "kind": {
                    "type": "string",
                    "description": "gif (default), mp4, or webm.",
                },
                "slug": {"type": "string", "description": "Optional filename stem without .gif"},
                "run": {
                    "type": "string",
                    "description": "Optional known recorder: sept, aug, getting-started, robotics, source-parts.",
                },
                "live": {
                    "type": "boolean",
                    "description": "If true, record real Studio UI (Playwright) instead of a guide stub.",
                },
                "callback_url": {
                    "type": "string",
                    "description": "Optional HTTPS URL to POST the job JSON when done. Prefer this over polling.",
                },
                "wait": {
                    "type": "integer",
                    "description": "Optional long-poll seconds (max 120) so this call returns the finished file.",
                },
            },
            "required": ["title"],
        },
    },
    {
        "name": "grok_clip_status",
        "description": "Poll a grok_request_clip job. Returns public /docs/media URL and repo path when done.",
        "inputSchema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "grok_clips",
        "description": (
            "List the clip board: every GIF/MP4 URL and repo path the bot can grab. "
            "Set ungrabbed=true to see only files not yet marked grabbed."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "ungrabbed": {
                    "type": "boolean",
                    "description": "If true, only clips the bot has not marked grabbed.",
                }
            },
        },
    },
    {
        "name": "grok_clip_wait",
        "description": (
            "Long-poll a clip job until done/error (max 120s). Prefer this over rapid grok_clip_status. "
            "If timeout=true, call again with the same job_id."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "timeout": {"type": "integer", "description": "Seconds to wait, default 90, max 120."},
            },
            "required": ["job_id"],
        },
    },
    {
        "name": "grok_clip_grab",
        "description": "Mark a clip as grabbed after the bot copied the file. Pass job_id, or url/path.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "url": {"type": "string"},
                "path": {"type": "string"},
                "by": {"type": "string", "description": "Who grabbed it (default grok-bot)."},
            },
        },
    },
    {
        "name": "x_post",
        "description": "Draft (default) or publish a tweet using the user's X app. Tests must leave confirm false.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Tweet text, max 280 characters."},
                "confirm": {"type": "boolean", "description": "Must be true to publish. Default false (draft only)."},
            },
            "required": ["text"],
        },
    },
    {
        "name": "grok_music_request",
        "description": (
            "Download or reuse a song for a Render Studio social post. Pass the song name (not a dirty YouTube dump). "
            "Prefers official/Topic/VEVO; else the most popular remaining match. Never clean/non-explicit, covers, or instrumentals. "
            "Always send reason: x_post, instagram_post, linkedin_post, or other, plus a one-line why (the post you are making). "
            "Returns hosted MP3 download_url and player_url. After the post is live, call grok_social_post."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Song name, e.g. Travis Scott FE!N"},
                "url": {"type": "string", "description": "Optional YouTube video or playlist URL"},
                "playlist": {"type": "string", "description": "Our playlist id (render-hype) or a YouTube playlist URL"},
                "reason": {
                    "type": "string",
                    "description": "x_post | instagram_post | linkedin_post | other",
                },
                "reason_detail": {"type": "string", "description": "What you are posting and where"},
            },
        },
    },
    {
        "name": "grok_music_library",
        "description": "List hosted playlists and MP3s with request counts, player URLs, and download URLs.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "grok_social_post",
        "description": (
            "After a live social post that used a requested track, insert the public URL. "
            "Pass same_video_group when the exact same video went to a second platform so Management can compare."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "track_id": {"type": "string"},
                "request_id": {"type": "string"},
                "platform": {"type": "string", "description": "x | instagram | linkedin | other"},
                "post_url": {"type": "string"},
                "same_video_group": {"type": "string", "description": "Shared id when the same video is on two platforms"},
                "posted_at": {"type": "string"},
            },
            "required": ["post_url", "platform"],
        },
    },
    {
        "name": "grok_social_checkin",
        "description": (
            "Check in on a post: days 1–3 then weekly for 4 weeks. Include views/impressions, comments text, "
            "why it did well or poorly, sentiment (positive/negative/mixed), and whether negativity or positivity drove virality."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "post_id": {"type": "string"},
                "views": {"type": "integer"},
                "impressions": {"type": "integer"},
                "likes": {"type": "integer"},
                "comments_count": {"type": "integer"},
                "reposts": {"type": "integer"},
                "comments": {"type": "array"},
                "why_good_or_bad": {"type": "string"},
                "sentiment": {"type": "string"},
                "viral_from": {"type": "string", "description": "positive | negative | none"},
                "advice": {"type": "string"},
                "kind": {"type": "string"},
            },
            "required": ["post_id"],
        },
    },
    {
        "name": "grok_social_weekly",
        "description": "Upload the weekly social analytics report to Management → Social media. Required every week.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "week_of": {"type": "string", "description": "YYYY-MM-DD of the week start"},
                "summary": {"type": "string"},
                "wins": {"type": "string"},
                "losses": {"type": "string"},
                "sentiment": {"type": "string"},
                "viral_from": {"type": "string"},
                "recommendations": {"type": "string"},
                "platforms": {"type": "object"},
            },
            "required": ["summary"],
        },
    },
    {
        "name": "grok_taste",
        "description": (
            "Load Sam's taste pack: top requested tracks, knowledge files (posts/PDFs), quality rules, and latest scraper output. "
            "Call this before picking music or writing a caption."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


def _call_tool(name: str, arguments: dict[str, Any] | None) -> Any:
    args = arguments or {}
    if name not in {"mcp_watchdog_status", "agent_hello", "agent_converse"}:
        try:
            from backend.services import mcp_watchdog_service as wd

            wd.note_tool(str(name), args)
        except Exception:
            pass
    if name == "openarm_research":
        from backend.services import openarm_research_service as research

        action = str(args.get("action") or "")
        if action == "guide":
            return {
                "skill": _skill_text("openarm-research"),
                "calibration_skill": _skill_text("openarm-calibration"),
            }
        if action == "overview":
            return research.overview()
        if action == "events":
            return research.list_events(kind=args.get("kind"), project_id=args.get("project_id"), limit=args.get("limit") or 30)
        if action == "record":
            return research.record_event(args.get("data") or {})
        raise ValueError("unknown openarm_research action")
    if name == "grok_incident":
        action = str(args.get("action") or "")
        if action == "guide":
            skill = _skill_text("incident-research")
            tracer = HERE / "DEBUG-PATH-TRACER.md"
            out = {
                "skill": skill,
                "skill_path": "ai-context/skills/incident-research/SKILL.md",
                "debug_path_tracer_path": "mcp/grok-bot/DEBUG-PATH-TRACER.md",
                "debug_self_improve_path": "ai-context/skills/debug-self-improve/SKILL.md",
                "then": "Load DEBUG-PATH-TRACER.md only when tracing files. Load debug-self-improve only when filing a retro.",
            }
            if tracer.is_file():
                out["debug_path_tracer"] = tracer.read_text(encoding="utf-8")
            return out
        base = "/api/ops/incidents"
        if action == "overview":
            return _studio(base + "/overview")
        if action == "query":
            return _studio(base + "/query", method="POST", body={"filters": args.get("filters") or {}, "limit": args.get("limit") or 100})
        if action == "compare":
            return _studio(base + "/compare/" + urllib.parse.quote(str(args.get("feature") or ""), safe=""))
        if action == "log":
            return _studio(base + "/logs/" + urllib.parse.quote(str(args.get("log_id") or ""), safe=""))
        if action in {"prompts", "prompt"}:
            project_id = urllib.parse.quote(str(args.get("project_id") or ""), safe="")
            path = base + "/prompts/" + project_id
            if action == "prompt":
                path += "/" + urllib.parse.quote(str(args.get("prompt_id") or ""), safe="")
            return _studio(path)
        if action == "search":
            q = urllib.parse.quote(str(args.get("q") or args.get("feature") or ""), safe="")
            try:
                return _studio(base + "/search?q=" + q + "&limit=" + str(int(args.get("limit") or 40)))
            except Exception as exc:
                off = _debugger_offline()
                if not off.studio_unavailable(exc):
                    raise
                from backend.services import incident_intelligence_service as ii

                out = ii.search_chat_logs(str(args.get("q") or args.get("feature") or ""), limit=int(args.get("limit") or 40))
                if isinstance(out, dict):
                    out.setdefault("via", "local")
                return out
        if action == "smoke" and not _studio_token():
            # The MCP process can inspect its own server host without a user's
            # Studio JWT. Label the origin so a remote MCP host is never
            # mistaken for the browser or a different Studio instance.
            from backend.services import incident_intelligence_service as ii

            out = ii.system_smoke()
            out["via"] = "grok_mcp_local_host"
            out["note"] = "Metrics describe the Grok MCP host. Browser, viewport, and Quest checks remain unknown."
            return out
        if action in {"snapshot", "event", "field", "smoke", "finding", "checklist"}:
            path = {"snapshot": "/snapshots", "event": "/events", "field": "/listener/fields", "smoke": "/smoke", "finding": "/findings", "checklist": "/checklist"}[action]
            return _studio(base + path, method="POST", body=args.get("data") or {})
        if action == "weekly":
            return _studio(base + "/weekly")
        if action == "export":
            return _studio(base + "/exports", method="POST", body=args.get("data") or {"destination": "grok", "feature": args.get("feature")})
        if action == "vote":
            export_id = urllib.parse.quote(str(args.get("export_id") or args.get("log_id") or ""), safe="")
            return _studio(base + "/exports/" + export_id + "/vote", method="POST", body=args.get("data") or {})
        if action == "audit":
            return _studio(base + "/audits", method="POST", body=args.get("data") or {})
        if action == "inbox":
            return _studio(base + "/inbox")
        if action == "accuracy":
            return _studio(base + "/accuracy")
        if action == "debug_overview":
            return _studio("/api/debug-training/overview")
        if action == "debug_similar":
            q = urllib.parse.quote(str(args.get("q") or args.get("feature") or ""), safe="")
            return _studio("/api/debug-training/similar?q=" + q + "&limit=" + str(int(args.get("limit") or 40)))
        if action == "debug_report":
            return _studio("/api/debug-training/reports", method="POST", body=args.get("data") or {})
        if action == "debug_instances":
            return _studio("/api/debug-training/instances")
        raise ValueError("Unknown incident action")
    if name == "grok_debugger":
        action = str(args.get("action") or "")
        if action == "cli_readonly":
            action = "readonly_cli"
        if action in {"explain_tracking", "explain_api", "explain_logs"}:
            return grok_explain_tracking(args)
        if action == "guide":
            out = {
                "skill": _skill_text("debugger-analytics"),
                "skill_path": "ai-context/skills/debugger-analytics/SKILL.md",
                "harness": _skill_text("debugger-analytics", "HARNESS.md"),
                "harness_path": "mcp/grok-bot/skills/debugger-analytics/HARNESS.md",
                "must_read": True,
                "catalog_lite": True,
                "catalog_path": "ai-context/skills/debug-id-catalog/SKILL.md",
                "catalog_reference": "ai-context/skills/debug-id-catalog/CATALOG-REFERENCE.md",
                "then": "Call grok_debugger action=catalog once (lite ids). Read CATALOG-REFERENCE.md only if you need full tables. Then action=agree. Credit is a dashboard metric, not a write license. Do not PROMPT_RESULT on ordinary chat — only regressions or deploy receipts.",
            }
            try:
                out["catalog"] = _debugger_offline()._lite_catalog()
            except Exception:
                pass
            return out
        base = "/api/ops/debugger-analytics"
        data = args.get("data") if isinstance(args.get("data"), dict) else {}
        then = lambda path, **kw: _studio_then(path, action=action, args=args, data=data, **kw)
        if action == "search_ids":
            q = urllib.parse.quote(str(args.get("q") or args.get("feature") or ""), safe="")
            return then(base + "/search?q=" + q + "&limit=" + str(int(args.get("limit") or 40)))
        if action == "cli_request":
            return then(base + "/cli", method="POST", body=data or {"command_key": args.get("q") or "journalctl_render3d"}, kind="write")
        if action == "watchdog_draft":
            return then(base + "/watchdogs", method="POST", body=data or {"title": args.get("q") or "tmp watchdog"}, kind="write")
        if action == "inbox":
            return _studio(base + "/inbox")
        if action == "analysis":
            return _studio(base + "/analysis", method="POST", body=data)
        if action == "weekly":
            return _studio(base + "/weekly")
        if action == "bug":
            if args.get("bug_id") or args.get("id"):
                return _studio(base + "/bugs/" + urllib.parse.quote(str(args.get("bug_id") or args.get("id") or ""), safe=""))
            if data:
                return _studio(base + "/bugs", method="POST", body=data)
            return _studio(base + "/bugs")
        if action == "ping":
            bid = urllib.parse.quote(str(args.get("bug_id") or args.get("id") or ""), safe="")
            return _studio(base + "/bugs/" + bid + "/instances")
        if action == "notes":
            return _studio(base + "/notes", method="POST", body=data) if data else _studio(base + "/notes")
        if action == "skill_proposal":
            return _studio(base + "/skills", method="POST", body=data)
        if action == "throttle":
            return _studio(base + "/throttle")
        if action == "score":
            return then(base + "/scores", method="POST", body=data, kind="write") if data else _studio(base + "/scores")
        if action == "overview":
            return _studio(base + "/overview")
        if action == "approve":
            target = str(data.get("kind") or args.get("q") or "watchdog")
            item = urllib.parse.quote(str(args.get("id") or data.get("id") or ""), safe="")
            path = {"watchdog": "/watchdogs/", "cli": "/cli/", "skill": "/skills/", "privilege": "/privileges/", "rollback": "/rollbacks/", "issue": "/issues/"}[target]
            return then(base + path + item, method="PUT", body=data or {"action": "approve"}, kind="write")
        if action == "privilege":
            return _studio(base + "/privileges")
        if action == "ask_safe":
            return _studio(base + "/privileges/ask-safe", method="POST", body=data or {"method": args.get("q") or "watchdog.log"})
        if action == "ban":
            method = urllib.parse.quote(str(data.get("method") or args.get("q") or ""), safe="")
            return then(base + "/privileges/" + method, method="PUT", body={"action": "ban", "reason": data.get("reason") or ""}, kind="write")
        if action == "fork":
            return then(base + "/forks", method="POST", body=data, kind="write") if data else _studio(base + "/forks")
        if action == "rollback":
            return then(base + "/rollbacks", method="POST", body=data, kind="write") if data else _studio(base + "/rollbacks")
        if action == "issue":
            body = dict(data or {})
            if body.get("github") is True and body.get("approve") is not True:
                body = {**body, "approve": False}
            return then(base + "/issues", method="POST", body=body, kind="write") if body else _studio(base + "/issues")
        if action == "logic_report":
            return _studio(base + "/logic?scope=" + urllib.parse.quote(str(data.get("scope") or "weekly"), safe=""))
        if action == "latency":
            return _studio(base + "/latency", method="POST", body=data) if data else _studio(base + "/latency")
        if action == "confirm_fixed":
            return _studio(base + "/confirm-fixed", method="POST", body=data)
        if action == "cost_report":
            if args.get("id"):
                return _studio(base + "/cost-reports/" + urllib.parse.quote(str(args.get("id")), safe=""))
            return then(base + "/cost-reports")
        if action == "session_close":
            return then(base + "/sessions/close", method="POST", body=data or {"trigger": "close"}, kind="write")
        if action == "session_cede":
            return then(base + "/sessions/cede", method="POST", body=data or {"trigger": "cede"}, kind="write")
        if action == "suggestion":
            if data.get("id") or args.get("id"):
                return _studio(base + "/suggestions/" + urllib.parse.quote(str(data.get("id") or args.get("id") or ""), safe=""), method="PUT", body=data or {"action": "take"})
            return _studio(base + "/suggestions", method="POST", body=data) if data else _studio(base + "/suggestions")
        if action == "blacklist":
            method = urllib.parse.quote(str(data.get("method") or args.get("q") or ""), safe="")
            if data.get("action") == "restore" and method:
                return then(base + "/blacklist/" + method, method="PUT", body={"action": "restore"}, kind="write")
            return _studio(base + "/blacklist") if not data.get("method") else _studio(base + "/blacklist", method="POST", body=data)
        if action == "archive_watchdog":
            wid = urllib.parse.quote(str(args.get("id") or data.get("id") or data.get("watchdog_id") or ""), safe="")
            return then(base + "/watchdogs/" + wid + "/archive", method="POST", body=data or {"finish": True}, kind="write")
        if action == "metrics":
            return then(base + "/metrics")
        if action == "taxonomy":
            return then(base + "/taxonomy")
        if action in {"history", "history_ids"}:
            q = urllib.parse.quote(str(args.get("q") or ""), safe="")
            return then(base + "/history?q=" + q + "&limit=" + str(int(args.get("limit") or 20)))
        if action == "history_get":
            return then(base + "/history/" + urllib.parse.quote(str(args.get("id") or args.get("log_id") or data.get("log_id") or ""), safe=""))
        if action == "readonly_cli":
            return then(base + "/cli/readonly", method="POST", body=data or {"command": args.get("q") or "pwd"}, kind="write")
        if action == "catalog":
            return then(base + "/catalog")
        if action == "agree":
            verdict = str(data.get("verdict") or args.get("q") or "")
            if verdict in {"agree", "disagree"}:
                return then(base + "/agree", method="POST", body=data or {"verdict": verdict}, kind="write")
            return then(base + "/catalog")
        if action == "credit":
            if data.get("rollup"):
                return then(base + "/credit/rollup?all_periods=true")
            return then(base + "/credit", method="POST", body=data, kind="write") if data else then(base + "/credit")
        if action == "agent_report":
            return then(base + "/league/report", method="POST", body=data, kind="write")
        if action == "league_cycle":
            return then(base + "/league/cycle", method="POST", body=data or {"agent_id": "grok", "peer_id": "cursor"}, kind="write")
        if action == "league":
            return then(base + "/league")
        if action == "debug_jobs":
            return _debugger_offline().local_read(action, args, data)
        if action == "cad_snapshots":
            return _debugger_offline().local_read(action, args, data)
        if action == "swarm_summary":
            return _debugger_offline().local_read(action, args, data)
        if action in {"instance_registry", "lookup_area", "resolve_instance"}:
            return _debugger_offline().local_read(action, args, data)
        if action in {"cad_votes", "list_cad_votes"}:
            return _debugger_offline().local_read(action, args, data)
        if action in {"record_cad_vote", "cad_vote"}:
            return _debugger_offline().local_write(action, args, data)
        if action == "claim_debug_job":
            return _debugger_offline().local_write(action, args, data)
        if action in {"ingest_jsonl", "rollup_live", "credit_tick", "swarm_tick", "stamp_feature"}:
            return _debugger_offline().local_write(action, args, data)
        if action in {"confirm_candidate", "reject_candidate"}:
            return _debugger_offline().local_write(action, args, data)
        if action == "agent_ops":
            from backend.services import agent_ops_service as aops

            if data.get("similar"):
                return aops.similar(str(data.get("category_id") or "DATA"), data.get("ops"))
            return aops.record_ops(data or args)
        if action == "mcp_watchdog":
            from backend.services import mcp_watchdog_service as wd

            return wd.snapshot()
        raise ValueError("Unknown debugger action")
    if name == "grok_status":
        return grok_status()
    if name == "agent_intro_pack":
        from backend.services import agent_intro_service as intro

        return intro.pack_info()
    if name == "agent_intro_handshake":
        from backend.services import agent_intro_service as intro

        return intro.handshake(str(args.get("agent") or ""), str(args.get("phrase") or ""))
    if name == "agent_sandbox_reset":
        from backend.services import agent_intro_service as intro

        return intro.sandbox_reset()
    if name == "agent_sandbox_run":
        from backend.services import agent_intro_service as intro

        return intro.sandbox_run(str(args.get("op") or "ping"), int(args.get("a") or 0), int(args.get("b") or 0))
    if name == "agent_refpack_upload":
        from backend.services import agent_intro_service as intro

        return intro.refpack_upload(str(args.get("agent") or ""), str(args.get("src") or ""))
    if name == "grok_chat":
        return grok_chat(str(args.get("prompt") or ""), args.get("system"), args.get("model"))
    if name == "grok_wiring":
        return grok_wiring()
    if name == "grok_dimos_status":
        return grok_dimos_status(args)
    if name == "grok_dimos_connect":
        return grok_dimos_connect(args)
    if name == "grok_dimos_probe":
        return grok_dimos_probe(args)
    if name == "grok_mujoco_run":
        return grok_mujoco_run(args)
    if name == "grok_robotics_runbook":
        return grok_robotics_runbook(args)
    if name == "agent_bus_submit":
        return agent_bus_submit(args)
    if name == "agent_bus_inbox":
        return agent_bus_inbox(args.get("limit"))
    if name == "pm_prompt_kit":
        from backend.services import pm_prompt_service as pms

        return pms.kit(args.get("cycle_id"))
    if name == "pm_prompt_submit":
        from backend.services import pm_prompt_service as pms

        return pms.submit(args)
    if name == "pm_prompt_status":
        from backend.services import pm_prompt_service as pms

        return pms.status(int(args.get("limit") or 20))
    if name == "agent_hello":
        from backend.services import mcp_watchdog_service as wd

        return wd.hello(args)
    if name == "agent_converse":
        from backend.services import mcp_watchdog_service as wd

        return wd.converse(args)
    if name == "mcp_watchdog_status":
        from backend.services import mcp_watchdog_service as wd

        return wd.snapshot()
    if name == "rm_queue":
        from backend.services import mcp_watchdog_service as wd

        return wd.rm_queue(args)
    if name == "comms_webhook_register":
        from backend.services import mcp_watchdog_service as wd

        return wd.register_webhook(str(args.get("url") or ""))
    if name == "comms_broadcast":
        from backend.services import mcp_watchdog_service as wd

        return wd.fanout_event({"kind": "broadcast", "text": str(args.get("text") or "")[:400]})
    if name == "team_status_now":
        from backend.services import team_status_service as ts

        return ts.publish(force_email=bool(args.get("force_email")))
    if name == "pm_goals_submit":
        from backend.services import team_status_service as ts

        return ts.set_pm_goals(str(args.get("text") or ""))
    if name == "grok_auth_event":
        return grok_auth_event(args)
    if name == "grok_auth_status":
        return grok_auth_status(args.get("limit"))
    if name == "grok_group_chat":
        return grok_group_chat(args)
    if name == "grok_sandbox":
        return grok_sandbox(args)
    if name == "grok_vote":
        return grok_vote(args)
    if name == "grok_tag":
        return grok_tag(args)
    if name == "grok_report":
        return grok_report(args)
    if name == "grok_collab_pad":
        return grok_collab_pad(args)
    if name == "grok_collab_index":
        return grok_collab_index(args)
    if name == "grok_stats":
        return grok_stats(args)
    if name == "grok_ledger_relay":
        return grok_ledger_relay(args)
    if name == "grok_help_request":
        return grok_help_request(args)
    if name == "grok_mule_hop":
        return grok_mule_hop(args)
    if name == "grok_drive_search":
        from backend.services import grok_drive_index_service as gdi

        q = str(args.get("query") or args.get("q") or "")
        return gdi.search(q, int(args.get("limit") or 8))
    if name == "grok_key_index":
        return grok_key_index(args.get("query"))
    if name == "grok_tweet_for_agent":
        return grok_tweet_for_agent(args)
    if name == "agent_ops_submit":
        try:
            from backend.services import agent_ops_service as aops

            return aops.record_ops(args)
        except Exception:
            return _ops_file_submit(args)
    if name == "agent_ops_similar":
        try:
            from backend.services import agent_ops_service as aops

            return aops.similar(str(args.get("category_id") or ""), args.get("ops"))
        except Exception:
            return _ops_file_similar(str(args.get("category_id") or ""), args.get("ops"))
    if name == "grok_pitch_deck":
        return grok_pitch_deck(args)
    if name == "grok_rnd_benchmarks":
        return grok_rnd_benchmarks(args)
    if name == "grok_rnd_demo":
        return grok_rnd_demo(args)
    if name == "grok_agent_tasks":
        return grok_agent_tasks(args)
    if name == "grok_marketing":
        return grok_marketing(args.get("section"), args.get("query"))
    if name == "grok_request_clip":
        return _clip_harness().request_clip(
            str(args.get("title") or ""),
            str(args.get("prompt") or args.get("title") or ""),
            kind=str(args.get("kind") or "gif"),
            slug=args.get("slug"),
            run=args.get("run"),
            live=args.get("live"),
            callback_url=args.get("callback_url"),
            wait=args.get("wait"),
        )
    if name == "grok_clip_status":
        return _clip_harness().clip_status(str(args.get("job_id") or ""))
    if name == "grok_clip_wait":
        return _clip_harness().wait_for_job(
            str(args.get("job_id") or ""),
            int(args.get("timeout") or 90),
        )
    if name == "grok_clips":
        return _clip_harness().clips_board(ungrabbed=bool(args.get("ungrabbed")))
    if name == "grok_clip_grab":
        return _clip_harness().mark_grabbed_from_body(
            {
                "id": args.get("job_id") or args.get("id"),
                "url": args.get("url"),
                "path": args.get("path"),
                "by": args.get("by") or "grok-bot",
            }
        )
    if name == "x_post":
        return x_post(str(args.get("text") or ""), confirm=bool(args.get("confirm")))
    if name == "grok_music_request":
        return _music(
            "/api/marketing/v1/music/request",
            method="POST",
            body={
                "query": args.get("query") or args.get("song") or "",
                "url": args.get("url") or "",
                "playlist": args.get("playlist") or "",
                "reason": args.get("reason") or "other",
                "reason_detail": args.get("reason_detail") or "",
            },
        )
    if name == "grok_music_library":
        return _music("/api/marketing/v1/music/library")
    if name == "grok_social_post":
        return _music("/api/marketing/v1/posts", method="POST", body=dict(args))
    if name == "grok_social_checkin":
        post_id = str(args.get("post_id") or "")
        body = {k: v for k, v in args.items() if k != "post_id"}
        return _music(f"/api/marketing/v1/posts/{post_id}/checkin", method="POST", body=body)
    if name == "grok_social_weekly":
        return _music("/api/marketing/v1/reports/weekly", method="POST", body=dict(args))
    if name == "grok_taste":
        return _music("/api/marketing/v1/taste")
    raise ValueError(f"Unknown tool: {name}")


def _result(id_: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _error(id_: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def handle(message: dict[str, Any]) -> dict[str, Any] | None:
    method = str(message.get("method") or "")
    id_ = message.get("id")
    params = message.get("params") if isinstance(message.get("params"), dict) else {}
    if method == "initialize":
        return _result(
            id_,
            {
                "protocolVersion": PROTOCOL,
                "capabilities": {"tools": {}, "prompts": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        )
    if method in {"notifications/initialized", "notifications/cancelled"}:
        return None
    if method == "ping":
        return _result(id_, {})
    if method == "tools/list":
        return _result(id_, {"tools": TOOLS})
    if method == "resources/list":
        return _result(id_, {"resources": []})
    if method == "prompts/list":
        prompts = []
        try:
            from backend.services import pm_prompt_service as pms

            prompts.extend(pms.mcp_prompts_list())
        except Exception:
            pass
        try:
            from backend.services import mcp_watchdog_service as wd

            prompts.extend(wd.mcp_prompts_list())
        except Exception:
            pass
        return _result(id_, {"prompts": prompts})
    if method == "prompts/get":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        try:
            from backend.services import pm_prompt_service as pms

            if name in {p["name"] for p in pms.mcp_prompts_list()}:
                return _result(id_, pms.mcp_prompts_get(name, arguments))
        except Exception:
            pass
        try:
            from backend.services import mcp_watchdog_service as wd

            return _result(id_, wd.mcp_prompts_get(name, arguments))
        except ValueError as exc:
            return _error(id_, -32602, str(exc)[:240])
        except Exception as exc:
            return _error(id_, -32603, str(exc)[:240])
    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        try:
            payload = _call_tool(name, arguments)
            text = json.dumps(payload, indent=2) if not isinstance(payload, str) else payload
            return _result(id_, {"content": [{"type": "text", "text": text}]})
        except Exception as exc:
            return _result(
                id_,
                {"content": [{"type": "text", "text": str(exc)[:400]}], "isError": True},
            )
    if id_ is None:
        return None
    return _error(id_, -32601, f"Method not found: {method}")


def _read_message(stdin) -> dict[str, Any] | None:
    header_line = stdin.readline()
    if not header_line:
        return None
    if isinstance(header_line, bytes):
        header_line = header_line.decode("utf-8")
    if header_line.lower().startswith("content-length:"):
        length = int(header_line.split(":", 1)[1].strip())
        while True:
            line = stdin.readline()
            if line in ("", b""):
                return None
            if isinstance(line, bytes):
                line = line.decode("utf-8")
            if line in ("\r\n", "\n"):
                break
        body = stdin.read(length)
        if isinstance(body, bytes):
            body = body.decode("utf-8")
        return json.loads(body)
    stripped = header_line.strip()
    if not stripped:
        return _read_message(stdin)
    return json.loads(stripped)


def _write_message(stdout, message: dict[str, Any]) -> None:
    raw = json.dumps(message, separators=(",", ":")).encode("utf-8")
    stdout.write(f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii"))
    stdout.write(raw)
    stdout.flush()


def serve_stdio() -> None:
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    while True:
        try:
            message = _read_message(stdin)
        except Exception:
            break
        if message is None:
            break
        reply = handle(message)
        if reply is not None:
            _write_message(stdout, reply)


def _dispatch_rpc(payload: Any) -> Any:
    if isinstance(payload, list):
        replies = [handle(item) for item in payload if isinstance(item, dict)]
        return [item for item in replies if item is not None]
    if isinstance(payload, dict):
        return handle(payload)
    return {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}


def _health_payload() -> dict[str, Any]:
    return {
        "ok": True,
        "name": SERVER_NAME,
        "version": SERVER_VERSION,
        "mcp": "/mcp",
        "public_mcp": "https://render3d.app/mcp",
        "marketing_md": "https://render3d.app/mcp/marketing.md",
        "harness_inbox": "https://render3d.app/mcp/harness.md",
        "clips": "https://render3d.app/mcp/clips",
        "wiring": "https://render3d.app/mcp/wiring",
        "protocol": PROTOCOL,
        "transport": "streamable-http",
    }


_SESSIONS: set[str] = set()


def _mcp_token() -> str:
    return _env("GROK_MCP_TOKEN") or _env("GROK_MCP_PUBLIC_TOKEN")


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
        "Access-Control-Allow-Headers": (
            "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version"
        ),
        "Access-Control-Max-Age": "86400",
    }


def _query_value(path: str, name: str) -> str:
    query = path.split("?", 1)[1] if "?" in path else ""
    params = urllib.parse.parse_qs(query, keep_blank_values=True)
    values = params.get(name) or []
    return str(values[0] if values else "").strip()


class GrokBotHttpHandler(BaseHTTPRequestHandler):
    server_version = f"{SERVER_NAME}/{SERVER_VERSION}"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), format % args))

    def _send(self, code: int, body: bytes, content_type: str, extra: dict[str, str] | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in {**_cors_headers(), **(extra or {})}.items():
            self.send_header(key, value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _presented_token(self) -> str:
        header = (self.headers.get("Authorization") or "").strip()
        if header.lower().startswith("bearer "):
            return header[7:].strip()
        api_key = (self.headers.get("X-Api-Key") or "").strip()
        if api_key:
            return api_key
        return _query_value(self.path, "token") or _query_value(self.path, "access_token")

    def _authorized(self) -> bool:
        """Reject a wrong Bearer. Missing token is allowed so Grok's remote
        connector can POST initialize (it cannot set custom headers)."""
        expected = _mcp_token()
        if not expected:
            return True
        got = self._presented_token()
        if not got:
            return True
        if len(got) != len(expected):
            return False
        return hmac.compare_digest(got, expected)

    def _research_authorized(self) -> bool:
        """The OpenArm research index includes project metadata and needs an explicit token."""
        expected = _mcp_token()
        got = self._presented_token()
        return bool(expected and got and len(got) == len(expected) and hmac.compare_digest(got, expected))

    def _mcp_path(self) -> bool:
        path = self.path.split("?", 1)[0]
        return path in {"/", "/mcp", "/mcp/"}

    def _query_map(self) -> dict[str, str]:
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        return {key: str((values or [""])[0]) for key, values in params.items()}

    def _read_json_body(self) -> tuple[dict[str, Any] | None, bytes | None]:
        length = int(self.headers.get("Content-Length") or 0)
        if length > 2_000_000:
            return None, b'{"ok":false,"error":"payload too large"}'
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}, None
        try:
            payload = json.loads(raw.decode("utf-8") or "null")
        except json.JSONDecodeError:
            return None, b'{"ok":false,"error":"parse error"}'
        return (payload if isinstance(payload, dict) else {}), None

    def _clip_route(self, method: str) -> bool:
        path = self.path.split("?", 1)[0]
        parts = [p for p in path.split("/") if p]
        if parts and parts[0] == "mcp":
            rest = parts[1:]
        else:
            rest = parts
        if not rest or rest[0] not in {"clips", "wiring"}:
            return False
        if rest[0] == "wiring":
            raw = json.dumps(grok_wiring(), indent=2).encode("utf-8")
            self._send(200, raw, "application/json")
            return True
        if not self._authorized():
            self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
            return True
        body: dict[str, Any] | None = {}
        if method in {"POST", "PUT"}:
            body, err = self._read_json_body()
            if err is not None:
                self._send(413 if b"too large" in err else 400, err, "application/json")
                return True
        code, payload = _clip_harness().http_clips(method, path, body, self._query_map())
        raw = json.dumps(payload, indent=2).encode("utf-8")
        self._send(code, raw, "application/json")
        return True

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"", "text/plain")

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/health":
            raw = json.dumps(_health_payload(), separators=(",", ":")).encode("utf-8")
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/group-chat", "/group-chat"}:
            raw = json.dumps(grok_group_chat({"action": "read"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/team-chat/feed", "/team-chat/feed"}:
            raw = json.dumps(team_chat_feed({"limit": 80}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/explain", "/sandbox-files/explain"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            q = (qs.get("q") or qs.get("topic") or [""])[0]
            raw = json.dumps(grok_explain_tracking({"q": q}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/voice", "/sandbox-files/voice"}:
            raw = json.dumps(grok_voice_select({"action": "get"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/slides", "/sandbox-files/slides"}:
            raw = json.dumps(grok_marketing_slides({"action": "deck"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/pitch", "/sandbox-files/pitch"}:
            raw = json.dumps(grok_pitch_deck({"action": "deck", "post": False}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/benchmarks", "/sandbox-files/benchmarks"}:
            raw = json.dumps(grok_rnd_benchmarks({"action": "plan", "post": False}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/rnd-demo", "/sandbox-files/rnd-demo"}:
            raw = json.dumps(grok_rnd_demo({"action": "deck", "post": False}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/tasks", "/sandbox-files/tasks"}:
            raw = json.dumps(grok_agent_tasks({"action": "list", "post": False}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/decision", "/sandbox-files/decision"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            topic = (qs.get("topic") or qs.get("q") or [""])[0]
            kind = (qs.get("kind") or ["debug"])[0]
            raw = json.dumps(grok_decision_brief({"topic": topic, "kind": kind, "post": False}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/group-chat/media", "/group-chat/media"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            name = (qs.get("name") or [""])[0]
            try:
                dest = _chat_media_resolve(name)
                if not dest.is_file():
                    alt = GROUP_CHAT_IMAGES / Path(name).name
                    dest = alt if alt.is_file() else dest
                if not dest.is_file():
                    self._send(404, b'{"ok":false,"error":"missing image"}', "application/json")
                    return
                mime = CHAT_IMAGE_MIME.get(dest.suffix.lower(), "application/octet-stream")
                self._send(200, dest.read_bytes(), mime)
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/sandbox", "/sandbox-files"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            action = (qs.get("action") or ["list"])[0]
            if str(action).lower() not in {"list", "rev", "feed", "controls", "notes", "explain"}:
                action = "list"
            try:
                raw = json.dumps(grok_sandbox({"action": action, "path": (qs.get("path") or [""])[0], "cursor": (qs.get("cursor") or ["0"])[0]}), indent=2).encode()
                self._send(200, raw, "application/json")
            except (ValueError, OSError) as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/sandbox/rev", "/sandbox-files/rev"}:
            raw = json.dumps(grok_sandbox({"action": "rev"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/sandbox/controls", "/sandbox-files/controls"}:
            try:
                from backend.services import xr_control_live as live

                raw = json.dumps({"ok": True, **live.load_config()}, indent=2).encode()
            except Exception as exc:
                raw = json.dumps({"ok": False, "error": str(exc)[:240], "token": "xrctrl2"}).encode()
            self._send(200, raw, "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/sandbox/control-notes", "/sandbox-files/control-notes"}:
            try:
                from backend.services import xr_control_live as live

                raw = json.dumps({"ok": True, "notes": live.list_notes(40), "token": live.TOKEN}, indent=2).encode()
            except Exception as exc:
                raw = json.dumps({"ok": False, "error": str(exc)[:240], "token": "xrctrl2"}).encode()
            self._send(200, raw, "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/sandbox/file", "/sandbox-files/file"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            rel = (qs.get("path") or qs.get("file") or [""])[0]
            try:
                raw = json.dumps(grok_sandbox({"action": "read", "path": rel}), indent=2).encode()
                self._send(200, raw, "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/votes", "/votes"}:
            raw = json.dumps(grok_vote({"action": "tally"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/reports", "/reports"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            ping = (qs.get("ping") or qs.get("q") or [""])[0]
            raw = json.dumps(grok_report({"ping": ping}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/tags", "/tags"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            tag = (qs.get("tag") or qs.get("q") or [""])[0]
            raw = json.dumps(grok_tag({"tag": tag}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/collab-pad", "/collab-pad"}:
            raw = json.dumps(grok_collab_pad({"action": "read"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/collab-index", "/collab-index"}:
            raw = json.dumps(grok_collab_index({"action": "read"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/stats", "/stats"}:
            raw = json.dumps(grok_stats({}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/ledger-relay", "/ledger-relay"}:
            raw = json.dumps(grok_ledger_relay({"action": "roster"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/help-requests", "/help-requests"}:
            raw = json.dumps(grok_help_request({"action": "read"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.rstrip("/") in {"/mcp/mule-outbox", "/mule-outbox"}:
            raw = json.dumps(grok_mule_hop({"action": "read"}), indent=2).encode()
            self._send(200, raw, "application/json")
            return
        if path.split("?", 1)[0].rstrip("/") in {"/mcp/drive-search", "/drive-search"}:
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            q = (qs.get("q") or qs.get("query") or [""])[0]
            try:
                from backend.services import grok_drive_index_service as gdi

                raw = json.dumps(gdi.search(q, 8), indent=2).encode()
                self._send(200, raw, "application/json")
            except Exception as exc:
                self._send(500, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if "/team-chat" in path:
            try:
                from backend.services import team_status_service as ts

                code, body, ctype = ts.http_get(path)
                self._send(code, body, ctype)
            except Exception as exc:
                self._send(500, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if "/watchdog" in path or "/harness-inbox" in path or "/rm-inbox" in path or "/comms-codes" in path or "/comms-counts" in path:
            try:
                from backend.services import mcp_watchdog_service as wd

                code, body, ctype = wd.http_get(path)
                self._send(code, body, ctype)
            except Exception as exc:
                self._send(500, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path in {"/mcp/marketing.md", "/marketing.md", "/MARKETING.md"}:
            if MARKETING_MD.is_file():
                text = MARKETING_MD.read_text(encoding="utf-8")
                self._send(200, text.encode("utf-8"), "text/markdown; charset=utf-8")
            else:
                self._send(404, b"MARKETING.md missing\n", "text/plain; charset=utf-8")
            return
        if path in {"/mcp/harness.md", "/harness.md"}:
            inbox = REPO_ROOT / "data" / "grok-bot" / "harness-inbox.md"
            if inbox.is_file():
                self._send(200, inbox.read_text(encoding="utf-8").encode("utf-8"), "text/markdown; charset=utf-8")
            else:
                self._send(200, b"# Grok bot harness inbox\n\nEmpty.\n", "text/markdown; charset=utf-8")
            return
        if self._clip_route("GET"):
            return
        if not self._mcp_path():
            self._send(404, b'{"ok":false}', "application/json")
            return
        if not self._authorized():
            self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
            return
        accept = (self.headers.get("Accept") or "").lower()
        if "text/event-stream" in accept:
            session = (self.headers.get("Mcp-Session-Id") or "").strip() or str(uuid.uuid4())
            _SESSIONS.add(session)
            sse = b": streamable-http\n\n"
            extra = {
                "Mcp-Session-Id": session,
                "MCP-Protocol-Version": PROTOCOL,
            }
            self._send(200, sse, "text/event-stream", extra)
            return
        raw = json.dumps(_health_payload(), separators=(",", ":")).encode("utf-8")
        self._send(200, raw, "application/json")

    def do_DELETE(self) -> None:  # noqa: N802
        if not self._mcp_path():
            self._send(404, b'{"ok":false}', "application/json")
            return
        session = (self.headers.get("Mcp-Session-Id") or "").strip()
        if session:
            _SESSIONS.discard(session)
        self._send(204, b"", "text/plain")

    def do_PUT(self) -> None:  # noqa: N802
        self.do_POST()

    def do_POST(self) -> None:  # noqa: N802
        if self._clip_route("POST"):
            return
        path = self.path.split("?", 1)[0]
        if path.rstrip("/") in {"/mcp/mule-outbox", "/mule-outbox"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            if not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                out = grok_mule_hop({"action": "post", **dict(payload or {})})
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/help-requests", "/help-requests"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                if agent == "sam" or not self._authorized():
                    post["agent"] = "sam"
                out = grok_help_request({"action": "post", **post})
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/votes", "/votes"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                if agent == "sam" or not self._authorized():
                    post["agent"] = "sam"
                out = grok_vote({"action": "post", **post})
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/collab-pad", "/collab-pad"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                if agent == "sam" or not self._authorized():
                    post["agent"] = "sam"
                out = grok_collab_pad({"action": "post", **post})
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as ext:
                self._send(400, json.dumps({"ok": False, "error": str(ext)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/collab-index", "/collab-index"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                out = grok_collab_index({"action": "post", **post})
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as ext:
                self._send(400, json.dumps({"ok": False, "error": str(ext)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/controls", "/sandbox-files/controls"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            if not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                from backend.services import xr_control_live as live

                post = dict(payload or {})
                out = live.handle(str(post.get("action") or "put"), post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/correct", "/sandbox-files/correct"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                post["action"] = "correct"
                out = grok_sandbox(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox", "/sandbox-files"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("action", "write")
                out = grok_sandbox(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/voice", "/sandbox-files/voice"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            if not self._authorized() and str((payload or {}).get("agent") or "").strip().lower() not in {"sam", "astra"}:
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("action", "put")
                out = grok_voice_select(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/slides", "/sandbox-files/slides"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("action", "present")
                out = grok_marketing_slides(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/pitch", "/sandbox-files/pitch"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("action", "generate")
                out = grok_pitch_deck(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/benchmarks", "/sandbox-files/benchmarks"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("action", "plan")
                out = grok_rnd_benchmarks(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/rnd-demo", "/sandbox-files/rnd-demo"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("action", "present")
                out = grok_rnd_demo(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/tasks", "/sandbox-files/tasks"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("action", "list")
                out = grok_agent_tasks(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as esc:
                self._send(400, json.dumps({"ok": False, "error": str(esc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/sandbox/decision", "/sandbox-files/decision"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            try:
                post = dict(payload or {})
                post.setdefault("post", True)
                out = grok_decision_brief(post)
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/group-chat/image", "/group-chat/image"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                out = grok_group_chat_image(payload or {})
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if path.rstrip("/") in {"/mcp/group-chat", "/group-chat"}:
            payload, err = self._read_json_body()
            if err:
                self._send(400, err, "application/json")
                return
            agent = str((payload or {}).get("agent") or "").strip().lower()
            if agent != "sam" and not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            try:
                post = dict(payload or {})
                if agent == "sam" or not self._authorized():
                    post["agent"] = "sam"
                action = str(post.get("action") or "post").strip().lower()
                if action not in {"post", "react", "upload"}:
                    action = "post"
                out = grok_group_chat({**post, "action": action})
                self._send(200, json.dumps(out).encode(), "application/json")
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if "/webhooks" in path or "/comms-hook" in path or path.rstrip("/").endswith("/broadcast") or path.rstrip("/").endswith("/rm-queue"):
            if not self._authorized():
                self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
                return
            payload, err = self._read_json_body()
            if err:
                self._send(413 if b"too large" in err else 400, err, "application/json")
                return
            try:
                from backend.services import mcp_watchdog_service as wd

                code, raw, ctype = wd.http_post(path, payload or {})
                self._send(code, raw, ctype)
            except Exception as exc:
                self._send(400, json.dumps({"ok": False, "error": str(exc)[:240]}).encode(), "application/json")
            return
        if not self._mcp_path():
            self._send(404, b'{"ok":false}', "application/json")
            return
        if not self._authorized():
            self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > 2_000_000:
            self._send(413, b'{"ok":false,"error":"payload too large"}', "application/json")
            return
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8") or "null")
        except json.JSONDecodeError:
            self._send(400, b'{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"}}', "application/json")
            return
        if (isinstance(payload, dict) and payload.get("method") == "tools/call"
                and isinstance(payload.get("params"), dict)
                and payload["params"].get("name") == "openarm_research"
                and not self._research_authorized()):
            self._send(401, b'{"ok":false,"error":"OpenArm research token required"}', "application/json")
            return
        reply = _dispatch_rpc(payload)
        session = (self.headers.get("Mcp-Session-Id") or "").strip()
        method = ""
        if isinstance(payload, dict):
            method = str(payload.get("method") or "")
        if method == "initialize" and not session:
            session = str(uuid.uuid4())
            _SESSIONS.add(session)
        extra = {"MCP-Protocol-Version": PROTOCOL}
        if session:
            extra["Mcp-Session-Id"] = session
        accept = (self.headers.get("Accept") or "").lower()
        if reply is None:
            self._send(202, b"", "application/json", extra)
            return
        body = json.dumps(reply, separators=(",", ":")).encode("utf-8")
        if "text/event-stream" in accept and "application/json" not in accept:
            sse = b"event: message\ndata: " + body + b"\n\n"
            self._send(200, sse, "text/event-stream", extra)
            return
        self._send(200, body, "application/json", extra)


def swarm_tick_interval_s() -> int:
    raw = _env("GROK_SWARM_TICK_S") or "300"
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 300


def start_swarm_credit_tick(interval_s: int | None = None) -> threading.Thread | None:
    """Idempotent ingest+rollup+league on an interval. No second launchd daemon."""
    interval = swarm_tick_interval_s() if interval_s is None else int(interval_s)
    if interval <= 0:
        sys.stderr.write(f"{SERVER_NAME} swarm credit tick disabled\n")
        return None

    def loop() -> None:
        time.sleep(min(interval, 20))
        while True:
            try:
                off = _debugger_offline()
                dss = off._dss()
                dss.swarm_credit_tick({"snapshot_id": "cad-swarm-tick"})
            except Exception as exc:
                sys.stderr.write(f"{SERVER_NAME} swarm credit tick skipped: {exc}\n")
            time.sleep(interval)

    thread = threading.Thread(target=loop, name="swarm-credit-tick", daemon=True)
    thread.start()
    sys.stderr.write(f"{SERVER_NAME} swarm credit tick every {interval}s (idempotent jsonl)\n")
    return thread


def serve_http(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    _load_dotenv_keys()
    try:
        _clip_harness().start_listener()
        sys.stderr.write(f"{SERVER_NAME} clip listener → data/grok-bot/clips\n")
    except Exception as exc:
        sys.stderr.write(f"{SERVER_NAME} clip listener skipped: {exc}\n")
    try:
        start_swarm_credit_tick()
    except Exception as exc:
        sys.stderr.write(f"{SERVER_NAME} swarm credit tick skipped: {exc}\n")
    try:
        from backend.services import mcp_watchdog_service as wd

        wd.start_relay_tick(45)
        sys.stderr.write(f"{SERVER_NAME} comms relay tick every 45s (harness-inbox, no Cursor wake)\n")
    except Exception as exc:
        sys.stderr.write(f"{SERVER_NAME} comms relay tick skipped: {exc}\n")
    try:
        from backend.services import team_status_service as ts

        ts.start_tick()
        sys.stderr.write(f"{SERVER_NAME} team status tick every {ts.INTERVAL_S}s until 19:00 CDT\n")
    except Exception as exc:
        sys.stderr.write(f"{SERVER_NAME} team status tick skipped: {exc}\n")
    httpd = ThreadingHTTPServer((host, port), GrokBotHttpHandler)
    httpd.allow_reuse_address = True
    sys.stderr.write(f"{SERVER_NAME} HTTP MCP on http://{host}:{port}/mcp\n")
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Grok bot MCP (stdio or localhost HTTP)")
    parser.add_argument("--http", action="store_true", help="Serve Streamable HTTP on localhost (LaunchAgent mode)")
    parser.add_argument("--host", default=_env("GROK_MCP_HOST") or DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=int(_env("GROK_MCP_PORT") or DEFAULT_PORT))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    _load_dotenv_keys()
    args = parse_args(argv)
    if args.http or _env("GROK_MCP_HTTP") in {"1", "true", "yes"}:
        serve_http(args.host, args.port)
        return
    serve_stdio()


if __name__ == "__main__":
    main()
