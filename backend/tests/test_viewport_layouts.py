"""Viewport layout store, share tokens, and general-settings import."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import viewport_layouts


class ViewportLayoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.patcher = patch.object(viewport_layouts.settings, "data_dir", str(self.data), create=True)
        self.patcher.start()
        if not hasattr(viewport_layouts.settings, "data_dir"):
            viewport_layouts.settings.data_root = str(self.data)

    def tearDown(self) -> None:
        self.patcher.stop()
        self.tmp.cleanup()

    def test_save_and_import_are_general_settings(self) -> None:
        tree = viewport_layouts.sanitize_tree({
            "type": "split",
            "direction": "right",
            "ratio": 0.4,
            "a": {"kind": "viewport", "label": "Viewport"},
            "b": {"id": "__wiring__", "kind": "wiring", "label": "Wiring"},
        })
        saved = viewport_layouts.save_layouts("user-1", {
            "layouts": [{
                "id": "lay1",
                "name": "3D + Wiring",
                "description": "Schematic on the right",
                "tree": tree,
                "tabs": [{"id": "__wiring__", "kind": "wiring", "label": "Wiring"}],
            }],
            "extraLinks": ["https://render3d.app/share/abc123token"],
        })
        self.assertEqual(saved["layouts"][0]["name"], "3D + Wiring")
        self.assertEqual(saved["layouts"][0]["tree"]["direction"], "right")
        self.assertEqual(saved["extraLinks"], ["https://render3d.app/share/abc123token"])
        loaded = viewport_layouts.load_layouts("user-1")
        self.assertEqual(loaded["layouts"][0]["id"], "lay1")
        imported = viewport_layouts.upsert_layout("user-1", {
            "id": "lay2",
            "name": "Imported",
            "tree": tree,
        })
        self.assertEqual(len(imported["layouts"]), 2)
        self.assertEqual(imported["lastId"], "lay2")

    def test_share_round_trip_comments_and_metadata(self) -> None:
        layout = {
            "id": "lay1",
            "name": "Split",
            "description": "Viewport beside parts",
            "tree": {"type": "leaf", "kind": "viewport"},
        }
        viewport_layouts.save_layouts("owner", {"layouts": [layout]})
        created = viewport_layouts.create_share("owner", layout, origin="https://render3d.app")
        self.assertTrue(created["share_url"].endswith(f"/share/{created['token']}"))
        share = viewport_layouts.load_share(created["token"])
        self.assertEqual(share["kind"], viewport_layouts.LAYOUT_KIND)
        meta = viewport_layouts.client_metadata(created["token"], share, origin="https://render3d.app")
        self.assertEqual(meta["kind"], "viewport_layout")
        self.assertEqual(meta["project_name"], "Split")
        self.assertIn("Viewport beside parts", meta["share_description"])
        self.assertIn("render-logo-gear-og.png", meta["preview_image_url"])
        self.assertIn("oglogo=20260916-1", meta["preview_image_url"])
        self.assertNotIn("favicon-180", meta["preview_image_url"])
        self.assertNotIn("render3d-og-banner", meta["preview_image_url"])
        self.assertEqual(meta["preview_width"], 1200)
        self.assertEqual(meta["preview_height"], 630)
        from backend.services import share_mode
        share_mode.add_share_comment(share, text="Looks good")
        viewport_layouts.save_share(created["token"], share)
        again = viewport_layouts.load_share(created["token"])
        self.assertEqual(share_mode.list_share_comments(again)[0]["text"], "Looks good")

    def test_listing_files_install_into_store(self) -> None:
        layout = viewport_layouts.layout_from_listing_files([
            {"name": "viewport-layout.json", "product_type": "viewport_layout", "layout": {
                "name": "Market layout",
                "tree": {"type": "split", "direction": "left", "a": {"kind": "wiring"}, "b": {"kind": "viewport"}},
            }},
        ])
        self.assertEqual(layout["name"], "Market layout")
        self.assertEqual(layout["tree"]["direction"], "left")
        store = viewport_layouts.upsert_layout("buyer", layout)
        self.assertEqual(store["layouts"][0]["name"], "Market layout")

    def test_shipped_popular_templates_include_mcmaster_and_quad(self) -> None:
        wiring = viewport_layouts.load_share("vpl-wiring-right")
        self.assertEqual(wiring["kind"], viewport_layouts.LAYOUT_KIND)
        self.assertEqual(wiring["layout"]["name"], "Viewport + Wiring")
        mc = viewport_layouts.load_share("vpl-mcmaster-right")
        self.assertEqual(mc["layout"]["tree"]["b"]["kind"], "mcmaster")
        quad = viewport_layouts.load_share("vpl-quad-left-down")
        self.assertEqual(quad["layout"]["tree"]["type"], "split")
        self.assertEqual(quad["layout"]["tree"]["a"]["type"], "split")
        self.assertEqual(quad["layout"]["tree"]["b"]["type"], "split")
