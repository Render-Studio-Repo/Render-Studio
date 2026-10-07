from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct

import numpy as np
import trimesh

from backend.services.cad_preview_optimizer import maybe_optimize_cad_preview


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _glb_document(path: Path) -> dict:
    payload = path.read_bytes()
    json_length, json_kind = struct.unpack_from("<II", payload, 12)
    assert json_kind == 0x4E4F534A
    return json.loads(payload[20 : 20 + json_length].decode("utf-8").rstrip(" \t\r\n\0"))


def _primitive_attributes(path: Path) -> list[dict]:
    document = _glb_document(path)
    return [
        primitive.get("attributes", {})
        for mesh in document.get("meshes", [])
        for primitive in mesh.get("primitives", [])
    ]


def _fragmented_scene(path: Path, count: int = 1200) -> None:
    scene = trimesh.Scene()
    for index in range(count):
        logical = "left_link" if index % 2 == 0 else "right_link"
        mesh = trimesh.creation.box((1.0, 1.0, 1.0))
        transform = np.eye(4)
        transform[0, 3] = float(index % 100)
        transform[1, 3] = float(index // 100)
        name = f"{logical}_{index:06x}"
        scene.add_geometry(mesh, geom_name=name, node_name=name, transform=transform)
    scene.export(path)


def test_batches_fragments_without_touching_step(tmp_path: Path) -> None:
    glb = tmp_path / "assembly.glb"
    step = tmp_path / "assembly.step"
    step.write_bytes(b"canonical-step-artifact")
    _fragmented_scene(glb)
    original_step_hash = _hash(step)
    original = trimesh.load(glb, force="scene", process=False)

    report = maybe_optimize_cad_preview(glb)

    optimized = trimesh.load(glb, force="scene", process=False)
    assert report.applied is True
    assert report.before.objects == 1200
    assert report.after.objects == 2
    assert report.before.triangles == report.after.triangles
    assert np.allclose(original.bounds, optimized.bounds)
    assert set(optimized.graph.nodes_geometry) == {"left_link", "right_link"}
    assert _hash(step) == original_step_hash
    assert glb.with_suffix(".preview-optimization.json").is_file()
    assert glb.with_name(".assembly.unoptimized.glb").is_file()


def test_small_preview_is_byte_identical(tmp_path: Path) -> None:
    glb = tmp_path / "small.glb"
    _fragmented_scene(glb, count=12)
    before = glb.read_bytes()
    report = maybe_optimize_cad_preview(glb)
    assert report.applied is False
    assert report.reason == "below-object-threshold"
    assert glb.read_bytes() == before


def test_optimized_glb_keeps_normals_and_fragment_colors(tmp_path: Path) -> None:
    glb = tmp_path / "colored.glb"
    scene = trimesh.Scene()
    expected_colors = {(255, 0, 0, 255), (0, 255, 0, 255)}
    for index, color in enumerate(expected_colors):
        for fragment in range(2):
            mesh = trimesh.creation.box((1.0, 1.0, 1.0))
            mesh.visual.face_colors = color
            transform = np.eye(4)
            transform[0, 3] = float(index * 3 + fragment)
            name = f"colored_part_{index}_{fragment:06x}"
            scene.add_geometry(mesh, geom_name=name, node_name=name, transform=transform)
    scene.export(glb)

    report = maybe_optimize_cad_preview(glb, minimum_objects=1, minimum_reduction_ratio=0.0)

    optimized = trimesh.load(glb, force="scene", process=False)
    exported_colors = {
        tuple(int(channel) for channel in color)
        for geometry in optimized.geometry.values()
        for color in np.asarray(geometry.visual.face_colors)
    }
    assert report.applied is True
    assert all("NORMAL" in attributes for attributes in _primitive_attributes(glb))
    assert exported_colors == expected_colors
