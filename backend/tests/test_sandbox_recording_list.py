import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class SandboxRecordingListTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[2] / "mcp/grok-bot/server.py"
        spec = importlib.util.spec_from_file_location("recording_list_server", path)
        cls.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.server)

    def test_scoped_recordings_are_not_hidden_by_global_cap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in range(205):
                (root / f"a{index:03}.json").write_text("{}")
            episodes = root / "openarm-mujoco/episodes"
            episodes.mkdir(parents=True)
            for index in range(201):
                (episodes / f"ep{index:03}.json").write_text("{}")
            with patch.object(self.server, "SANDBOX_DIR", root):
                first = self.server.grok_sandbox({"action": "list", "path": "openarm-mujoco/episodes"})
                self.assertEqual(first["count"], 201)
                self.assertEqual(len(first["files"]), 200)
                self.assertEqual(first["files"][0]["path"], "openarm-mujoco/episodes/ep000.json")
                self.assertEqual(first["next_cursor"], 200)
                second = self.server.grok_sandbox({"action": "list", "path": "openarm-mujoco/episodes", "cursor": first["next_cursor"]})
                self.assertEqual([item["path"] for item in second["files"]], ["openarm-mujoco/episodes/ep200.json"])
                self.assertIsNone(second["next_cursor"])

    def test_list_rejects_traversal_and_file_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "recording.json").write_text("{}")
            with patch.object(self.server, "SANDBOX_DIR", root):
                for path in ("../", "recording.json"):
                    with self.assertRaises(ValueError):
                        self.server.grok_sandbox({"action": "list", "path": path})


if __name__ == "__main__":
    unittest.main()
