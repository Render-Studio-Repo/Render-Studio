"""Evidence required to publish a Mesh candidate."""

from __future__ import annotations

import base64
import hashlib
import io
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
from PIL import Image


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_mesh(path: Path) -> dict[str, Any]:
    scene = trimesh.load(str(path), force="scene", process=False)
    bounds = []
    triangles = 0
    for node in scene.graph.nodes_geometry:
        matrix, name = scene.graph[node]
        mesh = scene.geometry[name]
        if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces):
            raise ValueError("Mesh occurrence contains no triangles")
        points = trimesh.transform_points(mesh.vertices, matrix)
        if not np.isfinite(points).all():
            raise ValueError("Mesh contains nonfinite coordinates")
        faces = points[mesh.faces]
        area = np.linalg.norm(np.cross(faces[:, 1] - faces[:, 0], faces[:, 2] - faces[:, 0]), axis=1)
        if not np.any(area > 1e-12):
            raise ValueError("Mesh occurrence has only degenerate triangles")
        bounds.append((points.min(axis=0), points.max(axis=0)))
        triangles += len(mesh.faces)
    if not bounds:
        raise ValueError("Mesh has no visible triangle geometry")
    minimum = np.min([b[0] for b in bounds], axis=0)
    maximum = np.max([b[1] for b in bounds], axis=0)
    return {"bounds": [minimum.tolist(), maximum.tolist()], "triangles": triangles, "instances": len(bounds)}


def snapshot_payloads(project_path: Path, info: dict[str, Any]) -> list[dict[str, Any]]:
    files = info.get("files")
    if info.get("up_axis") != "z" or not isinstance(files, dict):
        raise ValueError("Mesh review requires final GLB Z-up views")
    result = []
    for view in ("iso", "top", "front"):
        path = (project_path / str(files.get(view) or "")).resolve()
        if not path.is_relative_to(project_path.resolve()) or not path.is_file():
            raise ValueError(f"Missing current-run {view} snapshot")
        blob = path.read_bytes()
        with Image.open(io.BytesIO(blob)) as im:
            im.verify()
        result.append({"data_url": "data:image/png;base64," + base64.b64encode(blob).decode(),
                       "name": f"Final GLB {view} (Z-up)", "sha256": hashlib.sha256(blob).hexdigest()})
    return result


def candidate_manifest(source: Path, glb: Path, *, run_id: str, runtime: dict[str, Any]) -> dict[str, Any]:
    return {"schema": 1, "run_id": run_id, "source_sha256": file_hash(source),
            "glb_sha256": file_hash(glb), "geometry": inspect_mesh(glb), "runtime": runtime}


def verify_manifest(source: Path, glb: Path, manifest: dict[str, Any], run_id: str) -> None:
    if manifest.get("run_id") != run_id or manifest.get("review_passed") is not True:
        raise ValueError("Mesh candidate lacks current-run visual acceptance")
    if file_hash(source) != manifest.get("source_sha256") or file_hash(glb) != manifest.get("glb_sha256"):
        raise ValueError("Mesh candidate changed after inspection or review")
    inspect_mesh(glb)
