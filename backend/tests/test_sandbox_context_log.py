from pathlib import Path
import tempfile
import unittest
from unittest import mock


class SandboxContextLogTests(unittest.TestCase):
    def test_normalize_strips_banned_context(self):
        from backend.services import sandbox_context_log as scl

        row = scl.normalize_event({
            "session_id": "abc",
            "source": "sandbox-page",
            "feature_id": "sandbox.ui.click",
            "event_kind": "click",
            "target_id": "btn-repair",
            "context": {"pose": [1, 2, 3], "href": "/sandbox/", "prompt_text": "secret"},
            "tool_summary": "Repair:2",
        })
        self.assertNotIn("pose", row["context"])
        self.assertNotIn("prompt_text", row["context"])
        self.assertEqual(row["context"].get("href"), "/sandbox/")
        self.assertEqual(row["token"], "ctxlog1")

    def test_record_writes_jsonl(self):
        from backend.services import sandbox_context_log as scl

        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / "local.jsonl"
            data = Path(tmp) / "data.jsonl"
            with mock.patch.object(scl, "LOCAL_LOG", local), mock.patch.object(scl, "DATA_LOG", data), \
                 mock.patch.object(scl, "_try_supabase", return_value={"ok": False, "reason": "disabled"}), \
                 mock.patch("backend.services.xr_control_live.add_note", return_value={"ok": True}):
                out = scl.record_context_event({"target_id": "Astra", "event_kind": "agent_click"})
            self.assertTrue(out["ok"])
            self.assertTrue(local.is_file())
            self.assertIn("Astra", local.read_text())


if __name__ == "__main__":
    unittest.main()
