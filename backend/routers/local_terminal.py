"""Desktop-only local PTY websocket. Loopback + signed-in user required."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, Request, WebSocket, WebSocketDisconnect

from backend.auth import decode_token, get_current_user, get_user_by_id
from backend.services import local_pty

logger = logging.getLogger("render3d.local_terminal")

router = APIRouter()
REMOTE_CLOSE = 4403


def _availability_payload(connection: Any, host: str | None = None) -> dict[str, Any]:
    ok, reason = local_pty.local_terminal_gate(connection, host)
    return {
        "available": ok,
        "reason": reason,
        "kind": "local-pty",
        "capture": False,
        "app": "pty",
    }


@router.get("/api/local-terminal/availability")
def local_terminal_availability(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    del user
    payload = _availability_payload(request, request.headers.get("host"))
    payload["shell"] = local_pty.resolve_shell() if payload["available"] else ""
    return payload


@router.websocket("/api/local-terminal/ws")
async def local_terminal_ws(
    websocket: WebSocket,
    token: str = Query(...),
    project_id: Optional[str] = Query(default=None),
    cols: int = Query(default=80),
    rows: int = Query(default=24),
):
    user_id = decode_token(token)
    if not user_id or not get_user_by_id(user_id):
        await websocket.close(code=4401)
        return
    host = websocket.headers.get("host") or (websocket.url.hostname or "")
    ok, reason = local_pty.local_terminal_gate(websocket, host)
    if not ok:
        await websocket.accept()
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": reason}))
        except Exception:
            pass
        await websocket.close(code=REMOTE_CLOSE, reason=(reason or "forbidden")[:120])
        return

    await websocket.accept()
    cwd = local_pty.resolve_pty_cwd(project_id)
    proc = None
    try:
        proc = await asyncio.to_thread(local_pty.spawn_local_pty, cwd, cols, rows)
    except Exception as exc:
        logger.warning("local PTY spawn failed: %s", exc)
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Could not open a local shell on this computer.",
            }))
        except Exception:
            pass
        await websocket.close(code=1011)
        return

    loop = asyncio.get_running_loop()
    outgoing: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

    def reader() -> None:
        try:
            while proc.isalive():
                try:
                    chunk = proc.read(4096)
                except EOFError:
                    break
                if chunk:
                    asyncio.run_coroutine_threadsafe(outgoing.put(("out", chunk)), loop)
        except Exception:
            pass
        finally:
            asyncio.run_coroutine_threadsafe(outgoing.put(("eof", None)), loop)

    thread = threading.Thread(target=reader, name="local-pty-read", daemon=True)
    thread.start()

    async def pump_out() -> None:
        while True:
            kind, data = await outgoing.get()
            if kind == "eof":
                try:
                    await websocket.send_text(json.dumps({"type": "exit"}))
                except Exception:
                    pass
                break
            try:
                await websocket.send_text(json.dumps({"type": "output", "data": data}))
            except Exception:
                break

    out_task = asyncio.create_task(pump_out())
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > 64_000:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await asyncio.to_thread(proc.write, raw)
                continue
            kind = str(msg.get("type") or "")
            if kind == "input":
                data = msg.get("data")
                if data:
                    await asyncio.to_thread(proc.write, str(data)[:32_000])
            elif kind == "resize":
                c = max(10, min(int(msg.get("cols") or 80), 400))
                r = max(4, min(int(msg.get("rows") or 24), 200))
                try:
                    await asyncio.to_thread(proc.setwinsize, r, c)
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        out_task.cancel()
        local_pty.kill_pty(proc)
