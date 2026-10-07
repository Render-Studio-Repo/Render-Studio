"""Share GLB must be inline model/gltf-binary, including nested mesh/ files."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.main import (
    _file_response,
    _share_allowed_filenames,
    _share_exportable_filenames,
    _share_stored_name,
)
from backend.services import cad_service


class ShareGlbServeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.mesh = self.root / "mesh"
        self.mesh.mkdir()
        self.glb = self.mesh / "Terminator Spartan Skull.glb"
        self.glb.write_bytes(b"glTF" + b"\x00" * 64)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_file_response_promotes_jake_sidecar_to_public_glb(self) -> None:
        jake = self.root / ".phillips_s.step.glb"
        jake.write_bytes(b"glTF" + b"\x00" * 64)
        resp = _file_response(self.root, "pid", "phillips_s.glb")
        self.assertEqual(resp.media_type, "model/gltf-binary")
        public = self.root / "phillips_s.glb"
        self.assertTrue(public.is_file())
        self.assertEqual(public.read_bytes(), jake.read_bytes())

    def test_stored_name_keeps_mesh_folder(self) -> None:
        self.assertEqual(
            _share_stored_name("mesh/Terminator Spartan Skull.glb"),
            "mesh/Terminator Spartan Skull.glb",
        )
        self.assertEqual(_share_stored_name("just.glb"), "just.glb")

    def test_file_response_glb_is_inline_gltf_binary(self) -> None:
        resp = _file_response(self.root, "pid", "mesh/Terminator Spartan Skull.glb")
        self.assertEqual(resp.media_type, "model/gltf-binary")
        disposition = str(resp.headers.get("content-disposition") or "").lower()
        self.assertIn("inline", disposition)
        self.assertNotIn("attachment", disposition)

    def test_exportable_resolves_nested_mesh_from_basename(self) -> None:
        names = _share_exportable_filenames(self.root, ["Terminator Spartan Skull.glb"])
        self.assertEqual(names, ["mesh/Terminator Spartan Skull.glb"])

    def test_allowed_filenames_include_nested_mesh_path(self) -> None:
        share = {
            "filename": "mesh/Terminator Spartan Skull.glb",
            "viewer_filename": "mesh/Terminator Spartan Skull.glb",
            "visible_filenames": ["mesh/Terminator Spartan Skull.glb"],
        }
        allowed = _share_allowed_filenames(self.root, share["filename"], share)
        self.assertIn("Terminator Spartan Skull.glb", allowed)
        self.assertIn("mesh/Terminator Spartan Skull.glb", allowed)

    def test_visible_assembly_bake_finds_nested_mesh(self) -> None:
        exports = cad_service.build_visible_assembly_exports(
            self.root,
            ["Terminator Spartan Skull.glb"],
            stem="_share_visible_test",
            include_companions=False,
        )
        out = self.root / "_share_visible_test.glb"
        self.assertTrue(out.is_file())
        self.assertTrue(any(str(item.get("name") or "").endswith(".glb") for item in exports))

    def test_share_bake_skips_mcmaster_when_designed_glb_exists(self) -> None:
        designed = self.root / "Doghouse.glb"
        designed.write_bytes(b"glTF" + b"\x00" * 64)
        hardware = self.root / "91251A194.step"
        hardware.write_text("ISO-10303-21;\n")
        cad_service.build_visible_assembly_exports(
            self.root,
            ["Doghouse.glb", "91251A194.step"],
            stem="_share_visible_hw",
            include_companions=False,
        )
        out = self.root / "_share_visible_hw.glb"
        self.assertTrue(out.is_file())
        self.assertEqual(out.read_bytes(), designed.read_bytes())


if __name__ == "__main__":
    unittest.main()
