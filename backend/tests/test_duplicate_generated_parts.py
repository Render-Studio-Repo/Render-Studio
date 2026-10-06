"""Exploded generate clones must not become sibling browser components."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.services import cad_service
from backend.services.design_service import (
    _is_generic_promoted_part_label,
    _iter_build123d_leaf_children,
    _promote_disconnected_bodies,
)


class DuplicateGeneratedPartsTests(unittest.TestCase):
    def test_generic_body_labels_are_clones(self) -> None:
        self.assertTrue(_is_generic_promoted_part_label("Body 1"))
        self.assertTrue(_is_generic_promoted_part_label("part_08"))
        self.assertTrue(cad_service.is_generic_promoted_part_slug("body_3"))
        self.assertFalse(_is_generic_promoted_part_label("hopper"))
        self.assertFalse(cad_service.is_generic_promoted_part_slug("auger_barrel"))

    def test_disconnected_body_promote_writes_no_files(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "auger.glb").write_bytes(b"glb")
        self.assertEqual(_promote_disconnected_bodies(root, "auger.glb", base="auger"), [])
        self.assertFalse((root / "auger_part01.glb").exists())

    def test_leaf_walk_does_not_flatten_solid_faces(self) -> None:
        class Face:
            label = "face"

        class Solid:
            def __init__(self) -> None:
                self.label = "body_1"
                self.children = [Face(), Face()]

        class Compound:
            def __init__(self) -> None:
                self.label = "assembly"
                self.children = [Solid(), Solid()]

        leaves = _iter_build123d_leaf_children(Compound())
        self.assertEqual(len(leaves), 2)
        self.assertTrue(all(type(item).__name__ == "Solid" for item in leaves))

    def test_quarantine_moves_generic_exploded_bodies_only(self) -> None:
        root = Path(tempfile.mkdtemp())
        base = "concrete_printer_auger_cylindrical_extruder_matc_part"
        (root / f"{base}.glb").write_bytes(b"parent")
        (root / f"{base}.step").write_text("ISO-10303-21;", encoding="utf-8")
        clone = root / f"{base}__part_01_body_1.glb"
        clone.write_bytes(b"clone")
        unique = root / f"{base}__part_02_hopper.glb"
        unique.write_bytes(b"hopper")
        (root / "91290A115.glb").write_bytes(b"bolt")
        (root / f"{base}_copy.glb").write_bytes(b"copy")
        result = cad_service.quarantine_duplicate_generated_parts(root)
        self.assertGreaterEqual(result["count"], 2)
        self.assertFalse(clone.is_file())
        self.assertFalse((root / f"{base}_copy.glb").is_file())
        self.assertTrue(unique.is_file())
        self.assertTrue((root / f"{base}.glb").is_file())
        self.assertTrue((root / f"{base}.step").is_file())
        self.assertTrue((root / "91290A115.glb").is_file())
        trash = root / ".duplicate_parts_trash"
        self.assertTrue((trash / clone.name).is_file())

    def test_lite_hidden_sidecar_matches_parent_family(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "auger.glb").write_bytes(b"parent")
        self.assertTrue(
            cad_service.is_lite_hidden_design_sidecar("auger__part_01_body_1", root)
        )
        self.assertTrue(cad_service.is_lite_hidden_design_sidecar("auger_part01", root))
        self.assertFalse(cad_service.is_lite_hidden_design_sidecar("auger", root))
        self.assertFalse(cad_service.is_lite_hidden_design_sidecar("helmet", root))


if __name__ == "__main__":
    unittest.main()
