"""Studio Quest pipe: /api/dimos/ws → DIMOS OpenArm teleop /ws.

POST /api/dimos/ensure-coordinator starts `dimos run teleop-*` in the
background when :8443 is down. It never kills a live coordinator.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Query, WebSocket
from pydantic import BaseModel, Field

from backend.services.dimos_headset import headset_map_payload
from backend.services.dimos_teleop_proxy import (
    CLOUD_REFUSE_REASON,
    DIMOS_WS_DEFAULT,
    connect_and_relay,
    normalize_dimos_upstream,
    studio_can_proxy_lan,
)
from backend.services.dimos_teleop_spawn import coordinator_status, ensure_dimos_coordinator, peek_coordinator_status

router = APIRouter()


class EnsureCoordinatorBody(BaseModel):
    headset: str = "quest"
    blueprint: Optional[str] = Field(default=None)


@router.get("/api/dimos/ws-default")
def dimos_ws_default():
    return {
        "upstream": DIMOS_WS_DEFAULT,
        "pipe": "/api/dimos/ws",
        **headset_map_payload(),
    }


@router.get("/api/dimos/coordinator")
async def dimos_coordinator():
    """Cached status. Never run ps/socket probes on the event loop."""
    import asyncio

    hit = peek_coordinator_status()
    if hit is not None:
        return hit
    return await asyncio.to_thread(coordinator_status)


@router.post("/api/dimos/ensure-coordinator")
def dimos_ensure_coordinator(body: Optional[EnsureCoordinatorBody] = None) -> dict[str, Any]:
    """If the DIMOS pipe is down, spawn the headset's blueprint and return immediately."""
    payload = body or EnsureCoordinatorBody()
    return ensure_dimos_coordinator(payload.headset, payload.blueprint)


@router.websocket("/api/dimos/ws")
async def dimos_quest_pipe(
    websocket: WebSocket,
    upstream: Optional[str] = Query(default=None),
):
    studio_host = websocket.headers.get("host") or (websocket.url.hostname or "")
    if not studio_can_proxy_lan(studio_host):
        await websocket.accept()
        await websocket.close(code=1008, reason=CLOUD_REFUSE_REASON)
        return
    target = normalize_dimos_upstream(upstream)
    if not target:
        await websocket.accept()
        await websocket.close(code=1008, reason="Invalid DIMOS target; choose the Pi LAN address on port 8443")
        return
    await connect_and_relay(websocket, target)
