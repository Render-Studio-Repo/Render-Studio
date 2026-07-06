"""CAD mesh operations: load, export, and build primitives from AI actions."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import trimesh

logger = logging.getLogger(__name__)

SUPPORTED_IMPORT = {".stl", ".obj", ".glb", ".gltf", ".ply", ".off"}
SUPPORTED_EXPORT = {".stl", ".glb", ".obj"}


def project_dir(base: Path, project_id: str) -> Path:
    path = base / project_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_project_files(project_path: Path) -> list[dict[str, Any]]:
    files = []
    for f in sorted(project_path.iterdir()):
        if f.is_file() and f.suffix.lower() in SUPPORTED_IMPORT | SUPPORTED_EXPORT:
            if f.name.startswith("_active_"):
                continue
            files.append(
                {
                    "id": f.stem,
                    "name": f.name,
                    "format": f.suffix.lower().lstrip("."),
                    "size": f.stat().st_size,
                }
            )
    return files


def load_mesh(path: Path) -> trimesh.Trimesh:
    mesh = trimesh.load(path, force="mesh")
    if isinstance(mesh, trimesh.Scene):
        mesh = mesh.dump(concatenate=True)
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Could not load mesh from {path}")
    return repair_mesh(mesh)


def _bake_face_colors_to_vertices(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Assign vertex colors from face_colors without scipy (needed for GLB export)."""
    fc = _snapshot_face_colors(mesh)
    if fc is None:
        return mesh
    m = mesh_copy(mesh)
    n = len(m.vertices)
    accum = np.zeros((n, 4), dtype=np.float64)
    counts = np.zeros(n, dtype=np.float64)
    for fi, face in enumerate(m.faces):
        for vi in face:
            accum[vi] += fc[fi]
            counts[vi] += 1.0
    mask = counts > 0
    vertex_rgba = np.tile(np.array([196, 196, 196, 255], dtype=np.uint8), (n, 1))
    if np.any(mask):
        blended = (accum[mask] / counts[mask, None]).astype(np.uint8)
        vertex_rgba[mask] = blended
    m.visual.vertex_colors = vertex_rgba
    return m


def export_mesh(mesh: trimesh.Trimesh, path: Path) -> Path:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXPORT:
        path = path.with_suffix(".glb")
    out = mesh
    if suffix in {".glb", ".gltf"} and _snapshot_face_colors(mesh) is not None:
        out = _bake_face_colors_to_vertices(mesh)
    out.export(path)
    return path


def _snapshot_face_colors(mesh: trimesh.Trimesh) -> np.ndarray | None:
    try:
        fc = getattr(mesh.visual, "face_colors", None)
        if fc is not None and len(fc) == len(mesh.faces):
            return np.asarray(fc, dtype=np.uint8).copy()
    except Exception:
        pass
    return None


