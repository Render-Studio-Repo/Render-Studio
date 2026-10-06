"""Parametric CAD edits via the FeatureProgram kernel (build123d → OCCT).

Live Extrude / Pad / Pocket / Fillet / Chamfer should append features and
rebuild B-rep solids — not mutate tessellated meshes with manifold CSG.

Mesh face-pull remains available as a fallback for imported GLBs that have no
``.program.json``. This module must not be used by AI model-generation paths.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


def _load_program(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("parts"), list) or not data["parts"]:
        raise ValueError(f"Invalid FeatureProgram: {path.name}")
    return data


def _primary_part(program: dict[str, Any]) -> dict[str, Any]:
    parts = program.get("parts") or []
    if not parts:
        raise ValueError("FeatureProgram has no parts")
    return parts[0]


def _program_basename(program_path: Path) -> str:
    """Stem for ``foo.program.json`` → ``foo`` (Path.stem alone leaves ``foo.program``)."""
    name = program_path.name
    if name.endswith(".program.json"):
        return name[: -len(".program.json")]
    return program_path.stem


def _rebuild(program: dict[str, Any], project_path: Path, basename: str) -> dict[str, Any]:
    from backend.services.kernel_bridge import build_and_export

    program = dict(program)
    program["name"] = basename
    result = build_and_export(program, project_path, basename=basename)
    return result


def _orthonormal_basis(normal: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = np.asarray(normal, dtype=float)
    n = n / (np.linalg.norm(n) + 1e-15)
    # Stable tangent pick (same idea as Three.js / OCCT helpers).
    axis = np.array([0.0, 0.0, 1.0] if abs(n[2]) < 0.9 else [1.0, 0.0, 0.0])
    u = np.cross(axis, n)
    u = u / (np.linalg.norm(u) + 1e-15)
    v = np.cross(n, u)
    v = v / (np.linalg.norm(v) + 1e-15)
    return u, v, n


def _ordered_boundary_loop(mesh, region: list[int]) -> list[np.ndarray]:
    """Return an ordered 3D polyline for the outer boundary of a planar region."""
    faces = mesh.faces[np.asarray(region, dtype=int)]
    from collections import defaultdict

    edge_faces: dict[tuple[int, int], int] = defaultdict(int)
    for a, b, c in faces:
        for u, v in ((int(a), int(b)), (int(b), int(c)), (int(c), int(a))):
            key = (u, v) if u < v else (v, u)
            edge_faces[key] += 1
    boundary = [e for e, count in edge_faces.items() if count == 1]
    if len(boundary) < 3:
        raise ValueError("Face region has no usable boundary loop")

    adj: dict[int, list[int]] = defaultdict(list)
    for a, b in boundary:
        adj[a].append(b)
        adj[b].append(a)

    start = next(iter(adj))
    loop = [start]
    prev = None
    cur = start
    for _ in range(len(boundary) + 2):
        nxts = [x for x in adj[cur] if x != prev]
        if not nxts:
            break
        # Prefer continuing without sharp backtracking when valence > 2.
        nxt = nxts[0]
        if len(nxts) > 1 and prev is not None:
            p = mesh.vertices[prev]
            c = mesh.vertices[cur]
            best = None
            best_dot = -2.0
            forward = c - p
            fn = float(np.linalg.norm(forward)) or 1.0
            forward = forward / fn
            for cand in nxts:
                d = mesh.vertices[cand] - c
                dn = float(np.linalg.norm(d)) or 1.0
                dot = float(np.dot(forward, d / dn))
                if dot > best_dot:
                    best_dot = dot
                    best = cand
            nxt = best if best is not None else nxts[0]
        if nxt == start:
            break
        loop.append(nxt)
        prev, cur = cur, nxt
    if len(loop) < 3:
        raise ValueError("Could not order face boundary")
    return [np.asarray(mesh.vertices[i], dtype=float) for i in loop]


def face_region_to_extrude_feature(
    mesh,
    face_index: int,
    *,
    distance: float,
    op: str = "auto",
    normal: list[float] | None = None,
    through: bool = False,
) -> dict[str, Any]:
    """Build an ``extrude`` Feature dict (mm) for a planar mesh face region."""
    from backend.services.cad_service import _body_for_face, _coplanar_region_faces, _mesh_bodies, repair_mesh, mesh_copy

    m = repair_mesh(mesh_copy(mesh))
    bodies = _mesh_bodies(m)
    body_i, local_fi = _body_for_face(bodies, int(face_index))
    target = bodies[body_i]
    region, n = _coplanar_region_faces(target, local_fi)
    if normal is not None and len(normal) >= 3:
        hint = np.asarray(normal[:3], dtype=float)
        hn = float(np.linalg.norm(hint))
        if hn > 1e-12 and float(np.dot(n, hint / hn)) < 0:
            n = -n

    mode = (op or "auto").lower()
    d = float(distance)
    if mode == "auto":
        mode = "cut" if d < 0 else "join"
    if mode in ("join", "add"):
        combine = "add"
        amount = abs(d)
        extrude_dir = n
    elif mode == "cut":
        combine = "cut"
        if through:
            span = float(np.linalg.norm(target.extents)) + 2.0
            amount = max(abs(d), span)
        else:
            amount = abs(d) if abs(d) > 1e-12 else 1.0
        # Cut prism goes into the solid (opposite outward normal).
        extrude_dir = -n
    elif mode == "intersect":
        combine = "intersect"
        amount = abs(d)
        extrude_dir = n
    else:
        raise ValueError(f"Kernel face pad does not support op={op!r}; use mesh fallback")

    if amount <= 1e-9:
        raise ValueError("Pad/Pocket length must be > 0")

    pts3 = _ordered_boundary_loop(target, region)
    origin = pts3[0]
    u, v, nn = _orthonormal_basis(extrude_dir)
    # Keep winding consistent with extrude direction.
    profile = []
    for p in pts3:
        dlt = p - origin
        profile.append([float(np.dot(dlt, u)), float(np.dot(dlt, v))])
    # Close / drop duplicate end
    if len(profile) >= 2:
        if math.hypot(profile[0][0] - profile[-1][0], profile[0][1] - profile[-1][1]) < 1e-6:
            profile = profile[:-1]
    if len(profile) < 3:
        raise ValueError("Face profile needs at least 3 points")

    # Ensure CCW relative to extrude normal for a positive solid.
    area2 = 0.0
    for i, (x0, y0) in enumerate(profile):
        x1, y1 = profile[(i + 1) % len(profile)]
        area2 += x0 * y1 - x1 * y0
    if area2 < 0:
        profile = list(reversed(profile))

    return {
        "op": "extrude",
        "combine": combine,
        "id": f"face-pad-{int(face_index)}",
        "profile": profile,
        "height": float(amount),
        "plane_ref": {
            "origin": [float(origin[0]), float(origin[1]), float(origin[2])],
            "u_axis": [float(u[0]), float(u[1]), float(u[2])],
            "normal": [float(nn[0]), float(nn[1]), float(nn[2])],
        },
    }


def apply_face_pad(
    project_path: Path,
    program_path: Path,
    mesh_path: Path,
    *,
    face_index: int,
    distance: float,
    op: str = "auto",
    normal: list[float] | None = None,
    through: bool = False,
) -> dict[str, Any]:
    """Append a face Pad/Pocket extrude to the FeatureProgram and rebuild."""
    import trimesh

    program = _load_program(program_path)
    mesh = trimesh.load(mesh_path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(tuple(mesh.geometry.values()))
    feat = face_region_to_extrude_feature(
        mesh,
        face_index,
        distance=distance,
        op=op,
        normal=normal,
        through=through,
    )
    part = _primary_part(program)
    features = list(part.get("features") or [])
    features.append(feat)
    part["features"] = features
    basename = _program_basename(program_path)
    result = _rebuild(program, project_path, basename)
    result["pipeline"] = "kernel"
    result["feature"] = feat
    return result


def apply_program_fillet(
    project_path: Path,
    program_name: str,
    radius_mm: float,
    *,
    edges: str = "all",
) -> Path:
    """Append a fillet feature and rebuild. Returns the output GLB path."""
    prog_path = Path(program_name)
    if not prog_path.is_absolute():
        prog_path = project_path / prog_path
    if prog_path.suffix != ".json":
        # callers sometimes pass just the file name
        if not str(program_name).endswith(".program.json"):
            candidate = project_path / f"{Path(program_name).stem}.program.json"
            if candidate.is_file():
                prog_path = candidate
    program = _load_program(prog_path)
    part = _primary_part(program)
    part.setdefault("features", []).append(
        {"op": "fillet", "combine": "add", "radius": float(radius_mm), "edges": edges or "all"}
    )
    basename = _program_basename(prog_path)
    result = _rebuild(program, project_path, basename)
    glb = project_path / result["primary"]
    return glb


def apply_program_chamfer(
    project_path: Path,
    program_name: str,
    length_mm: float,
    *,
    edges: str = "all",
) -> Path:
    """Append a chamfer feature and rebuild. Returns the output GLB path."""
    prog_path = Path(program_name)
    if not prog_path.is_absolute():
        prog_path = project_path / prog_path
    if prog_path.suffix != ".json":
        if not str(program_name).endswith(".program.json"):
            candidate = project_path / f"{Path(program_name).stem}.program.json"
            if candidate.is_file():
                prog_path = candidate
    program = _load_program(prog_path)
    part = _primary_part(program)
    part.setdefault("features", []).append(
        {"op": "chamfer", "combine": "add", "length": float(length_mm), "edges": edges or "all"}
    )
    basename = _program_basename(prog_path)
    result = _rebuild(program, project_path, basename)
    return project_path / result["primary"]


def can_use_kernel_face_pad(
    *,
    op: str,
    direction: str = "one",
    taper_deg: float = 0.0,
) -> bool:
    """Whether a live Press-Pull gesture should use the FeatureProgram kernel."""
    mode = (op or "auto").lower()
    if mode in ("new_body",):
        return False
    if str(direction or "one").lower() not in ("one", ""):
        return False
    if abs(float(taper_deg or 0.0)) > 1e-9:
        return False
    return mode in ("auto", "join", "add", "cut", "intersect")
