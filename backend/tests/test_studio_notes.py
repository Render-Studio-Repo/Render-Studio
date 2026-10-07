"""Workstation + per-user notes stay on gitignored / data paths only."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import studio_notes_service


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
    b"\x00\x00\x00\x03\x00\x01\x00\x05\xfe\xd4\xef\x00\x00\x00\x00IEND\xaeB`\x82"
)


class StudioNotesServiceTests(unittest.TestCase):
    def test_workstation_path_is_repo_sams_notes(self) -> None:
        path = studio_notes_service.workstation_path()
        self.assertEqual(path.name, "Sam's Notes")
        self.assertTrue(str(path).endswith("Sam's Notes"))

    def test_filter_roundtrip_user_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch("backend.services.studio_notes_service.settings.data_dir", tmp):
                saved = studio_notes_service.write_user_notes("user-1", "openarm\ncan0")
                self.assertIn("openarm", saved["text"])
                loaded = studio_notes_service.read_user_notes("user-1")
                self.assertEqual(loaded["text"], "openarm\ncan0")
                self.assertTrue((Path(tmp) / "user_notes" / "user-1.json").is_file())
                self.assertTrue((Path(tmp) / "studio_notes" / "users" / "user-1").is_dir())
                self.assertEqual(len(loaded["notes"]), 1)

    def test_rejects_path_escape_user_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch("backend.services.studio_notes_service.settings.data_dir", tmp):
                path = studio_notes_service.user_notes_path("../etc/passwd")
                self.assertTrue(str(path).startswith(str(Path(tmp).resolve())))
                self.assertEqual(path.name, "etcpasswd.json")

    def test_multi_note_create_open_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch("backend.services.studio_notes_service.settings.data_dir", tmp):
                first = studio_notes_service.create_note(
                    "user", user_id="u1", title="Hardware", html_body="<h2>CAN</h2><p>can0</p>"
                )
                second = studio_notes_service.create_note(
                    "user", user_id="u1", title="Commands", text="run teleop"
                )
                listing = studio_notes_service.list_notes("user", "u1")
                self.assertEqual(len(listing["notes"]), 2)
                opened = studio_notes_service.get_note("user", first["id"], "u1")
                self.assertIsNotNone(opened)
                self.assertIn("can0", opened["html"])
                self.assertTrue(studio_notes_service.delete_note("user", second["id"], "u1"))
                self.assertEqual(len(studio_notes_service.list_notes("user", "u1")["notes"]), 1)

    def test_migrates_sams_notes_once_without_duplicating(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sam = Path(tmp) / "Sam's Notes"
            sam.write_text("# Lab\nrun the bench\nApp Secret placeholder-not-real\n", encoding="utf-8")
            with patch("backend.services.studio_notes_service.settings.data_dir", tmp), patch(
                "backend.services.studio_notes_service.workstation_path",
                return_value=sam,
            ):
                listing = studio_notes_service.list_notes("workstation")
                self.assertEqual(len(listing["notes"]), 1)
                self.assertEqual(listing["notes"][0]["title"], "Sam's Notes")
                note = studio_notes_service.get_note("workstation", listing["notes"][0]["id"])
                self.assertIn("Lab", note["html"])
                self.assertTrue(note["may_contain_secrets"])
                again = studio_notes_service.list_notes("workstation")
                self.assertEqual(len(again["notes"]), 1)
                store = Path(tmp) / "studio_notes" / "workstation"
                self.assertTrue(store.is_dir())

    def test_image_save_and_path_safety(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with patch("backend.services.studio_notes_service.settings.data_dir", tmp):
                saved = studio_notes_service.save_image("user", PNG_1X1, "u1")
                self.assertTrue(saved["id"].startswith("i"))
                found = studio_notes_service.get_image("user", saved["id"], "u1")
                self.assertIsNotNone(found)
                path, media = found
                self.assertEqual(media, "image/png")
                self.assertTrue(path.is_file())
                self.assertIsNone(studio_notes_service.get_image("user", "../etc/passwd", "u1"))
                with self.assertRaises(ValueError):
                    studio_notes_service.save_image("user", b"not-an-image", "u1")

    def test_plaintext_headings_and_sanitize(self) -> None:
        html_body = studio_notes_service.plaintext_to_html("# Title\nhello")
        self.assertIn("<h1>Title</h1>", html_body)
        dirty = studio_notes_service.sanitize_html('<p>ok</p><script>alert(1)</script><img src="x" onerror="x">')
        self.assertNotIn("script", dirty.lower())
        self.assertNotIn("onerror", dirty.lower())
        self.assertFalse(studio_notes_service.looks_like_secret("run can0 on the bench"))
        self.assertTrue(studio_notes_service.looks_like_secret("App Secret\nnot-a-real-value"))

    def test_does_not_embed_workstation_file_in_module_source(self) -> None:
        source = Path(studio_notes_service.__file__).read_text(encoding="utf-8")
        sam = studio_notes_service.workstation_path()
        if not sam.is_file():
            return
        private = sam.read_text(encoding="utf-8", errors="replace")
        for line in private.splitlines():
            token = line.strip()
            if len(token) >= 20 and token.replace("|", "").isalnum():
                self.assertNotIn(token, source)


if __name__ == "__main__":
    unittest.main()
