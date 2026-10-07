"""Weekly bus report store."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import init_db
from backend.services import weekly_bus_report_service as weekly


class WeeklyBusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.patcher = patch("backend.database.DB_PATH", self.db)
        self.md = Path(self.tmp.name) / "weekly"
        self.md.mkdir()
        self.md_patch = patch("backend.services.weekly_bus_report_service.REPORT_MD", self.md)
        self.patcher.start()
        self.md_patch.start()
        init_db()

    def tearDown(self) -> None:
        self.md_patch.stop()
        self.patcher.stop()
        self.tmp.cleanup()

    def test_publish_has_cursor_and_zero_instance_factor(self) -> None:
        row = weekly.publish()
        self.assertEqual(row["schema"], "rs.weekly.v1")
        self.assertGreater(row["cursor"]["asked"], 10)
        self.assertEqual(row["cursor"]["built"] + row["cursor"]["missed"] + row["cursor"]["skipped_on_purpose"], row["cursor"]["asked"])
        self.assertEqual(row["headcount"]["now_count"], 7)
        self.assertEqual(row["headcount"]["delta"], 3)
        listed = weekly.list_reports(1)
        self.assertEqual(listed[0]["id"], row["id"])
        self.assertTrue(row["logs"]["scalable"])
