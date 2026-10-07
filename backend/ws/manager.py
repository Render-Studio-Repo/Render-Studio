"""WebSocket hub for real-time project collaboration."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from backend.services.xr_hot_path import (
    XR_RELAY_TYPES,
    sanitize_printer_box,
    sanitize_public_drop,
    sanitize_public_object,
    sanitize_xr_device,
    sanitize_xr_mode,
    upsert_public_drop,
)

logger = logging.getLogger("render3d.ws")


@dataclass
class Client:
    websocket: WebSocket
    user_id: str
    display_name: str
    color: str
    avatar_url: str | None = None
    handle: str | None = None
    picks: list[dict[str, Any]] = field(default_factory=list)
    xr_pose: dict[str, Any] | None = None
    xr_device: str | None = None
    xr_mode: str | None = None


class CollabHub:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, Client]] = {}
        self._workspace_rooms: dict[str, dict[str, Client]] = {}
        self._xr_public: dict[str, Client] = {}
        self._xr_public_objects: dict[str, dict[str, Any]] = {}
        self._xr_project_objects: dict[str, dict[str, dict[str, Any]]] = {}
        self._user_sockets: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()
        self._main_loop: asyncio.AbstractEventLoop | None = None

    @staticmethod
    def _color(user_id: str) -> str:
        palette = ["#58a6ff", "#3fb950", "#d29922", "#ff7b72", "#bc8cff", "#79c0ff", "#ffa657"]
        return palette[hash(user_id) % len(palette)]

    @staticmethod
    def _apply_pose_meta(client: Client, pose: dict[str, Any] | None, msg: dict[str, Any] | None = None) -> None:
        device = ""
        mode = ""
        if isinstance(pose, dict):
            device = sanitize_xr_device(pose.get("xr_device") or pose.get("xrDevice"))
            mode = sanitize_xr_mode(pose.get("xr_mode") or pose.get("xrMode"))
        if isinstance(msg, dict):
            device = sanitize_xr_device(msg.get("xr_device") or msg.get("xrDevice")) or device
            mode = sanitize_xr_mode(msg.get("xr_mode") or msg.get("xrMode")) or mode
        if device:
            client.xr_device = device
        if mode:
            client.xr_mode = mode

    async def connect(self, project_id: str, websocket: WebSocket, user: dict[str, Any]) -> Client:
        await websocket.accept()
        client = Client(
            websocket=websocket,
            user_id=user["id"],
            display_name=user["display_name"],
            color=self._color(user["id"]),
            avatar_url=user.get("avatar_url"),
        )
        async with self._lock:
            room = self._rooms.setdefault(project_id, {})
            room[user["id"]] = client

        await self.broadcast(
            project_id,
            {
                "type": "presence.join",
                "user": {
                    "id": client.user_id,
                    "display_name": client.display_name,
                    "color": client.color,
                    "avatar_url": client.avatar_url,
                },
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
                        "avatar_url": c.avatar_url,
                        "picks": c.picks,
                        "xrPose": c.xr_pose,
                        "xr_device": c.xr_device,
                        "xr_mode": c.xr_mode,
                    }
                    for c in self._rooms.get(project_id, {}).values()
                    if c.user_id != client.user_id
                ],
            }
        )
        async with self._lock:
            dropped = list(self._xr_project_objects.get(project_id, {}).values())
        if dropped:
            await websocket.send_json({"type": "xr.objects.sync", "objects": dropped})
        return client

    async def disconnect(self, project_id: str, user_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(project_id, {})
            room.pop(user_id, None)
            if not room:
                self._rooms.pop(project_id, None)
                self._xr_project_objects.pop(project_id, None)
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

    async def connect_workspace(self, team_id: str, websocket: WebSocket, user: dict[str, Any]) -> Client:
        await websocket.accept()
        client = Client(
            websocket=websocket,
            user_id=user["id"],
            display_name=user["display_name"],
            color=self._color(user["id"]),
            avatar_url=user.get("avatar_url"),
        )
        async with self._lock:
            room = self._workspace_rooms.setdefault(team_id, {})
            room[user["id"]] = client
            users = list(room.values())
        await websocket.send_json(
            {
                "type": "workspace.presence.sync",
                "team_id": team_id,
                "users": [
                    {
                        "id": c.user_id,
                        "display_name": c.display_name,
                        "color": c.color,
                        "avatar_url": c.avatar_url,
                    }
                    for c in users
                ],
            }
        )
        await self.broadcast_workspace(
            team_id,
            {
                "type": "workspace.presence.join",
                "team_id": team_id,
                "user": {
                    "id": client.user_id,
                    "display_name": client.display_name,
                    "color": client.color,
                    "avatar_url": client.avatar_url,
                },
            },
            skip_user_id=client.user_id,
        )
        return client

    async def disconnect_workspace(self, team_id: str, user_id: str) -> None:
        async with self._lock:
            room = self._workspace_rooms.get(team_id, {})
            room.pop(user_id, None)
            if not room:
                self._workspace_rooms.pop(team_id, None)
        await self.broadcast_workspace(team_id, {"type": "workspace.presence.leave", "team_id": team_id, "user_id": user_id})

    async def broadcast_workspace(self, team_id: str, message: dict[str, Any], *, skip_user_id: str | None = None) -> None:
        async with self._lock:
            clients = list(self._workspace_rooms.get(team_id, {}).values())
        dead: list[tuple[str, str]] = []
        for client in clients:
            if skip_user_id and client.user_id == skip_user_id:
                continue
            try:
                await client.websocket.send_json(message)
            except Exception as exc:
                logger.debug("workspace ws send failed: %s", exc)
                dead.append((team_id, client.user_id))
        for tid, uid in dead:
            await self.disconnect_workspace(tid, uid)

    def notify_workspace(self, team_id: str, message: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast_workspace(team_id, message))
        except RuntimeError:
            logger.debug("no event loop for workspace ws notify")

    async def connect_user(self, websocket: WebSocket, user: dict[str, Any]) -> None:
        await websocket.accept()
        self._main_loop = asyncio.get_running_loop()
        async with self._lock:
            self._user_sockets.setdefault(user["id"], set()).add(websocket)
        sent_capture_ids: set[str] = set()
        sent_prompt_ids: set[str] = set()
        try:
            await websocket.send_json({"type": "user.sync"})
            # Flush any XR captures waiting for a logged-in desktop session.
            # Keep re-checking the on-disk inbox: with multiple uvicorn workers,
            # notify_user only reaches sockets on the worker that handled publish.
            try:
                from backend.services import xr_capture_inbox

                for item in xr_capture_inbox.list_pending(user["id"]):
                    cid = str(item.get("id") or "")
                    await websocket.send_json(item)
                    if cid:
                        sent_capture_ids.add(cid)
            except Exception as exc:
                logger.debug("xr capture inbox flush failed: %s", exc)
            try:
                from backend.services import xr_prompt_inbox

                for item in xr_prompt_inbox.list_pending(user["id"]):
                    pid = str(item.get("id") or "")
                    await websocket.send_json(item)
                    if pid:
                        sent_prompt_ids.add(pid)
            except Exception as exc:
                logger.debug("xr prompt inbox flush failed: %s", exc)
            while True:
                try:
                    await asyncio.wait_for(websocket.receive_text(), timeout=2.0)
                except asyncio.TimeoutError:
                    try:
                        from backend.services import xr_capture_inbox

                        for item in xr_capture_inbox.list_pending(user["id"]):
                            cid = str(item.get("id") or "")
                            if not cid or cid in sent_capture_ids:
                                continue
                            await websocket.send_json(item)
                            sent_capture_ids.add(cid)
                    except Exception as exc:
                        logger.debug("xr capture inbox poll failed: %s", exc)
                    try:
                        from backend.services import xr_prompt_inbox

                        for item in xr_prompt_inbox.list_pending(user["id"]):
                            pid = str(item.get("id") or "")
                            if not pid or pid in sent_prompt_ids:
                                continue
                            await websocket.send_json(item)
                            sent_prompt_ids.add(pid)
                    except Exception as exc:
                        logger.debug("xr prompt inbox poll failed: %s", exc)
        finally:
            async with self._lock:
                sockets = self._user_sockets.get(user["id"])
                if sockets:
                    sockets.discard(websocket)
                    if not sockets:
                        self._user_sockets.pop(user["id"], None)

    async def send_user(self, user_id: str, message: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._user_sockets.get(user_id, set()))
        dead: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_json(message)
            except Exception as exc:
                logger.debug("user ws send failed: %s", exc)
                dead.append(websocket)
        if dead:
            async with self._lock:
                sockets_set = self._user_sockets.get(user_id)
                if sockets_set:
                    for websocket in dead:
                        sockets_set.discard(websocket)
                    if not sockets_set:
                        self._user_sockets.pop(user_id, None)

    def notify_user(self, user_id: str, message: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.send_user(user_id, message))
            return
        except RuntimeError:
            pass
        loop = self._main_loop
        if loop is not None and loop.is_running():
            asyncio.run_coroutine_threadsafe(self.send_user(user_id, message), loop)
            return
        logger.debug("no event loop for user ws notify")

    async def broadcast_users(self, message: dict[str, Any], *, skip_user_id: str | None = None) -> None:
        async with self._lock:
            user_ids = list(self._user_sockets.keys())
        for uid in user_ids:
            if skip_user_id and uid == skip_user_id:
                continue
            await self.send_user(uid, message)

    def notify_all_users(self, message: dict[str, Any], *, skip_user_id: str | None = None) -> None:
        """Push to every signed-in user socket on this worker (Public folder, global toasts)."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.broadcast_users(message, skip_user_id=skip_user_id))
        except RuntimeError:
            logger.debug("no event loop for all-user ws notify")

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
                    "avatar_url": client.avatar_url,
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
        elif mtype == "xr.pose":
            pose = msg.get("pose")
            if not isinstance(pose, dict):
                return
            client.xr_pose = pose
            self._apply_pose_meta(client, pose, msg)
            await self.broadcast(
                project_id,
                {
                    "type": "xr.pose",
                    "user_id": client.user_id,
                    "display_name": client.display_name,
                    "color": client.color,
                    "avatar_url": client.avatar_url,
                    "xr_device": client.xr_device,
                    "xr_mode": client.xr_mode,
                    "pose": pose,
                },
                skip_user_id=client.user_id,
            )
        elif mtype == "xr.drop":
            payload = sanitize_public_drop(msg, client.user_id)
            if not payload:
                return
            payload["display_name"] = client.display_name
            async with self._lock:
                store = self._xr_project_objects.setdefault(project_id, {})
                upsert_public_drop(store, payload)
            await self.broadcast(project_id, payload, skip_user_id=client.user_id)
        elif mtype == "xr.object":
            payload = sanitize_public_object(msg, client.user_id)
            if not payload:
                return
            payload["display_name"] = client.display_name
            async with self._lock:
                store = self._xr_project_objects.get(project_id) or {}
                prev = store.get(payload["object_id"])
                if prev:
                    merged = {**prev, **payload}
                    if payload.get("pose"):
                        merged["pose"] = payload["pose"]
                    store[payload["object_id"]] = merged
            await self.broadcast(project_id, payload, skip_user_id=client.user_id)
        elif mtype == "xr.printer":
            payload = sanitize_printer_box(msg, client.user_id)
            if not payload:
                return
            payload["display_name"] = client.display_name
            async with self._lock:
                store = self._xr_project_objects.setdefault(project_id, {})
                upsert_public_drop(store, payload)
            await self.broadcast(project_id, payload, skip_user_id=client.user_id)
        elif mtype in XR_RELAY_TYPES - {"rtc.signal", "xr.drop", "xr.object", "xr.printer"}:
            payload = {**msg, "user_id": client.user_id, "display_name": client.display_name}
            target = str(msg.get("target_user_id") or "").strip()
            if target:
                await self.send_to_user(project_id, target, payload)
            else:
                await self.broadcast(project_id, payload, skip_user_id=client.user_id)
        elif mtype == "video.editor":
            action = str(msg.get("action") or "update")[:40]
            label = str(msg.get("label") or "")[:80]
            kind = str(msg.get("kind") or "video")[:20]
            await self.broadcast(
                project_id,
                {
                    "type": "video.editor",
                    "action": action,
                    "clip_id": str(msg.get("clip_id") or "")[:80],
                    "label": label,
                    "kind": kind,
                    "user_id": client.user_id,
                    "display_name": client.display_name,
                    "avatar_url": client.avatar_url,
                },
                skip_user_id=client.user_id,
            )
        elif isinstance(mtype, str) and mtype.startswith("canvas."):
            from backend.services import canvas_collab
            from backend.services import teams_service as ts

            if mtype not in canvas_collab.CANVAS_COLLAB_TYPES:
                return
            if mtype in canvas_collab.CANVAS_MUTATION_TYPES and not ts.can_edit_project(user_id, project_id):
                return
            payload = {
                "type": mtype,
                "board": str(msg.get("board") or "")[:80],
                "op": str(msg.get("op") or "")[:24],
                "user_id": client.user_id,
                "display_name": client.display_name,
                "color": client.color,
                "avatar_url": client.avatar_url,
            }
            if mtype == "canvas.cursor":
                payload["x"] = msg.get("x")
                payload["y"] = msg.get("y")
            elif mtype == "canvas.preview":
                payload["preview"] = msg.get("preview")
            elif mtype == "canvas.patch":
                payload["op"] = payload["op"] or "upsert"
                if isinstance(msg.get("element"), dict):
                    payload["element"] = msg.get("element")
                if isinstance(msg.get("ids"), list):
                    payload["ids"] = [str(i)[:80] for i in msg.get("ids")[:200]]
                if isinstance(msg.get("elements"), list):
                    payload["elements"] = msg.get("elements")[:400]
            elif mtype == "canvas.delete":
                payload["ids"] = [str(i)[:80] for i in (msg.get("ids") or [])[:200]]
            await self.broadcast(project_id, payload, skip_user_id=client.user_id)
        elif mtype == "rtc.signal":
            signal = msg.get("signal")
            if not isinstance(signal, dict):
                return
            payload = {
                "type": "rtc.signal",
                "user_id": client.user_id,
                "target_user_id": msg.get("target_user_id"),
                "signal": signal,
            }
            target = str(msg.get("target_user_id") or "").strip()
            if target:
                await self.send_to_user(project_id, target, payload)
            else:
                await self.broadcast(project_id, payload, skip_user_id=client.user_id)

    async def send_to_user(self, project_id: str, user_id: str, message: dict[str, Any]) -> None:
        async with self._lock:
            client = self._rooms.get(project_id, {}).get(user_id)
        if not client:
            return
        try:
            await client.websocket.send_json(message)
        except Exception as exc:
            logger.debug("ws send_to_user failed: %s", exc)
            await self.disconnect(project_id, user_id)

    def _public_user_payload(self, client: Client) -> dict[str, Any]:
        return {
            "id": client.user_id,
            "display_name": client.display_name,
            "handle": client.handle,
            "color": client.color,
            "avatar_url": client.avatar_url,
            "xr_device": client.xr_device,
            "xr_mode": client.xr_mode,
        }

    async def connect_xr_public(self, websocket: WebSocket, user: dict[str, Any]) -> Client:
        from backend.services import xr_public_room_service

        await websocket.accept()
        color = xr_public_room_service.color_for(user["id"])
        client = Client(
            websocket=websocket,
            user_id=user["id"],
            display_name=user.get("display_name") or user.get("email") or "User",
            color=color,
            avatar_url=user.get("avatar_url"),
            handle=(user.get("handle") or None),
        )
        async with self._lock:
            prev = self._xr_public.get(client.user_id)
            self._xr_public[client.user_id] = client
        if prev and prev.websocket is not websocket:
            try:
                await prev.websocket.close(code=4409, reason="Public room opened on another device")
            except Exception:
                pass
        try:
            xr_public_room_service.touch(user)
        except Exception as exc:
            logger.debug("xr public touch failed: %s", exc)
        occupants = [
            {**self._public_user_payload(c), "xrPose": c.xr_pose}
            for c in self._xr_public.values()
            if c.user_id != client.user_id
        ]
        async with self._lock:
            dropped = list(self._xr_public_objects.values())
        await websocket.send_json({"type": "presence.sync", "users": occupants})
        if dropped:
            await websocket.send_json({"type": "xr.objects.sync", "objects": dropped})
        await self.broadcast_xr_public(
            {"type": "presence.join", "user": self._public_user_payload(client)},
            skip_user_id=client.user_id,
        )
        return client

    async def disconnect_xr_public(self, user_id: str, websocket: WebSocket | None = None) -> None:
        from backend.services import xr_public_room_service

        async with self._lock:
            client = self._xr_public.get(user_id)
            if websocket is not None and client and client.websocket is not websocket:
                return
            self._xr_public.pop(user_id, None)
            empty = not self._xr_public
            if empty:
                self._xr_public_objects.clear()
        try:
            xr_public_room_service.leave(user_id)
        except Exception as exc:
            logger.debug("xr public leave failed: %s", exc)
        await self.broadcast_xr_public({"type": "presence.leave", "user_id": user_id})

    async def broadcast_xr_public(
        self,
        message: dict[str, Any],
        *,
        skip_user_id: str | None = None,
    ) -> None:
        async with self._lock:
            clients = list(self._xr_public.values())
        dead: list[tuple[str, WebSocket]] = []
        for client in clients:
            if skip_user_id and client.user_id == skip_user_id:
                continue
            try:
                await client.websocket.send_json(message)
            except Exception as exc:
                logger.debug("xr public ws send failed: %s", exc)
                dead.append((client.user_id, client.websocket))
        for uid, ws in dead:
            await self.disconnect_xr_public(uid, ws)

    async def handle_xr_public_message(self, user_id: str, raw: str) -> None:
        from backend.services import xr_public_room_service

        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        mtype = msg.get("type")
        async with self._lock:
            client = self._xr_public.get(user_id)
        if not client:
            return
        user = {
            "id": client.user_id,
            "display_name": client.display_name,
            "handle": client.handle,
            "avatar_url": client.avatar_url,
        }
        if mtype in {"ping", "presence.touch"}:
            try:
                xr_public_room_service.touch(
                    user,
                    project_id=str(msg.get("project_id") or "") or None,
                    project_name=str(msg.get("project_name") or "") or None,
                    update_project=bool(msg.get("project_id") or msg.get("project_name")),
                )
            except Exception as exc:
                logger.debug("xr public ping failed: %s", exc)
            return
        if mtype == "xr.pose":
            pose = msg.get("pose")
            if not isinstance(pose, dict):
                return
            client.xr_pose = pose
            self._apply_pose_meta(client, pose, msg)
            try:
                xr_public_room_service.touch(
                    {
                        **user,
                        "xr_device": client.xr_device,
                        "xr_mode": client.xr_mode,
                    },
                    update_device=True,
                )
            except Exception as exc:
                logger.debug("xr public device touch failed: %s", exc)
            await self.broadcast_xr_public(
                {
                    "type": "xr.pose",
                    "user_id": client.user_id,
                    "display_name": client.display_name,
                    "handle": client.handle,
                    "color": client.color,
                    "avatar_url": client.avatar_url,
                    "xr_device": client.xr_device,
                    "xr_mode": client.xr_mode,
                    "pose": pose,
                },
                skip_user_id=client.user_id,
            )
            return
        if mtype == "xr.drop":
            payload = sanitize_public_drop(msg, client.user_id)
            if not payload:
                return
            payload["display_name"] = client.display_name
            payload["handle"] = client.handle
            async with self._lock:
                upsert_public_drop(self._xr_public_objects, payload)
            await self.broadcast_xr_public(payload, skip_user_id=client.user_id)
            return
        if mtype == "xr.object":
            payload = sanitize_public_object(msg, client.user_id)
            if not payload:
                return
            payload["display_name"] = client.display_name
            async with self._lock:
                prev = self._xr_public_objects.get(payload["object_id"])
                if prev:
                    merged = {**prev, **payload}
                    if payload.get("pose"):
                        merged["pose"] = payload["pose"]
                    self._xr_public_objects[payload["object_id"]] = merged
            await self.broadcast_xr_public(payload, skip_user_id=client.user_id)
            return
        if mtype == "xr.printer":
            payload = sanitize_printer_box(msg, client.user_id)
            if not payload:
                return
            payload["display_name"] = client.display_name
            async with self._lock:
                upsert_public_drop(self._xr_public_objects, payload)
            await self.broadcast_xr_public(payload, skip_user_id=client.user_id)
            return
        if mtype == "rtc.signal":
            signal = msg.get("signal")
            if not isinstance(signal, dict):
                return
            payload = {
                "type": "rtc.signal",
                "user_id": client.user_id,
                "target_user_id": msg.get("target_user_id"),
                "signal": signal,
            }
            target = str(msg.get("target_user_id") or "").strip()
            if target:
                async with self._lock:
                    dest = self._xr_public.get(target)
                if dest:
                    try:
                        await dest.websocket.send_json(payload)
                    except Exception as exc:
                        logger.debug("xr public rtc send failed: %s", exc)
            else:
                await self.broadcast_xr_public(payload, skip_user_id=client.user_id)
            return
        if mtype in XR_RELAY_TYPES - {"rtc.signal"}:
            payload = {
                **msg,
                "user_id": client.user_id,
                "display_name": client.display_name,
                "handle": client.handle,
            }
            target = str(msg.get("target_user_id") or "").strip()
            if target:
                async with self._lock:
                    dest = self._xr_public.get(target)
                if dest:
                    try:
                        await dest.websocket.send_json(payload)
                    except Exception as exc:
                        logger.debug("xr public relay failed: %s", exc)
            else:
                await self.broadcast_xr_public(payload, skip_user_id=client.user_id)
            return
        if mtype == "project.announce":
            project_id = str(msg.get("project_id") or "").strip()
            project_name = str(msg.get("project_name") or "").strip()
            try:
                xr_public_room_service.touch(
                    user,
                    project_id=project_id or None,
                    project_name=project_name or None,
                    update_project=True,
                )
            except Exception as exc:
                logger.debug("xr public announce failed: %s", exc)
            await self.broadcast_xr_public(
                {
                    "type": "project.announce",
                    "user_id": client.user_id,
                    "display_name": client.display_name,
                    "handle": client.handle,
                    "project_id": project_id,
                    "project_name": project_name,
                },
                skip_user_id=client.user_id,
            )
            return
        if mtype == "project.share.invite":
            payload = {
                "type": "project.share.invite",
                "user_id": client.user_id,
                "display_name": client.display_name,
                "handle": client.handle,
                "project_id": str(msg.get("project_id") or "").strip(),
                "project_name": str(msg.get("project_name") or "").strip(),
            }
            await self.broadcast_xr_public(payload, skip_user_id=client.user_id)
            return


hub = CollabHub()
