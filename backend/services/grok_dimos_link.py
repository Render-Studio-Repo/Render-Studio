"""Link Grok bot ↔ DIMOS robot PC (LAN host:8443).

Stores per-user DIMOS upstream for MCP tools and Studio Preferences.
Does not spawn teleop or command joints — only save + probe reachability.
"""

from __future__ import annotations

import logging
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any
from urllib.parse import urlparse

from backend.database import get_conn
from backend.services.dimos_teleop_proxy import (
    DIMOS_WS_DEFAULT,
    normalize_dimos_upstream,
)

logger = logging.getLogger("render3d.grok_dimos")

PROBE_TIMEOUT_S = 2.5


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def ensure_schema() -> None:
    from backend.services import grok_bot_service

    grok_bot_service.ensure_schema()
    with get_conn() as conn:
        cols = {str(r[1]) for r in conn.execute("PRAGMA table_info(user_grok_bot)").fetchall()}
        if "dimos_upstream" not in cols:
            conn.execute("ALTER TABLE user_grok_bot ADD COLUMN dimos_upstream TEXT")
        if "dimos_host" not in cols:
            conn.execute("ALTER TABLE user_grok_bot ADD COLUMN dimos_host TEXT")
        if "dimos_updated_at" not in cols:
            conn.execute("ALTER TABLE user_grok_bot ADD COLUMN dimos_updated_at TEXT")


def host_display(upstream: str) -> str:
    parsed = urlparse(upstream or "")
    host = parsed.hostname or ""
    port = parsed.port or 8443
    return f"{host}:{port}" if host else ""


def https_teleop_url(upstream: str) -> str:
    parsed = urlparse(upstream or "")
    host = parsed.hostname or ""
    port = parsed.port or 8443
    if not host:
        return ""
    return f"https://{host}:{port}/teleop"


def pipe_url(upstream: str) -> str:
    u = (upstream or "").strip()
    if not u:
        return "/api/dimos/ws"
    return f"/api/dimos/ws?upstream={urllib.parse.quote(u, safe='')}"


def _load_row(user_id: str) -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT dimos_upstream, dimos_host, dimos_updated_at FROM user_grok_bot WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return {}
    return {
        "dimos_upstream": row["dimos_upstream"] or "",
        "dimos_host": row["dimos_host"] or "",
        "dimos_updated_at": row["dimos_updated_at"] or "",
    }


def probe_dimos(upstream: str) -> dict[str, Any]:
    """TCP + optional HTTPS /teleop probe. Never sends robot commands."""
    target = normalize_dimos_upstream(upstream)
    out: dict[str, Any] = {
        "ok": False,
        "upstream": target or "",
        "host": host_display(target) if target else "",
        "teleop_url": https_teleop_url(target) if target else "",
        "tcp_open": False,
        "http_reachable": False,
        "error": None,
    }
    if not target:
        out["error"] = "Invalid DIMOS host — use LAN IPv4, optional :8443 (e.g. 192.168.1.77)"
        return out
    parsed = urlparse(target)
    host = parsed.hostname or ""
    port = int(parsed.port or 8443)
    try:
        with socket.create_connection((host, port), timeout=PROBE_TIMEOUT_S):
            out["tcp_open"] = True
    except OSError as exc:
        out["error"] = f"TCP {host}:{port} closed — {exc}"
        return out

    teleop = https_teleop_url(target)
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(teleop, method="GET", headers={"User-Agent": "render3d-grok-dimos/1"})
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_S, context=ctx) as resp:
            out["http_reachable"] = 200 <= int(resp.status) < 500
            out["http_status"] = int(resp.status)
    except urllib.error.HTTPError as exc:
        out["http_reachable"] = True
        out["http_status"] = int(exc.code)
    except Exception as exc:
        out["error"] = f"HTTPS /teleop probe failed — {exc}"
        out["ok"] = True
        out["note"] = "Port open; /teleop HTTPS probe failed (cert or path). Studio pipe may still work."
        return out

    out["ok"] = bool(out["tcp_open"])
    out["error"] = None
    return out


def get_link(user_id: str) -> dict[str, Any]:
    ensure_schema()
    row = _load_row(user_id)
    upstream = normalize_dimos_upstream(row.get("dimos_upstream") or "") or ""
    host = row.get("dimos_host") or host_display(upstream)
    return {
        "ok": True,
        "linked": bool(upstream),
        "host": host,
        "upstream": upstream,
        "teleop_url": https_teleop_url(upstream) if upstream else "",
        "studio_pipe": pipe_url(upstream) if upstream else "/api/dimos/ws",
        "default_upstream": DIMOS_WS_DEFAULT,
        "updated_at": row.get("dimos_updated_at") or None,
        "api": {
            "get": "GET /api/integrations/grok-bot/dimos",
            "connect": 'POST /api/integrations/grok-bot/dimos {"host":"192.168.1.77"}',
            "probe": 'POST /api/integrations/grok-bot/dimos/probe {"host":"192.168.1.77"}',
            "clear": "DELETE /api/integrations/grok-bot/dimos",
            "studio_ws": "/api/dimos/ws?upstream=wss://HOST:8443/ws",
            "coordinator": "GET /api/dimos/coordinator (local spawn only)",
        },
        "note": "Saves DIMOS LAN host for Grok MCP. Does not arm teleop or move joints.",
    }


def connect_link(user_id: str, host_raw: str, *, probe: bool = True) -> dict[str, Any]:
    ensure_schema()
    target = normalize_dimos_upstream(host_raw)
    if not target:
        raise ValueError("Invalid DIMOS host — private LAN IPv4 on port 8443 only (e.g. 192.168.1.77)")
    host = host_display(target)
    now = _now()
    with get_conn() as conn:
        existing = conn.execute("SELECT user_id FROM user_grok_bot WHERE user_id = ?", (user_id,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE user_grok_bot
                   SET dimos_upstream = ?, dimos_host = ?, dimos_updated_at = ?, updated_at = ?
                 WHERE user_id = ?
                """,
                (target, host, now, now, user_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO user_grok_bot (user_id, enabled, dimos_upstream, dimos_host, dimos_updated_at, updated_at)
                VALUES (?, 0, ?, ?, ?, ?)
                """,
                (user_id, target, host, now, now),
            )
    result = get_link(user_id)
    result["saved"] = True
    if probe:
        result["probe"] = probe_dimos(target)
        result["reachable"] = bool(result["probe"].get("ok"))
    return result


def clear_link(user_id: str) -> dict[str, Any]:
    ensure_schema()
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE user_grok_bot
               SET dimos_upstream = NULL, dimos_host = NULL, dimos_updated_at = ?, updated_at = ?
             WHERE user_id = ?
            """,
            (now, now, user_id),
        )
    out = get_link(user_id)
    out["cleared"] = True
    return out
