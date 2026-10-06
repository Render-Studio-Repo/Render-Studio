"""XR controller evidence must survive upload without retaining scene objects."""

import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import xr_debugger_service as service


class XrControlsDiagnosticsTests(unittest.TestCase):
    def test_upload_retains_build_pose_and_independent_button_edges(self):
        interaction = {
            "l": {"grip": [0.12, 1.3, -0.5, 0, 0, 0, 1], "near": "xrStudio", "distance": 0.014321, "held": "xrStudio"},
            "r": {"aim": [0.3, 1.3, -0.6, 0, 0, 0, 1], "hit": "miss"},
        }
        row = {"t": 200, "n": 2, "l": {"sq": 1}, "r": {"sq": 1}, "interaction": interaction}
        payload = {
            "manual": True,
            "filename": "20260915-1100-xr-ctl.jsonl",
            "controls": {
                "build": "20260915-xrgrab1",
                "rows": [row],
                "ev": [{**row, "ev": "input"}],
            },
        }
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            ai = root / "ai"
            user = root / "user"
            ai.mkdir()
            user.mkdir()
            with patch.object(service, "ai_debugger_dir", return_value=ai), patch.object(service, "user_debugger_dir", return_value=user):
                result = service.write_xr_perf_log({"id": "test"}, payload)
            saved = json.loads((ai / result["name"]).read_text())
        controls = saved["controls"]
        self.assertEqual(controls["build"], "20260915-xrgrab1")
        self.assertEqual(controls["rows"][0]["interaction"]["l"]["held"], "xrStudio")
        self.assertEqual(controls["ev"][0]["l"]["sq"], 1)
        self.assertEqual(controls["ev"][0]["r"]["sq"], 1)
        self.assertEqual(controls["ev"][0]["interaction"]["l"]["distance"], 0.014)
        self.assertEqual(controls["ev"][0]["interaction"]["r"]["aim"], interaction["r"]["aim"])

    def test_invalid_diagnostics_and_arbitrary_scene_fields_are_dropped(self):
        result = service.sanitize_xr_controls({
            "build": "<" + "b" * 90 + ">",
            "rows": [{"interaction": {
                "l": {"grip": [0, math.nan, 0, 0, 0, 0, 1], "aim": [1], "distance": math.inf, "near": "p" * 90, "held": {"secret": "hidden"}, "scene": {"token": "hidden"}},
                "r": {"hit": "miss", "aim": [1.12345, 2, 3, 0, 0, 0, 1]},
                "secret": "hidden",
            }}],
        })
        side = result["rows"][0]["interaction"]["l"]
        self.assertEqual(side, {"near": "p" * 64})
        self.assertEqual(result["rows"][0]["interaction"]["r"]["aim"][0], 1.123)
        self.assertEqual(result["build"], "b" * 48)
        self.assertNotIn("hidden", json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    unittest.main()
