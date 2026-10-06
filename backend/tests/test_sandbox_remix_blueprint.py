from pathlib import Path
import tempfile
import unittest
from unittest import mock


class SandboxRemixBlueprintTests(unittest.TestCase):
    def test_normalize_blueprint(self):
        from backend.services import sandbox_remix_blueprint as srb

        row = srb.normalize_blueprint({
            "kind": "blueprint",
            "blueprint": {
                "remix_id": "remix_abc",
                "session_id": "s1",
                "source_project_id": "proj1",
                "safe_to_merge": True,
                "restore_guide": {"tree": "remixes/x/tree.json"},
                "health": {"safe_to_merge": True, "probes": [{"id": "mcp.stats", "ok": True}]},
                "repeat_steps": ["Open sandbox"],
            },
        })
        self.assertEqual(row["token"], "remix1")
        self.assertTrue(row["safe_to_merge"])
        self.assertEqual(row["remix_id"], "remix_abc")
        self.assertIn("tree", row["restore_guide"])

    def test_record_writes_jsonl(self):
        from backend.services import sandbox_remix_blueprint as srb

        with tempfile.TemporaryDirectory() as tmp:
            local = Path(tmp) / "local.jsonl"
            data = Path(tmp) / "data.jsonl"
            with mock.patch.object(srb, "LOCAL_LOG", local), mock.patch.object(srb, "DATA_LOG", data), \
                 mock.patch.object(srb, "_try_supabase", return_value={"ok": False, "reason": "disabled"}):
                out = srb.record_blueprint({"kind": "health_check", "remix_id": "r1", "safe_to_merge": False})
            self.assertTrue(out["ok"])
            self.assertTrue(local.is_file())
            self.assertIn("r1", local.read_text())


if __name__ == "__main__":
    unittest.main()
