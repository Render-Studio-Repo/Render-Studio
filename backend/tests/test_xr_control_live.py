from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import xr_control_live as xcl


class XrControlLiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        data = root / "data"
        sandbox = root / "sandbox"
        data.mkdir()
        sandbox.mkdir()
        self.patches = [
            patch.object(xcl, "DATA_DIR", data),
            patch.object(xcl, "CONTROLS_PATH", data / "controls.json"),
            patch.object(xcl, "WIRE_PATH", data / "wire-queue.json"),
            patch.object(xcl, "NOTES_PATH", data / "notes.jsonl"),
            patch.object(xcl, "SANDBOX_CONTROLS", sandbox / "controls.json"),
            patch.object(xcl, "SANDBOX_NOTES", sandbox / "control-notes.jsonl"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_live_edit_bumps_rev_without_applying_scene(self) -> None:
        first = xcl.load_config()
        self.assertEqual(first["token"], "xrctrl2")
        self.assertFalse(first["apply_scene"])
        patched = xcl.patch_config({
            "simulate": True,
            "listen": True,
            "map": {"trigger": {"btn": 2, "kind": "button"}},
        })
        self.assertGreater(patched["rev"], first["rev"])
        self.assertTrue(patched["simulate"])
        self.assertEqual(patched["profiles"]["quest3"]["trigger"]["btn"], 2)
        self.assertFalse(patched["apply_scene"])
        self.assertEqual(patched["wire_status"], "idle")

    def test_notes_store_success_and_fail(self) -> None:
        xcl.add_note({"feature": "trigger", "ok": False, "attempt": "selectstart", "note": "missed"})
        xcl.add_note({"feature": "trigger", "ok": True, "attempt": "poll buttons[0]", "note": "present"})
        notes = xcl.list_notes()
        self.assertTrue(any(n["ok"] and n["feature"] == "trigger" for n in notes))
        self.assertTrue(any((not n["ok"]) and "selectstart" in n["attempt"] for n in notes))
        packet = xcl.debugger_packet("headset")
        self.assertEqual(packet["auto_apply"], False)
        self.assertTrue(any("poll" in s["text"].lower() or s["keep"] for s in packet["suggestions"]))

    def test_wire_to_scene_stays_queued_until_approve(self) -> None:
        queued = xcl.ask_wire(agent="astra", note="wire this to my scene")
        self.assertFalse(queued["applied"])
        self.assertEqual(queued["status"], "pending_approval")
        self.assertEqual(queued["privilege"], "xr.controls.wire_scene")
        cfg = xcl.load_config()
        self.assertFalse(cfg["apply_scene"])
        self.assertEqual(cfg["wire_status"], "pending_approval")
        approved = xcl.approve_wire(queued["item"]["id"])
        self.assertEqual(approved["status"], "approved")
        self.assertTrue(approved["apply_scene"])
        self.assertFalse(approved["applied"])
        live = xcl.load_config()
        self.assertTrue(live["apply_scene"])
        self.assertEqual(live["wire_status"], "approved")

    def test_handle_unknown_raises(self) -> None:
        with self.assertRaises(ValueError):
            xcl.handle("nope")


if __name__ == "__main__":
    unittest.main()
