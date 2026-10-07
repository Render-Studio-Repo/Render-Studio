"""FreeCAD/OCC kernel measure: vertex, edge, and face distances."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.services.freecad_transform import _pnt_xyz, _round3, _vec_xyz


def normalize_kernel_pick(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or raw.get("type") or "").strip().lower()
    if kind in {"corner", "vertex", "vert"}:
        kind = "vertex"
    elif kind == "edge":
        kind = "edge"
    elif kind == "face":
        kind = "face"
    else:
        return None
    try:
        index = int(raw.get("index"))
    except (TypeError, ValueError):
        return None
    if index < 0:
        return None
    return {"kind": kind, "index": index}


def compact_kernel_topology(topo: dict[str, Any] | None) -> dict[str, Any]:
    data = topo if isinstance(topo, dict) else {}
    faces = []
    for face in data.get("faces") or []:
        if not isinstance(face, dict):
            continue
        faces.append(
            {
                "index": face.get("index"),
                "body_index": face.get("body_index"),
                "center": face.get("center"),
                "normal": face.get("normal"),
                "bbox": face.get("bbox"),
                "area": face.get("area"),
                "planar": bool(face.get("planar")),
            }
        )
    return {
        "kernel": data.get("kernel") or "freecad",
        "bodies": list(data.get("bodies") or []),
        "faces": faces,
        "edges": list(data.get("edges") or []),
        "vertices": list(data.get("vertices") or []),
    }


def _load_step_shape(step_path: Path):
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_Reader

    path = Path(step_path)
    if not path.is_file():
        return None
    reader = STEPControl_Reader()
    status = reader.ReadFile(str(path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        return None
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        return None
    return shape


def _collect_kernel_subshapes(
    shape,
    *,
    max_faces: int = 800,
    max_edges: int = 1600,
    max_vertices: int = 800,
):
    from OCP.BRep import BRep_Tool
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
    from OCP.TopExp import TopExp, TopExp_Explorer
    from OCP.TopoDS import TopoDS

    faces = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More() and len(faces) < int(max_faces):
        faces.append(TopoDS.Face_s(explorer.Current()))
        explorer.Next()

    edges = []
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
        edges.append(edge)
        explorer.Next()

    vertices = []
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
        vertices.append(vertex)
        explorer.Next()

    return {"face": faces, "edge": edges, "vertex": vertices}


def _shape_for_pick(subshapes: dict[str, list], pick: dict[str, Any]):
    kind = pick["kind"]
    index = pick["index"]
    items = subshapes.get(kind) or []
    if index < 0 or index >= len(items):
        return None
    return items[index]


def _entity_props(kind: str, shape) -> dict[str, Any]:
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
    from OCP.BRepGProp import BRepGProp
    from OCP.GeomAbs import GeomAbs_SurfaceType
    from OCP.GProp import GProp_GProps
    from OCP.TopAbs import TopAbs_REVERSED
    from OCP.TopExp import TopExp
    from OCP.gp import gp_Pnt, gp_Vec

    props: dict[str, Any] = {"kind": kind}
    if kind == "vertex":
        props["position"] = _pnt_xyz(BRep_Tool.Pnt_s(shape))
        return props
    if kind == "edge":
        try:
            v1 = TopExp.FirstVertex_s(shape)
            v2 = TopExp.LastVertex_s(shape)
            start = _pnt_xyz(BRep_Tool.Pnt_s(v1))
            end = _pnt_xyz(BRep_Tool.Pnt_s(v2))
        except Exception:
            start = end = [0.0, 0.0, 0.0]
        length = ((end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2 + (end[2] - start[2]) ** 2) ** 0.5
        try:
            gprops = GProp_GProps()
            BRepGProp.LinearProperties_s(shape, gprops)
            length = abs(float(gprops.Mass()))
        except Exception:
            pass
        mid = [
            _round3((start[0] + end[0]) / 2.0),
            _round3((start[1] + end[1]) / 2.0),
            _round3((start[2] + end[2]) / 2.0),
        ]
        try:
            curve = BRepAdaptor_Curve(shape)
            mid = _pnt_xyz(curve.Value(0.5 * (curve.FirstParameter() + curve.LastParameter())))
        except Exception:
            pass
        props.update({"start": start, "end": end, "mid": mid, "length_mm": _round3(length)})
        return props
    gprops = GProp_GProps()
    area = 0.0
    center = [0.0, 0.0, 0.0]
    try:
        BRepGProp.SurfaceProperties_s(shape, gprops)
        area = abs(float(gprops.Mass()))
        center = _pnt_xyz(gprops.CentreOfMass())
    except Exception:
        pass
    planar = False
    normal = [0.0, 0.0, 1.0]
    try:
        surf = BRepAdaptor_Surface(shape)
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
        normal = _vec_xyz(vec, reverse=shape.Orientation() == TopAbs_REVERSED)
    except Exception:
        pass
    props.update(
        {
            "center": center,
            "normal": normal,
            "area_mm2": _round3(area),
            "planar": bool(planar),
        }
    )
    return props


def _extrema_distance(shape_a, shape_b) -> dict[str, Any] | None:
    from OCP.BRepExtrema import BRepExtrema_DistShapeShape

    extrema = BRepExtrema_DistShapeShape(shape_a, shape_b)
    perform = getattr(extrema, "Perform", None)
    if callable(perform):
        perform()
    if not extrema.IsDone() or int(extrema.NbSolution()) < 1:
        return None
    p1 = extrema.PointOnShape1(1)
    p2 = extrema.PointOnShape2(1)
    return {
        "distance_mm": _round3(float(extrema.Value())),
        "point1": _pnt_xyz(p1),
        "point2": _pnt_xyz(p2),
    }


def _single_label(kind: str) -> str:
    return {"vertex": "Corner", "edge": "Edge length", "face": "Face area"}.get(kind, kind.title())


def _pair_label(kind_a: str, kind_b: str) -> str:
    names = {"vertex": "corner", "edge": "edge", "face": "face"}
    a = names.get(kind_a, kind_a)
    b = names.get(kind_b, kind_b)
    if a == b:
        return f"{a.title()} distance"
    return f"{a.title()} to {b} distance"


def measure_kernel_entities(
    step_path: Path,
    pick_a: dict[str, Any] | None,
    pick_b: dict[str, Any] | None = None,
    *,
    max_faces: int = 800,
    max_edges: int = 1600,
    max_vertices: int = 800,
) -> dict[str, Any]:
    """Measure one or two FreeCAD/OCC entities. Distances are millimetres."""
    a = normalize_kernel_pick(pick_a)
    b = normalize_kernel_pick(pick_b) if pick_b else None
    if a is None:
        raise ValueError("Pick a vertex, edge, or face to measure.")
    shape = _load_step_shape(step_path)
    if shape is None:
        raise FileNotFoundError("Could not read the FreeCAD STEP document.")
    subshapes = _collect_kernel_subshapes(
        shape,
        max_faces=max_faces,
        max_edges=max_edges,
        max_vertices=max_vertices,
    )
    shape_a = _shape_for_pick(subshapes, a)
    if shape_a is None:
        raise ValueError(f"Kernel {a['kind']} {a['index']} is not in this document.")
    props_a = _entity_props(a["kind"], shape_a)
    result: dict[str, Any] = {
        "kernel": "freecad",
        "source": "occ",
        "a": {"index": a["index"], **props_a},
        "b": None,
        "label": _single_label(a["kind"]),
        "kind": "length" if a["kind"] != "face" else "area",
        "distance_mm": None,
        "area_mm2": props_a.get("area_mm2"),
        "length_mm": props_a.get("length_mm"),
        "point1": props_a.get("position") or props_a.get("mid") or props_a.get("center"),
        "point2": None,
    }
    if a["kind"] == "vertex":
        result["kind"] = "point"
        result["position_mm"] = props_a.get("position")
    if b is None:
        return result
    shape_b = _shape_for_pick(subshapes, b)
    if shape_b is None:
        raise ValueError(f"Kernel {b['kind']} {b['index']} is not in this document.")
    props_b = _entity_props(b["kind"], shape_b)
    extrema = _extrema_distance(shape_a, shape_b)
    if extrema is None:
        raise ValueError("FreeCAD could not compute that distance.")
    result.update(
        {
            "b": {"index": b["index"], **props_b},
            "label": _pair_label(a["kind"], b["kind"]),
            "kind": "length",
            "distance_mm": extrema["distance_mm"],
            "point1": extrema["point1"],
            "point2": extrema["point2"],
            "area_mm2": None,
            "length_mm": extrema["distance_mm"],
        }
    )
    return result
