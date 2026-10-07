"""Place-beside helpers keep existing STEP bodies and skip when there is no sibling."""

from __future__ import annotations

import json
import math
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services.freecad_engine import (
    _valid_place_meta,
    find_live_assembly_step,
    place_new_part_beside_assembly,
    place_offset_mm,
)


class FreeCadPlaceTests(unittest.TestCase):
    def test_place_offset_parks_new_solid_on_plus_x(self) -> None:
        existing = (0.0, 0.0, 0.0, 40.0, 10.0, 8.0)
        new = (0.0, 0.0, 0.0, 12.0, 6.0, 4.0)
        dx, dy, dz = place_offset_mm(existing, new, gap_mm=20.0)
        self.assertEqual((dy, dz), (0.0, 0.0))
        self.assertAlmostEqual(dx, 60.0)

    def test_already_parked_offset_is_zero(self) -> None:
        existing = (0.0, 0.0, 0.0, 40.0, 10.0, 8.0)
        new = (60.0, 0.0, 0.0, 72.0, 6.0, 4.0)
        dx, dy, dz = place_offset_mm(existing, new, gap_mm=20.0)
        self.assertEqual((dx, dy, dz), (0.0, 0.0, 0.0))

    def test_place_offset_rejects_freecad_empty_bound_sentinel(self) -> None:
        invalid = (-1e100, -1e100, -1e100, 1e100, 1e100, 1e100)
        with self.assertRaises(ValueError):
            place_offset_mm(invalid, (0.0, 0.0, 0.0, 12.0, 6.0, 4.0))

    def test_place_offset_rejects_non_finite_bounds(self) -> None:
        invalid = (0.0, 0.0, 0.0, math.inf, 10.0, 8.0)
        with self.assertRaises(ValueError):
            place_offset_mm(invalid, (0.0, 0.0, 0.0, 12.0, 6.0, 4.0))

    def test_place_meta_rejects_old_freecad_empty_bound_sentinel(self) -> None:
        corrupt = {
            "ok": True,
            "translation": [2e100, 0.0, 0.0],
            "existing_bbox": [-1e100, -1e100, -1e100, 1e100, 1e100, 1e100],
            "new_bbox": [-1e100, -1e100, -1e100, 1e100, 1e100, 1e100],
        }
        self.assertFalse(_valid_place_meta(corrupt))

    def test_place_meta_accepts_finite_receipt(self) -> None:
        receipt = {
            "ok": True,
            "translation": [60.0, 0.0, 0.0],
            "existing_bbox": [0.0, 0.0, 0.0, 40.0, 10.0, 8.0],
            "new_bbox": [60.0, 0.0, 0.0, 72.0, 6.0, 4.0],
        }
        self.assertTrue(_valid_place_meta(receipt))

    def test_find_live_assembly_skips_new_and_hardware(self) -> None:
        root = Path(tempfile.mkdtemp())
        old = root / "base.step"
        old.write_text("ISO-10303-21;", encoding="utf-8")
        time.sleep(0.05)
        hardware = root / "91290A115.step"
        hardware.write_text("ISO-10303-21;", encoding="utf-8")
        time.sleep(0.05)
        new = root / "clip.step"
        new.write_text("ISO-10303-21;", encoding="utf-8")
        found = find_live_assembly_step(root, new)
        self.assertEqual(found, old)

    def test_place_skips_when_no_sibling(self) -> None:
        root = Path(tempfile.mkdtemp())
        new = root / "only.step"
        new.write_text("ISO-10303-21;", encoding="utf-8")
        out = place_new_part_beside_assembly(root, new)
        self.assertFalse(out.get("ok"))
        self.assertEqual(out.get("reason"), "no_sibling_step")

    def test_place_is_idempotent_with_meta(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "base.step").write_text("ISO-10303-21;", encoding="utf-8")
        new = root / "clip.step"
        new.write_text("ISO-10303-21;", encoding="utf-8")
        prior = {
            "ok": True,
            "merged": True,
            "new_stem": "clip",
            "translation": [20.0, 0.0, 0.0],
        }
        (root / "clip.place.json").write_text(json.dumps(prior), encoding="utf-8")
        out = place_new_part_beside_assembly(root, new)
        self.assertTrue(out.get("ok"))
        self.assertTrue(out.get("skipped"))
        self.assertEqual(out.get("reason"), "already_placed")

    def test_invalid_legacy_meta_is_reconciled_instead_of_skipped(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "base.step").write_text("ISO-10303-21;", encoding="utf-8")
        new = root / "clip.step"
        new.write_text("ISO-10303-21;", encoding="utf-8")
        (root / "clip.place.json").write_text(json.dumps({
            "ok": True,
            "translation": [2e100, 0.0, 0.0],
            "existing_bbox": [-1e100, -1e100, -1e100, 1e100, 1e100, 1e100],
            "new_bbox": [-1e100, -1e100, -1e100, 1e100, 1e100, 1e100],
        }), encoding="utf-8")

        with patch("backend.services.freecad_engine.freecad_available", return_value=False):
            out = place_new_part_beside_assembly(root, new)

        self.assertEqual(out, {"ok": False, "reason": "freecad_unavailable"})

    def test_place_skips_when_new_part_is_already_live_model(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "auger.step").write_text("ISO-10303-21;", encoding="utf-8")
        time.sleep(0.05)
        new = root / "auger_edited.step"
        new.write_text("ISO-10303-21;", encoding="utf-8")
        out = place_new_part_beside_assembly(root, new)
        self.assertTrue(out.get("skipped"))
        self.assertEqual(out.get("reason"), "already_live_model")


if __name__ == "__main__":
    unittest.main()
