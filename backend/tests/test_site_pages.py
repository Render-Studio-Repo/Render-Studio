"""Docs / Updates CMS persistence."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import site_pages_service


class SitePagesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.patcher = patch("backend.services.site_pages_service.settings.data_dir", str(self.data))
        self.patcher.start()

    def tearDown(self) -> None:
        self.patcher.stop()
        self.tmp.cleanup()

    def test_defaults_include_founder_and_feature_banners(self) -> None:
        data = site_pages_service.load()
        self.assertEqual(data["updates"]["founder"]["title"], "A first note from Render Studio")
        banners = data["updates"]["banners"]
        self.assertEqual(len(banners), 1)
        self.assertEqual(banners[0]["id"], "roadmap")
        self.assertIn("render-studio-roadmap-robotics.jpg", banners[0]["src"])
        self.assertNotIn("render3d-linkedin-hello-world.png", banners[0]["src"])
        self.assertEqual(data["docs"]["getting_started"]["title"], "Render Studio")

    def test_save_survives_reload(self) -> None:
        site_pages_service.save({
            "updates": {
                "founder": {"title": "Studio note", "body": "Edited copy."},
                "banners": [
                    {"id": "hello-world", "src": "/custom.png", "title": "Render Update", "alt": "Banner"},
                ],
                "posts": [
                    {
                        "id": "ai-cad-generate",
                        "title": "AI CAD generate (edited)",
                        "summary": "Override",
                        "visual": "/custom.gif",
                        "date": "2026-09-08",
                    }
                ],
            },
            "docs": {
                "guides": {"ai-generate": {"title": "Generate with AI", "gif": "/new.gif"}},
            },
        })
        again = site_pages_service.load()
        self.assertEqual(again["updates"]["founder"]["title"], "Studio note")
        self.assertEqual(again["updates"]["banners"][0]["src"], "/custom.png")
        self.assertEqual(again["updates"]["posts"][0]["title"], "AI CAD generate (edited)")
        self.assertEqual(again["docs"]["guides"]["ai-generate"]["gif"], "/new.gif")
        self.assertTrue((_pages := Path(self.data) / "site_pages.json").is_file())

    def test_empty_banners_persist_after_reload(self) -> None:
        site_pages_service.save({
            "updates": {
                "banners": [
                    {"id": "keep", "src": "/keep.png", "title": "Keep"},
                    {"id": "gone", "src": "", "title": "Gone"},
                ],
            },
        })
        once = site_pages_service.load()
        self.assertEqual([item["id"] for item in once["updates"]["banners"]], ["keep"])
        site_pages_service.save({"updates": {"banners": []}})
        again = site_pages_service.load()
        self.assertEqual(again["updates"]["banners"], [])
        self.assertEqual(again["updates"]["founder"]["title"], "A first note from Render Studio")

    def test_media_upload_and_lookup(self) -> None:
        saved = site_pages_service.save_media("banner.png", b"\x89PNG\r\n", "image/png")
        self.assertTrue(saved["src"].startswith("/api/site/pages/media/"))
        path = site_pages_service.media_file(saved["filename"])
        self.assertTrue(path and path.is_file())
        self.assertIsNone(site_pages_service.media_file("../secret.png"))
        with self.assertRaises(ValueError):
            site_pages_service.save_media("payload.exe", b"MZ", "application/octet-stream")


if __name__ == "__main__":
    unittest.main()
