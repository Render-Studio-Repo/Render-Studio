"""XR studio: workspace move, file inbox."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import get_conn, init_db
from backend.services import social_network_service, teams_service
from backend.services.xr_studio import merge_log_usage, token_count_from_entry, usage_from_prompt_history
from backend.services.xr_hot_path import (
    GRANT_REFRESH_SURFACES,
    XR_RELAY_TYPES,
    grant_notify_user_ids,
    grant_ws_payload,
    presence_sync_pose_messages,
    relay_recipient_ids,
    sanitize_printer_box,
    sanitize_public_drop,
    sanitize_public_object,
    sanitize_xr_device,
    sanitize_xr_mode,
    should_refresh_permission_surfaces,
    upsert_public_drop,
)


class XrStudioAccessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()
        self.owner = "u_owner"
        self.friend = "u_friend"
        self.team_a = "team_a"
        self.team_b = "team_b"
        self.project = "proj_xr"
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                (self.owner, "owner@example.com", "Owner", "x", "2026-09-07T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                (self.friend, "friend@example.com", "Friend", "x", "2026-09-07T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)",
                (self.team_a, "Studio A", self.owner, "2026-09-07T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO teams (id, name, created_by, created_at) VALUES (?,?,?,?)",
                (self.team_b, "Studio B", self.owner, "2026-09-07T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                (self.team_a, self.owner, "owner", "2026-09-07T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)",
                (self.team_b, self.owner, "owner", "2026-09-07T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO project_access (project_id, team_id, created_by, created_at) VALUES (?,?,?,?)",
                (self.project, self.team_a, self.owner, "2026-09-07T00:00:00+00:00"),
            )
            conn.commit()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_move_project_to_workspace(self):
        result = teams_service.move_project_to_workspace(self.project, self.team_b, self.owner)
        self.assertEqual(result["team_id"], self.team_b)
        with get_conn() as conn:
            row = conn.execute(
                "SELECT team_id FROM project_access WHERE project_id = ?",
                (self.project,),
            ).fetchone()
        self.assertEqual(row["team_id"], self.team_b)

    def test_send_file_inbox(self):
        sent = social_network_service.send_file(
            {"id": self.owner, "display_name": "Owner"},
            self.friend,
            share_url="/share/abc",
            filename="part.glb",
            project_id=self.project,
        )
        self.assertTrue(sent["ok"])
        inbox = social_network_service.list_inbox_files(self.friend)
        self.assertEqual(inbox[0]["filename"], "part.glb")
        self.assertEqual(inbox[0]["share_url"], "/share/abc")

    def test_cannot_send_file_to_self(self):
        with self.assertRaises(ValueError):
            social_network_service.send_file(
                {"id": self.owner, "display_name": "Owner"},
                self.owner,
                share_url="/share/abc",
            )

    def test_grant_notifies_actor_and_target(self):
        self.assertEqual(grant_notify_user_ids(self.owner, self.friend), [self.friend, self.owner])
        self.assertEqual(grant_notify_user_ids(self.owner, self.owner), [self.owner])

    def test_copy_to_my_projects_accepts_force_new(self):
        import inspect
        from backend.main import copy_project_to_my_projects

        params = inspect.signature(copy_project_to_my_projects).parameters
        self.assertIn("force_new", params)

    def test_rooms_relay_voice_and_strokes(self):
        self.assertIn("rtc.signal", XR_RELAY_TYPES)
        self.assertIn("xr.stroke", XR_RELAY_TYPES)
        self.assertIn("xr.file", XR_RELAY_TYPES)
        self.assertIn("xr.prompt.bridge", XR_RELAY_TYPES)
        self.assertIn("xr.drop", XR_RELAY_TYPES)
        self.assertIn("xr.object", XR_RELAY_TYPES)
        self.assertIn("xr.printer", XR_RELAY_TYPES)
        self.assertIn("xr.fit", XR_RELAY_TYPES)
        self.assertIn("xr.draw", XR_RELAY_TYPES)
        self.assertIn("xr.video", XR_RELAY_TYPES)
        self.assertIn("xr.window", XR_RELAY_TYPES)
        self.assertIn("xr.board", XR_RELAY_TYPES)
        self.assertIn("xr.table", XR_RELAY_TYPES)
        self.assertIn("xr.seat", XR_RELAY_TYPES)

    def test_xr_device_label_is_short_and_sanitized(self):
        self.assertEqual(sanitize_xr_device("Quest 3"), "Quest 3")
        self.assertEqual(sanitize_xr_device("Quest 3!!!"), "Quest 3")
        self.assertLessEqual(len(sanitize_xr_device("x" * 80)), 24)
        self.assertEqual(sanitize_xr_mode("vr"), "vr")
        self.assertEqual(sanitize_xr_mode("nope"), "")
        poses = presence_sync_pose_messages([
            {"id": self.friend, "xrPose": {"head": {"p": [0, 1.6, 0]}, "xr_device": "Quest 3", "avatar": {"source": "studio"}}},
        ])
        self.assertEqual(poses[0]["pose"]["xr_device"], "Quest 3")

    def test_capture_ready_can_flag_share_to_x(self):
        from unittest.mock import patch
        from backend.services import xr_capture_inbox

        tmp = tempfile.TemporaryDirectory()
        try:
            with patch.object(xr_capture_inbox.settings, "data_dir", tmp.name):
                entry = xr_capture_inbox.push_capture(
                    "u1",
                    project_id="p1",
                    kind="screenshot",
                    filename="shot.png",
                    url="/files/Screenshots/shot.png",
                    share_x=True,
                )
                self.assertTrue(entry["share_x"])
                self.assertEqual(entry["type"], "xr.capture.ready")
        finally:
            tmp.cleanup()

    def test_public_drop_payloads_are_sanitized_and_keep_full_inventory(self):
        drop = sanitize_public_drop(
            {
                "object_id": "drop-1",
                "project_name": "Bike",
                "glb_url": "/api/share/t/files/a.glb",
                "pose": {"p": [0, 1, 0.5], "q": [0, 0, 0, 1]},
            },
            "u1",
        )
        self.assertEqual(drop["user_id"], "u1")
        self.assertEqual(drop["pose"]["p"][1], 1.0)
        scene = sanitize_public_drop(
            {
                "object_id": "scene-p-cad.glb",
                "kind": "scene",
                "fit": "world",
                "share_mode": "remix",
                "glb_url": "/api/share/t/files/cad.glb",
                "pose": {"p": [0, 1.1, -0.4]},
            },
            "u1",
        )
        self.assertEqual(scene["kind"], "scene")
        self.assertEqual(scene["fit"], "world")
        self.assertEqual(scene["share_mode"], "remix")
        self.assertIsNone(sanitize_public_object({"object_id": ""}))
        store = {}
        for i in range(10):
            upsert_public_drop(store, {"object_id": f"d{i}", "glb_url": "x"})
        self.assertEqual(len(store), 10)
        self.assertIn("d0", store)
        self.assertIn("d9", store)
        box = sanitize_printer_box(
            {"size": [0.3, 0.26, 0.3], "position": [0.1, 0.13, -0.7]},
            "sam",
        )
        self.assertEqual(box["type"], "xr.printer")
        self.assertEqual(box["object_id"], "printer-box")
        self.assertIsNone(sanitize_printer_box({"size": [0.01, 0.01, 0.01], "position": [0, 0, 0]}))

    def test_grant_notify_skips_blank_ids(self):
        self.assertEqual(grant_notify_user_ids("", self.friend), [self.friend])
        self.assertEqual(grant_notify_user_ids(self.owner, None), [self.owner])
        self.assertEqual(grant_notify_user_ids(None, None), [])

    def test_two_peers_relay_pose_stroke_and_targeted_rtc(self):
        peers = [self.owner, self.friend]
        self.assertEqual(relay_recipient_ids(peers, self.owner), [self.friend])
        self.assertEqual(relay_recipient_ids(peers, self.owner, self.friend), [self.friend])
        self.assertEqual(relay_recipient_ids(peers, self.owner, "ghost"), [])
        for kind in ("xr.stroke", "rtc.signal"):
            self.assertIn(kind, XR_RELAY_TYPES)
        poses = presence_sync_pose_messages([
            {"id": self.friend, "xrPose": {"head": {"p": [0, 1.6, 0]}}},
            {"id": self.owner},
        ])
        self.assertEqual(len(poses), 1)
        self.assertEqual(poses[0]["user_id"], self.friend)

    def test_grant_ws_refreshes_connect_and_studio_for_both_users(self):
        ids = grant_notify_user_ids(self.owner, self.friend)
        self.assertEqual(ids, [self.friend, self.owner])
        payload = grant_ws_payload("chatgpt_granted")
        self.assertEqual(payload["type"], "ai.keys.changed")
        self.assertTrue(should_refresh_permission_surfaces(payload))
        self.assertIn("connect-vr-permissions", GRANT_REFRESH_SURFACES)
        self.assertIn("studio-keys", GRANT_REFRESH_SURFACES)
        from backend.services.stream_link_service import STREAM_PROVIDERS, status as stream_status

        self.assertEqual([p["id"] for p in STREAM_PROVIDERS], ["x_live", "twitch", "kick"])
        payload_ids = [p["id"] for p in stream_status({"id": self.owner})["providers"]]
        self.assertEqual(payload_ids, ["x_live", "twitch", "kick"])
        for uid in ids:
            self.assertTrue(should_refresh_permission_surfaces({**payload, "user_id": uid}))

    def test_studio_usage_sums_tokens_across_users(self):
        self.assertEqual(token_count_from_entry({"usage": {"total_tokens": 40}}), 40)
        self.assertEqual(token_count_from_entry({"meta": {"input_tokens": 3, "output_tokens": 7}}), 10)
        merged = merge_log_usage(
            {"tokens": 0, "queries": 0, "by_user": []},
            [
                {"kind": "prompt", "user_name": "Ada", "usage": {"total_tokens": 90}},
                {"kind": "build", "user_name": "Sam", "usage": {"tokens": 10}},
                {"kind": "share", "user_name": "Ada"},
            ],
        )
        self.assertEqual(merged["queries"], 2)
        self.assertEqual(merged["tokens"], 100)
        self.assertEqual(merged["by_user"][0]["name"], "Ada")
        self.assertEqual(merged["by_user"][0]["tokens"], 90)

    def test_studio_usage_from_prompt_history_matches_laptop_totals(self):
        entries = [
            {"status": "done", "user_name": "Ada", "usage": {"total_tokens": 120, "input_tokens": 80, "output_tokens": 40}},
            {"status": "done", "user_name": "Sam", "usage": {"total_tokens": 30, "input_tokens": 20, "output_tokens": 10}},
            {"status": "running", "user_name": "Ada", "usage": {"total_tokens": 999}},
        ]
        with patch("backend.services.prompt_history_service.list_entries", return_value=entries):
            usage = usage_from_prompt_history(Path("/tmp/unused"))
        self.assertEqual(usage["queries"], 2)
        self.assertEqual(usage["tokens"], 150)
        names = {row["name"]: row for row in usage["by_user"]}
        self.assertEqual(names["Ada"]["queries"], 1)
        self.assertEqual(names["Ada"]["tokens"], 120)
        self.assertEqual(names["Sam"]["tokens"], 30)

    def test_xr_window_layouts_persist_per_user(self):
        from unittest.mock import patch
        from backend.services import xr_window_layouts

        tmp = tempfile.TemporaryDirectory()
        try:
            with patch.object(xr_window_layouts.settings, "data_dir", tmp.name):
                saved = xr_window_layouts.save_layouts(
                    "u1",
                    {
                        "lastId": "lay-a",
                        "layouts": [{
                            "id": "lay-a",
                            "name": "Desk",
                            "menuTab": "projects",
                            "open": {"menuOpen": True, "aiOpen": False},
                            "poses": {"menu": {"visible": True, "forward": 0.7, "right": 0.1, "up": -0.08}},
                        }],
                    },
                )
                self.assertEqual(saved["lastId"], "lay-a")
                loaded = xr_window_layouts.load_layouts("u1")
                self.assertEqual(loaded["layouts"][0]["name"], "Desk")
                self.assertTrue(loaded["layouts"][0]["open"]["menuOpen"])
                other = xr_window_layouts.load_layouts("u2")
                self.assertEqual(other["layouts"], [])
        finally:
            tmp.cleanup()

    def test_xr_debugger_log_filename_in_folder(self):
        from datetime import datetime, timezone
        from unittest.mock import patch

        from backend.services import xr_debugger_service as svc

        name = svc.xr_perf_log_filename(datetime(2026, 9, 8, 12, 34, tzinfo=timezone.utc))
        self.assertEqual(name, "20260908-1234-xr-perf.jsonl")
        tmp = tempfile.TemporaryDirectory()
        try:
            root = Path(tmp.name)
            ai = root / "ai-context" / "debugger"
            user_dir = root / "data" / "debugger" / "u_owner"

            def fake_ai():
                ai.mkdir(parents=True, exist_ok=True)
                return ai

            def fake_user(_uid):
                user_dir.mkdir(parents=True, exist_ok=True)
                return user_dir

            with patch.object(svc, "ai_debugger_dir", fake_ai), patch.object(svc, "user_debugger_dir", fake_user):
                written = svc.write_xr_perf_log(
                    {"id": "u_owner"},
                    {
                        "filename": name,
                        "samples": [{"t": 1, "fps": 72, "dt": 13.8, "token": "secret"}],
                        "actions": [{"t": 2, "tool": "draw", "email": "hide@x.com"}],
                    },
                )
                self.assertEqual(written["name"], name)
                self.assertTrue((ai / name).is_file())
                self.assertTrue((ai / "last-xr-perf.jsonl").is_file())
                self.assertTrue((user_dir / name).is_file())
                anon = svc.write_xr_perf_log(
                    None,
                    {
                        "filename": "20260908-0001-xr-perf.jsonl",
                        "samples": [{"t": 1, "fps": 72, "dt": 13.8}],
                        "avgMs": 13.8,
                        "p95Ms": 13.8,
                        "n": 1,
                        "auto": True,
                    },
                )
                self.assertFalse(anon["ok"])
                self.assertEqual(anon.get("skipped"), "auto")
                self.assertFalse(svc.should_accept_xr_debugger_upload({"auto": True}))
                self.assertTrue(svc.should_accept_xr_debugger_upload({"auto": False, "manual": True}))
                manual = svc.write_xr_perf_log(
                    {"id": "u_owner"},
                    {
                        "filename": "20260915-0800-xr-ctl.jsonl",
                        "samples": [{"t": 1, "fps": 72, "dt": 13.8, "memMb": 61.2}],
                        "spikes": [{"t": 40, "dt": 28.1, "fps": 35.6, "memMb": 70.0, "heap": 1}],
                        "avgMs": 13.8,
                        "p95Ms": 28.1,
                        "n": 1,
                        "framebufferScale": 0.85,
                        "foveation": 0.35,
                        "hudScale": 1.75,
                        "presenting": 1,
                        "laser": 1,
                        "hitchCount": 1,
                        "maxDt": 28.1,
                        "durationMs": 12000,
                        "description": "XR debugger session · 1 frames · 1 hitches",
                        "manual": True,
                        "controls": {
                            "section": "xr-controls",
                            "rows": [{
                                "t": 12, "f": 72, "dt": 13.8, "hit": "miss", "h": "r",
                                "r": {"tr": 1, "sq": 0, "a": 0, "b": 0, "g": 1, "ax": [0, 0, 0], "m": "tracked-pointer"},
                            }],
                        },
                    },
                )
                self.assertTrue(manual["ok"])
                last = json.loads((ai / "last-xr-ctl.jsonl").read_text(encoding="utf-8").splitlines()[0])
                self.assertEqual(last.get("avgMs"), 13.8)
                self.assertEqual(last.get("p95Ms"), 28.1)
                self.assertEqual(last.get("framebufferScale"), 0.85)
                self.assertEqual(last.get("foveation"), 0.35)
                self.assertEqual(last.get("hudScale"), 1.75)
                self.assertEqual(last.get("presenting"), 1)
                self.assertEqual(last.get("hitchCount"), 1)
                self.assertEqual(len(last.get("spikes") or []), 1)
                self.assertTrue(last.get("timestamp"))
                self.assertIn("XR debugger session", last.get("description") or "")
                self.assertFalse(last.get("auto"))
                listed = svc.list_xr_perf_logs({"id": "u_owner"})
                self.assertTrue(listed)
                self.assertTrue(listed[0].get("timestamp"))
                self.assertTrue(listed[0].get("description"))
                text = (ai / name).read_text(encoding="utf-8")
                compact = text.replace(" ", "")
                self.assertIn('"fps":72', compact)
                self.assertNotIn("secret", text)
                self.assertNotIn("hide@x.com", text)
                ctl = svc.sanitize_xr_perf_payload(
                    {
                        "filename": "20260915-0001-xr-ctl.jsonl",
                        "samples": [{"t": 1, "fps": 72, "dt": 13.8, "token": "secret"}],
                        "controls": {
                            "section": "xr-controls",
                            "rows": [
                                {
                                    "t": 12,
                                    "f": 72,
                                    "dt": 13.8,
                                    "drop": 1,
                                    "th": 1,
                                    "c": "ui",
                                    "r": {"tr": 1, "sq": 0, "a": 0, "b": 0, "g": 1, "ax": [0, 0, 0.2], "m": "tracked-pointer", "move": 1, "on": ["rightTrigger", "rightAxes"]},
                                }
                            ],
                            "ov": {"d": 0, "s": 0, "st": 1, "l": 1},
                            "sess": {"on": 1, "mode": "immersive-vr", "ref": "local-floor", "n": 2},
                        },
                    }
                )
                self.assertEqual(ctl["controls"]["section"], "xr-controls")
                self.assertEqual(ctl["controls"]["rows"][0]["c"], "ui")
                self.assertEqual(ctl["controls"]["ov"]["d"], 0)
                self.assertEqual(ctl["controls"]["rows"][0]["r"].get("on"), ["rightTrigger", "rightAxes"])
                self.assertEqual(ctl["controls"]["rows"][0]["r"].get("move"), 1)
                self.assertNotIn("secret", json.dumps(ctl))
                fat_rows = [{"t": i, "f": 72, "dt": 13, "pad": "x" * 80, "c": "pick"} for i in range(400)]
                written_ctl = svc.write_xr_perf_log(
                    {"id": "u_owner"},
                    {
                        "filename": "20260915-0002-xr-ctl.jsonl",
                        "samples": [{"t": 1, "fps": 72, "dt": 13}],
                        "controls": {"section": "xr-controls", "rows": fat_rows},
                    },
                )
                self.assertTrue(written_ctl["ok"])
                ctl_text = (ai / written_ctl["name"]).read_text(encoding="utf-8")
                self.assertLessEqual(len(ctl_text.encode("utf-8")), svc.MAX_BODY_BYTES)
                self.assertTrue((ai / "last-xr-ctl.jsonl").is_file())
                listed_names = [row["name"] for row in svc.list_xr_perf_logs({"id": "u_owner"})]
                self.assertTrue(any(n.endswith("-xr-ctl.jsonl") for n in listed_names))
                for i in range(25):
                    svc.write_xr_perf_log(
                        {"id": "u_owner"},
                        {"filename": f"20260908-{i:04d}-xr-perf.jsonl", "samples": [{"t": i, "fps": 72, "dt": 13}]},
                    )
                dumped = [p for p in ai.glob("*-xr-perf.jsonl") if p.name != "last-xr-perf.jsonl"]
                self.assertLessEqual(len(dumped), svc.KEEP_MAX)
                self.assertEqual(svc.KEEP_MAX, 10)
                listed_capped = svc.list_xr_perf_logs({"id": "u_owner"})
                self.assertLessEqual(len(listed_capped), 10)
                self.assertTrue((ai / "last-xr-perf.jsonl").is_file())
                user_dumped = list(user_dir.glob("*-xr-perf.jsonl"))
                self.assertLessEqual(len(user_dumped), svc.KEEP_MAX)
                older = svc.write_xr_perf_log(
                    {"id": "u_owner"},
                    {
                        "filename": "20260910-0001-xr-perf.jsonl",
                        "timestamp": "2026-09-19T12:00:00+00:00",
                        "description": "older session",
                        "samples": [{"t": 1, "fps": 72, "dt": 13}],
                    },
                )
                newer = svc.write_xr_perf_log(
                    {"id": "u_owner"},
                    {
                        "filename": "20260909-9999-xr-perf.jsonl",
                        "timestamp": "2026-09-20T12:00:00+00:00",
                        "description": "newer session",
                        "samples": [{"t": 1, "fps": 72, "dt": 13}],
                    },
                )
                self.assertTrue(older["ok"] and newer["ok"])
                ordered = svc.sort_xr_perf_log_rows([
                    {"name": older["name"], "timestamp": "2026-09-19T12:00:00+00:00"},
                    {"name": newer["name"], "timestamp": "2026-09-20T12:00:00+00:00"},
                ])
                self.assertEqual(ordered[0]["name"], newer["name"])
                listed_order = svc.list_xr_perf_logs({"id": "u_owner"})
                stamps = [row.get("timestamp") or "" for row in listed_order]
                self.assertEqual(stamps, sorted(stamps, reverse=True))
                self.assertEqual(listed_order[0]["name"], newer["name"])
                desk = svc.write_xr_perf_log(
                    {"id": "u_owner"},
                    {
                        "filename": "20260916-1805-desk-dbg.jsonl",
                        "kind": "desktop-perf",
                        "description": "Desktop debugger session",
                        "samples": [{"t": 20, "fps": 16, "dt": 64, "cpu": 80, "memMb": 90}],
                        "clicks": [{"t": 4, "path": "button#btn-prompt", "x": 8, "y": 12, "token": "secret"}],
                        "spikes": [{
                            "t": 20,
                            "dt": 64,
                            "fps": 16,
                            "where": "video-editor-bake",
                            "stack": "tick | rAF",
                            "lastClick": "button#btn-prompt",
                        }],
                    },
                )
                self.assertTrue(desk["ok"])
                self.assertTrue((ai / "last-desk-dbg.jsonl").is_file())
                last_xr = (ai / "last-xr-perf.jsonl").read_text(encoding="utf-8")
                self.assertNotIn("desktop-perf", last_xr)
                self.assertIn("desktop-perf", (ai / "last-desk-dbg.jsonl").read_text(encoding="utf-8"))
                desk_body = json.loads((ai / "20260916-1805-desk-dbg.jsonl").read_text(encoding="utf-8").splitlines()[0])
                self.assertEqual(desk_body.get("kind"), "desktop-perf")
                self.assertEqual(desk_body.get("tag"), "spike")
                self.assertEqual(desk_body["spikes"][0]["where"], "video-editor-bake")
                self.assertIn("video-editor-bake", desk_body.get("spikeTrace") or "")
                self.assertNotIn("secret", json.dumps(desk_body))
                listed_desk = svc.list_xr_perf_logs({"id": "u_owner"})
                self.assertTrue(any(row["name"].endswith("desk-dbg.jsonl") and row.get("tag") == "spike" for row in listed_desk))
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
