"""Two websocket clients in one project room exchange pose, stroke, and rtc."""

from __future__ import annotations

import unittest

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.testclient import TestClient

from backend.ws.manager import CollabHub


def _mini_app() -> tuple[FastAPI, CollabHub]:
    hub = CollabHub()
    app = FastAPI()

    @app.websocket("/ws/projects/{project_id}/{user_id}")
    async def project_ws(websocket: WebSocket, project_id: str, user_id: str):
        user = {"id": user_id, "display_name": user_id.title()}
        client = await hub.connect(project_id, websocket, user)
        try:
            while True:
                raw = await websocket.receive_text()
                await hub.handle_message(project_id, client.user_id, raw)
        except WebSocketDisconnect:
            await hub.disconnect(project_id, client.user_id)

    return app, hub


class TwoClientXrRelayTests(unittest.TestCase):
    def test_two_clients_exchange_pose_stroke_and_rtc(self):
        app, _hub = _mini_app()
        with TestClient(app) as client:
            with client.websocket_connect("/ws/projects/room1/ada") as ada:
                ada_sync = ada.receive_json()
                self.assertEqual(ada_sync["type"], "presence.sync")
                with client.websocket_connect("/ws/projects/room1/sam") as sam:
                    sam_sync = sam.receive_json()
                    self.assertEqual(sam_sync["type"], "presence.sync")
                    ada_join = ada.receive_json()
                    self.assertEqual(ada_join["type"], "presence.join")
                    self.assertEqual(ada_join["user"]["id"], "sam")

                    ada.send_json({"type": "xr.pose", "pose": {"head": {"p": [0, 1.6, 0]}}})
                    pose = sam.receive_json()
                    self.assertEqual(pose["type"], "xr.pose")
                    self.assertEqual(pose["user_id"], "ada")
                    self.assertEqual(pose["pose"]["head"]["p"][1], 1.6)

                    sam.send_json({
                        "type": "xr.stroke",
                        "points": [[0, 1, 0], [0.1, 1, 0]],
                        "color": 0x22c55e,
                    })
                    stroke = ada.receive_json()
                    self.assertEqual(stroke["type"], "xr.stroke")
                    self.assertEqual(stroke["user_id"], "sam")
                    self.assertEqual(len(stroke["points"]), 2)

                    ada.send_json({
                        "type": "rtc.signal",
                        "target_user_id": "sam",
                        "signal": {"kind": "offer", "sdp": "v=0"},
                    })
                    rtc = sam.receive_json()
                    self.assertEqual(rtc["type"], "rtc.signal")
                    self.assertEqual(rtc["user_id"], "ada")
                    self.assertEqual(rtc["signal"]["kind"], "offer")

                    sam.send_json({
                        "type": "rtc.signal",
                        "target_user_id": "ada",
                        "signal": {"kind": "answer", "sdp": "v=0-answer"},
                    })
                    answer = ada.receive_json()
                    self.assertEqual(answer["type"], "rtc.signal")
                    self.assertEqual(answer["user_id"], "sam")
                    self.assertEqual(answer["signal"]["kind"], "answer")

                    ada.send_json({
                        "type": "rtc.signal",
                        "target_user_id": "sam",
                        "signal": {"kind": "ice", "candidate": {"candidate": "a", "sdpMid": "0"}},
                    })
                    ice = sam.receive_json()
                    self.assertEqual(ice["type"], "rtc.signal")
                    self.assertEqual(ice["signal"]["kind"], "ice")
                    self.assertEqual(ice["signal"]["candidate"]["sdpMid"], "0")

                    sam.send_json({
                        "type": "xr.board",
                        "action": "place",
                        "board": {"p": [0, 0, 0]},
                    })
                    board = ada.receive_json()
                    self.assertEqual(board["type"], "xr.board")
                    self.assertEqual(board["user_id"], "sam")

                    ada.send_json({
                        "type": "xr.drop",
                        "object_id": "scene-p1-frame.step",
                        "project_id": "p1",
                        "glb_url": "/api/share/t/files/frame.glb",
                        "kind": "scene",
                        "fit": "world",
                        "share_mode": "view",
                        "pose": {"p": [0, 1.2, -0.4], "q": [0, 0, 0, 1], "s": [1, 1, 1]},
                    })
                    drop = sam.receive_json()
                    self.assertEqual(drop["type"], "xr.drop")
                    self.assertEqual(drop["user_id"], "ada")
                    self.assertEqual(drop["kind"], "scene")
                    self.assertEqual(drop["share_mode"], "view")

                    sam.send_json({
                        "type": "xr.prompt.bridge",
                        "prompt": "flange",
                        "target_user_id": "ada",
                    })
                    prompt = ada.receive_json()
                    self.assertEqual(prompt["type"], "xr.prompt.bridge")
                    self.assertEqual(prompt["prompt"], "flange")
                    self.assertEqual(prompt["user_id"], "sam")

    def test_late_joiner_gets_scene_mesh_snapshot(self):
        app, _hub = _mini_app()
        with TestClient(app) as client:
            with client.websocket_connect("/ws/projects/room1/ada") as ada:
                self.assertEqual(ada.receive_json()["type"], "presence.sync")
                ada.send_json({
                    "type": "xr.drop",
                    "object_id": "scene-p1-frame.step",
                    "project_id": "p1",
                    "glb_url": "/api/share/t/files/frame.glb",
                    "kind": "scene",
                    "fit": "world",
                    "share_mode": "view",
                    "pose": {"p": [0, 1.2, -0.4], "q": [0, 0, 0, 1], "s": [1, 1, 1]},
                })
                with client.websocket_connect("/ws/projects/room1/lee") as lee:
                    self.assertEqual(lee.receive_json()["type"], "presence.sync")
                    snap = lee.receive_json()
                    self.assertEqual(snap["type"], "xr.objects.sync")
                    self.assertEqual(snap["objects"][0]["object_id"], "scene-p1-frame.step")
                    self.assertEqual(snap["objects"][0]["glb_url"], "/api/share/t/files/frame.glb")
                    self.assertEqual(snap["objects"][0]["kind"], "scene")
                    self.assertEqual(snap["objects"][0]["share_mode"], "view")

    def test_join_presence_sync_includes_stored_xr_pose(self):
        app, _hub = _mini_app()
        with TestClient(app) as client:
            with client.websocket_connect("/ws/projects/room1/ada") as ada:
                self.assertEqual(ada.receive_json()["type"], "presence.sync")
                ada.send_json({"type": "xr.pose", "pose": {"head": {"p": [0.2, 1.7, 0.1]}}})
                with client.websocket_connect("/ws/projects/room1/sam") as sam:
                    sam_sync = sam.receive_json()
                    self.assertEqual(sam_sync["type"], "presence.sync")
                    ada_row = next(u for u in sam_sync["users"] if u["id"] == "ada")
                    self.assertEqual(ada_row["xrPose"]["head"]["p"][1], 1.7)
                    join = ada.receive_json()
                    self.assertEqual(join["type"], "presence.join")
                    self.assertEqual(join["user"]["id"], "sam")


