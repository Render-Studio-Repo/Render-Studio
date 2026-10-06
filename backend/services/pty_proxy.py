"""Authenticated Studio proxy helpers for the local PTY sidecar."""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from backend.services.viser_proxy import is_private_lan_host, resolve_lan_ip

logger = logging.getLogger("render3d.pty_proxy")

PTY_TICKET_TTL_SEC = 2 * 60 * 60
PTY_DEFAULT_PORT = 8765


def allow_pty_target(host: str, port: int) -> tuple[str, str, int]:
    """Return (ws_url, host, port) for loopback/LAN sidecar only."""
    raw_host = str(host or "").strip().lower().strip("[]")
    if not raw_host:
        raise ValueError("PTY host is required")
    try:
        p = int(port)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid PTY port") from exc
    if p < 1 or p > 65535:
        raise ValueError("Invalid PTY port")
    if not is_private_lan_host(raw_host):
        raise ValueError("PTY host must be localhost or a private LAN IP")
    resolved = resolve_lan_ip(raw_host)
    if not resolved and (raw_host.endswith(".local") or raw_host in {"localhost", "127.0.0.1", "::1"}):
        resolved = "127.0.0.1" if raw_host == "localhost" else raw_host
    if not resolved or not is_private_lan_host(resolved):
        raise ValueError("PTY host did not resolve to a private address")
    if raw_host == "localhost":
        raw_host = "127.0.0.1"
    return f"ws://{raw_host}:{p}/", raw_host, p


def sidecar_health_url(host: str, port: int) -> str:
    _, h, p = allow_pty_target(host, port)
    return f"http://{h}:{p}/health"


def probe_pty(host: str, port: int) -> tuple[bool, str]:
    try:
        url = sidecar_health_url(host, port)
    except ValueError as exc:
        return False, str(exc)
    import httpx

    try:
        with httpx.Client(timeout=httpx.Timeout(2.0, connect=1.0)) as client:
            resp = client.get(url)
        if resp.status_code == 200:
            return True, ""
        return False, f"Sidecar HTTP {resp.status_code}"
    except Exception:
        parsed = urlparse(url)
        return False, f"Sidecar not running at {parsed.hostname}:{int(port)}"


def log_proxy_connect(user_id: str, host: str, port: int) -> None:
    logger.info("pty proxy connect user=%s target=%s:%s", user_id or "anon", host, port)
