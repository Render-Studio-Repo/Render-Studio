"""Engine-folder files resolve from nested and percent-encoded paths."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.services.cad_service import (
    delete_model_artifacts,
    find_cad_file_for_stem,
    resolve_existing_project_file,
    resolve_project_file,
)
from backend.services.engine_layout import _decode_rel, normalize_rel, output_dir, resolve_in_layout


class EngineFilePathTests(unittest.TestCase):
    def test_decode_percent_encoded_slash(self) -> None:
        self.assertEqual(_decode_rel("vibecad%2Fopenarm.glb"), "vibecad/openarm.glb")
        self.assertEqual(_decode_rel("vibecad%252Fopenarm.glb"), "vibecad/openarm.glb")
        self.assertEqual(normalize_rel("vibecad%2Fopenarm.glb"), "vibecad/openarm.glb")

    def test_resolve_vibecad_nested_and_encoded(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "vibecad"
        folder.mkdir()
        glb = folder / "openarm.glb"
        glb.write_bytes(b"glb")
        self.assertEqual(resolve_in_layout(root, "vibecad/openarm.glb"), glb)
        self.assertEqual(resolve_in_layout(root, "vibecad%2Fopenarm.glb"), glb)
        self.assertEqual(resolve_project_file(root, "vibecad/openarm.glb"), glb)
        self.assertEqual(resolve_project_file(root, "vibecad%2Fopenarm.glb"), glb)
        self.assertEqual(find_cad_file_for_stem(root, "openarm", {".glb"}), glb)

    def test_find_cad_skips_drive_id_json_stub(self) -> None:
        from backend.services.cad_service import looks_like_drive_id_stub

        root = Path(tempfile.mkdtemp())
        folder = root / "vibecad"
        folder.mkdir()
        stub = root / "openarm.glb"
        stub.write_text('{"id":"1zhROzih9mrNBB_qCHTkYVmovLO7IxVRI"}\n', encoding="utf-8")
        real = folder / "openarm.glb"
        real.write_bytes(b"glTF" + b"\x00" * 80)
        self.assertTrue(looks_like_drive_id_stub(stub))
        self.assertFalse(looks_like_drive_id_stub(real))
        self.assertEqual(find_cad_file_for_stem(root, "openarm", {".glb"}), real)
        self.assertEqual(resolve_in_layout(root, "openarm.glb"), real)

    def test_resolve_existing_mesh_nested(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        glb = folder / "terminator spartan skull.glb"
        glb.write_bytes(b"glb")
        self.assertEqual(resolve_existing_project_file(root, "mesh/terminator spartan skull.glb"), "mesh/terminator spartan skull.glb")
        self.assertEqual(resolve_existing_project_file(root, "mesh%2Fterminator%20spartan%20skull.glb"), "mesh/terminator spartan skull.glb")

    def test_reject_parent_escape_after_decode(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "vibecad").mkdir()
        secret = root.parent / "secret.glb"
        try:
            secret.write_bytes(b"nope")
            self.assertIsNone(resolve_project_file(root, "vibecad%2F..%2Fsecret.glb"))
            self.assertIsNone(resolve_in_layout(root, "vibecad/../secret.glb"))
        finally:
            if secret.is_file():
                secret.unlink()

    def test_selected_vibecad_folder_wins_over_root_sidecar(self) -> None:
        root = Path(tempfile.mkdtemp())
        (root / "vibecad").mkdir()
        (root / "bracket.vibecad.py").write_text("from build123d import *\n", encoding="utf-8")
        dest = output_dir(
            root,
            "vibecad",
            previous_source_name="bracket.vibecad.py",
            base_filename="vibecad/bracket.step",
        )
        self.assertEqual(dest, root / "vibecad")

    def test_existing_vibecad_glb_wins_when_codex_source_is_at_root(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "vibecad"
        folder.mkdir()
        (folder / "bracket.glb").write_bytes(b"old-assembly")
        (root / "bracket.vibecad.py").write_text("from build123d import *\n", encoding="utf-8")
        dest = output_dir(
            root,
            "vibecad",
            previous_source_name="bracket.vibecad.py",
            base_filename="bracket.glb",
        )
        self.assertEqual(dest, folder)

    def test_delete_model_artifacts_removes_engine_folder_family(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "vibecad"
        folder.mkdir()
        (folder / "openarm.glb").write_bytes(b"glb")
        (folder / "openarm.step").write_bytes(b"step")
        (folder / "openarm.vibecad.py").write_text("x = 1\n", encoding="utf-8")
        (root / "unrelated.glb").write_bytes(b"keep")
        deleted = delete_model_artifacts(root, "vibecad/openarm.glb")
        self.assertIn("vibecad/openarm.glb", deleted)
        self.assertIn("vibecad/openarm.step", deleted)
        self.assertFalse((folder / "openarm.glb").is_file())
        self.assertTrue((root / "unrelated.glb").is_file())

    def test_deleted_catalog_hides_sibling_stl_from_browser(self) -> None:
        from backend.services.cad_service import (
            add_deleted_catalogs,
            list_browser_tree,
            list_project_files,
        )

        root = Path(tempfile.mkdtemp())
        (root / "helmet.glb").write_bytes(b"glb")
        (root / "helmet.stl").write_bytes(b"stl")
        (root / "keep.glb").write_bytes(b"keep")
        add_deleted_catalogs(root, ["helmet.glb"])
        names = {row["name"] for row in list_project_files(root)}
        self.assertNotIn("helmet.glb", names)
        self.assertNotIn("helmet.stl", names)
        self.assertIn("keep.glb", names)
        stems = {c["stem"] for c in (list_browser_tree(root).get("components") or [])}
        self.assertNotIn("helmet", stems)
        self.assertIn("keep", stems)

    def test_republish_clears_deleted_catalog_tombstone(self) -> None:
        from backend.services.cad_service import (
            add_deleted_catalogs,
            clear_deleted_catalogs_for_published,
            list_browser_tree,
            list_project_files,
            load_deleted_catalogs,
        )

        root = Path(tempfile.mkdtemp())
        (root / "box.stl").write_bytes(b"stl")
        add_deleted_catalogs(root, ["box.step"])
        self.assertNotIn("box.stl", {row["name"] for row in list_project_files(root)})
        (root / "box.glb").write_bytes(b"glb")
        (root / "box.step").write_bytes(b"step")
        clear_deleted_catalogs_for_published(root, ["box.glb"])
        self.assertFalse(load_deleted_catalogs(root))
        names = {row["name"] for row in list_project_files(root)}
        self.assertIn("box.glb", names)
        self.assertIn("box.step", names)
        stems = {c["stem"] for c in (list_browser_tree(root).get("components") or [])}
        self.assertIn("box", stems)

    def test_list_project_files_skips_share_bake_sidecar(self) -> None:
        from backend.services.cad_service import list_browser_tree, list_project_files

        root = Path(tempfile.mkdtemp())
        (root / "arm.glb").write_bytes(b"glb")
        (root / "_share_visible_ZbXNZ8z5.glb").write_bytes(b"share")
        (root / "_export_visible_assembly.glb").write_bytes(b"export")
        names = {row["name"] for row in list_project_files(root)}
        self.assertIn("arm.glb", names)
        self.assertNotIn("_share_visible_ZbXNZ8z5.glb", names)
        self.assertNotIn("_export_visible_assembly.glb", names)
        stems = {c["stem"] for c in (list_browser_tree(root).get("components") or [])}
        self.assertIn("arm", stems)
        self.assertNotIn("_share_visible_ZbXNZ8z5", stems)

    def test_jake_hidden_preview_recovers_tombstoned_assembly(self) -> None:
        from backend.services.cad_service import (
            add_deleted_catalogs,
            list_browser_tree,
            primary_assembly_component,
        )

        root = Path(tempfile.mkdtemp())
        _write_named_glb(root / ".Bracket.step.glb", ["Motor", "Bracket", "Rail"])
        (root / "Bracket_exploded.glb").write_bytes(b"exp" * 40)
        add_deleted_catalogs(root, ["bracket.glb", "bracket.step", "bracket"])
        tree = list_browser_tree(root)
        comps = tree.get("components") or []
        stems = {c.get("stem") for c in comps}
        self.assertIn("Bracket", stems)
        self.assertNotIn("Bracket_exploded", stems)
        primary = primary_assembly_component(root)
        self.assertIsNotNone(primary)
        self.assertEqual(primary.get("stem"), "Bracket")
        self.assertEqual(primary.get("viewer_filename"), ".Bracket.step.glb")
        self.assertTrue(primary.get("auto_load"))
        self.assertEqual(primary.get("children_label"), "Bodies")
        self.assertEqual([c.get("label") for c in (primary.get("children") or [])], ["Motor", "Bracket", "Rail"])

    def test_ensure_public_glb_copies_jake_sidecar(self) -> None:
        from backend.services.cad_service import ensure_public_glb_from_jake_preview

        root = Path(tempfile.mkdtemp())
        jake = root / ".phillips_s.step.glb"
        jake.write_bytes(b"glTF" + b"\x00" * 32)
        out = ensure_public_glb_from_jake_preview(root, "phillips_s.glb")
        self.assertIsNotNone(out)
        public = root / "phillips_s.glb"
        self.assertEqual(out, public)
        self.assertTrue(public.is_file())
        self.assertEqual(public.read_bytes(), jake.read_bytes())
        self.assertEqual(ensure_public_glb_from_jake_preview(root, "missing.glb"), None)

    def test_ensure_public_glb_replaces_drive_stub_from_vibecad(self) -> None:
        from backend.services.cad_service import ensure_public_glb_from_jake_preview

        root = Path(tempfile.mkdtemp())
        (root / "vibecad").mkdir()
        stub = root / "Shell_Clutch.glb"
        stub.write_text('{"id":"1zhROzih9mrNBB_qCHTkYVmovLO7IxVRI"}\n', encoding="utf-8")
        real = root / "vibecad" / "Shell_Clutch.glb"
        real.write_bytes(b"glTF" + b"\x00" * 80)
        out = ensure_public_glb_from_jake_preview(root, "Shell_Clutch.glb")
        self.assertEqual(out, stub)
        self.assertEqual(stub.read_bytes(), real.read_bytes())

    def test_generic_glb_body_labels_use_step_occurrence_names(self) -> None:
        from backend.services.cad_service import (
            _display_names_for_scene_bodies,
            _is_generic_gltf_body_id,
            add_deleted_catalogs,
            list_browser_tree,
            primary_assembly_component,
        )

        self.assertTrue(_is_generic_gltf_body_id("Body 30"))
        self.assertTrue(_is_generic_gltf_body_id("Body_1"))
        self.assertTrue(_is_generic_gltf_body_id("Enclosure body"))
        self.assertFalse(_is_generic_gltf_body_id("base"))
        mapped = _display_names_for_scene_bodies(
            ["Enclosure body", "Body 30", "Body 1", "Body 2"],
            {1: "base", 2: "lid", 30: "motor_socket"},
        )
        self.assertEqual(mapped[1], "Motor Socket")
        self.assertEqual(mapped[2], "Base")
        self.assertEqual(mapped[3], "Lid")

        root = Path(tempfile.mkdtemp())
        _write_named_glb(root / ".Housing.step.glb", ["Housing body", "Body 2", "Body 1"])
        (root / "Housing.step").write_text(
            "ISO-10303-21;\nHEADER;ENDSEC;DATA;\n"
            "#1=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','base','');\n"
            "#2=NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','lid','');\n"
            "#3=MANIFOLD_SOLID_BREP('','');\n"
            "#4=MANIFOLD_SOLID_BREP('','');\n"
            "ENDSEC;END-ISO-10303-21;\n",
            encoding="utf-8",
        )
        add_deleted_catalogs(root, ["housing.glb", "housing.step", "housing"])
        primary = primary_assembly_component(root)
        self.assertIsNotNone(primary)
        labels = [c.get("label") for c in (primary.get("children") or [])]
        self.assertIn("Base", labels)
        self.assertIn("Lid", labels)
        self.assertNotIn("Body 1", labels)
        self.assertNotIn("Body 2", labels)
        tree = list_browser_tree(root)
        self.assertTrue(tree.get("components"))

    def test_vibecad_expected_outputs_name_generic_bodies(self) -> None:
        from backend.services.cad_service import _display_names_for_scene_bodies, list_browser_tree

        mapped = _display_names_for_scene_bodies(
            ["Body 1", "Body 2"],
            {},
            ["pi_tray", "mks_tray"],
        )
        self.assertEqual(mapped, ["Pi Tray", "Mks Tray"])

        root = Path(tempfile.mkdtemp())
        _write_named_glb(root / "Cart.glb", ["Body 1", "Body 2"])
        (root / "Cart.vibecad.json").write_text(
            '{"model_name":"Cart","expected_outputs":["deck","axle"]}',
            encoding="utf-8",
        )
        tree = list_browser_tree(root)
        comps = tree.get("components") or []
        self.assertTrue(comps)
        labels = [c.get("label") for c in (comps[0].get("children") or [])]
        self.assertEqual(labels, ["Deck", "Axle"])

    def test_freecad_create_primitive_is_flagged_not_cad_primary(self) -> None:
        from backend.services.cad_service import list_browser_tree, newest_published_model

        root = Path(tempfile.mkdtemp())
        (root / "mount.glb").write_bytes(b"cad" * 40)
        (root / "box.glb").write_bytes(b"box" * 40)
        (root / "box.step").write_text("ISO-10303-21;", encoding="utf-8")
        (root / "box.freecad.json").write_text('{"engine":"freecad","op":"box"}', encoding="utf-8")
        tree = list_browser_tree(root)
        by_stem = {c.get("stem"): c for c in (tree.get("components") or [])}
        self.assertTrue(by_stem["box"].get("freecad_primitive"))
        self.assertTrue(by_stem["box"].get("xr_creation"))
        self.assertFalse(by_stem["mount"].get("freecad_primitive"))
        self.assertEqual(newest_published_model(root), "mount.glb")

    def test_primitive_stem_flagged_without_sidecar_and_vr_generation(self) -> None:
        from backend.services.cad_service import list_browser_tree

        root = Path(tempfile.mkdtemp())
        (root / "cone10.glb").write_bytes(b"cone" * 40)
        (root / "FollowingTheAttachedDxfReferenceAndCreated.glb").write_bytes(b"vr" * 40)
        (root / "Cart.glb").write_bytes(b"cad" * 40)
        (root / "generation.json").write_text(
            '{"status":"complete","client":"xr","filename":"FollowingTheAttachedDxfReferenceAndCreated.glb","jobs":[]}',
            encoding="utf-8",
        )
        tree = list_browser_tree(root)
        by_stem = {c.get("stem"): c for c in (tree.get("components") or [])}
        self.assertTrue(by_stem["cone10"].get("freecad_primitive"))
        self.assertTrue(by_stem["cone10"].get("xr_creation"))
        self.assertTrue(by_stem["FollowingTheAttachedDxfReferenceAndCreated"].get("vr_generation"))
        self.assertFalse(by_stem["Cart"].get("xr_creation"))


def _write_named_glb(path: Path, names: list[str]) -> None:
    import json
    import struct

    meshes = [{"name": name} for name in names]
    nodes = [{"name": name, "mesh": i} for i, name in enumerate(names)]
    meta = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(names)))}],
        "nodes": nodes,
        "meshes": meshes,
    }
    blob = json.dumps(meta, separators=(",", ":")).encode("utf-8")
    pad = (4 - (len(blob) % 4)) % 4
    blob += b" " * pad
    length = 12 + 8 + len(blob)
    path.write_bytes(
        struct.pack("<3I", 0x46546C67, 2, length)
        + struct.pack("<2I", len(blob), 0x4E4F534A)
        + blob
    )


class OrphanPartCollapseTests(unittest.TestCase):
    def test_collapse_groups_exploded_parts_without_parent(self) -> None:
        from backend.services.cad_service import collapse_orphan_exploded_part_components

        rows = [
            {"stem": "Purse__part_01_base", "name": "vibecad/Purse__part_01_base.glb", "size": 100, "engine": "vibecad"},
            {"stem": "Purse__part_02_lid", "name": "vibecad/Purse__part_02_lid.glb", "size": 200, "engine": "vibecad"},
            {"stem": "Purse__part_03_pin", "name": "vibecad/Purse__part_03_pin.glb", "size": 10, "engine": "vibecad"},
        ]
        out = collapse_orphan_exploded_part_components(rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["stem"], "Purse")
        self.assertTrue(out[0].get("virtual_component"))
        self.assertEqual(out[0]["viewer_filename"], "vibecad/Purse__part_02_lid.glb")

    def test_collapse_root_and_engine_folder_same_stem(self) -> None:
        from backend.services.cad_service import collapse_duplicate_folder_stems

        out = collapse_duplicate_folder_stems([
            {"stem": "Purse", "name": "Purse.glb", "size": 10, "engine": None},
            {"stem": "Purse", "name": "vibecad/Purse.glb", "size": 20, "engine": "vibecad"},
        ])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["name"], "vibecad/Purse.glb")

    def test_revive_tombstone_when_only_assembly_still_on_disk(self) -> None:
        from backend.services.cad_service import (
            add_deleted_catalogs,
            list_browser_tree,
            list_project_files,
            load_deleted_catalogs,
        )

        root = Path(tempfile.mkdtemp())
        folder = root / "vibecad"
        folder.mkdir()
        (folder / "Purse.glb").write_bytes(b"assembled" * 40)
        (folder / "Purse__part_01_base.glb").write_bytes(b"part")
        add_deleted_catalogs(root, ["vibecad/Purse.glb", "Purse.glb", "Purse"])
        names = {row["name"] for row in list_project_files(root)}
        self.assertIn("vibecad/Purse.glb", names)
        stems = [c.get("stem") for c in (list_browser_tree(root).get("components") or [])]
        self.assertEqual(stems.count("Purse"), 1)
        self.assertFalse(any(k for k in load_deleted_catalogs(root) if "purse" in k))


if __name__ == "__main__":
    unittest.main()
