"""Safe DIMOS coordinator ensure: no second spawn, never kill."""

from __future__ import annotations

import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services.dimos_teleop_spawn import (
    ensure_dimos_coordinator,
    existing_teleop_pids,
    infer_hardware_mode,
    live_robot_payload,
    spawn_dimos_coordinator,
)


class DimosTeleopSpawnTests(unittest.TestCase):
    def test_parses_existing_teleop_pids_without_signaling(self) -> None:
        ps = (
            "  111 /Users/sam/.local/bin/dimos run teleop-quest-openarm\n"
            "  222 /usr/bin/python -m dimos run teleop-quest-xarm7\n"
            "  333 /bin/zsh\n"
            "  444 node teleop-server\n"
        )
        self.assertEqual(existing_teleop_pids(ps), [111, 222])

    def test_already_up_does_not_spawn(self) -> None:
        spawned: list[str] = []

        def spawn(bp: str) -> dict:
            spawned.append(bp)
            return {"ok": True, "status": "starting", "started": True, "blueprint": bp}

        out = ensure_dimos_coordinator(
            "quest",
            pipe_up=lambda: True,
            teleop_pids=lambda: [],
            spawn=spawn,
        )
        self.assertEqual(out["status"], "already_up")
        self.assertFalse(out["started"])
        self.assertEqual(spawned, [])
        self.assertEqual(out["command"], "dimos run teleop-quest-openarm")
        self.assertEqual(out["robot"], "Open Arm")
        self.assertEqual(out["hardware_id"], "openarm")
        self.assertTrue(out["recognized"])

    def test_existing_process_does_not_spawn_or_kill(self) -> None:
        spawned: list[str] = []

        def spawn(bp: str) -> dict:
            spawned.append(bp)
            raise AssertionError("must not spawn beside a live teleop process")

        out = ensure_dimos_coordinator(
            "vision",
            pipe_up=lambda: False,
            teleop_pids=lambda: [4242],
            spawn=spawn,
        )
        self.assertEqual(out["status"], "already_running")
        self.assertFalse(out["started"])
        self.assertEqual(out["headset"], "vision")
        self.assertEqual(out["pids"], [4242])
        self.assertEqual(spawned, [])
        self.assertIn("no teleop-vision", out["fallback_note"])

    def test_down_spawns_allowlisted_blueprint_only(self) -> None:
        spawned: list[str] = []

        def spawn(bp: str) -> dict:
            spawned.append(bp)
            return {"ok": True, "status": "starting", "started": True, "pid": 9, "blueprint": bp}

        out = ensure_dimos_coordinator(
            "vive",
            blueprint="teleop-vive-openarm",
            pipe_up=lambda: False,
            teleop_pids=lambda: [],
            spawn=spawn,
        )
        self.assertEqual(out["status"], "starting")
        self.assertTrue(out["started"])
        self.assertEqual(spawned, ["teleop-quest-openarm"])
        self.assertEqual(out["command"], "dimos run teleop-quest-openarm")

    def test_openarm_spawn_uses_local_router_for_zenoh(self) -> None:
        seen: list[list[str]] = []

        class FakeProc:
            pid = 77

        def fake_popen(argv, **kwargs):
            seen.append(list(argv))
            self.assertTrue(kwargs.get("start_new_session"))
            self.assertNotIn("kill", str(kwargs).lower())
            return FakeProc()

        import backend.services.dimos_teleop_spawn as spawn_mod

        with (patch.object(spawn_mod, "resolve_dimos_bin", return_value=Path("/opt/dimos")),
              patch.object(spawn_mod, "resolve_dimos_cwd", return_value=Path("/tmp")),
              patch.object(spawn_mod, "_dimos_python", return_value=Path("/opt/python")),
              patch.dict("os.environ", {"DIMOS_TRANSPORT": "zenoh", "ZENOH_CONNECT": ""})):
            out = spawn_dimos_coordinator("teleop-quest-openarm", popen=fake_popen)
        self.assertEqual(out["status"], "starting")
        self.assertTrue(out["local_router"])
        self.assertEqual(seen[0][-2:], ["/opt/dimos", "teleop-quest-openarm"])
        self.assertTrue(str(seen[0][1]).endswith("openarm_router_launcher.py"))

    def test_configured_zenoh_endpoint_keeps_dimos_command(self) -> None:
        import backend.services.dimos_teleop_spawn as spawn_mod

        class FakeProc:
            pid = 78

        seen: list[list[str]] = []
        with (patch.object(spawn_mod, "resolve_dimos_bin", return_value=Path("/opt/dimos")),
              patch.dict("os.environ", {"DIMOS_TRANSPORT": "zenoh", "ZENOH_CONNECT": "tcp/127.0.0.1:7447"})):
            out = spawn_dimos_coordinator("teleop-quest-openarm", popen=lambda argv, **_kw: (seen.append(list(argv)) or FakeProc()))
        self.assertFalse(out["local_router"])
        self.assertEqual(seen[0], ["/opt/dimos", "run", "teleop-quest-openarm"])

    def test_mock_openarm_is_recognized_without_can(self) -> None:
        self.assertEqual(infer_hardware_mode("dimos run teleop-quest-openarm"), "mock")
        self.assertEqual(
            infer_hardware_mode(
                "dimos run teleop-quest-openarm --left-can-port can1 --right-can-port can0"
            ),
            "can",
        )
        robot = live_robot_payload(
            up=True,
            process=True,
            blueprint="teleop-quest-openarm",
            hardware_mode="mock",
        )
        self.assertEqual(robot["robot"], "Open Arm")
        self.assertEqual(robot["robot_id"], "openarm")
        self.assertEqual(robot["hardware_id"], "openarm")
        self.assertEqual(robot["hardware_mode"], "mock")
        self.assertTrue(robot["recognized"])
        self.assertTrue(robot["selected"])
        down = live_robot_payload(
            up=False,
            process=False,
            blueprint="teleop-quest-openarm",
            hardware_mode="mock",
        )
        self.assertFalse(down["recognized"])

    def test_peek_coordinator_status_is_loop_safe(self) -> None:
        from backend.services import dimos_teleop_spawn as mod

        payload = {"up": True, "port": 8443}
        mod._status_cache["payload"] = payload
        mod._status_cache["at"] = time.monotonic()
        self.assertIs(mod.peek_coordinator_status(), payload)
        mod._status_cache["at"] = time.monotonic() - 100
        self.assertIsNone(mod.peek_coordinator_status())
        self.assertIs(mod.peek_coordinator_status(allow_stale=True), payload)

    def test_seed_idle_coordinator_cache_fills_empty_peek(self) -> None:
        from backend.services import dimos_teleop_spawn as mod

        mod._status_cache["payload"] = None
        mod._status_cache["at"] = 0.0
        seeded = mod.seed_idle_coordinator_cache()
        self.assertFalse(seeded["up"])
        self.assertIs(mod.peek_coordinator_status(), seeded)
