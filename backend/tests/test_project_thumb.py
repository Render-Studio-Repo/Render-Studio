"""Sidebar thumbs come from snapshots, then the project mesh, then photos."""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from backend.services.project_thumb import (
    THUMB_SIZE,
    _object_bbox,
    _still_is_full_snapshot,
    ensure_project_thumb,
    find_source_models,
    find_fallback_still,
    find_source_image,
    find_source_model,
    pick_thumb_source,
    thumb_path,
)


def _write_still(path: Path, color=(40, 160, 220), size=(48, 48)) -> Path:
    Image.fromarray(np.full((*size, 3), color, dtype=np.uint8)).save(path)
    return path


def _write_box_glb(path: Path) -> Path:
    import trimesh

    mesh = trimesh.creation.box(extents=[12.0, 8.0, 20.0])
    mesh.export(str(path))
    return path


class ProjectThumbTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp())

    def test_snapshot_image_is_preferred_when_present(self) -> None:
        glb = _write_box_glb(self.root / "part.glb")
        time.sleep(0.05)
        snap = _write_still(self.root / "part_snapshot_iso.png", size=(800, 600))
        src, kind = pick_thumb_source(self.root)
        self.assertEqual(src, snap)
        self.assertEqual(kind, "image")
        self.assertEqual(find_source_image(self.root), snap)
        self.assertGreater(snap.stat().st_mtime, glb.stat().st_mtime)

    def test_exploded_snapshot_loses_to_assembled_iso(self) -> None:
        iso = _write_still(self.root / "chassis_snapshot_iso.png", size=(1600, 1200))
        time.sleep(0.05)
        _write_still(self.root / "chassis_exploded_snapshot_iso.png", size=(384, 384))
        _write_box_glb(self.root / "chassis_exploded.glb")
        src, kind = pick_thumb_source(self.root)
        self.assertEqual(src, iso)
        self.assertEqual(kind, "image")

    def test_tiny_splat_still_loses_to_mesh(self) -> None:
        splat = _write_still(self.root / "part_snapshot_iso.png", size=(384, 384))
        time.sleep(0.05)
        glb = _write_box_glb(self.root / "part.glb")
        src, kind = pick_thumb_source(self.root)
        self.assertEqual(src, glb)
        self.assertEqual(kind, "model")
        self.assertGreater(glb.stat().st_mtime, splat.stat().st_mtime)

    def test_full_png_snapshot_wins_without_pillow(self) -> None:
        """The lean production worker can identify a full snapshot from its PNG header."""
        snap = _write_still(self.root / "part_snapshot_iso.png", size=(800, 600))
        with patch("builtins.__import__", side_effect=ImportError("no pillow")):
            self.assertTrue(_still_is_full_snapshot(snap))

    def test_imported_glb_without_snapshot_builds_solid_thumb(self) -> None:
        _write_box_glb(self.root / "import.glb")
        dest = ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        self.assertTrue(dest.is_file())
        with Image.open(dest) as im:
            self.assertEqual(im.size, (THUMB_SIZE, THUMB_SIZE))
            arr = np.asarray(im)
            bg = (arr[:, :, 0] > 220) & (arr[:, :, 1] > 220) & (arr[:, :, 2] > 220)
            fill = 1.0 - (float(bg.mean()) if bg.size else 1.0)
            self.assertGreater(fill, 0.12)

    def test_newer_mesh_beats_stale_snapshot(self) -> None:
        snap = _write_still(self.root / "old_snapshot_iso.png")
        time.sleep(0.05)
        glb = _write_box_glb(self.root / "part.glb")
        src, kind = pick_thumb_source(self.root)
        self.assertEqual(src, glb)
        self.assertEqual(kind, "model")
        self.assertLess(snap.stat().st_mtime, glb.stat().st_mtime)

    def test_imported_glb_without_snapshot_builds_thumb(self) -> None:
        _write_box_glb(self.root / "import.glb")
        dest = ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        self.assertTrue(dest.is_file())
        self.assertEqual(dest, thumb_path(self.root))
        with Image.open(dest) as im:
            self.assertEqual(im.size, (THUMB_SIZE, THUMB_SIZE))

    def test_step_without_glb_is_not_tessellated(self) -> None:
        (self.root / "bare.step").write_text("ISO-10303-21;", encoding="utf-8")
        self.assertIsNone(find_source_model(self.root))
        self.assertIsNone(ensure_project_thumb(self.root, force=True))

    def test_empty_tiny_glb_is_not_used_as_a_model_thumbnail(self) -> None:
        (self.root / "broken.glb").write_bytes(b"glTF" + b"\x00" * 200)
        self.assertIsNone(find_source_model(self.root))

    def test_step_uses_sibling_preview_glb(self) -> None:
        (self.root / "import.step").write_text("ISO-10303-21;", encoding="utf-8")
        glb = _write_box_glb(self.root / "import.glb")
        self.assertEqual(find_source_model(self.root), glb)

    def test_mesh_folder_glb_is_found(self) -> None:
        folder = self.root / "mesh"
        folder.mkdir()
        glb = _write_box_glb(folder / "hero.glb")
        self.assertEqual(find_source_model(self.root), glb)

    def test_mcmaster_glb_loses_to_design_assembly(self) -> None:
        design = _write_box_glb(self.root / "bracket.glb")
        time.sleep(0.05)
        _write_box_glb(self.root / "7939K12.glb")
        src, kind = pick_thumb_source(self.root)
        self.assertEqual(src, design)
        self.assertEqual(kind, "model")

    def test_reference_photo_used_when_project_has_no_model(self) -> None:
        refs = self.root / "references"
        refs.mkdir()
        photo = _write_still(refs / "hero.jpg", color=(200, 40, 40))
        self.assertEqual(find_fallback_still(self.root), photo)
        dest = ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        with Image.open(dest) as im:
            self.assertEqual(im.size, (THUMB_SIZE, THUMB_SIZE))

    def test_object_bbox_frames_outer_shell_not_cavity_floor(self) -> None:
        """A large interior patch must not win over the outer silhouette."""
        arr = np.full((200, 200, 3), 246, dtype=np.uint8)
        arr[20:180, 20:180] = (70, 90, 110)
        arr[28:172, 28:172] = (246, 246, 246)
        arr[55:145, 55:145] = (40, 50, 60)
        bbox = _object_bbox(Image.fromarray(arr))
        self.assertIsNotNone(bbox)
        left, top, right, bottom = bbox
        self.assertLessEqual(left, 24)
        self.assertLessEqual(top, 24)
        self.assertGreaterEqual(right, 176)
        self.assertGreaterEqual(bottom, 176)

    def test_hollow_box_thumb_keeps_outer_silhouette(self) -> None:
        import trimesh

        try:
            outer = trimesh.creation.box(extents=[40.0, 40.0, 40.0])
            inner = trimesh.creation.box(extents=[32.0, 32.0, 32.0])
            mesh = outer.difference(inner)
        except Exception:
            self.skipTest("trimesh boolean difference unavailable")
        if mesh is None or len(getattr(mesh, "faces", [])) < 8:
            self.skipTest("hollow box boolean produced no mesh")
        mesh.export(str(self.root / "housing.glb"))
        dest = ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        with Image.open(dest) as im:
            arr = np.asarray(im)
            bg = (arr[:, :, 0] > 220) & (arr[:, :, 1] > 220) & (arr[:, :, 2] > 220)
            fill = 1.0 - (float(bg.mean()) if bg.size else 1.0)
            self.assertGreater(fill, 0.10)
            self.assertLess(fill, 0.92)

    def test_failed_model_thumb_is_not_retried_until_source_changes(self) -> None:
        from unittest.mock import patch

        from backend.services import project_thumb as thumbs

        _write_box_glb(self.root / "broken.glb")
        with patch.object(thumbs, "_write_jpeg_from_model", side_effect=RuntimeError("no faces")):
            first = thumbs.ensure_project_thumb(self.root, force=True)
            self.assertIsNone(first)
            self.assertTrue((self.root / ".thumb.fail").is_file())
            with patch.object(thumbs, "_write_jpeg_from_model") as writer:
                second = thumbs.ensure_project_thumb(self.root, force=False)
                self.assertIsNone(second)
                writer.assert_not_called()

    def test_img2threejs_reference_used_during_mesh_job(self) -> None:
        work = self.root / ".img2threejs"
        work.mkdir()
        photo = _write_still(work / "reference.png", color=(30, 200, 90))
        self.assertEqual(find_fallback_still(self.root), photo)
        dest = ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        self.assertTrue(dest.is_file())


    def test_get_thumb_skips_model_raster_when_no_still(self) -> None:
        _write_box_glb(self.root / "part.glb")
        with patch(
            "backend.services.project_thumb._write_jpeg_from_model",
            side_effect=AssertionError("rasterized model"),
        ):
            self.assertIsNone(ensure_project_thumb(self.root, allow_model=False))

    def test_get_thumb_can_build_from_still_without_model(self) -> None:
        snap = _write_still(self.root / "part_snapshot_iso.png", size=(800, 600))
        _write_box_glb(self.root / "part.glb")
        dest = ensure_project_thumb(self.root, allow_model=False)
        self.assertIsNotNone(dest)
        self.assertTrue(dest.is_file())
        self.assertGreater(snap.stat().st_size, 0)

    def test_failed_newer_glb_falls_back_to_older_project_mesh(self) -> None:
        from unittest.mock import patch

        from backend.services import project_thumb as thumbs

        older = _write_box_glb(self.root / "pi.glb")
        time.sleep(0.05)
        newer = _write_box_glb(self.root / "arduino.glb")
        self.assertGreater(newer.stat().st_mtime, older.stat().st_mtime)

        real = thumbs._write_jpeg_from_model

        def writer(src, dest):
            if src.name == "arduino.glb":
                raise RuntimeError("no faces")
            return real(src, dest)

        with patch.object(thumbs, "_write_jpeg_from_model", side_effect=writer):
            dest = thumbs.ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        self.assertTrue(dest.is_file())
        meta = (self.root / ".thumb.meta").read_text(encoding="utf-8")
        self.assertIn("pi.glb", meta)

    def test_oversized_published_model_beats_compact_older_model(self) -> None:
        compact = _write_box_glb(self.root / "assembly.glb")
        time.sleep(0.05)
        oversized = _write_box_glb(self.root / "edited_export.glb")
        with oversized.open("ab") as stream:
            stream.truncate(12_000_001)
        with patch(
            "backend.services.cad_service.newest_published_model",
            return_value=oversized.name,
        ):
            self.assertEqual(find_source_models(self.root), [oversized, compact])
            self.assertEqual(find_source_model(self.root), oversized)

    def test_same_path_model_overwrite_invalidates_thumb_fingerprint(self) -> None:
        model_dir = self.root / "mesh"
        model_dir.mkdir()
        model = _write_box_glb(model_dir / "assembly.glb")
        dest = ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        before = json.loads((self.root / ".thumb.meta").read_text(encoding="utf-8"))

        time.sleep(0.01)
        import trimesh

        trimesh.creation.icosphere(subdivisions=1, radius=7.0).export(str(model))

        refreshed = ensure_project_thumb(self.root)
        after = json.loads((self.root / ".thumb.meta").read_text(encoding="utf-8"))
        self.assertEqual(refreshed, dest)
        self.assertEqual(before["src"], "mesh/assembly.glb")
        self.assertEqual(after["src"], "mesh/assembly.glb")
        self.assertEqual(after["src_mtime_ns"], model.stat().st_mtime_ns)
        self.assertEqual(after["src_size"], model.stat().st_size)
        self.assertNotEqual(before["src_mtime_ns"], after["src_mtime_ns"])
        self.assertNotEqual(before["src_size"], after["src_size"])

    def test_sidebar_queues_model_thumb_when_jpeg_missing(self) -> None:
        from backend.services import project_thumb as thumbs

        thumbs._THUMB_QUEUE_AT.clear()
        _write_box_glb(self.root / "part.glb")
        self.assertTrue(thumbs.should_queue_model_thumb(self.root))
        self.assertFalse(thumbs.should_queue_model_thumb(self.root))
        dest = ensure_project_thumb(self.root, force=True)
        self.assertTrue(dest.is_file())
        thumbs._THUMB_QUEUE_AT.clear()
        self.assertFalse(thumbs.should_queue_model_thumb(self.root))

    def test_model_thumb_without_pillow_stores_preview_png(self) -> None:
        from unittest.mock import patch

        from backend.services import project_thumb as thumbs

        _write_box_glb(self.root / "part.glb")
        with patch.object(thumbs, "_write_rgba_jpeg", side_effect=ImportError("no pillow")):
            dest = thumbs.ensure_project_thumb(self.root, force=True)
        self.assertIsNotNone(dest)
        self.assertTrue(dest.is_file())
        self.assertTrue(dest.read_bytes().startswith(b"\x89PNG"))
        self.assertEqual(thumbs.thumb_media_type(dest), "image/png")
