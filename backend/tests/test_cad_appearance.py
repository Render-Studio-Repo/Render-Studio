"""Workbench fills: no whole-file pink hash, no rainbow on OCC face dumps."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh

from backend.services.cad_service import (
    DEFAULT_APPEARANCE_PALETTE,
    _colors_are_default_grey,
    _ensure_default_appearance,
    _is_occ_face_dump_scene,
    _palette_color_for_name,
    _prompt_appearance_palette,
    _prompt_hex_colors,
    _rgba_is_neutral_grey,
    _semantic_color_for_name,
    apply_prompt_appearance,
    colorize_assembly_glb_parts,
)


SALMON = np.array([0xF4, 0xA7, 0xA7, 255], dtype=np.uint8)
MAGENTA = np.array([0xF2, 0xA7, 0xD9, 255], dtype=np.uint8)
FILL_0 = DEFAULT_APPEARANCE_PALETTE[0]


def _box_scene(n: int, *, faces: int = 12) -> trimesh.Scene:
    scene = trimesh.Scene()
    for i in range(n):
        mesh = trimesh.creation.box(extents=[10.0, 8.0, 6.0])
        if faces <= 2:
            mesh.faces = mesh.faces[: max(1, faces)]
        scene.add_geometry(mesh, geom_name=f"body_{i:02d}", node_name=f"body_{i:02d}")
    return scene


class CadAppearanceTests(unittest.TestCase):
    def test_terminator_filename_is_not_salmon_or_magenta(self) -> None:
        color = _palette_color_for_name("Terminator_Spartan_Head_Robotic_Openarm_2")
        self.assertFalse(np.array_equal(color[:3], SALMON[:3]))
        self.assertFalse(np.array_equal(color[:3], MAGENTA[:3]))

    def test_uncoloured_mesh_uses_fill_0_not_a_hash(self) -> None:
        mesh = trimesh.creation.box(extents=[20.0, 10.0, 8.0])
        styled = _ensure_default_appearance(mesh, seed="Terminator_Spartan_Head_Robotic_Openarm_2")
        face0 = np.asarray(styled.visual.face_colors[0], dtype=np.uint8)
        self.assertTrue(np.array_equal(face0[:3], FILL_0[:3]))

    def test_openarm_name_uses_workbench_fill_0(self) -> None:
        color = _semantic_color_for_name("OpenArm_2.0_official_fit_master")
        self.assertIsNotNone(color)
        self.assertTrue(np.array_equal(color[:3], FILL_0[:3]))

    def test_named_solids_over_48_are_not_face_dumps(self) -> None:
        scene = _box_scene(60, faces=12)
        self.assertFalse(_is_occ_face_dump_scene(scene))

    def test_eighty_tiny_triangle_nodes_are_dumps(self) -> None:
        scene = _box_scene(80, faces=2)
        self.assertTrue(_is_occ_face_dump_scene(scene))

    def test_thousands_of_tiny_faces_are_dumps(self) -> None:
        scene = _box_scene(200, faces=2)
        self.assertTrue(_is_occ_face_dump_scene(scene))

    def test_colorize_paints_60_named_solids(self) -> None:
        root = Path(tempfile.mkdtemp())
        path = root / "assembly.glb"
        scene = _box_scene(60, faces=12)
        scene.export(str(path))
        self.assertTrue(colorize_assembly_glb_parts(path, force=True))
        loaded = trimesh.load(str(path), force="scene")
        colors = set()
        for geom in loaded.geometry.values():
            mat = getattr(getattr(geom, "visual", None), "material", None)
            factor = getattr(mat, "baseColorFactor", None) if mat is not None else None
            if factor is None:
                continue
            arr = np.asarray(factor, dtype=float).reshape(-1)
            if arr.max() > 1.5:
                arr = arr / 255.0
            colors.add(tuple(np.round(arr[:3], 3)))
        self.assertEqual(len(colors), 1)  # Unknown parts share a neutral finish, not a colour cycle.

    def test_white_face_colors_are_unauthored(self) -> None:
        white = np.tile(np.array([255, 255, 255, 255], dtype=np.uint8), (12, 1))
        self.assertTrue(_colors_are_default_grey(white))
        self.assertTrue(_rgba_is_neutral_grey((1.0, 1.0, 1.0, 1.0)))
        # Shop aluminum must not be treated as exporter grey.
        alum = np.array([0xC0, 0xC6, 0xCC, 255], dtype=np.uint8)
        self.assertFalse(_colors_are_default_grey(np.tile(alum, (8, 1))))
        self.assertFalse(_rgba_is_neutral_grey((0xC0 / 255.0, 0xC6 / 255.0, 0xCC / 255.0, 1.0)))

    def test_improve_prompt_hexes_drive_palette(self) -> None:
        hexes = _prompt_hex_colors(
            "NEMA mount: colors: housing aluminum #c0c6cc, hardware black-oxide #3a3f44"
        )
        self.assertEqual(len(hexes), 2)
        self.assertEqual(tuple(hexes[0][:3]), (0xC0, 0xC6, 0xCC))
        self.assertEqual(tuple(hexes[1][:3]), (0x3A, 0x3F, 0x44))
        pal = _prompt_appearance_palette(
            "motor mount colors: plate aluminum #c0c6cc, screws #3a3f44"
        )
        self.assertEqual(tuple(pal[0][:3]), (0xC0, 0xC6, 0xCC))

    def test_white_mesh_gets_shop_or_prompt_color(self) -> None:
        mesh = trimesh.creation.box(extents=[20.0, 10.0, 8.0])
        mesh.visual.face_colors = np.tile(
            np.array([255, 255, 255, 255], dtype=np.uint8), (len(mesh.faces), 1)
        )
        styled = apply_prompt_appearance(
            mesh,
            "Motor mount: colors: housing aluminum #c0c6cc",
            seed="motor_mount",
        )
        face0 = np.asarray(styled.visual.face_colors[0], dtype=np.uint8)
        self.assertEqual(tuple(face0[:3]), (0xC0, 0xC6, 0xCC))

    def test_colorize_replaces_white_pbr(self) -> None:
        root = Path(tempfile.mkdtemp())
        path = root / "white_assy.glb"
        scene = _box_scene(4, faces=12)
        try:
            from trimesh.visual.material import PBRMaterial
            from trimesh.visual.texture import TextureVisuals
        except Exception:
            self.skipTest("trimesh PBR materials unavailable")
        for geom in scene.geometry.values():
            geom.visual = TextureVisuals(
                material=PBRMaterial(baseColorFactor=np.array([1.0, 1.0, 1.0, 1.0]))
            )
        scene.export(str(path))
        self.assertTrue(
            colorize_assembly_glb_parts(
                path,
                force=True,
                prompt="colors: plate aluminum #c0c6cc, insert steel #8a939d",
            )
        )
        loaded = trimesh.load(str(path), force="scene")
        whites = 0
        for geom in loaded.geometry.values():
            mat = getattr(getattr(geom, "visual", None), "material", None)
            factor = getattr(mat, "baseColorFactor", None) if mat is not None else None
            if factor is None:
                continue
            arr = np.asarray(factor, dtype=float).reshape(-1)
            if arr.max() > 1.5:
                arr = arr / 255.0
            if float(arr[:3].mean()) > 0.92:
                whites += 1
        self.assertEqual(whites, 0)


if __name__ == "__main__":
    unittest.main()