class TwoClientPublicXrRelayTests(unittest.TestCase):
    def test_public_lobby_exchanges_pose_stroke_and_rtc(self):
        hub = CollabHub()
        app = FastAPI()

        @app.websocket("/api/ws/xr/public/{user_id}")
        async def public_ws(websocket: WebSocket, user_id: str):
            user = {"id": user_id, "display_name": user_id.title()}
            client = await hub.connect_xr_public(websocket, user)
            try:
                while True:
                    raw = await websocket.receive_text()
                    await hub.handle_xr_public_message(client.user_id, raw)
            except WebSocketDisconnect:
                await hub.disconnect_xr_public(client.user_id, client.websocket)

        with TestClient(app) as client:
            with client.websocket_connect("/api/ws/xr/public/ada") as ada:
                self.assertEqual(ada.receive_json()["type"], "presence.sync")
                ada.send_json({"type": "xr.pose", "pose": {"head": {"p": [0, 1.6, 0]}}})
                with client.websocket_connect("/api/ws/xr/public/sam") as sam:
                    sam_sync = sam.receive_json()
                    self.assertEqual(sam_sync["type"], "presence.sync")
                    ada_row = next(u for u in sam_sync["users"] if u["id"] == "ada")
                    self.assertEqual(ada_row["xrPose"]["head"]["p"][1], 1.6)
                    join = ada.receive_json()
                    self.assertEqual(join["type"], "presence.join")
                    self.assertEqual(join["user"]["id"], "sam")

                    sam.send_json({
                        "type": "xr.stroke",
                        "points": [[0, 1, 0], [0.2, 1, 0]],
                    })
                    stroke = ada.receive_json()
                    self.assertEqual(stroke["type"], "xr.stroke")
                    self.assertEqual(stroke["user_id"], "sam")

                    ada.send_json({
                        "type": "rtc.signal",
                        "target_user_id": "sam",
                        "signal": {"kind": "offer", "sdp": "v=0"},
                    })
                    rtc = sam.receive_json()
                    self.assertEqual(rtc["type"], "rtc.signal")
                    self.assertEqual(rtc["user_id"], "ada")
                    self.assertEqual(rtc["signal"]["kind"], "offer")

                    sam.send_json({
                        "type": "rtc.signal",
                        "target_user_id": "ada",
                        "signal": {"kind": "answer", "sdp": "v=0-answer"},
                    })
                    answer = ada.receive_json()
                    self.assertEqual(answer["type"], "rtc.signal")
                    self.assertEqual(answer["signal"]["kind"], "answer")

                    ada.send_json({
                        "type": "rtc.signal",
                        "target_user_id": "sam",
                        "signal": {"kind": "ice", "candidate": {"candidate": "cand", "sdpMid": "0"}},
                    })
                    ice = sam.receive_json()
                    self.assertEqual(ice["signal"]["kind"], "ice")

                    ada.send_json({
                        "type": "xr.drop",
                        "object_id": "scene-p1-cad.glb",
                        "glb_url": "/api/share/t/files/cad.glb",
                        "kind": "scene",
                        "fit": "world",
                        "pose": {"p": [0, 1.1, -0.5]},
                    })
                    drop = sam.receive_json()
                    self.assertEqual(drop["type"], "xr.drop")

                    sam.send_json({
                        "type": "xr.object",
                        "object_id": "held-1",
                        "pose": {"p": [0.1, 1.2, 0]},
                    })
                    obj = ada.receive_json()
                    self.assertEqual(obj["type"], "xr.object")
                    self.assertEqual(obj["user_id"], "sam")

    def test_public_late_joiner_gets_scene_mesh_snapshot(self):
        hub = CollabHub()
        app = FastAPI()

        @app.websocket("/api/ws/xr/public/{user_id}")
        async def public_ws(websocket: WebSocket, user_id: str):
            user = {"id": user_id, "display_name": user_id.title()}
            client = await hub.connect_xr_public(websocket, user)
            try:
                while True:
                    raw = await websocket.receive_text()
                    await hub.handle_xr_public_message(client.user_id, raw)
            except WebSocketDisconnect:
                await hub.disconnect_xr_public(client.user_id, client.websocket)

        with TestClient(app) as client:
            with client.websocket_connect("/api/ws/xr/public/ada") as ada:
                self.assertEqual(ada.receive_json()["type"], "presence.sync")
                ada.send_json({
                    "type": "xr.drop",
                    "object_id": "scene-p1-cad.glb",
                    "glb_url": "/api/share/t/files/cad.glb",
                    "kind": "scene",
                    "fit": "world",
                    "share_mode": "view",
                    "pose": {"p": [0, 1.1, -0.5]},
                })
                with client.websocket_connect("/api/ws/xr/public/lee") as lee:
                    self.assertEqual(lee.receive_json()["type"], "presence.sync")
                    snap = lee.receive_json()
                    self.assertEqual(snap["type"], "xr.objects.sync")
                    self.assertEqual(snap["objects"][0]["object_id"], "scene-p1-cad.glb")
                    self.assertEqual(snap["objects"][0]["kind"], "scene")
                    self.assertEqual(snap["objects"][0]["share_mode"], "view")


class XrPromptInboxTests(unittest.TestCase):
    def test_prompt_inbox_roundtrip(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch

        from backend.services import xr_prompt_inbox

        tmp = tempfile.TemporaryDirectory()
        try:
            with patch.object(xr_prompt_inbox.settings, "data_dir", tmp.name):
                entry = xr_prompt_inbox.push_prompt("u1", {"prompt": "flange", "images": []})
                self.assertEqual(entry["type"], "xr.prompt.bridge")
                pending = xr_prompt_inbox.list_pending("u1")
                self.assertEqual(len(pending), 1)
                self.assertEqual(pending[0]["prompt"], "flange")
                self.assertTrue(xr_prompt_inbox.ack_prompt("u1", entry["id"]))
                self.assertEqual(xr_prompt_inbox.list_pending("u1"), [])
                self.assertTrue((Path(tmp.name) / "u1" / "xr_prompt_inbox.json").is_file())
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
