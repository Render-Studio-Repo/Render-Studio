import tempfile
import unittest
from unittest.mock import patch

from backend.services.xr_hot_path import XR_RELAY_TYPES
from backend.services import xr_window_visibility


class XrWindowVisibilityTests(unittest.TestCase):
    def test_persist_hidden_and_anchored_pose(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        with patch.object(xr_window_visibility.settings, "data_dir", tmp.name):
            saved = xr_window_visibility.save_visibility("user-vis1", "proj-a", {
                "windows": {
                    "clip": {
                        "id": "clip",
                        "hidden": True,
                        "curved": True,
                        "anchored": True,
                        "pose": {"wx": 0.2, "wy": 1.4, "wz": -0.7, "scale": 1.2},
                    }
                }
            })
            self.assertTrue(saved["windows"]["clip"]["hidden"])
            self.assertTrue(saved["windows"]["clip"]["anchored"])
            loaded = xr_window_visibility.load_visibility("user-vis1", "proj-a")
            self.assertEqual(loaded["windows"]["clip"]["pose"]["wx"], 0.2)
            other = xr_window_visibility.load_visibility("user-vis1", "proj-b")
            self.assertEqual(other["windows"], {})

    def test_relay_includes_window_visibility(self):
        self.assertIn("xr.window", XR_RELAY_TYPES)


if __name__ == "__main__":
    unittest.main()
