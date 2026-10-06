"""scan-milestones: worklog @milestone + shipped.json without titles still publish."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCAN_PATH = ROOT / "scripts" / "scan-milestones.py"


def load_scan():
    spec = importlib.util.spec_from_file_location("scan_milestones", SCAN_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ScanMilestonesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mod = load_scan()

    def test_shipped_rows_without_title_still_load(self) -> None:
        rows = self.mod.load_shipped_registry()
        ids = {row["id"] for row in rows}
        self.assertIn("viewport-split-layouts", ids)
        self.assertIn("clip-video-editor", ids)
        clip = next(row for row in rows if row["id"] == "clip-video-editor")
        self.assertTrue(clip["title"])

    def test_worklog_accepts_milestone_in_body(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "worklog.md"
            path.write_text(
                "## 2026-09-16 — Brand-new laser cutter export\n\n"
                "@milestone id=laser-cutter-export\n"
                "- Export DXF nests for the shop laser.\n",
                encoding="utf-8",
            )
            with patch.object(self.mod, "WORKLOG", path):
                rows = self.mod.load_worklog("2026-09-01")
        ids = {row["id"] for row in rows}
        self.assertTrue(any("laser" in rid for rid in ids), ids)

    def test_upsert_shipped_adds_missing_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            shipped = Path(tmp) / "shipped.json"
            shipped.write_text(json.dumps({"items": [{"id": "keep-me", "title": "Keep"}]}), encoding="utf-8")
            with patch.object(self.mod, "SHIPPED", shipped):
                self.mod.upsert_shipped(
                    [{"id": "new-tool", "title": "New tool", "summary": "Ships", "date": "2026-09-16", "kind": "tool"}]
                )
            data = json.loads(shipped.read_text(encoding="utf-8"))
            ids = [row["id"] for row in data["items"]]
            self.assertEqual(ids[0], "new-tool")
            self.assertIn("keep-me", ids)

    def test_updates_js_fetches_shipped_json(self) -> None:
        src = (ROOT / "frontend" / "site" / "updates.js").read_text(encoding="utf-8")
        self.assertIn("mergeShippedRegistry", src)
        self.assertIn("shipped.json", src)
        self.assertIn("loadShippedRegistry", src)
        self.assertIn("builtinMilestones", src)
