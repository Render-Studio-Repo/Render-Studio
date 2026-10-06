"""Apply viewport move/rotate/scale/delete to B-rep STEP with FreeCAD's OCC kernel.

The gizmo used to bake only the tessellated GLB. The sibling STEP stayed put, so
the next kernel op (Pad/Pocket) or a remesh snapped the part back. This module
applies the same pivot matrix FreeCAD uses (``Part.Shape.transformGeometry`` /
OCC ``BRepBuilderAPI_GTransform``) to the STEP, then the caller still mesh-bakes
the live GLB so the viewport does not remesh-pop.

Backspace/Delete uses the same solid index as the gizmo so removing one body
does not leave the STEP with a ghost solid that blocks the next delete.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Sequence

import numpy as np

logger = logging.getLogger(__name__)


def compose_transform_matrix(
    transform: dict[str, Any],
    center: Sequence[float] | None = None,
) -> np.ndarray:
    """4x4 matching ``cad_service.apply_transform``: scale/rotate about center, then translate."""
    import trimesh

    cx, cy, cz = (0.0, 0.0, 0.0)
    if center is not None and len(center) >= 3:
        cx, cy, cz = float(center[0]), float(center[1]), float(center[2])
    matrix = np.eye(4, dtype=float)
    has_scale = "scale" in transform and transform["scale"] is not None
    has_rot = "rotation_deg" in transform and transform["rotation_deg"] is not None
    if has_scale or has_rot:
        to_origin = trimesh.transformations.translation_matrix([-cx, -cy, -cz])
        back = trimesh.transformations.translation_matrix([cx, cy, cz])
        local = np.eye(4, dtype=float)
        if has_scale:
            local = _scale_matrix(transform["scale"]) @ local
        if has_rot:
            r = np.radians([float(v) for v in list(transform["rotation_deg"])[:3]])
            while len(r) < 3:
                r = np.append(r, 0.0)
            local = trimesh.transformations.euler_matrix(r[0], r[1], r[2], axes="sxyz") @ local
        matrix = back @ local @ to_origin
    if transform.get("translation") is not None:
        t = [float(v) for v in list(transform["translation"])[:3]]
        while len(t) < 3:
            t.append(0.0)
        matrix = trimesh.transformations.translation_matrix(t) @ matrix
    return matrix


def _scale_matrix(scale: float | Sequence[float]) -> np.ndarray:
    if isinstance(scale, (int, float)):
        sx = sy = sz = float(scale)
    else:
        values = [float(v) for v in list(scale)[:3]]
        while len(values) < 3:
            values.append(values[-1] if values else 1.0)
        sx, sy, sz = values
    matrix = np.eye(4, dtype=float)
    matrix[0, 0] = sx
    matrix[1, 1] = sy
    matrix[2, 2] = sz
    return matrix


def _step_name_candidates(project_path: Path, stem: str) -> list[Path]:
    return [
        project_path / f"{stem}.step",
        project_path / f"{stem}.stp",
        project_path / f"{stem}.STEP",
        project_path / f"{stem}.STP",
    ]


def resolve_transform_step(project_path: Path, *filenames: str) -> Path | None:
    """STEP that matches this viewport file, preferring an already-edited sibling."""
    from backend.services.freecad_engine import resolve_project_step

    seen: set[str] = set()
    for raw in filenames:
        name = Path(str(raw or "")).name
        if not name or name in seen:
            continue
        seen.add(name)
        stem = Path(name).stem
        for candidate in _step_name_candidates(project_path, stem):
            if candidate.is_file():
                return candidate
        found = resolve_project_step(project_path, name)
        if found is not None:
            return found
    return None


def viewer_pivot_center(path: Path) -> list[float]:
    """Bounding-box center of the mesh the gizmo is moving (model units)."""
    from backend.services import cad_service

    mesh = cad_service.load_mesh(path)
    bounds = getattr(mesh, "bounds", None)
    if bounds is None:
        return [0.0, 0.0, 0.0]
    center = np.asarray(bounds, dtype=float).mean(axis=0)
    return [float(center[0]), float(center[1]), float(center[2])]


def _shape_bbox_mm(shape) -> list[float]:
    from OCP.BRepBndLib import BRepBndLib
    from OCP.Bnd import Bnd_Box

    box = Bnd_Box()
    try:
        BRepBndLib.Add_s(shape, box, False)
    except Exception:
        BRepBndLib.Add(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    return [
        float(xmin),
        float(ymin),
        float(zmin),
        float(xmax),
        float(ymax),
        float(zmax),
    ]


def list_kernel_solids(step_path: Path, *, max_solids: int = 256) -> list[dict[str, Any]]:
    """FreeCAD/OCC solids in STEP order — the same index transform-body uses."""
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer

    path = Path(step_path)
    if not path.is_file():
        return []
    reader = STEPControl_Reader()
    status = reader.ReadFile(str(path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        return []
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        return []
    names: list[str] = []
    try:
        from backend.services.cad_service import _authored_step_body_names, _is_generic_gltf_body_id

        names = _authored_step_body_names(path)
    except Exception:
        names = []
    solids: list[dict[str, Any]] = []
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More() and len(solids) < int(max_solids):
        solid = explorer.Current()
        bbox = _shape_bbox_mm(solid)
        center = [
            (bbox[0] + bbox[3]) / 2.0,
            (bbox[1] + bbox[4]) / 2.0,
            (bbox[2] + bbox[5]) / 2.0,
        ]
        idx = len(solids)
        raw = names[idx] if idx < len(names) else ""
        label = raw if str(raw).strip() and not _is_generic_gltf_body_id(raw) else f"Body {idx + 1}"
        dx, dy, dz = bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]
        solids.append(
            {
                "index": idx,
                "name": label,
                "bbox": bbox,
                "center": center,
                "volume": abs(dx * dy * dz),
            }
        )
        explorer.Next()
    return solids


def _round3(value: float) -> float:
    return round(float(value), 3)


def _pnt_xyz(pnt) -> list[float]:
    return [_round3(pnt.X()), _round3(pnt.Y()), _round3(pnt.Z())]


def _vec_xyz(vec, reverse: bool = False) -> list[float]:
    x, y, z = float(vec.X()), float(vec.Y()), float(vec.Z())
    if reverse:
        x, y, z = -x, -y, -z
    length = (x * x + y * y + z * z) ** 0.5 or 1.0
    return [_round3(x / length), _round3(y / length), _round3(z / length)]


def _point_in_bbox(point: Sequence[float], bbox: Sequence[float], pad: float = 1.5) -> bool:
    if point is None or len(point) < 3 or bbox is None or len(bbox) < 6:
        return False
    px, py, pz = float(point[0]), float(point[1]), float(point[2])
    return (
        bbox[0] - pad <= px <= bbox[3] + pad
        and bbox[1] - pad <= py <= bbox[4] + pad
        and bbox[2] - pad <= pz <= bbox[5] + pad
    )


def _dist_point_segment(point: Sequence[float], start: Sequence[float], end: Sequence[float]) -> float:
    px, py, pz = float(point[0]), float(point[1]), float(point[2])
    ax, ay, az = float(start[0]), float(start[1]), float(start[2])
    bx, by, bz = float(end[0]), float(end[1]), float(end[2])
    abx, aby, abz = bx - ax, by - ay, bz - az
    denom = abx * abx + aby * aby + abz * abz
    if denom < 1e-18:
        dx, dy, dz = px - ax, py - ay, pz - az
        return (dx * dx + dy * dy + dz * dz) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / denom))
    dx, dy, dz = px - (ax + t * abx), py - (ay + t * aby), pz - (az + t * abz)
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def kernel_pick_face(
    faces: Sequence[dict[str, Any]],
    point: Sequence[float],
    normal: Sequence[float] | None = None,
    *,
    pad_mm: float = 1.5,
) -> dict[str, Any] | None:
    """Smallest planar-aligned kernel face whose AABB contains the pick."""
    if not faces or point is None or len(point) < 3:
        return None
    nx = ny = nz = 0.0
    if normal is not None and len(normal) >= 3:
        nx, ny, nz = float(normal[0]), float(normal[1]), float(normal[2])
        nlen = (nx * nx + ny * ny + nz * nz) ** 0.5
        if nlen > 1e-9:
            nx, ny, nz = nx / nlen, ny / nlen, nz / nlen
    best: tuple[float, dict[str, Any]] | None = None
    px, py, pz = float(point[0]), float(point[1]), float(point[2])
    for face in faces:
        bb = list(face.get("bbox") or [])
        if not _point_in_bbox(point, bb, pad_mm):
            continue
        center = list(face.get("center") or [])
        if len(center) < 3:
            continue
        dx, dy, dz = px - float(center[0]), py - float(center[1]), pz - float(center[2])
        dist = (dx * dx + dy * dy + dz * dz) ** 0.5
        fn = list(face.get("normal") or [])
        align = 0.0
        if len(fn) >= 3 and (nx or ny or nz):
            align = abs(float(fn[0]) * nx + float(fn[1]) * ny + float(fn[2]) * nz)
        area = abs(float(face.get("area") or 0.0))
        score = dist - 40.0 * align + area * 1e-9
        if best is None or score < best[0]:
            best = (score, face)
    return None if best is None else best[1]


def kernel_pick_edge(
    edges: Sequence[dict[str, Any]],
    point: Sequence[float],
    *,
    max_dist: float | None = None,
) -> dict[str, Any] | None:
    if not edges or point is None or len(point) < 3:
        return None
    best: tuple[float, dict[str, Any]] | None = None
    for edge in edges:
        start = list(edge.get("start") or [])
        end = list(edge.get("end") or [])
        if len(start) < 3 or len(end) < 3:
            continue
        dist = _dist_point_segment(point, start, end)
        if max_dist is not None and dist > max_dist:
            continue
        if best is None or dist < best[0]:
            best = (dist, edge)
    return None if best is None else best[1]


def kernel_pick_vertex(
    vertices: Sequence[dict[str, Any]],
    point: Sequence[float],
    *,
    max_dist: float | None = None,
) -> dict[str, Any] | None:
    if not vertices or point is None or len(point) < 3:
        return None
    px, py, pz = float(point[0]), float(point[1]), float(point[2])
    best: tuple[float, dict[str, Any]] | None = None
    for vertex in vertices:
        pos = list(vertex.get("position") or [])
        if len(pos) < 3:
            continue
        dx, dy, dz = px - float(pos[0]), py - float(pos[1]), pz - float(pos[2])
        dist = (dx * dx + dy * dy + dz * dz) ** 0.5
        if max_dist is not None and dist > max_dist:
            continue
        if best is None or dist < best[0]:
            best = (dist, vertex)
    return None if best is None else best[1]


def list_kernel_topology(
    step_path: Path,
    *,
    max_solids: int = 256,
    max_faces: int = 800,
    max_edges: int = 1600,
    max_vertices: int = 800,
    max_tris: int = 8000,
    include_tris: bool = True,
) -> dict[str, Any]:
    """FreeCAD/OCC faces, edges, and vertices for viewport picking."""
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
    from OCP.BRepGProp import BRepGProp
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.GeomAbs import GeomAbs_SurfaceType
    from OCP.GProp import GProp_GProps
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED, TopAbs_VERTEX
    from OCP.TopExp import TopExp, TopExp_Explorer
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS
    from OCP.gp import gp_Pnt, gp_Vec

    empty = {"kernel": "freecad", "bodies": [], "faces": [], "edges": [], "vertices": []}
    path = Path(step_path)
    if not path.is_file():
        return empty
    bodies = list_kernel_solids(path, max_solids=max_solids)
    reader = STEPControl_Reader()
    status = reader.ReadFile(str(path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        return {**empty, "bodies": bodies}
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        return {**empty, "bodies": bodies}

    diag = 1.0
    if bodies:
        bb = list(bodies[0].get("bbox") or [])
        if len(bb) >= 6:
            diag = max(abs(bb[3] - bb[0]), abs(bb[4] - bb[1]), abs(bb[5] - bb[2]), 1.0)
        for body in bodies[1:]:
            box = list(body.get("bbox") or [])
            if len(box) >= 6:
                diag = max(
                    diag,
                    abs(box[3] - box[0]),
                    abs(box[4] - box[1]),
                    abs(box[5] - box[2]),
                )
    deflection = max(0.15, min(1.25, float(diag) / 120.0))
    if include_tris:
        try:
            BRepMesh_IncrementalMesh(shape, deflection, False, 0.5, True)
        except Exception:
            logger.warning("OCC mesh for kernel topology failed on %s", path.name, exc_info=True)

    faces: list[dict[str, Any]] = []
    tri_budget = int(max_tris)
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More() and len(faces) < int(max_faces):
        face = TopoDS.Face_s(explorer.Current())
        props = GProp_GProps()
        try:
            BRepGProp.SurfaceProperties_s(face, props)
            center = _pnt_xyz(props.CentreOfMass())
            area = abs(float(props.Mass()))
        except Exception:
            bb = _shape_bbox_mm(face)
            center = [
                _round3((bb[0] + bb[3]) / 2.0),
                _round3((bb[1] + bb[4]) / 2.0),
                _round3((bb[2] + bb[5]) / 2.0),
            ]
            area = abs((bb[3] - bb[0]) * (bb[4] - bb[1]))
        bbox = [_round3(v) for v in _shape_bbox_mm(face)]
        planar = False
        normal = [0.0, 0.0, 1.0]
        try:
            surf = BRepAdaptor_Surface(face)
            planar = surf.GetType() == GeomAbs_SurfaceType.GeomAbs_Plane
            u = 0.5 * (surf.FirstUParameter() + surf.LastUParameter())
            v = 0.5 * (surf.FirstVParameter() + surf.LastVParameter())
            pnt = gp_Pnt()
            d1u = gp_Vec()
            d1v = gp_Vec()
            surf.D1(u, v, pnt, d1u, d1v)
            vec = d1u.Crossed(d1v)
            if vec.Magnitude() < 1e-12:
                vec = gp_Vec(0.0, 0.0, 1.0)
            normal = _vec_xyz(vec, reverse=face.Orientation() == TopAbs_REVERSED)
        except Exception:
            pass
        tris: list[float] = []
        if include_tris and tri_budget > 0:
            try:
                location = TopLoc_Location()
                triangulation = BRep_Tool.Triangulation_s(face, location)
                if triangulation is not None:
                    reversed_face = face.Orientation() == TopAbs_REVERSED
                    trsf = location.Transformation()
                    nodes = []
                    for index in range(1, int(triangulation.NbNodes()) + 1):
                        point = triangulation.Node(index).Transformed(trsf)
                        nodes.append([_round3(point.X()), _round3(point.Y()), _round3(point.Z())])
                    count = int(triangulation.NbTriangles())
                    take = min(count, tri_budget)
                    for index in range(1, take + 1):
                        a, b, c = triangulation.Triangle(index).Get()
                        ia, ib, ic = a - 1, b - 1, c - 1
                        if reversed_face:
                            ib, ic = ic, ib
                        pa, pb, pc = nodes[ia], nodes[ib], nodes[ic]
                        tris.extend([*pa, *pb, *pc])
                    tri_budget -= take
            except Exception:
                tris = []
        body_index = kernel_body_index_at_point(bodies, center) if bodies else 0
        if body_index is None:
            body_index = 0
        faces.append(
            {
                "index": len(faces),
                "body_index": int(body_index),
                "center": center,
                "normal": normal,
                "bbox": bbox,
                "area": _round3(area),
                "planar": bool(planar),
                "tris": tris,
            }
        )
        explorer.Next()

    edges: list[dict[str, Any]] = []
    seen_edges: set[tuple[tuple[float, ...], tuple[float, ...]]] = set()
    explorer = TopExp_Explorer(shape, TopAbs_EDGE)
    while explorer.More() and len(edges) < int(max_edges):
        edge = TopoDS.Edge_s(explorer.Current())
        try:
            v1 = TopExp.FirstVertex_s(edge)
            v2 = TopExp.LastVertex_s(edge)
            start = _pnt_xyz(BRep_Tool.Pnt_s(v1))
            end = _pnt_xyz(BRep_Tool.Pnt_s(v2))
        except Exception:
            explorer.Next()
            continue
        key = (tuple(start), tuple(end)) if tuple(start) <= tuple(end) else (tuple(end), tuple(start))
        if key in seen_edges:
            explorer.Next()
            continue
        seen_edges.add(key)
        mid = [
            _round3((start[0] + end[0]) / 2.0),
            _round3((start[1] + end[1]) / 2.0),
            _round3((start[2] + end[2]) / 2.0),
        ]
        try:
            curve = BRepAdaptor_Curve(edge)
            u0, u1 = curve.FirstParameter(), curve.LastParameter()
            mid = _pnt_xyz(curve.Value(0.5 * (u0 + u1)))
        except Exception:
            pass
        props = GProp_GProps()
        length = ((end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2 + (end[2] - start[2]) ** 2) ** 0.5
        try:
            BRepGProp.LinearProperties_s(edge, props)
            length = abs(float(props.Mass()))
        except Exception:
            pass
        body_index = kernel_body_index_at_point(bodies, mid) if bodies else 0
        if body_index is None:
            body_index = 0
        edges.append(
            {
                "index": len(edges),
                "body_index": int(body_index),
                "start": start,
                "end": end,
                "mid": mid,
                "length": _round3(length),
            }
        )
        explorer.Next()

    vertices: list[dict[str, Any]] = []
    seen_verts: set[tuple[float, float, float]] = set()
    explorer = TopExp_Explorer(shape, TopAbs_VERTEX)
    while explorer.More() and len(vertices) < int(max_vertices):
        vertex = TopoDS.Vertex_s(explorer.Current())
        try:
            position = _pnt_xyz(BRep_Tool.Pnt_s(vertex))
        except Exception:
            explorer.Next()
            continue
        key = (position[0], position[1], position[2])
        if key in seen_verts:
            explorer.Next()
            continue
        seen_verts.add(key)
        body_index = kernel_body_index_at_point(bodies, position) if bodies else 0
        if body_index is None:
            body_index = 0
        vertices.append(
            {
                "index": len(vertices),
                "body_index": int(body_index),
                "position": position,
            }
        )
        explorer.Next()

    return {
        "kernel": "freecad",
        "bodies": bodies,
        "faces": faces,
        "edges": edges,
        "vertices": vertices,
    }


def kernel_body_index_at_point(
    bodies: Sequence[dict[str, Any]],
    point: Sequence[float],
    *,
    pad_mm: float = 1.5,
) -> int | None:
    """Smallest kernel solid whose AABB contains the pick (FreeCAD-style)."""
    if not bodies or point is None or len(point) < 3:
        return None
    px, py, pz = float(point[0]), float(point[1]), float(point[2])
    pad = float(pad_mm)
    best: tuple[float, int] | None = None
    for body in bodies:
        try:
            idx = int(body.get("index"))
            bb = list(body.get("bbox") or [])
        except (TypeError, ValueError):
            continue
        if len(bb) < 6:
            continue
        if not (
            bb[0] - pad <= px <= bb[3] + pad
            and bb[1] - pad <= py <= bb[4] + pad
            and bb[2] - pad <= pz <= bb[5] + pad
        ):
            continue
        vol = abs((bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]))
        try:
            vol = min(vol, float(body.get("volume") or vol))
        except (TypeError, ValueError):
            pass
        if best is None or vol < best[0]:
            best = (max(vol, 1e-9), idx)
    return None if best is None else best[1]


def resolve_kernel_body_index(
    bodies: Sequence[dict[str, Any]],
    body_index: int | None,
    body_name: str | None = None,
) -> int | None:
    """Map a viewport selection onto the FreeCAD/OCC solid walk."""
    if body_name:
        want = str(body_name).strip().lower()
        if want:
            for body in bodies:
                if str(body.get("name") or "").strip().lower() == want:
                    try:
                        return int(body.get("index"))
                    except (TypeError, ValueError):
                        continue
    if body_index is None:
        return None
    return int(body_index)


def kernel_body_center(
    bodies: Sequence[dict[str, Any]],
    body_index: int | None,
    body_name: str | None = None,
) -> list[float] | None:
    if not bodies:
        return None
    if body_name:
        want = str(body_name).strip().lower()
        for body in bodies:
            if str(body.get("name") or "").strip().lower() == want:
                center = body.get("center")
                if isinstance(center, (list, tuple)) and len(center) >= 3:
                    return [float(center[0]), float(center[1]), float(center[2])]
    if body_index is None:
        return None
    idx = int(body_index)
    for body in bodies:
        try:
            if int(body.get("index")) != idx:
                continue
        except (TypeError, ValueError):
            continue
        center = body.get("center")
        if isinstance(center, (list, tuple)) and len(center) >= 3:
            return [float(center[0]), float(center[1]), float(center[2])]
        bb = list(body.get("bbox") or [])
        if len(bb) >= 6:
            return [(bb[0] + bb[3]) / 2.0, (bb[1] + bb[4]) / 2.0, (bb[2] + bb[5]) / 2.0]
    return None


def try_apply_freecad_step_transform(
    project_path: Path,
    filename: str,
    transform: dict[str, Any],
    *,
    out_step: Path,
    viewer_path: Path | None = None,
    body_index: int | None = None,
    body_name: str | None = None,
) -> Path | None:
    """Transform the sibling STEP. Returns the written STEP, or None to keep mesh-only."""
    if not transform:
        return None
    step_in = resolve_transform_step(
        project_path,
        Path(out_step).name,
        filename,
        viewer_path.name if viewer_path is not None else "",
    )
    if step_in is None:
        return None
    center = None
    kernel_bodies: list[dict[str, Any]] = []
    try:
        kernel_bodies = list_kernel_solids(step_in)
    except Exception:
        kernel_bodies = []
    if body_index is not None or body_name:
        center = kernel_body_center(kernel_bodies, body_index, body_name)
    if center is None and viewer_path is not None and viewer_path.is_file() and body_index is None:
        try:
            center = viewer_pivot_center(viewer_path)
        except Exception:
            center = None
    matrix = compose_transform_matrix(transform, center)
    if np.allclose(matrix, np.eye(4), atol=1e-12):
        if Path(out_step).resolve() != step_in.resolve():
            out_step.parent.mkdir(parents=True, exist_ok=True)
            import shutil

            shutil.copy2(step_in, out_step)
            return out_step
        return step_in
    dest = Path(out_step)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        _transform_step_ocp(
            step_in,
            dest,
            matrix,
            body_index=body_index,
            body_name=body_name,
        )
        logger.info("OCC kernel transformed %s → %s", step_in.name, dest.name)
        return dest
    except Exception as exc:
        logger.warning("OCC in-process transform failed (%s); trying FreeCADCmd", exc)
    try:
        _transform_step_freecadcmd(
            project_path,
            step_in,
            dest,
            matrix,
            body_index=body_index,
        )
        logger.info("FreeCADCmd transformed %s → %s", step_in.name, dest.name)
        return dest
    except Exception as exc:
        logger.warning("FreeCAD kernel transform skipped for %s: %s", filename, exc)
        return None


def remesh_document_preview(step_path: Path, glb_path: Path) -> Path:
    """One coherent STEP→GLB preview after a document op (no leftover mesh bake)."""
    from backend.services.cad_service import tessellate_step_to_glb

    dest = Path(glb_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.stem}.__kernel{dest.suffix}")
    tmp.unlink(missing_ok=True)
    try:
        tessellate_step_to_glb(step_path, tmp, force=True)
        if not tmp.is_file() or tmp.stat().st_size < 64:
            raise RuntimeError(f"FreeCAD preview remesh produced no GLB for {Path(step_path).name}")
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)
    return dest


def apply_cad_document_transform(
    project_path: Path,
    filename: str,
    transform: dict[str, Any],
    *,
    out_step: Path,
    out_glb: Path,
    viewer_path: Path | None = None,
    body_index: int | None = None,
    body_name: str | None = None,
) -> dict[str, Any]:
    """Move/rotate/scale via FreeCAD/OCC on the STEP document, then remesh the GLB.

    Viewport CAD is not a second kernel: the sibling STEP is the source of truth.
    Jake ``.py`` stays the generation script (cad-params /sync_only still patches
    it); gizmo edits do not rewrite Jake source — they update STEP+preview GLB.
    """
    step_in = resolve_transform_step(
        project_path,
        Path(out_step).name,
        filename,
        viewer_path.name if viewer_path is not None else "",
    )
    if step_in is None:
        return None
    written = try_apply_freecad_step_transform(
        project_path,
        filename,
        transform,
        out_step=out_step,
        viewer_path=viewer_path,
        body_index=body_index,
        body_name=body_name,
    )
    if written is None or not Path(written).is_file():
        raise RuntimeError(
            f"FreeCAD could not apply this transform to {filename}."
        )
    remesh_document_preview(written, out_glb)
    return {
        "kernel": "freecad",
        "step": Path(written).name,
        "glb": Path(out_glb).name,
        "body_index": body_index,
        "body_name": body_name,
    }


def apply_cad_document_remove_body(
    project_path: Path,
    filename: str,
    *,
    body_index: int,
    body_name: str | None = None,
    out_step: Path | None = None,
    out_glb: Path | None = None,
) -> dict[str, Any]:
    """removeObject-equivalent: drop one OCC solid from STEP, remesh preview GLB."""
    dest_step = Path(out_step) if out_step is not None else None
    written = try_apply_freecad_step_remove_body(
        project_path,
        filename,
        body_index=body_index,
        body_name=body_name,
        out_step=dest_step,
    )
    if written is None:
        raise RuntimeError(
            "FreeCAD could not delete this body: no STEP document, or the kernel "
            f"could not remove solid {body_index} from {filename}."
        )
    dest_glb = Path(out_glb) if out_glb is not None else written.with_suffix(".glb")
    remesh_document_preview(written, dest_glb)
    return {
        "kernel": "freecad",
        "step": Path(written).name,
        "glb": dest_glb.name,
        "body_index": body_index,
        "body_name": body_name,
    }


def try_apply_freecad_step_remove_body(
    project_path: Path,
    filename: str,
    *,
    body_index: int,
    body_name: str | None = None,
    out_step: Path | None = None,
) -> Path | None:
    """Drop one FreeCAD/OCC solid from the sibling STEP. None means no B-rep to edit."""
    dest = Path(out_step) if out_step is not None else None
    step_in = resolve_transform_step(
        project_path,
        dest.name if dest is not None else "",
        filename,
    )
    if step_in is None:
        return None
    if dest is None:
        dest = step_in
    dest.parent.mkdir(parents=True, exist_ok=True)
    kernel_bodies: list[dict[str, Any]] = []
    try:
        kernel_bodies = list_kernel_solids(step_in)
    except Exception:
        kernel_bodies = []
    idx = resolve_kernel_body_index(kernel_bodies, body_index, body_name)
    if idx is None:
        idx = int(body_index)
    solid_count = len(kernel_bodies)
    if solid_count:
        if solid_count <= 1:
            raise ValueError("Cannot remove a body from a single-body model.")
        if idx < 0 or idx >= solid_count:
            raise ValueError(f"body_index out of range: {idx}")
    try:
        _remove_step_solid_ocp(step_in, dest, body_index=idx)
        logger.info("OCC kernel removed body %s from %s → %s", idx, step_in.name, dest.name)
        return dest
    except ValueError:
        raise
    except Exception as exc:
        logger.warning("OCC in-process body delete failed (%s); trying FreeCADCmd", exc)
    try:
        _remove_step_solid_freecadcmd(project_path, step_in, dest, body_index=idx)
        logger.info("FreeCADCmd removed body %s from %s → %s", idx, step_in.name, dest.name)
        return dest
    except Exception as exc:
        logger.warning("FreeCAD kernel body delete skipped for %s: %s", filename, exc)
        return None


def _read_ocp_solids(step_in: Path) -> tuple[Any, list[Any]]:
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer

    reader = STEPControl_Reader()
    status = reader.ReadFile(str(step_in))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise RuntimeError(f"Could not read STEP: {step_in.name}")
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        raise RuntimeError(f"STEP has no geometry: {step_in.name}")
    solids: list[Any] = []
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More():
        solids.append(explorer.Current())
        explorer.Next()
    return shape, solids


def _write_ocp_shape(shape: Any, dest: Path, step_in: Path) -> None:
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer

    writer = STEPControl_Writer()
    writer.Transfer(shape, STEPControl_StepModelType.STEPControl_AsIs)
    write_path = dest
    tmp_path = None
    if dest.resolve() == Path(step_in).resolve():
        tmp_path = dest.with_name(f"{dest.stem}.__xform{dest.suffix}")
        write_path = tmp_path
    status = writer.Write(str(write_path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone or not write_path.is_file():
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        raise RuntimeError(f"OCC failed to write STEP: {dest.name}")
    if tmp_path is not None:
        tmp_path.replace(dest)


def _compound_solids(solids: Sequence[Any]) -> Any:
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound

    if len(solids) == 1:
        return solids[0]
    builder = BRep_Builder()
    compound = TopoDS_Compound()
    builder.MakeCompound(compound)
    for solid in solids:
        builder.Add(compound, solid)
    return compound


def _transform_step_ocp(
    step_in: Path,
    dest: Path,
    matrix: np.ndarray,
    *,
    body_index: int | None = None,
    body_name: str | None = None,
) -> None:
    from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform
    from OCP.gp import gp_GTrsf

    shape, solids = _read_ocp_solids(step_in)

    gtrsf = gp_GTrsf()
    for row in range(3):
        for col in range(4):
            gtrsf.SetValue(row + 1, col + 1, float(matrix[row, col]))

    def apply(one):
        return BRepBuilderAPI_GTransform(one, gtrsf, True).Shape()

    idx = None if body_index is None else int(body_index)
    # Always walk solids when a body is targeted so siblings keep their Placement.
    if idx is not None and solids:
        if idx < 0 or idx >= len(solids):
            raise RuntimeError(f"body_index {idx} out of range for {len(solids)} solids")
        out_shape = _compound_solids(
            [apply(solid) if i == idx else solid for i, solid in enumerate(solids)]
        )
        _ = body_name  # GLB node names are not in the STEP solid walk; index is the contract.
    else:
        out_shape = apply(shape)
    _write_ocp_shape(out_shape, dest, step_in)


def _remove_step_solid_ocp(step_in: Path, dest: Path, *, body_index: int) -> None:
    _shape, solids = _read_ocp_solids(step_in)
    idx = int(body_index)
    if len(solids) <= 1:
        raise ValueError("Cannot remove a body from a single-body model.")
    if idx < 0 or idx >= len(solids):
        raise ValueError(f"body_index out of range: {idx}")
    remaining = [solid for i, solid in enumerate(solids) if i != idx]
    if not remaining:
        raise ValueError("Cannot remove the last remaining body.")
    _write_ocp_shape(_compound_solids(remaining), dest, step_in)


def _remove_step_solid_freecadcmd(
    project_path: Path,
    step_in: Path,
    dest: Path,
    *,
    body_index: int,
) -> None:
    from backend.services.freecad_engine import run_freecad_macro

    source = _build_remove_body_macro(step_in, body_index=int(body_index))
    stem = f"{dest.stem}_fcdelete"
    result = run_freecad_macro(
        project_path=project_path,
        stem=stem,
        source=source,
        parameters={},
        expected_outputs=["Part"],
        timeout_sec=90.0,
    ) or {}
    if not result.get("ok"):
        err = str(result.get("error") or "FreeCAD delete failed")
        tb = str(result.get("traceback") or "")
        raise RuntimeError(err + (f"\n{tb[:2000]}" if tb else ""))
    written = Path(str(result.get("step_path") or ""))
    if not written.is_file():
        raise RuntimeError("FreeCAD delete produced no STEP")
    import shutil

    shutil.copy2(written, dest)


def _build_remove_body_macro(step_in: Path, *, body_index: int) -> str:
    body = repr(int(body_index))
    return f'''# Render Studio viewport delete · FreeCAD Part kernel
import Part
shape = Part.Shape()
shape.read({str(step_in)!r})
body_index = {body}
solids = list(shape.Solids)
if len(solids) <= 1:
    raise RuntimeError("Cannot remove a body from a single-body model.")
if body_index < 0 or body_index >= len(solids):
    raise RuntimeError("body_index out of range for FreeCAD solids")
parts = [s for i, s in enumerate(solids) if i != body_index]
if not parts:
    raise RuntimeError("Cannot remove the last remaining body.")
out_shape = parts[0] if len(parts) == 1 else Part.makeCompound(parts)
obj = doc.addObject("Part::Feature", "Part")
obj.Label = "Part"
obj.Shape = out_shape
result["Part"] = obj
'''


def _transform_step_freecadcmd(
    project_path: Path,
    step_in: Path,
    dest: Path,
    matrix: np.ndarray,
    *,
    body_index: int | None = None,
) -> None:
    from backend.services.freecad_engine import run_freecad_macro

    flat = [float(v) for v in np.asarray(matrix, dtype=float).reshape(-1)]
    if len(flat) != 16:
        raise RuntimeError("transform matrix must be 4x4")
    source = _build_transform_macro(step_in, flat, body_index=body_index)
    stem = f"{dest.stem}_fcxform"
    result = run_freecad_macro(
        project_path=project_path,
        stem=stem,
        source=source,
        parameters={},
        expected_outputs=["Part"],
        timeout_sec=90.0,
    ) or {}
    if not result.get("ok"):
        err = str(result.get("error") or "FreeCAD transform failed")
        tb = str(result.get("traceback") or "")
        raise RuntimeError(err + (f"\n{tb[:2000]}" if tb else ""))
    written = Path(str(result.get("step_path") or ""))
    if not written.is_file():
        raise RuntimeError("FreeCAD transform produced no STEP")
    import shutil

    shutil.copy2(written, dest)


def _build_transform_macro(
    step_in: Path,
    matrix16: Sequence[float],
    *,
    body_index: int | None,
) -> str:
    vals = ", ".join(repr(float(v)) for v in list(matrix16)[:16])
    body = "None" if body_index is None else repr(int(body_index))
    return f'''# Render Studio viewport transform · FreeCAD Part kernel
import Part
shape = Part.Shape()
shape.read({str(step_in)!r})
mat = App.Matrix({vals})
body_index = {body}
if body_index is None:
    out_shape = shape.transformGeometry(mat)
else:
    solids = list(shape.Solids)
    if not solids:
        out_shape = shape.transformGeometry(mat)
    else:
        if body_index < 0 or body_index >= len(solids):
            raise RuntimeError("body_index out of range for FreeCAD solids")
        parts = [s.transformGeometry(mat) if i == body_index else s for i, s in enumerate(solids)]
        out_shape = parts[0] if len(parts) == 1 else Part.makeCompound(parts)
obj = doc.addObject("Part::Feature", "Part")
obj.Label = "Part"
obj.Shape = out_shape
result["Part"] = obj
'''
