"""Same-origin Quest teleop pipe: Studio /api/dimos/ws → DIMOS /ws.

Quest Browser loads Studio over HTTP on :8001. The standalone DIMOS page at
https://192.168.1.83:8443/teleop works because it is same-origin with the
self-signed WSS socket. This proxy lets the headset stay inside Studio VR
and still drive the OpenArm Quest pipe (LCM PoseStamped + Joy bytes).
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import ssl
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger("render3d.dimos")

DIMOS_WS_DEFAULT = "wss://192.168.1.83:8443/ws"
ALLOWED_HOSTS = frozenset({"192.168.1.83", "127.0.0.1", "localhost", "::1"})
ALLOWED_PORTS = frozenset({8443})
CONNECT_TIMEOUT_S = 3.0
MAX_FRAME_BYTES = 1_048_576
CLOUD_STUDIO_HOST_SUFFIX = "render3d.app"
CLOUD_REFUSE_REASON = "cloud cannot reach LAN DimOS"
CLOUD_WORKER_ENV = "RENDER3D_CLOUD_WORKER"


def studio_can_proxy_lan(studio_host: str | None) -> bool:
    """This uvicorn can reach the user's LAN, even when Host is render3d.app.

    The public name is Caddy/Cloudflare in front of this Mac. Python here sees
    127.0.0.1 and RFC1918. Only a separate cloud worker that cannot see LAN
    should set RENDER3D_CLOUD_WORKER=1. Target SSRF still lives in
    normalize_dimos_upstream / allow_viser_target.
    """
    if os.environ.get(CLOUD_WORKER_ENV, "").strip().lower() in {"1", "true", "yes"}:
        host = (studio_host or "").split(":")[0].strip().lower()
        if host == CLOUD_STUDIO_HOST_SUFFIX or host.endswith(f".{CLOUD_STUDIO_HOST_SUFFIX}"):
            return False
    return True


def _expand_dimos_host_input(raw: str) -> str:
    """Turn a LAN IP or IP:8443 into a ws(s) URL before parsing."""
    text = (raw or "").strip()
    if not text or "://" in text:
        return text
    if text.count(":") == 1 and not text.startswith("["):
        host, port = text.rsplit(":", 1)
        if port.isdigit():
            return f"wss://{host}:{port}/ws"
    return f"wss://{text}:8443/ws"


def _host_allowed(host: str) -> bool:
    name = (host or "").lower()
    if name in ALLOWED_HOSTS:
        return True
    try:
        ip = ipaddress.ip_address(name)
    except ValueError:
        return False
    if str(ip) == "169.254.169.254":
        return False
    if ip.is_loopback or ip.is_link_local:
        return True
    return bool(ip.is_private and not ip.is_multicast)


def normalize_dimos_upstream(url: str | None) -> str:
    """Return a LAN DIMOS /ws URL, or empty if the host/port/path is not allowed."""
    raw = _expand_dimos_host_input((url or "").strip() or DIMOS_WS_DEFAULT)
    parsed = urlparse(raw)
    if parsed.scheme not in {"ws", "wss"}:
        return ""
    host = (parsed.hostname or "").lower()
    if not _host_allowed(host):
        return ""
    port = parsed.port or (443 if parsed.scheme == "wss" else 80)
    if port not in ALLOWED_PORTS:
        return ""
    path = parsed.path or "/ws"
    if path.rstrip("/") != "/ws":
        return ""
    return f"{parsed.scheme}://{parsed.hostname}:{port}/ws"


def dimos_upstream_ssl(url: str) -> ssl.SSLContext | None:
    if not url.startswith("wss://"):
        return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def relay_dimos_sockets(client_ws: Any, upstream_ws: Any, upstream_url: str = "") -> None:
    """Copy binary/text frames both ways until either side closes."""

    async def client_to_upstream() -> None:
        while True:
            message = await client_ws.receive()
            kind = message.get("type")
            if kind == "websocket.disconnect":
                return
            if kind != "websocket.receive":
                continue
            data = message.get("bytes")
            if data is not None:
                await upstream_ws.send(data)
                continue
            text = message.get("text")
            if text is not None:
                await upstream_ws.send(text)

    async def upstream_to_client() -> None:
        async for payload in upstream_ws:
            if isinstance(payload, (bytes, bytearray)):
                await client_ws.send_bytes(payload)
            else:
                from backend.services.robotics_teleop_state import note_status
                note_status(upstream_url, payload)
                await client_ws.send_text(str(payload))

    tasks = [
        asyncio.create_task(client_to_upstream()),
        asyncio.create_task(upstream_to_client()),
    ]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    for task in pending:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    for task in done:
        exc = task.exception()
        if exc:
            raise exc


async def connect_and_relay(client_ws: Any, upstream_url: str) -> None:
    """Accept the Studio client, open DIMOS /ws, relay. Times out instead of hanging."""
    import websockets

    target = normalize_dimos_upstream(upstream_url)
    if not target:
        await client_ws.accept()
        await client_ws.close(code=1008)
        return
    await client_ws.accept()
    try:
        async with websockets.connect(
            target,
            ssl=dimos_upstream_ssl(target),
            max_size=MAX_FRAME_BYTES,
            open_timeout=CONNECT_TIMEOUT_S,
            close_timeout=1,
        ) as upstream_ws:
            try:
                await relay_dimos_sockets(client_ws, upstream_ws, target)
            finally:
                from backend.services.robotics_teleop_state import clear_status
                clear_status(target)
    except Exception as exc:
        logger.info("DIMOS Quest pipe upstream failed: %s", exc)
        try:
            await client_ws.close(code=1011)
        except Exception:
            pass
