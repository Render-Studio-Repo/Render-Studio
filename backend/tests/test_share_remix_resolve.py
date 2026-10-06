"""Remix must find shared CAD even when the stored name is gone or nested."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.main import _copy_share_files_to_project, _resolve_shared_filename, _remix_studio_url


class ShareRemixResolveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.src = self.root / "src"
        self.dst = self.root / "dst"
        self.src.mkdir()
        self.dst.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_resolves_nested_vibecad_file_when_root_basename_missing(self):
        nested = self.src / "vibecad"
        nested.mkdir()
        (nested / "fire_pit.glb").write_bytes(b"glb")
        share = {"filename": "fire_pit.glb"}
        rel = _resolve_shared_filename(self.src, share)
        self.assertEqual(rel, "vibecad/fire_pit.glb")
        copied = _copy_share_files_to_project(self.src, self.dst, rel, share)
        self.assertIn("fire_pit.glb", copied)
        self.assertTrue((self.dst / "fire_pit.glb").is_file())

    def test_falls_back_to_viewer_filename(self):
        (self.src / "current.glb").write_bytes(b"glb")
        share = {
            "filename": "deleted_old_name.glb",
            "viewer_filename": "current.glb",
        }
        rel = _resolve_shared_filename(self.src, share)
        self.assertEqual(rel, "current.glb")

    def test_remix_studio_url_opens_viewport(self):
        self.assertEqual(_remix_studio_url("abc123"), "/?project=abc123#viewport")
        self.assertEqual(_remix_studio_url(""), "/#viewport")


if __name__ == "__main__":
    unittest.main()
