"""FreeCAD-style appearance: per-body ShapeColor, no empty-mesh IndexError."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh

from backend.services.cad_service import (
    _scene_to_single_mesh,
    load_mesh,
    paint_model_appearance,
    paintable_mesh_path,
)


def _box(name: str, *, translate: list[float] | None = None) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=[10.0, 8.0, 6.0])
    if translate:
        mesh.apply_translation(translate)
    mesh.metadata["name"] = name
    return mesh


def _write_scene(path: Path, geoms: list[tuple[str, trimesh.Trimesh]]) -> Path:
    scene = trimesh.Scene()
    for name, geom in geoms:
        scene.add_geometry(geom, geom_name=name, node_name=name)
    scene.export(str(path))
    return path


def _geom_rgb(geom) -> tuple[float, float, float] | None:
    mat = getattr(getattr(geom, "visual", None), "material", None)
    factor = getattr(mat, "baseColorFactor", None) if mat is not None else None
    if factor is not None:
        arr = np.asarray(factor, dtype=float).reshape(-1)
        if arr.size >= 3:
            if arr.max() > 1.5:
                arr = arr / 255.0
            return tuple(np.round(arr[:3], 2))
    fc = getattr(getattr(geom, "visual", None), "face_colors", None)
    if fc is not None and len(fc):
        return tuple(np.round(np.asarray(fc[0][:3], dtype=float) / 255.0, 2))
    vc = getattr(getattr(geom, "visual", None), "vertex_colors", None)
    if vc is not None and len(vc):
        return tuple(np.round(np.asarray(vc[0][:3], dtype=float) / 255.0, 2))
    return None


def _named_rgb(path: Path) -> dict[str, tuple[float, float, float] | None]:
    loaded = trimesh.load(str(path), force="scene")
    if isinstance(loaded, trimesh.Trimesh):
        return {path.stem: _geom_rgb(loaded)}
    out: dict[str, tuple[float, float, float] | None] = {}
    for name, geom in loaded.geometry.items():
        out[str(name)] = _geom_rgb(geom)
    return out


class PaintAppearanceTests(unittest.TestCase):
    def test_empty_scene_raises_value_error_not_index_error(self) -> None:
        empty = trimesh.Trimesh(
            vertices=np.zeros((0, 3)),
            faces=np.zeros((0, 3), dtype=np.int64),
            process=False,
        )
        scene = trimesh.Scene()
        scene.add_geometry(empty, geom_name="empty", node_name="empty")
        with self.assertRaises(ValueError) as ctx:
            _scene_to_single_mesh(scene, "empty.glb")
        self.assertIn("no mesh faces", str(ctx.exception).lower())

        root = Path(tempfile.mkdtemp())
        path = root / "empty.glb"
        _write_scene(path, [("empty", empty)])
        with self.assertRaises(ValueError):
            load_mesh(path)
        with self.assertRaises(ValueError):
            paint_model_appearance(path, color="#ff0000")

    def test_empty_plus_solid_does_not_crash_load_mesh(self) -> None:
        empty = trimesh.Trimesh(
            vertices=np.zeros((0, 3)),
            faces=np.zeros((0, 3), dtype=np.int64),
            process=False,
        )
        root = Path(tempfile.mkdtemp())
        path = root / "mixed.glb"
        _write_scene(path, [("empty", empty), ("body_1", _box("body_1", translate=[20.0, 0.0, 0.0]))])
        mesh = load_mesh(path)
        self.assertGreater(len(mesh.faces), 0)

    def test_shape_color_paints_selected_body_only(self) -> None:
        root = Path(tempfile.mkdtemp())
        path = root / "assembly.glb"
        _write_scene(
            path,
            [
                ("body_0", _box("body_0")),
                ("body_1", _box("body_1", translate=[20.0, 0.0, 0.0])),
            ],
        )
        before = _named_rgb(path)
        paint_model_appearance(path, color="#ff0000", scope="object", body_index=1)
        after = _named_rgb(path)
        self.assertEqual(after.get("body_1"), (1.0, 0.0, 0.0))
        self.assertEqual(after.get("body_0"), before.get("body_0"))

    def test_shape_color_unknown_body_name_falls_back_to_index(self) -> None:
        root = Path(tempfile.mkdtemp())
        path = root / "assembly.glb"
        _write_scene(
            path,
            [
                ("body_0", _box("body_0")),
                ("body_1", _box("body_1", translate=[20.0, 0.0, 0.0])),
            ],
        )
        paint_model_appearance(
            path,
            color="#00ff00",
            scope="object",
            body_index=1,
            body_name="Body 2",
        )
        after = _named_rgb(path)
        self.assertEqual(after.get("body_1"), (0.0, 1.0, 0.0))
        self.assertNotEqual(after.get("body_0"), (0.0, 1.0, 0.0))

    def test_face_color_uses_local_indices_on_selected_body(self) -> None:
        root = Path(tempfile.mkdtemp())
        path = root / "assembly.glb"
        _write_scene(
            path,
            [
                ("body_0", _box("body_0")),
                ("body_1", _box("body_1", translate=[20.0, 0.0, 0.0])),
            ],
        )
        paint_model_appearance(
            path,
            color="#0000ff",
            scope="faces",
            body_index=1,
            face_indices=[0],
        )
        loaded = trimesh.load(str(path), force="scene")
        body1 = loaded.geometry["body_1"]
        body0 = loaded.geometry["body_0"]
        fc1 = np.asarray(body1.visual.face_colors)
        fc0 = np.asarray(body0.visual.face_colors)
        self.assertTrue(np.array_equal(fc1[0][:3], np.array([0, 0, 255], dtype=np.uint8)))
        self.assertFalse(np.array_equal(fc0[0][:3], np.array([0, 0, 255], dtype=np.uint8)))

    def test_nested_mesh_path_is_paintable(self) -> None:
        root = Path(tempfile.mkdtemp())
        folder = root / "mesh"
        folder.mkdir()
        path = folder / "Terminator_Spartan_Head_Robotic_Openarm_2_edited.glb"
        _write_scene(
            path,
            [
                ("body_0", _box("body_0")),
                ("body_1", _box("body_1", translate=[20.0, 0.0, 0.0])),
            ],
        )
        self.assertEqual(paintable_mesh_path(root, path), path)
        paint_model_appearance(path, color="#ff0000", scope="object", body_index=0)
        after = _named_rgb(path)
        self.assertEqual(after.get("body_0"), (1.0, 0.0, 0.0))
        self.assertNotEqual(after.get("body_1"), (1.0, 0.0, 0.0))


if __name__ == "__main__":
    unittest.main()
