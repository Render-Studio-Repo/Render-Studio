"""Non-destructive optimization for large, static CAD viewport previews.

The STEP and source artifacts are never opened for writing.  This module only
replaces a derived GLB after the replacement proves geometry and logical-part
parity with the original preview.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import tempfile
from typing import Any

import numpy as np
import trimesh


_FRAGMENT_SUFFIX = re.compile(r"_[0-9a-f]{5,10}$", re.IGNORECASE)


@dataclass(frozen=True)
class PreviewComplexity:
    objects: int
    triangles: int
    logical_parts: int
    bytes: int


@dataclass(frozen=True)
class PreviewOptimizationReport:
    applied: bool
    reason: str
    before: PreviewComplexity
    after: PreviewComplexity
    source_sha256: str
    optimized_sha256: str
    manifest_path: str | None = None
    rollback_path: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def logical_part_name(name: str) -> str:
    """Return the stable CAD body name used by Studio selection grouping."""
    value = _FRAGMENT_SUFFIX.sub("", str(name or "").strip())
    return value or "cad_part"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _glb_document(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        header = handle.read(12)
        if len(header) != 12 or header[:4] != b"glTF":
            raise ValueError("preview is not a binary glTF")
        length, kind = struct.unpack("<II", handle.read(8))
        if kind != 0x4E4F534A:
            raise ValueError("GLB has no JSON document")
        return json.loads(handle.read(length).decode("utf-8").rstrip(" \t\r\n\0"))


def _scene_facts(scene: trimesh.Scene, size: int) -> PreviewComplexity:
    nodes = list(scene.graph.nodes_geometry)
    triangles = sum(len(scene.geometry[scene.graph.get(node)[1]].faces) for node in nodes)
    logical = {logical_part_name(node) for node in nodes}
    return PreviewComplexity(len(nodes), int(triangles), len(logical), int(size))


def _bounds(scene: trimesh.Scene) -> np.ndarray:
    value = np.asarray(scene.bounds, dtype=np.float64)
    if value.shape != (2, 3) or not np.isfinite(value).all():
        raise ValueError("preview has invalid world bounds")
    return value


def _color_signature(scene: trimesh.Scene) -> Counter[tuple[int, int, int, int]]:
    colors: Counter[tuple[int, int, int, int]] = Counter()
    for node in scene.graph.nodes_geometry:
        geometry_name = scene.graph.get(node)[1]
        mesh = scene.geometry[geometry_name]
        visual = mesh.visual
        if hasattr(visual, "to_color"):
            continue
        face_colors = np.asarray(visual.face_colors, dtype=np.uint8)
        colors.update(tuple(int(channel) for channel in color) for color in face_colors)
    return colors


def _has_complete_normals(document: dict[str, Any]) -> bool:
    accessors = document.get("accessors", [])
    primitives = [
        primitive
        for mesh in document.get("meshes", [])
        for primitive in mesh.get("primitives", [])
    ]
    if not primitives:
        return False
    for primitive in primitives:
        attributes = primitive.get("attributes", {})
        position_index = attributes.get("POSITION")
        normal_index = attributes.get("NORMAL")
        if not isinstance(position_index, int) or not isinstance(normal_index, int):
            return False
        try:
            position = accessors[position_index]
            normal = accessors[normal_index]
        except (IndexError, TypeError):
            return False
        if position.get("count") != normal.get("count") or normal.get("type") != "VEC3":
            return False
    return True


def maybe_optimize_cad_preview(
    glb_path: Path,
    *,
    minimum_objects: int = 1000,
    minimum_reduction_ratio: float = 0.25,
) -> PreviewOptimizationReport:
    """Batch fragments by logical CAD part and atomically replace a laggy GLB.

    Each output mesh is one logical selectable part.  A sidecar records the
    original node-to-part mapping.  Animation and skin data fail closed because
    this optimization is intended only for static CAD previews.
    """
    path = Path(glb_path)
    source_hash = _sha256(path)
    document = _glb_document(path)
    scene = trimesh.load(path, force="scene", process=False)
    if not isinstance(scene, trimesh.Scene):
        scene = trimesh.Scene(scene)
    before = _scene_facts(scene, path.stat().st_size)
    if document.get("animations") or document.get("skins"):
        return PreviewOptimizationReport(False, "animated-or-skinned", before, before, source_hash, source_hash)
    if before.objects < minimum_objects:
        return PreviewOptimizationReport(False, "below-object-threshold", before, before, source_hash, source_hash)

    groups: dict[str, list[trimesh.Trimesh]] = {}
    mapping: dict[str, str] = {}
    for node in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph.get(node)
        mesh = scene.geometry[geometry_name].copy()
        mesh.apply_transform(transform)
        logical_name = logical_part_name(node)
        groups.setdefault(logical_name, []).append(mesh)
        mapping[str(node)] = logical_name

    projected = len(groups)
    if projected > int(before.objects * (1.0 - minimum_reduction_ratio)):
        return PreviewOptimizationReport(False, "insufficient-object-reduction", before, before, source_hash, source_hash)

    optimized = trimesh.Scene()
    used: set[str] = set()
    for logical_name, meshes in groups.items():
        merged = trimesh.util.concatenate(meshes)
        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", logical_name).strip("_") or "cad_part"
        candidate = safe_name
        suffix = 2
        while candidate in used:
            candidate = f"{safe_name}_{suffix}"
            suffix += 1
        used.add(candidate)
        optimized.add_geometry(merged, geom_name=candidate, node_name=candidate)

    source_bounds = _bounds(scene)
    source_colors = _color_signature(scene)
    optimized_bounds = _bounds(optimized)
    if not np.allclose(source_bounds, optimized_bounds, rtol=1e-7, atol=1e-5):
        raise ValueError("optimized preview changed world bounds")

    with tempfile.NamedTemporaryFile(prefix=f".{path.stem}-", suffix=".glb", dir=path.parent, delete=False) as handle:
        candidate_path = Path(handle.name)
    manifest_path = path.with_suffix(".preview-optimization.json")
    rollback_path = path.with_name(f".{path.stem}.unoptimized.glb")
    temp_manifest: Path | None = None
    temp_rollback: Path | None = None
    try:
        candidate_path.write_bytes(trimesh.exchange.gltf.export_glb(optimized, include_normals=True))
        candidate_document = _glb_document(candidate_path)
        if not _has_complete_normals(candidate_document):
            raise ValueError("optimized preview has incomplete vertex normals")
        check = trimesh.load(candidate_path, force="scene", process=False)
        if not isinstance(check, trimesh.Scene):
            check = trimesh.Scene(check)
        after = _scene_facts(check, candidate_path.stat().st_size)
        if after.triangles != before.triangles:
            raise ValueError("optimized preview changed triangle coverage")
        if after.logical_parts != before.logical_parts or after.objects != projected:
            raise ValueError("optimized preview changed logical-part identity")
        if not np.allclose(source_bounds, _bounds(check), rtol=1e-7, atol=1e-5):
            raise ValueError("exported optimized preview changed world bounds")
        if source_colors != _color_signature(check):
            raise ValueError("optimized preview changed material colors")
        optimized_hash = _sha256(candidate_path)
        manifest = {
            "version": 1,
            "source_glb_sha256": source_hash,
            "optimized_glb_sha256": optimized_hash,
            "before": asdict(before),
            "after": asdict(after),
            "source_node_to_logical_part": mapping,
        }
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", prefix=f".{path.stem}-", suffix=".json", dir=path.parent, delete=False
        ) as handle:
            json.dump(manifest, handle, indent=2, sort_keys=True)
            handle.write("\n")
            temp_manifest = Path(handle.name)
        with tempfile.NamedTemporaryFile(
            prefix=f".{path.stem}-rollback-", suffix=".glb", dir=path.parent, delete=False
        ) as handle:
            temp_rollback = Path(handle.name)
        shutil.copyfile(path, temp_rollback)
        os.replace(temp_rollback, rollback_path)
        os.replace(candidate_path, path)
        os.replace(temp_manifest, manifest_path)
        return PreviewOptimizationReport(
            True, "optimized", before, after, source_hash, optimized_hash,
            str(manifest_path), str(rollback_path)
        )
    finally:
        candidate_path.unlink(missing_ok=True)
        if temp_manifest is not None:
            temp_manifest.unlink(missing_ok=True)
        if temp_rollback is not None:
            temp_rollback.unlink(missing_ok=True)
