"""Regression coverage for lossless mesh edits and derivative exports."""

from __future__ import annotations

import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import trimesh

from backend.services import cad_service


def _write_scene(path: Path, *, repeated: bool = False) -> Path:
    scene = trimesh.Scene()
    left = trimesh.creation.box(extents=(10.0, 8.0, 6.0))
    left.visual.face_colors = np.tile([40, 80, 120, 255], (len(left.faces), 1))
    scene.add_geometry(left, geom_name="LeftBody", node_name="LeftBody")
    right = left if repeated else trimesh.creation.box(extents=(4.0, 5.0, 6.0))
    scene.add_geometry(
        right,
        geom_name="LeftBody" if repeated else "RightBody",
        node_name="RightBody",
        transform=trimesh.transformations.translation_matrix([20.0, 0.0, 0.0]),
    )
    scene.export(str(path))
    return path


def _decorate_structured_glb(path: Path) -> dict:
    document, version, chunks = cad_service._read_glb_document(path)
    scene_index = int(document.get("scene") or 0)
    scene = document["scenes"][scene_index]
    roots = list(scene.get("nodes") or [])
    pivot_index = len(document["nodes"])
    document["nodes"].append(
        {"name": "AnimatedPivot", "children": roots, "extras": {"nodeToken": "keep"}}
    )
    scene["nodes"] = [pivot_index]
    scene["extras"] = {"sceneToken": "keep"}
    document["animations"] = [{"name": "spin_AnimatedPivot", "channels": [], "samplers": []}]
    document["extras"] = {"documentToken": "keep"}
    document["materials"] = [
        {
            "name": "AdvancedMetal",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.2, 0.3, 0.4, 1.0],
                "metallicFactor": 0.8,
                "roughnessFactor": 0.25,
            },
            "extensions": {"KHR_materials_clearcoat": {"clearcoatFactor": 0.7}},
            "extras": {"materialToken": "keep"},
        }
    ]
    for mesh in document.get("meshes") or []:
        for primitive in mesh.get("primitives") or []:
            primitive["material"] = 0
    cad_service._write_glb_document(path, path, document, version=version, chunks=chunks)
    return document


def _model_extents_from_3mf(path: Path) -> tuple[float, float, float]:
    with zipfile.ZipFile(path) as archive:
        object_name = next(name for name in archive.namelist() if name.startswith("3D/Objects/"))
        root = ET.fromstring(archive.read(object_name))
    vertices = [
        [float(vertex.attrib[axis]) for axis in ("x", "y", "z")]
        for vertex in root.findall(".//{*}vertex")
    ]
    values = np.asarray(vertices, dtype=float)
    return tuple(float(value) for value in np.ptp(values, axis=0))


