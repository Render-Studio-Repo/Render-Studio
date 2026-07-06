"""WebSocket hub for real-time project collaboration."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("render3d.ws")


@dataclass
class Client:
    websocket: WebSocket
    user_id: str
    display_name: str
    color: str
    picks: list[dict[str, Any]] = field(default_factory=list)


class CollabHub:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, Client]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _color(user_id: str) -> str:
        palette = ["#58a6ff", "#3fb950", "#d29922", "#ff7b72", "#bc8cff", "#79c0ff", "#ffa657"]
        return palette[hash(user_id) % len(palette)]

    async def connect(self, project_id: str, websocket: WebSocket, user: dict[str, Any]) -> Client:
        await websocket.accept()
        client = Client(
            websocket=websocket,
            user_id=user["id"],
            display_name=user["display_name"],
            color=self._color(user["id"]),
        )
        async with self._lock:
            room = self._rooms.setdefault(project_id, {})
            room[user["id"]] = client

        await self.broadcast(
            project_id,
            {
                "type": "presence.join",
                "user": {"id": client.user_id, "display_name": client.display_name, "color": client.color},
            },
            skip_user_id=client.user_id,
        )
        await websocket.send_json(
            {
                "type": "presence.sync",
                "users": [
                    {
                        "id": c.user_id,
                        "display_name": c.display_name,
                        "color": c.color,
                        "picks": c.picks,
                    }
                    for c in self._rooms.get(project_id, {}).values()
                    if c.user_id != client.user_id
                ],
            }
        )
        return client

    async def disconnect(self, project_id: str, user_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(project_id, {})
            room.pop(user_id, None)
            if not room:
                self._rooms.pop(project_id, None)
        await self.broadcast(
            project_id,
            {"type": "presence.leave", "user_id": user_id},
        )

    async def broadcast(
        self,
        project_id: str,
        message: dict[str, Any],
        *,
        skip_user_id: str | None = None,
    ) -> None:
        async with self._lock:
            clients = list(self._rooms.get(project_id, {}).values())
        dead: list[tuple[str, str]] = []
        for client in clients:
            if skip_user_id and client.user_id == skip_user_id:
                continue
            try:
                await client.websocket.send_json(message)
            except Exception as exc:
                logger.debug("ws send failed: %s", exc)
                dead.append((project_id, client.user_id))
        for pid, uid in dead:
            await self.disconnect(pid, uid)

    def notify(self, project_id: str, message: dict[str, Any]) -> None:
        """Schedule broadcast from sync HTTP handlers."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast(project_id, message))
        except RuntimeError:
            logger.debug("no event loop for ws notify")

    async def handle_message(self, project_id: str, user_id: str, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        mtype = msg.get("type")
        async with self._lock:
            client = self._rooms.get(project_id, {}).get(user_id)
        if not client:
            return

        if mtype == "pick.update":
            client.picks = msg.get("picks") or []
            await self.broadcast(
                project_id,
                {
                    "type": "pick.update",
                    "user_id": client.user_id,
                    "display_name": client.display_name,
                    "color": client.color,
                    "picks": client.picks,
                },
                skip_user_id=client.user_id,
            )
        elif mtype == "pick.clear":
            client.picks = []
            await self.broadcast(
                project_id,
                {"type": "pick.clear", "user_id": client.user_id},
                skip_user_id=client.user_id,
            )


hub = CollabHub()
