"""Personal project pins: max 5, no silent drop, persist per user."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database import init_db
from backend.services import project_pins


class ProjectPinsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.db_patch.start()
        init_db()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def test_put_and_get_roundtrip(self) -> None:
        saved = project_pins.put_pins("sam", ["a", "b", "a", "  "])
        self.assertEqual(saved, ["a", "b"])
        self.assertEqual(project_pins.get_pins("sam"), ["a", "b"])
        self.assertEqual(project_pins.get_pins("other"), [])

    def test_sixth_pin_is_rejected(self) -> None:
        project_pins.put_pins("sam", ["1", "2", "3", "4", "5"])
        with self.assertRaises(ValueError) as ctx:
            project_pins.put_pins("sam", ["1", "2", "3", "4", "5", "6"])
        self.assertIn("Unpin one", str(ctx.exception))
        self.assertEqual(project_pins.get_pins("sam"), ["1", "2", "3", "4", "5"])

    def test_unpin_then_pin_again(self) -> None:
        project_pins.put_pins("sam", ["1", "2", "3", "4", "5"])
        project_pins.put_pins("sam", ["1", "2", "3", "4"])
        self.assertEqual(project_pins.put_pins("sam", ["1", "2", "3", "4", "6"]), ["1", "2", "3", "4", "6"])

    def test_api_routes_exist(self) -> None:
        src = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(encoding="utf-8")
        self.assertIn('@app.get("/api/users/me/project-pins")', src)
        self.assertIn('@app.put("/api/users/me/project-pins")', src)
        self.assertIn("class ProjectPinsRequest", src)
        self.assertNotIn("set_project_public_pin", src[src.index("def get_my_project_pins"):src.index("def update_my_project_pins") + 400])


if __name__ == "__main__":
    unittest.main()
