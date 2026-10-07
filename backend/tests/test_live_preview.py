"""Live viewport previews skip exploded sidecars and prefer generation-live GLBs."""

from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path

from backend.services.live_preview import (
    find_newest_preview_glb,
    find_newest_preview_step,
    has_settled_design_siblings,
)


def _write_settled(path: Path, data: bytes, *, newer: bool = False) -> None:
    path.write_bytes(data)
    now = time.time()
    stamp = now - (0.6 if newer else 1.2)
    os.utime(path, (stamp, stamp))


class LivePreviewPickTests(unittest.TestCase):
    def test_skips_exploded_even_when_newer(self) -> None:
        root = Path(tempfile.mkdtemp())
        assembled = root / "doghouse.glb"
        exploded = root / "doghouse_exploded.glb"
        _write_settled(assembled, b"assembled-mesh" * 20)
        _write_settled(exploded, b"exploded-mesh" * 40, newer=True)
        picked = find_newest_preview_glb(root)
        self.assertEqual(picked, assembled)

    def test_prefers_generation_live_sidecar(self) -> None:
        root = Path(tempfile.mkdtemp())
        full = root / "doghouse.glb"
        live = root / "doghouse.generation-live.glb"
        _write_settled(full, b"full-export" * 30)
        _write_settled(live, b"live-draft" * 10, newer=True)
        picked = find_newest_preview_glb(root)
        self.assertEqual(picked, live)

    def test_never_picks_stl(self) -> None:
        root = Path(tempfile.mkdtemp())
        stl = root / "doghouse.stl"
        glb = root / "doghouse.glb"
        _write_settled(stl, b"solid ascii" * 40, newer=True)
        _write_settled(glb, b"assembled-mesh" * 20)
        picked = find_newest_preview_glb(root)
        self.assertEqual(picked, glb)
        self.assertFalse(str(picked).lower().endswith(".stl"))

    def test_skips_exploded_step(self) -> None:
        root = Path(tempfile.mkdtemp())
        assembled = root / "doghouse.step"
        exploded = root / "doghouse_exploded.step"
        _write_settled(assembled, b"ISO-10303 assembled" * 20)
        _write_settled(exploded, b"ISO-10303 exploded" * 40, newer=True)
        picked = find_newest_preview_step(root)
        self.assertEqual(picked, assembled)

    def test_has_settled_design_siblings(self) -> None:
        root = Path(tempfile.mkdtemp())
        existing = root / "base.glb"
        draft = root / "clip.generation-live.glb"
        _write_settled(existing, b"assembled-mesh" * 20)
        _write_settled(draft, b"live-draft" * 20, newer=True)
        self.assertTrue(has_settled_design_siblings(root, excluding=draft))
        self.assertFalse(has_settled_design_siblings(root, excluding=existing))

    def test_same_stem_live_sidecar_is_not_a_new_object(self) -> None:
        from backend.services.live_preview import preview_design_stem

        root = Path(tempfile.mkdtemp())
        existing = root / "NEMA_34_Offset_Bracket.glb"
        live = root / "NEMA_34_Offset_Bracket.generation-live.glb"
        _write_settled(existing, b"assembled-mesh" * 20)
        _write_settled(live, b"live-draft" * 20, newer=True)
        self.assertEqual(
            preview_design_stem(existing),
            preview_design_stem(live),
        )
        self.assertFalse(has_settled_design_siblings(root, excluding=live))
        other = root / "rail.glb"
        _write_settled(other, b"assembled-mesh" * 20)
        self.assertTrue(has_settled_design_siblings(root, excluding=live))


class ViewportSkipsStlTests(unittest.TestCase):
    def test_stl_sidecar_is_not_the_viewport_file(self) -> None:
        from backend.services.cad_service import viewer_filename_for_model

        root = Path(tempfile.mkdtemp())
        (root / "part.glb").write_bytes(b"glb-mesh" * 20)
        (root / "part.stl").write_bytes(b"solid ascii" * 20)
        self.assertEqual(viewer_filename_for_model("part.stl", root), "part.glb")

    def test_stl_only_upload_still_views(self) -> None:
        from backend.services.cad_service import viewer_filename_for_model

        root = Path(tempfile.mkdtemp())
        (root / "scan.stl").write_bytes(b"solid ascii" * 20)
        self.assertEqual(viewer_filename_for_model("scan.stl", root), "scan.stl")


if __name__ == "__main__":
    unittest.main()