def mesh_copy(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Copy geometry without pulling scipy via ColorVisual.vertex_colors."""
    colors = _snapshot_face_colors(mesh)
    m = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices, dtype=float),
        faces=np.asarray(mesh.faces, dtype=int),
        process=False,
    )
    if colors is not None:
        m.visual.face_colors = colors
    return m


def mesh_uses_millimeters(mesh: trimesh.Trimesh) -> bool:
    """Heuristic: kernel/exported parts are mm; legacy trimesh primitives are meters."""
    try:
        return float(max(mesh.extents)) >= 1.0
    except Exception:
        return False


def length_from_mm(mesh: trimesh.Trimesh, mm: float) -> float:
    """Convert a millimeter dimension to the mesh's native length units."""
    return float(mm) if mesh_uses_millimeters(mesh) else float(mm) / 1000.0


def repair_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Best-effort cleanup so booleans are less likely to fail."""
    m = mesh_copy(mesh)
    try:
        m.remove_duplicate_faces()
        m.remove_unreferenced_vertices()
        if hasattr(m, "fill_holes"):
            m.fill_holes()
        m.fix_normals()
        m.process(validate=True)
    except Exception as exc:
        logger.debug("mesh repair partial: %s", exc)
    return m


def apply_transform(mesh: trimesh.Trimesh, transform: dict[str, Any]) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    if "scale" in transform:
        m.apply_scale(transform["scale"])
    if "translation" in transform:
        m.apply_translation(transform["translation"])
    if "rotation_deg" in transform:
        r = np.radians(transform["rotation_deg"])
        matrix = trimesh.transformations.euler_matrix(r[0], r[1], r[2], axes="sxyz")
        m.apply_transform(matrix)
    return repair_mesh(m)


def extrude_face(
    mesh: trimesh.Trimesh,
    face_index: int,
    distance: float,
    *,
    axis: list[float] | None = None,
    inward: bool = False,
) -> trimesh.Trimesh:
    """Extrude a mesh face along its normal (or custom axis) and union with the body."""
    m = repair_mesh(mesh_copy(mesh))
    fi = int(face_index)
    if fi < 0 or fi >= len(m.faces):
        raise ValueError(f"face_index out of range: {fi}")

    dist = float(distance)
    if dist <= 0:
        raise ValueError("extrude distance must be > 0")

    normal = np.asarray(axis if axis is not None else m.face_normals[fi], dtype=float)
    nlen = float(np.linalg.norm(normal))
    if nlen < 1e-9:
        raise ValueError("extrude direction is zero")
    normal = normal / nlen
    if inward:
        normal = -normal

    ring = m.vertices[m.faces[fi]]
    n = len(ring)
    if n < 3:
        raise ValueError("face must have at least 3 vertices")

    top = ring + normal * dist
    vertices = np.vstack([ring, top])
    faces: list[list[int]] = []

    for i in range(1, n - 1):
        faces.append([0, i, i + 1])
        faces.append([n, n + i + 1, n + i])

    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, j + n])
        faces.append([i, j + n, i + n])

    solid = repair_mesh(trimesh.Trimesh(vertices=vertices, faces=faces, process=True))
    return _boolean(m, solid, "union")


def _boolean_engines() -> list[str | None]:
    engines: list[str | None] = []
    try:
        import manifold3d  # noqa: F401

        engines.append("manifold")
    except Exception:
        pass
    engines.append(None)
    return engines


def _boolean(mesh_a: trimesh.Trimesh, mesh_b: trimesh.Trimesh, op: str) -> trimesh.Trimesh:
    """Boolean CSG with repair, no volume pre-check, and safe fallbacks."""
    a = repair_mesh(mesh_a)
    b = repair_mesh(mesh_b)
    fn = {
        "union": trimesh.boolean.union,
        "difference": trimesh.boolean.difference,
        "intersection": trimesh.boolean.intersection,
    }.get(op)
    if fn is None:
        raise ValueError(f"Unknown boolean op: {op}")

    last_err: Exception | None = None
    for engine in _boolean_engines():
        try:
            result = fn([a, b], engine=engine, check_volume=False)
            if result is not None and len(getattr(result, "vertices", [])) > 0:
                return repair_mesh(result)
        except Exception as exc:
            last_err = exc
            logger.info("Boolean %s engine=%s failed: %s", op, engine, exc)

    if op == "union":
        logger.warning("Boolean union fallback to concatenate")
        return repair_mesh(trimesh.util.concatenate([a, b]))
    if op == "difference":
        logger.warning("Boolean difference fallback — keeping outer mesh (%s)", last_err)
        return a
    if op == "intersection":
        logger.warning("Boolean intersection fallback — keeping mesh A")
        return a
    raise ValueError(f"Boolean {op} failed: {last_err}")


def _align_cylinder_to_axis(cylinder: trimesh.Trimesh, axis: np.ndarray, center: np.ndarray) -> trimesh.Trimesh:
    axis = np.asarray(axis, dtype=float)
    axis = axis / (np.linalg.norm(axis) + 1e-12)
    z = np.array([0.0, 0.0, 1.0])
    rot = trimesh.geometry.align_vectors(z, axis)
    if isinstance(rot, tuple):
        rot = rot[0]
    cylinder.apply_transform(rot)
    cylinder.apply_translation(center)
    return cylinder


def _through_hole_cutter(
    base: trimesh.Trimesh,
    position: np.ndarray,
    axis: np.ndarray,
    radius: float,
    *,
    through: bool,
    depth: float | None,
) -> trimesh.Trimesh:
    """Cylinder sized to span the part along axis (for reliable boolean difference)."""
    ax = np.asarray(axis, dtype=float)
    ax = ax / (np.linalg.norm(ax) + 1e-12)
    pos = np.asarray(position, dtype=float)
    verts = base.vertices - pos
    proj = verts @ ax
    t0, t1 = float(proj.min()), float(proj.max())
    margin = max(float(max(base.extents)), radius * 4) * 0.15
    if through:
        length = (t1 - t0) + 2.0 * margin
        center = pos + ax * ((t0 + t1) * 0.5)
    else:
        length = float(depth or max(base.extents) * 0.5)
        center = pos + ax * (margin * 0.5)
    cutter = repair_mesh(
        trimesh.creation.cylinder(radius=radius, height=length, sections=48)
    )
    return _align_cylinder_to_axis(cutter, ax, center)


def hole_at_point(
    base: trimesh.Trimesh,
    position: list[float],
    *,
    axis: list[float] | None = None,
    diameter: float | None = None,
    depth: float | None = None,
    through: bool = False,
) -> trimesh.Trimesh:
    pos = np.asarray(position, dtype=float)
    ax = np.asarray(axis or [0, 0, 1], dtype=float)
    if diameter is None:
        diameter = 3.0 if mesh_uses_millimeters(base) else 0.003
    radius = float(diameter) / 2.0
    base_vol = float(base.volume) if base.volume > 0 else 0.0
    cutter = _through_hole_cutter(
        base, pos, ax, radius, through=through, depth=depth
    )
    if not _cutter_intersects_mesh(base, cutter):
        units = "mm" if mesh_uses_millimeters(base) else "m"
        raise ValueError(
            f"Hole cutter does not intersect the model (diameter={diameter:g} {units}). "
            "Pick a point on the part or increase diameter_mm."
        )
    out = _boolean(repair_mesh(base), cutter, "difference")
    if base_vol > 0 and out.volume >= base_vol * 0.999:
        has_manifold = "manifold" in _boolean_engines()
        units = "mm" if mesh_uses_millimeters(base) else "m"
        hint = (
            f"Boolean cut failed (diameter={diameter:g} {units}). "
            "Try a larger diameter_mm, ensure the mesh is a solid, or re-pick the face."
        )
        if not has_manifold:
            hint += " Also install manifold3d in the server venv: .venv/bin/python -m pip install manifold3d && restart."
        raise ValueError(hint)
    return out


def _aabb_intersect(a: np.ndarray, b: np.ndarray) -> bool:
    return bool(np.all(a[0] <= b[1]) and np.all(b[0] <= a[1]))


def _cutter_intersects_mesh(base: trimesh.Trimesh, cutter: trimesh.Trimesh) -> bool:
    """Fast reject when the cutter bounding box misses the part entirely."""
    try:
        if base.bounds is not None and cutter.bounds is not None:
            return _aabb_intersect(np.asarray(base.bounds), np.asarray(cutter.bounds))
    except Exception:
        pass
    return True


def _hole_spec_for_ref(ref_id: str, refs: dict[str, dict[str, Any]]) -> tuple[list[float], list[float]]:
    ref = _lookup_ref(ref_id, refs)
    if not ref or ref.get("position") is None:
        raise ValueError(f"Unknown or invalid reference: {ref_id}")
    pos = list(ref["position"])
    axis = list(ref.get("normal") or [0, 0, 1])
    return pos, axis


def _hole_specs_from_action(
    action: dict[str, Any], refs: dict[str, dict[str, Any]]
) -> list[tuple[list[float], list[float]]]:
    """Multiple @refs → one through-hole at their centroid (unless one_per_ref set)."""
    ref_ids = _normalize_ref_ids(action)
    if not ref_ids and "position" in action:
        return [(list(action["position"]), list(action.get("axis", [0, 0, 1])))]

    if action.get("one_per_ref") or action.get("holes_per_ref"):
        return [_hole_spec_for_ref(rid, refs) for rid in ref_ids]

    if len(ref_ids) > 1:
        positions: list[np.ndarray] = []
        normals: list[np.ndarray] = []
        for rid in ref_ids:
            ref = _lookup_ref(rid, refs)
            if ref and ref.get("position") is not None:
                positions.append(np.asarray(ref["position"], dtype=float))
                if ref.get("normal"):
                    normals.append(np.asarray(ref["normal"], dtype=float))
        if len(positions) < 2:
            raise ValueError("hole_at_point: could not resolve multiple references")
        centroid = np.mean(positions, axis=0).tolist()
        if normals:
            axis = np.mean(normals, axis=0)
            axis = (axis / (np.linalg.norm(axis) + 1e-12)).tolist()
        else:
            axis = [0.0, 0.0, 1.0]
        return [(centroid, axis)]

    if len(ref_ids) == 1:
        return [_hole_spec_for_ref(ref_ids[0], refs)]

    raise ValueError("hole_at_point needs at_ref, at_refs, or position")


def _box(extents: list[float]) -> trimesh.Trimesh:
    return repair_mesh(trimesh.creation.box(extents=extents))


def _cylinder(radius: float, height: float, sections: int = 32) -> trimesh.Trimesh:
    return repair_mesh(trimesh.creation.cylinder(radius=radius, height=height, sections=sections))


def _sphere(radius: float) -> trimesh.Trimesh:
    return repair_mesh(trimesh.creation.icosphere(subdivisions=3, radius=radius))


def _vase(
    height: float = 0.25,
    outer_radius: float = 0.08,
    wall: float = 0.004,
    taper: float = 0.82,
    foot_scale: float = 1.08,
) -> trimesh.Trimesh:
    """Single revolved hollow plant vase (closed wall profile, no boolean stack)."""
    h = float(height)
    r0 = float(outer_radius)
    r1 = max(r0 * float(taper), r0 * 0.55)
    lip = r1 * 1.04
    foot = r0 * float(foot_scale)
    w = float(wall)
    sections = 64

    ri_foot = max(foot - w * 1.2, 0.005)
    ri_body = max(r0 - w, 0.005)
    ri_shoulder = max(r1 - w, 0.005)
    ri_lip = max(lip - w * 2, 0.005)
    z_floor = w * 1.5

    wall_prof = np.array(
        [
            [0.0, 0.0],
            [foot, 0.0],
            [r0, h * 0.06],
            [r0 * 0.97, h * 0.28],
            [r1, h * 0.78],
            [lip, h],
            [r1 * 0.94, h * 0.995],
            [ri_lip, h - w],
            [ri_shoulder, h * 0.72],
            [ri_body, h * 0.1],
            [ri_foot, z_floor],
            [0.0, z_floor],
            [0.0, 0.0],
        ],
        dtype=float,
    )

    mesh = repair_mesh(trimesh.creation.revolve(wall_prof, sections=sections))
    if len(mesh.vertices) > 0 and mesh.is_watertight:
        return mesh

    # Fallback: tapered solid cylinder
    body = _cylinder(r0, h, sections=sections)
    verts = body.vertices.copy()
    z0, z1 = verts[:, 2].min(), verts[:, 2].max()
    span = max(z1 - z0, 1e-9)
    for i in range(len(verts)):
        t = (verts[i, 2] - z0) / span
        s = 1.0 - t * (1.0 - taper)
        verts[i, 0] *= s
        verts[i, 1] *= s
    body.vertices = verts
    return repair_mesh(body)


def _parse_color(color: Any) -> np.ndarray:
    """RGBA uint8 for trimesh face_colors."""
    named = {
        "white": [255, 255, 255, 255],
        "black": [20, 20, 20, 255],
        "red": [220, 60, 60, 255],
        "green": [60, 180, 80, 255],
        "blue": [70, 130, 220, 255],
        "gray": [140, 145, 150, 255],
        "grey": [140, 145, 150, 255],
    }
    if isinstance(color, str):
        c = color.strip().lower()
        if c in named:
            return np.array(named[c], dtype=np.uint8)
        if c.startswith("#") and len(c) in (4, 7):
            if len(c) == 4:
                r, g, b = int(c[1] * 2, 16), int(c[2] * 2, 16), int(c[3] * 2, 16)
            else:
                r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
            return np.array([r, g, b, 255], dtype=np.uint8)
    if isinstance(color, (list, tuple)):
        vals = list(color)
        if len(vals) >= 3 and all(0 <= v <= 1 for v in vals[:3]):
            rgba = [int(v * 255) for v in vals[:3]] + [255]
            if len(vals) >= 4:
                rgba[3] = int(vals[3] * 255) if vals[3] <= 1 else int(vals[3])
            return np.array(rgba, dtype=np.uint8)
        if len(vals) >= 3:
            return np.array([int(vals[0]), int(vals[1]), int(vals[2]), 255], dtype=np.uint8)
    return np.array([196, 196, 196, 255], dtype=np.uint8)


def _ensure_face_colors(mesh: trimesh.Trimesh, default: np.ndarray | None = None) -> np.ndarray:
    n = len(mesh.faces)
    if mesh.visual.face_colors is None or len(mesh.visual.face_colors) != n:
        base = default if default is not None else np.array([196, 196, 196, 255], dtype=np.uint8)
        mesh.visual.face_colors = np.tile(base, (n, 1))
    return mesh.visual.face_colors


def paint_faces(mesh: trimesh.Trimesh, face_indices: list[int], color: Any) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    rgba = _parse_color(color)
    colors = _ensure_face_colors(m)
    for fi in face_indices:
        if 0 <= fi < len(m.faces):
            colors[fi] = rgba
    m.visual.face_colors = colors
    return m


def set_mesh_material(mesh: trimesh.Trimesh, color: Any) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    rgba = _parse_color(color)
    n = len(m.faces)
    m.visual.face_colors = np.tile(rgba, (n, 1))
    return m


def _strip_ref_token(ref_id: str) -> str:
    return ref_id.strip().lstrip("@")


def _first_str(val: Any) -> str | None:
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, list) and val:
        first = val[0]
        if isinstance(first, str):
            return first.strip()
    return None


def _first_number(val: Any) -> int | float | None:
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, list) and val:
        first = val[0]
        if isinstance(first, (int, float)):
            return first
    return None


def sanitize_action(action: dict[str, Any]) -> dict[str, Any]:
    """Normalize AI quirks (e.g. at_ref as a list) before CAD build."""
    a = dict(action)
    op = a.get("op")

    at_ref = a.get("at_ref")
    if isinstance(at_ref, list):
        ids = [_strip_ref_token(x) for x in at_ref if isinstance(x, str)]
        a.pop("at_ref", None)
        merged = ids + [
            _strip_ref_token(x)
            for x in (a.get("at_refs") or a.get("refs") or [])
            if isinstance(x, str)
        ]
        if merged:
            a["at_refs"] = merged
    elif isinstance(at_ref, str):
        a["at_ref"] = _strip_ref_token(at_ref)

    for key in ("at_refs", "refs"):
        if key in a and isinstance(a[key], list):
            a[key] = [_strip_ref_token(x) for x in a[key] if isinstance(x, str)]

    for key in ("face_index_from", "face_index_to"):
        n = _first_number(a.get(key))
        if n is not None:
            a[key] = int(n)

    if op == "boolean":
        for key in ("a", "b"):
            sid = _first_str(a.get(key))
            if sid is not None:
                a[key] = sid

    if op == "transform" and "source" in a:
        sid = _first_str(a.get("source"))
        if sid is not None:
            a["source"] = sid

    return a


def sanitize_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [sanitize_action(a) for a in actions if isinstance(a, dict)]


def _lookup_ref(ref_id: str, references: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    key = _strip_ref_token(ref_id)
    return references.get(key) or references.get(f"@{key}")


def _normalize_ref_ids(action: dict[str, Any]) -> list[str]:
    """Collect string reference ids from at_ref / at_refs / refs (AI may send lists)."""
    ids: list[str] = []
    at_ref = action.get("at_ref")
    if isinstance(at_ref, str):
        ids.append(_strip_ref_token(at_ref))
    elif isinstance(at_ref, list):
        for item in at_ref:
            if isinstance(item, str):
                ids.append(_strip_ref_token(item))

    for key in ("at_refs", "refs"):
        raw = action.get(key)
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, str):
                    ids.append(_strip_ref_token(item))

    ref_one = action.get("reference_id")
    if isinstance(ref_one, str):
        ids.append(_strip_ref_token(ref_one))

    seen: set[str] = set()
    out: list[str] = []
    for rid in ids:
        if rid and rid not in seen:
            seen.add(rid)
            out.append(rid)
    return out


def _coerce_int_list(raw: Any) -> list[int]:
    if raw is None:
        return []
    if isinstance(raw, (int, float)):
        return [int(raw)]
    if not isinstance(raw, list):
        return []
    out: list[int] = []
    for item in raw:
        if isinstance(item, (int, float)):
            out.append(int(item))
        elif isinstance(item, list):
            out.extend(_coerce_int_list(item))
    return out


def _resolve_face_indices(action: dict[str, Any], references: dict[str, dict[str, Any]]) -> list[int]:
    indices: list[int] = []
    if "face_indices" in action:
        indices.extend(_coerce_int_list(action["face_indices"]))
    for ref_id in _normalize_ref_ids(action):
        ref = _lookup_ref(ref_id, references)
        if ref and ref.get("face_index") is not None:
            indices.append(int(ref["face_index"]))
    lo = action.get("face_index_from")
    hi = action.get("face_index_to")
    if lo is not None and hi is not None:
        indices.extend(range(int(lo), int(hi) + 1))
    return sorted(set(indices))


def _resolve_ref_position(action: dict[str, Any], references: dict[str, dict[str, Any]]) -> list[float]:
    for ref_id in _normalize_ref_ids(action):
        ref = _lookup_ref(ref_id, references)
        if ref and ref.get("position") is not None:
            return list(ref["position"])
    if "position" in action:
        return list(action["position"])
    raise ValueError(f"No position for action {action.get('op')}")


def _resolve_ref_axis(action: dict[str, Any], references: dict[str, dict[str, Any]]) -> list[float]:
    for ref_id in _normalize_ref_ids(action):
        ref = _lookup_ref(ref_id, references)
        if ref and ref.get("normal"):
            return list(ref["normal"])
    return list(action.get("axis", [0, 0, 1]))


def build_from_actions(
    actions: list[dict[str, Any]],
    *,
    base_mesh: trimesh.Trimesh | None = None,
    references: dict[str, dict[str, Any]] | None = None,
) -> trimesh.Trimesh:
    actions = sanitize_actions(actions)
    meshes: dict[str, trimesh.Trimesh] = {}
    refs = references or {}
    result_id: str | None = None
    working = repair_mesh(mesh_copy(base_mesh)) if base_mesh is not None else None
    warnings: list[str] = []

    for action in actions:
        op = action.get("op")
        aid = action.get("id", str(uuid.uuid4())[:8])

        if op == "use_base":
            if working is None:
                raise ValueError("use_base requires base_filename / loaded mesh")
            working = mesh_copy(working)
            meshes[aid] = working
        elif op == "box":
            meshes[aid] = _box(action.get("extents", [1, 1, 1]))
        elif op == "cylinder":
            meshes[aid] = _cylinder(
                radius=float(action.get("radius", 0.5)),
                height=float(action.get("height", 1)),
                sections=int(action.get("sections", 32)),
            )
        elif op == "sphere":
            meshes[aid] = _sphere(float(action.get("radius", 0.5)))
        elif op == "vase":
            mesh = _vase(
                height=float(action.get("height", 0.25)),
                outer_radius=float(action.get("outer_radius", action.get("radius", 0.08))),
                wall=float(action.get("wall", action.get("wall_mm", 4) / 1000)),
                taper=float(action.get("taper", 0.82)),
            )
            meshes[aid] = mesh
            working = mesh
        elif op == "paint_faces":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("paint_faces requires a base mesh (use use_base first)")
            indices = _resolve_face_indices(action, refs)
            if not indices:
                raise ValueError("paint_faces: no face indices or @face refs resolved")
            working = paint_faces(target, indices, action.get("color", "white"))
            meshes[aid] = working
        elif op == "set_material":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("set_material requires a mesh")
            working = set_mesh_material(target, action.get("color", [0.77, 0.77, 0.77]))
            meshes[aid] = working
        elif op == "transform":
            source = action.get("source")
            if source not in meshes:
                raise ValueError(f"Unknown source mesh: {source}")
            meshes[aid] = apply_transform(meshes[source], action.get("transform", {}))
        elif op == "boolean":
            a, b = action.get("a"), action.get("b")
            if a not in meshes or b not in meshes:
                raise ValueError(f"Boolean references unknown meshes: {a}, {b}")
            meshes[aid] = _boolean(meshes[a], meshes[b], action.get("operation", "union"))
        elif op == "hole_at_point":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("hole_at_point requires a base mesh")
            if "diameter" in action:
                diameter = float(action["diameter"])
            elif "diameter_mm" in action:
                diameter = length_from_mm(target, float(action["diameter_mm"]))
            else:
                diameter = None
            if "depth_mm" in action and "depth" not in action:
                depth = length_from_mm(target, float(action["depth_mm"]))
            elif action.get("depth") is not None:
                depth = float(action["depth"])
            else:
                depth = None
            for pos, axis in _hole_specs_from_action(action, refs):
                target = hole_at_point(
                    target,
                    pos,
                    axis=axis,
                    diameter=diameter,
                    depth=depth,
                    through=bool(action.get("through", False)),
                )
            working = target
            meshes[aid] = working
        elif op == "extrude_face":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("extrude_face requires a base mesh")
            indices = _resolve_face_indices(action, refs)
            if not indices:
                raise ValueError("extrude_face: pick a face or set face_index")
            if "distance" in action:
                distance = float(action["distance"])
            elif "distance_mm" in action:
                distance = length_from_mm(target, float(action["distance_mm"]))
            else:
                distance = length_from_mm(target, 10.0)
            axis = _resolve_ref_axis(action, refs) if _normalize_ref_ids(action) else action.get("axis")
            for fi in indices:
                target = extrude_face(
                    target,
                    fi,
                    distance,
                    axis=axis,
                    inward=bool(action.get("inward", False)),
                )
            working = target
            meshes[aid] = working
        elif op == "import_existing":
            continue
        else:
            raise ValueError(f"Unsupported CAD op: {op}")

        if action.get("result", False):
            result_id = aid

    if result_id and result_id in meshes:
        out = meshes[result_id]
    elif working is not None:
        out = working
    elif meshes:
        out = trimesh.util.concatenate(list(meshes.values()))
    else:
        raise ValueError("No meshes produced from actions")

    if len(out.vertices) == 0:
        raise ValueError("Result mesh is empty — try a simpler prompt (e.g. 'vase' or '20cm cube')")

    return repair_mesh(out)


def references_map(refs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in refs:
        if "id" not in r:
            continue
        rid = str(r["id"])
        bare = _strip_ref_token(rid)
        out[rid] = r
        out[bare] = r
        out[f"@{bare}"] = r
    return out


def save_actions_manifest(project_path: Path, actions: list[dict[str, Any]]) -> Path:
    manifest = project_path / "last_actions.json"
    manifest.write_text(json.dumps(actions, indent=2))
    return manifest
