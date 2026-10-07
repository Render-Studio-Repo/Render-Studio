"""Share OG / thumb stills come from the shared GLB, not the site logo."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from backend.services import share_preview


def _write_box_glb(path: Path) -> Path:
    import trimesh

    mesh = trimesh.creation.box(extents=[12.0, 8.0, 20.0])
    mesh.visual.face_colors = [40, 160, 220, 255]
    mesh.export(str(path))
    return path


class SharePreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_black_viewport_capture_is_not_usable(self) -> None:
        dest = self.root / "share_view_black.jpg"
        Image.new("RGB", (64, 48), (0, 0, 0)).save(dest, format="JPEG")
        self.assertFalse(share_preview.is_usable_share_preview(dest))
        good = self.root / "share_view_model.png"
        Image.new("RGB", (400, 300), (40, 140, 200)).save(good, format="PNG")
        self.assertTrue(share_preview.is_usable_share_preview(good))

    def test_nested_glb_without_snapshot_builds_png_still(self) -> None:
        folder = self.root / "vibecad"
        folder.mkdir()
        glb = _write_box_glb(folder / "Robot_assembled_Doghouse_Approximately_610_W_610.glb")
        meta = share_preview.share_preview_image_meta(self.root, glb.name)
        self.assertTrue(meta)
        dest = self.root / meta["preview_file"]
        self.assertTrue(dest.is_file())
        self.assertTrue(dest.read_bytes().startswith(b"\x89PNG"))
        self.assertEqual(meta["preview_type"], "image/png")
        self.assertNotIn("og-banner", dest.name.lower())
        self.assertTrue(dest.name.startswith("Robot_assembled_Doghouse"))

    def test_model_still_does_not_use_another_projects_image(self) -> None:
        _write_box_glb(self.root / "this_share.glb")
        other = Image.new("RGB", (64, 64), (250, 20, 20))
        other.save(self.root / "unrelated_snapshot_iso.png")
        meta = share_preview.share_preview_image_meta(self.root, "this_share.glb")
        self.assertTrue(meta)
        self.assertIn("this_share", str(meta["preview_file"]))
        self.assertNotIn("unrelated", str(meta["preview_file"]))

    def test_existing_model_og_is_reused_when_rebuild_fails(self) -> None:
        glb = self.root / "this_share.glb"
        glb.write_bytes(b"glTF" + b"\x00" * 64)
        dest = self.root / "this_share_share_og_color.png"
        Image.new("RGB", (400, 300), (30, 120, 200)).save(dest, format="PNG")
        with patch.object(share_preview, "_render_colored_model_rgba", return_value=None), patch.object(
            share_preview, "_raster_model_png_layer", return_value=None
        ):
            og = share_preview.make_share_og_png_from_model(self.root, "this_share.glb")
        self.assertIsNotNone(og)
        self.assertEqual(og[0], dest.name)

    def test_resolve_share_model_path_finds_vibecad(self) -> None:
        folder = self.root / "vibecad"
        folder.mkdir()
        glb = _write_box_glb(folder / "purse.glb")
        found = share_preview.resolve_share_model_path(self.root, "purse.glb")
        self.assertEqual(found, glb)

    def test_brand_og_card_is_gear_logo_not_old_banner(self) -> None:
        url = share_preview.brand_og_url("https://render3d.app")
        self.assertEqual(url, "https://render3d.app/render-logo-gear-og.png?oglogo=20260916-1")
        self.assertTrue(share_preview.is_brand_og_url(url))
        self.assertFalse(share_preview.is_brand_og_url("/render3d-og-banner.jpg"))
        card = Path(__file__).resolve().parents[2] / "frontend" / "assets" / "brand" / "render-logo-gear-og.png"
        self.assertTrue(card.is_file())
        with Image.open(card) as img:
            self.assertEqual(img.size, (1200, 630))