class MeshArtifactFidelityTests(unittest.TestCase):
    @staticmethod
    def _node_world_center(path: Path, node_name: str) -> np.ndarray:
        scene = cad_service.load_scene(path)
        world, geometry_name = scene.graph.get(node_name)
        geometry = scene.geometry[geometry_name]
        center = np.append(np.asarray(geometry.bounds, dtype=float).mean(axis=0), 1.0)
        return (np.asarray(world, dtype=float) @ center)[:3]

    def test_body_transform_preserves_parent_hierarchy_and_moves_only_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _write_scene(Path(tmp) / "structured.glb")
            _decorate_structured_glb(source)
            left_before = self._node_world_center(source, "LeftBody")
            right_before = self._node_world_center(source, "RightBody")

            cad_service.transform_scene_body(
                source,
                0,
                {"translation": [5.0, 0.0, 0.0]},
                body_name="LeftBody",
                out_path=source,
            )

            self.assertTrue(np.allclose(self._node_world_center(source, "LeftBody"), left_before + [5.0, 0.0, 0.0]))
            self.assertTrue(np.allclose(self._node_world_center(source, "RightBody"), right_before))
            document, _version, _chunks = cad_service._read_glb_document(source)
            self.assertEqual(document["animations"][0]["name"], "spin_AnimatedPivot")
            pivot = next(node for node in document["nodes"] if node.get("name") == "AnimatedPivot")
            self.assertEqual(pivot["extras"], {"nodeToken": "keep"})

    def test_repeated_glb_transforms_preserve_scene_and_accumulate_world_pose(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _write_scene(Path(tmp) / "structured.glb")
            _decorate_structured_glb(source)
            original = np.asarray(cad_service.load_scene(source).bounds, dtype=float)

            for _ in range(3):
                cad_service.apply_transform_preserving_parts(
                    source,
                    {"translation": [1.0, 2.0, 3.0]},
                    out_path=source,
                )

            moved = np.asarray(cad_service.load_scene(source).bounds, dtype=float)
            self.assertTrue(np.allclose(moved, original + np.array([1.0, 2.0, 3.0]) * 3.0))
            document, _version, _chunks = cad_service._read_glb_document(source)
            self.assertEqual(document["animations"][0]["name"], "spin_AnimatedPivot")
            self.assertEqual(len(document["meshes"]), 2)
            self.assertEqual(
                sum(bool((node or {}).get("extras", {}).get("renderStudioTransformWrapper")) for node in document["nodes"]),
                3,
            )

    def test_glb_transform_preserves_hierarchy_animation_extras_and_advanced_pbr(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _write_scene(Path(tmp) / "structured.glb")
            before = _decorate_structured_glb(source)
            output = source.with_name("transformed.glb")

            cad_service.apply_transform_preserving_parts(
                source,
                {"translation": [1.0, 2.0, 3.0], "rotation_deg": [0.0, 0.0, 15.0]},
                out_path=output,
            )

            after, _version, _chunks = cad_service._read_glb_document(output)
            self.assertEqual(after["animations"], before["animations"])
            self.assertEqual(after["extras"], before["extras"])
            self.assertEqual(after["scenes"][0]["extras"], before["scenes"][0]["extras"])
            self.assertEqual(after["nodes"][-2]["extras"], {"nodeToken": "keep"})
            self.assertEqual(after["materials"], before["materials"])
            self.assertEqual(len(after["meshes"]), len(before["meshes"]))
            self.assertTrue(after["nodes"][-1]["extras"]["renderStudioTransformWrapper"])

    def test_selected_body_paint_preserves_animation_extras_and_advanced_pbr(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _write_scene(Path(tmp) / "structured.glb")
            before = _decorate_structured_glb(source)
            output = source.with_name("painted.glb")

            cad_service.paint_model_appearance(
                source,
                color="#ff0000",
                scope="object",
                body_name="LeftBody",
                out_path=output,
            )

            after, _version, _chunks = cad_service._read_glb_document(output)
            self.assertEqual(after["animations"], before["animations"])
            self.assertEqual(after["extras"], before["extras"])
            self.assertEqual(
                [{key: value for key, value in node.items() if key != "mesh"} for node in after["nodes"]],
                [{key: value for key, value in node.items() if key != "mesh"} for node in before["nodes"]],
            )
            painted = after["materials"][-1]
            self.assertEqual(painted["pbrMetallicRoughness"]["baseColorFactor"], [1.0, 0.0, 0.0, 1.0])
            self.assertEqual(painted["pbrMetallicRoughness"]["metallicFactor"], 0.8)
            self.assertEqual(painted["extensions"], before["materials"][0]["extensions"])
            self.assertEqual(painted["extras"], {"materialToken": "keep"})

    def test_structured_topology_edits_are_rejected_before_flattening(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = _write_scene(Path(tmp) / "instances.glb", repeated=True)
            _decorate_structured_glb(source)

            with self.assertRaisesRegex(ValueError, "structured scene"):
                cad_service.assert_unstructured_mesh_edit_supported(source, "Mesh cleanup")
            with self.assertRaisesRegex(ValueError, "structured scene"):
                cad_service.assert_unstructured_mesh_edit_supported(source, "Mirror")

    def test_submillimeter_workspace_mesh_is_not_scaled_by_extent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scene = trimesh.Scene()
            scene.add_geometry(
                trimesh.creation.box(extents=(0.8, 0.4, 0.2)),
                geom_name="micro",
                node_name="micro",
            )
            source = root / "micro.glb"
            scene.export(str(source))
            output = cad_service.convert_mesh_to_3mf(root, source.name)

            self.assertTrue(np.allclose(sorted(_model_extents_from_3mf(output)), [0.2, 0.4, 0.8]))

    def test_explicit_meter_units_are_converted_to_millimeters(self) -> None:
        mesh = trimesh.creation.box(extents=(0.01, 0.02, 0.03))
        mesh.units = "m"
        prepared = cad_service._prepare_mesh_for_3mf(mesh)
        self.assertIsNotNone(prepared)
        self.assertTrue(np.allclose(sorted(prepared.extents), [10.0, 20.0, 30.0]))

    def test_preview_cache_uses_content_hash_not_mtime_and_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "colored.glb"
            mesh = trimesh.creation.box()
            mesh.visual.vertex_colors = np.tile([255, 0, 0, 255], (len(mesh.vertices), 1))
            mesh.export(source)
            first = cad_service._glb_preview_stats(source)
            self.assertGreater(first[2], 0)
            stat = source.stat()
            raw = source.read_bytes()
            self.assertIn(b"COLOR_0", raw)
            source.write_bytes(raw.replace(b"COLOR_0", b"COLOR_X"))
            os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns))

            second = cad_service._glb_preview_stats(source)
            self.assertEqual(first[:2], second[:2])
            self.assertEqual(second[2], 0)

    def test_obj_scene_export_preserves_named_groups_and_mtl_colors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "assembly.obj"
            scene = trimesh.Scene()
            red = trimesh.creation.box()
            red.visual = trimesh.visual.TextureVisuals(
                material=trimesh.visual.material.PBRMaterial(
                    name="RedMaterial", baseColorFactor=[255, 0, 0, 255]
                )
            )
            blue = trimesh.creation.box()
            blue.visual = trimesh.visual.TextureVisuals(
                material=trimesh.visual.material.PBRMaterial(
                    name="BlueMaterial", baseColorFactor=[0, 0, 255, 255]
                )
            )
            scene.add_geometry(red, geom_name="LeftBody", node_name="LeftBody")
            scene.add_geometry(blue, geom_name="RightBody", node_name="RightBody")

            cad_service.export_scene(scene, output)

            obj = output.read_text(encoding="utf-8")
            mtl = output.with_suffix(".mtl").read_text(encoding="utf-8")
            self.assertIn("o LeftBody", obj)
            self.assertIn("o RightBody", obj)
            self.assertIn("usemtl RedMaterial", obj)
            self.assertIn("usemtl BlueMaterial", obj)
            self.assertIn("newmtl RedMaterial", mtl)
            self.assertIn("newmtl BlueMaterial", mtl)

    def test_3mf_emits_part_base_material_color(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            mesh = trimesh.creation.box(extents=(10.0, 10.0, 10.0))
            mesh.visual.face_colors = np.tile([12, 34, 56, 255], (len(mesh.faces), 1))
            scene = trimesh.Scene(mesh)
            output = Path(tmp) / "colored.3mf"

            cad_service.export_scene_3mf(scene, output, multiplate=True)

            with zipfile.ZipFile(output) as archive:
                object_name = next(name for name in archive.namelist() if name.startswith("3D/Objects/"))
                model = ET.fromstring(archive.read(object_name))
            base = model.find(".//{*}basematerials/{*}base")
            obj = model.find(".//{*}object")
            self.assertIsNotNone(base)
            self.assertEqual(base.attrib["displaycolor"], "#0C2238FF")
            self.assertIn("pid", obj.attrib)
            self.assertEqual(obj.attrib.get("pindex"), "0")


if __name__ == "__main__":
    unittest.main()
