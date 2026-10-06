"""Mesh/GLB models convert to a printable 3MF, including nested mesh/ files."""

from __future__ import annotations

import tempfile
import unittest
import zipfile
import json
from xml.etree import ElementTree as ET
from pathlib import Path

import trimesh

from backend.services.cad_service import (
    _assign_bambu_plates_packed,
    convert_mesh_to_3mf,
    ensure_derived_export,
    export_scene_3mf,
    list_exports_for_model,
)


def _box_glb(path: Path) -> Path:
    mesh = trimesh.creation.box(extents=(20.0, 10.0, 8.0))
    mesh.export(path)
    return path


class MeshTo3mfConvertTests(unittest.TestCase):
    @staticmethod
    def _project_settings(path: Path) -> dict:
        with zipfile.ZipFile(path) as zf:
            return json.loads(zf.read("Metadata/project_settings.config"))

    def test_multiplate_packer_centers_each_plate_group(self) -> None:
        meshes = [
            trimesh.creation.box(extents=(220.0, 50.0, 10.0)),
            trimesh.creation.box(extents=(220.0, 80.0, 10.0)),
        ]

        plate_of, centers = _assign_bambu_plates_packed(meshes)

        self.assertEqual(sorted(plate_of), [0, 1])
        self.assertEqual(centers, [(128.0, 128.0), (128.0, 128.0)])

    def test_multiplate_packer_centers_a_sparse_shared_plate(self) -> None:
        meshes = [
            trimesh.creation.box(extents=(10.0, 20.0, 8.0)),
            trimesh.creation.box(extents=(20.0, 10.0, 8.0)),
            trimesh.creation.box(extents=(30.0, 15.0, 8.0)),
        ]

        plate_of, centers = _assign_bambu_plates_packed(meshes)
        lows_x = [center[0] - mesh.extents[0] / 2 for center, mesh in zip(centers, meshes)]
        highs_x = [center[0] + mesh.extents[0] / 2 for center, mesh in zip(centers, meshes)]
        lows_y = [center[1] - mesh.extents[1] / 2 for center, mesh in zip(centers, meshes)]
        highs_y = [center[1] + mesh.extents[1] / 2 for center, mesh in zip(centers, meshes)]

        self.assertEqual(plate_of, [0, 0, 0])
        self.assertEqual((min(lows_x) + max(highs_x)) / 2, 128.0)
        self.assertEqual((min(lows_y) + max(highs_y)) / 2, 128.0)

    def test_multiplate_export_clamps_saved_centers_outside_edges_and_bambu_exclusion_area(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            layout_dir = root / "slicer-layout"
            layout_dir.mkdir()
            (layout_dir / "assembly.json").write_text(
                json.dumps(
                    {
                        "parts": [
                            {"id": "part-1", "plate_id": 1, "center_mm": [2, 2, 0], "rotation_deg": [0, 0, 0]},
                            {"id": "part-2", "plate_id": 2, "center_mm": [254, 254, 0], "rotation_deg": [0, 0, 0]},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            scene = trimesh.Scene()
            scene.add_geometry(trimesh.creation.box(extents=(20.0, 20.0, 8.0)), geom_name="first", node_name="first")
            scene.add_geometry(trimesh.creation.box(extents=(20.0, 20.0, 8.0)), geom_name="second", node_name="second")
            dest = root / "assembly.3mf"

            export_scene_3mf(
                scene,
                dest,
                source_path=root / "assembly.glb",
                multiplate=True,
                project_path=root,
                layout_filename="assembly.glb",
            )

            centers = []
            with zipfile.ZipFile(dest) as zf:
                for name in sorted(entry for entry in zf.namelist() if entry.startswith("3D/Objects/")):
                    obj = ET.fromstring(zf.read(name))
                    coords = [[float(vertex.attrib[axis]) for axis in ("x", "y")] for vertex in obj.findall(".//{*}vertex")]
                    centers.append(tuple(round((min(row[axis] for row in coords) + max(row[axis] for row in coords)) / 2, 6) for axis in range(2)))

            # The lower-left part moves right of Bambu's 0..18 x 0..28 mm
            # nozzle-wipe exclusion area plus its 1 mm arrange gap.
            self.assertEqual(centers, [(29.0, 20.0), (236.0, 236.0)])

    def test_forced_3mf_export_replaces_a_fresh_cached_archive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            glb = _box_glb(root / "part.glb")
            dest = glb.with_suffix(".3mf")
            dest.write_bytes(b"fresh-but-obsolete")

            rebuilt = ensure_derived_export(root, glb.name, fmt="3mf", force=True)

            self.assertEqual(rebuilt, dest)
            self.assertTrue(zipfile.is_zipfile(dest))
            with zipfile.ZipFile(dest) as zf:
                self.assertIn("Metadata/model_settings.config", zf.namelist())

    def test_multiplate_export_auto_orients_each_part_on_a_stable_large_face(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = trimesh.creation.box(extents=(10.0, 20.0, 40.0))
            second = trimesh.creation.box(extents=(8.0, 12.0, 30.0))
            scene = trimesh.Scene()
            scene.add_geometry(first, geom_name="first", node_name="first")
            scene.add_geometry(second, geom_name="second", node_name="second")
            dest = root / "assembly.3mf"

            export_scene_3mf(
                scene,
                dest,
                source_path=root / "assembly.glb",
                multiplate=True,
                project_path=root,
                layout_filename="assembly.glb",
            )

            heights = []
            with zipfile.ZipFile(dest) as zf:
                for name in sorted(
                    entry for entry in zf.namelist() if entry.startswith("3D/Objects/")
                ):
                    obj = ET.fromstring(zf.read(name))
                    z_values = [
                        float(vertex.attrib["z"])
                        for vertex in obj.findall(".//{*}vertex")
                    ]
                    heights.append(round(max(z_values) - min(z_values), 6))

            self.assertEqual(sorted(heights), [8.0, 10.0])
            self.assertEqual(self._project_settings(dest)["enable_support"], "0")

    def test_multiplate_export_enables_bambu_auto_support_for_cantilever(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            layout_dir = root / "slicer-layout"
            layout_dir.mkdir()
            (layout_dir / "assembly.json").write_text(
                json.dumps(
                    {
                        "parts": [
                            {
                                "id": "part-1",
                                "plate_id": 1,
                                "center_mm": [100, 128, 0],
                                "rotation_deg": [0, 0, 0],
                            },
                            {
                                "id": "part-2",
                                "plate_id": 1,
                                "center_mm": [160, 128, 0],
                                "rotation_deg": [0, 0, 0],
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            post = trimesh.creation.box(extents=(4.0, 4.0, 10.0))
            post.apply_translation((0.0, 0.0, 5.0))
            roof = trimesh.creation.box(extents=(20.0, 8.0, 2.0))
            roof.apply_translation((6.0, 0.0, 11.0))
            cantilever = trimesh.util.concatenate((post, roof))
            scene = trimesh.Scene()
            scene.add_geometry(cantilever, geom_name="cantilever", node_name="cantilever")
            scene.add_geometry(
                trimesh.creation.box(extents=(10.0, 10.0, 10.0)),
                geom_name="box",
                node_name="box",
            )
            dest = root / "assembly.3mf"

            export_scene_3mf(
                scene,
                dest,
                source_path=root / "assembly.glb",
                multiplate=True,
                project_path=root,
                layout_filename="assembly.glb",
            )

            settings = self._project_settings(dest)
            self.assertEqual(settings["enable_support"], "1")
            self.assertEqual(settings["support_type"], "normal(auto)")

    def test_multiplate_export_skips_auto_orientation_above_part_budget(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scene = trimesh.Scene()
            for index in range(129):
                scene.add_geometry(
                    trimesh.creation.box(extents=(10.0, 20.0, 40.0)),
                    geom_name=f"part-{index}",
                    node_name=f"part-{index}",
                )
            dest = root / "large-assembly.3mf"

            export_scene_3mf(
                scene,
                dest,
                source_path=root / "large-assembly.glb",
                multiplate=True,
                project_path=root,
                layout_filename="large-assembly.glb",
            )

            with zipfile.ZipFile(dest) as zf:
                obj = ET.fromstring(zf.read("3D/Objects/object_1.model"))
                z_values = [
                    float(vertex.attrib["z"])
                    for vertex in obj.findall(".//{*}vertex")
                ]
                object_count = len(
                    [name for name in zf.namelist() if name.startswith("3D/Objects/")]
                )

            self.assertEqual(object_count, 129)
            self.assertEqual(round(max(z_values) - min(z_values), 6), 40.0)

    def test_multiplate_export_applies_saved_rotation_plate_and_position(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            layout_dir = root / "slicer-layout"
            layout_dir.mkdir()
            (layout_dir / "assembly.json").write_text(
                json.dumps(
                    {
                        "parts": [
                            {
                                "id": "part-1",
                                "plate_id": 2,
                                "center_mm": [30, 40, 20],
                                "rotation_deg": [0, 90, 0],
                            },
                            {
                                "id": "part-2",
                                "plate_id": 1,
                                "center_mm": [80, 90, 5],
                                "rotation_deg": [0, 0, 0],
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            first = trimesh.creation.box(extents=(10.0, 20.0, 40.0))
            second = trimesh.creation.box(extents=(8.0, 12.0, 6.0))
            original_extents = first.extents.copy()
            scene = trimesh.Scene()
            scene.add_geometry(first, geom_name="first", node_name="first")
            scene.add_geometry(second, geom_name="second", node_name="second")
            dest = root / "assembly.3mf"

            export_scene_3mf(
                scene,
                dest,
                source_path=root / "assembly.glb",
                multiplate=True,
                project_path=root,
                layout_filename="assembly.glb",
            )

            self.assertEqual(first.extents.tolist(), original_extents.tolist())
            with zipfile.ZipFile(dest) as zf:
                obj = ET.fromstring(zf.read("3D/Objects/object_1.model"))
                vertices = obj.findall(".//{*}vertex")
                coords = [
                    [float(vertex.attrib[key]) for key in ("x", "y", "z")]
                    for vertex in vertices
                ]
                lows = [min(row[axis] for row in coords) for axis in range(3)]
                highs = [max(row[axis] for row in coords) for axis in range(3)]
                sizes = [round(highs[axis] - lows[axis], 6) for axis in range(3)]
                centers = [round((highs[axis] + lows[axis]) / 2.0, 6) for axis in range(2)]
                root_model = ET.fromstring(zf.read("3D/3dmodel.model"))
                build_items = root_model.findall(".//{*}build/{*}item")
                settings = ET.fromstring(zf.read("Metadata/model_settings.config"))
                plate_ids = [
                    metadata.attrib["value"]
                    for metadata in settings.findall(".//plate/metadata")
                    if metadata.attrib.get("key") == "plater_id"
                ]

            self.assertEqual(sizes, [6.0, 12.0, 8.0])
            self.assertEqual(centers, [30.0, 40.0])
            self.assertEqual(round(lows[2], 6), 0.0)
            self.assertEqual(build_items[0].attrib["transform"], "1 0 0 0 1 0 0 0 1 307.2 0 0")
            self.assertEqual(plate_ids, ["1", "2"])

    def test_converts_nested_mesh_glb(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        glb = _box_glb(folder / "terminator spartan skull.glb")
        dest = convert_mesh_to_3mf(root, "mesh/terminator spartan skull.glb")
        self.assertTrue(dest.is_file())
        self.assertEqual(dest.name, "terminator spartan skull.3mf")
        self.assertEqual(dest.parent, folder)
        with zipfile.ZipFile(dest) as zf:
            names = set(zf.namelist())
        self.assertIn("3D/3dmodel.model", names)

    def test_lists_3mf_slot_before_file_exists(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        _box_glb(folder / "skull.glb")
        exports = list_exports_for_model(root, "mesh/skull.glb")
        three = next((item for item in exports if item["format"] == "3mf"), None)
        self.assertIsNotNone(three)
        self.assertEqual(three["name"], "mesh/skull.3mf")
        self.assertTrue(three.get("convertible"))

    def test_factory_uses_sibling_glb(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        _box_glb(folder / "clip.glb")
        (folder / "clip.mesh.mjs").write_text("export function create() {}", encoding="utf-8")
        dest = convert_mesh_to_3mf(root, "mesh/clip.mesh.mjs")
        self.assertTrue(dest.is_file())
        self.assertEqual(dest.suffix.lower(), ".3mf")

    def test_ensure_derived_export_writes_stl_and_3mf(self) -> None:
        from backend.services.cad_service import ensure_derived_export

        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        _box_glb(folder / "skull.glb")
        stl = ensure_derived_export(root, "mesh/skull.stl")
        self.assertIsNotNone(stl)
        self.assertTrue(stl.is_file())
        self.assertEqual(stl.name, "skull.stl")
        self.assertGreater(stl.stat().st_size, 0)
        three = ensure_derived_export(root, "mesh/skull.3mf")
        self.assertIsNotNone(three)
        self.assertTrue(three.is_file())
        self.assertEqual(three.name, "skull.3mf")
        self.assertGreater(three.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
