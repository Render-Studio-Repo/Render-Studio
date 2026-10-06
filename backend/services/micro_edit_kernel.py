"""Small, allowlisted B-rep edits shared by every CAD harness.

Runs in a time-limited subprocess. Never executes AI-authored Python. Face IDs
belong to the immutable STEP snapshot, not to viewport triangle indices.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path


def vector(value, *, limit=1000):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError("Use three numeric model-space coordinates in millimeters")
    out = [float(n) for n in value]
    if any(not math.isfinite(n) or abs(n) > limit for n in out):
        raise ValueError("Coordinates exceed the micro-edit limit")
    return out


def number(value, lo, hi):
    n = float(value)
    if not math.isfinite(n) or not lo <= n <= hi:
        raise ValueError(f"Value must be between {lo} and {hi}")
    return n


def hole_geometry(face):
    from build123d import GeomType, Vector
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    if face.geom_type != GeomType.CYLINDER: return None
    surface = BRepAdaptor_Surface(face.wrapped)
    if abs(surface.LastUParameter() - surface.FirstUParameter() - 2 * math.pi) > 1e-5:
        return None  # partial cylinders/slots need normal CAD authoring
    cylinder = surface.Cylinder()
    axis = Vector(*cylinder.Axis().Direction().Coord())
    origin = Vector(*cylinder.Location().Coord())
    center = face.center()
    radial = center - origin - axis * ((center - origin).dot(axis))
    if face.normal_at().dot(radial) >= 0: return None  # shaft exterior, not hole
    start, end = surface.FirstVParameter(), surface.LastVParameter()
    return {"radius": cylinder.Radius(), "origin": list(origin + axis * start),
            "axis": list(axis), "depth": end - start}


def describe_face(face, index):
    data = {"id": f"face:{index}", "kind": str(face.geom_type).split(".")[-1].lower(),
            "center_mm": [round(v, 5) for v in face.center()], "area_mm2": round(face.area, 5)}
    hole = hole_geometry(face)
    if hole:
        data["hole"] = {**hole, "diameter_mm": hole["radius"] * 2}
    if data["kind"] == "plane": data["normal"] = list(face.normal_at())
    return data


def _solids(shape):
    # import_step preserves named assembly leaves; propagate their labels/colors.
    out = []
    def visit(node, label="", color=None):
        label = node.label or label
        color = node.color or color
        if node.children:
            for child in node.children: visit(child, label, color)
        else:
            for solid in node.solids():
                solid.label = label or f"Body {len(out) + 1}"
                if color is not None: solid.color = color
                out.append(solid)
    visit(shape)
    return out


def inspect(step, selected=()):
    from build123d import import_step
    solids = _solids(import_step(step))
    if len(solids) > 2048: raise ValueError("Select or export a smaller subassembly (maximum 2,048 solids for micro edits).")
    selected = set(selected or (["body:0"] if len(solids) == 1 else []))
    rows = []
    for index, solid in enumerate(solids):
        body_id = f"body:{index}"
        bounds = solid.bounding_box()
        row = {"id": body_id, "name": solid.label, "size_mm": [round(v, 5) for v in bounds.size],
               "center_mm": [round(v, 5) for v in bounds.center()], "volume_mm3": round(solid.volume, 5)}
        if body_id in selected:
            if len(solid.faces()) > 500: raise ValueError("Selected body has over 500 faces; isolate a simpler mounting part for a fast edit.")
            row["faces"] = [describe_face(f, i) for i, f in enumerate(solid.faces())]
        rows.append(row)
    unknown = selected - {r["id"] for r in rows}
    if unknown: raise ValueError("Selected CAD bodies no longer exist")
    return {"units": "mm", "bodies": rows, "body_count": len(rows), "selected_body_ids": sorted(selected)}


def apply(step, dest, plan, allowed_bodies, allowed_faces=None):
    from build123d import import_step, export_step, Solid, Compound, Plane, Vector, GeomType, Matrix
    solids = _solids(import_step(step))
    original = list(solids)
    faces = {f"body:{i}": list(s.faces()) for i, s in enumerate(solids) if f"body:{i}" in allowed_bodies}
    operations = plan.get("operations")
    if not isinstance(operations, list) or not 1 <= len(operations) <= 8:
        raise ValueError("A micro edit needs 1–8 scoped operations")
    checks, touched, transformed, used_faces, offset_bodies = [], set(), set(), set(), set()
    for op in operations:
        body_id = op.get("body_id")
        if body_id not in faces: raise ValueError("Operation targets a body outside the selection")
        index = int(body_id.split(":")[1]); base = solids[index]
        kind = op.get("op") or op.get("type")
        if op.get("op") and op.get("type") and op["op"] != op["type"]:
            raise ValueError("Conflicting operation names in micro-edit plan")
        face = None
        if kind not in {"move_body", "scale_body"}:
            if body_id in transformed or body_id in offset_bodies:
                raise ValueError("Surface anchors changed earlier in this plan; perform surface edits before body transforms, or use a separate edit")
            face_id = str(op.get("face_id") or "")
            if not face_id.startswith("face:"): raise ValueError("Choose a CAD face ID from inspection")
            fi = int(face_id.split(":")[1])
            if fi < 0 or fi >= len(faces[body_id]): raise ValueError("CAD face ID is invalid")
            if allowed_faces and f"{body_id}/{face_id}" not in allowed_faces:
                raise ValueError("Operation targets a face outside the selection")
            face = faces[body_id][fi]
            key = (body_id, face_id)
            if key in used_faces: raise ValueError("Combine changes to the same face into one operation")
            used_faces.add(key)
            if kind == "offset_face" and index in touched:
                raise ValueError("Face offsets need a separate edit after other surface changes")
        if kind == "move_body":
            delta = vector(op.get("translation_mm"), limit=100)
            if sum(abs(n) for n in delta) < 1e-7: raise ValueError("Move has no effect")
            result = base.translate(Vector(*delta))
            check = {"op": kind, "translation_mm": delta}
        elif kind == "scale_body":
            factors = vector(op.get("factors"), limit=1.25)
            if any(n < .8 for n in factors): raise ValueError("Micro scaling is limited to 0.8–1.25 per axis")
            center = base.bounding_box().center()
            matrix = Matrix([[factors[0],0,0,center.X*(1-factors[0])], [0,factors[1],0,center.Y*(1-factors[1])],
                             [0,0,factors[2],center.Z*(1-factors[2])], [0,0,0,1]])
            result = base.transform_geometry(matrix)
            check = {"op": kind, "factors": factors}
        elif kind in {"resize_hole", "move_hole"}:
            hole = hole_geometry(face)
            if not hole: raise ValueError("Selected face is not a complete cylindrical hole")
            axis, origin = Vector(*hole["axis"]), Vector(*hole["origin"])
            depth, old_radius = hole["depth"], hole["radius"]
            radius = number(op.get("diameter_mm", 2 * old_radius), .2, 100) / 2
            delta = Vector(*vector(op.get("translation_mm", [0,0,0]), limit=30))
            if abs(delta.dot(axis)) > 1e-5: raise ValueError("Move a mounting hole within its mounting plane")
            if radius < old_radius or delta.length > 1e-7:
                # Filling a blind hole can erase an intentional recess. Require both open ends.
                if base.is_inside(origin - axis * .001) or base.is_inside(origin + axis * (depth + .001)):
                    raise ValueError("Hole relocation/shrinking currently requires a through-hole")
                plug = Solid.make_cylinder(old_radius, depth, Plane(origin=origin, z_dir=axis))
                base = base.fuse(plug)
            cutter = Solid.make_cylinder(radius, depth + .002, Plane(origin=origin + delta - axis * .001, z_dir=axis))
            result = base.cut(cutter).clean()
            matches = [hole_geometry(f) for f in result.faces()]
            matches = [h for h in matches if h and abs(h["radius"] - radius) < 1e-5 and
                       (Vector(*h["origin"]) - origin - delta).cross(axis).length < 1e-4]
            if not matches: raise ValueError("Requested complete hole could not be verified (it may intersect an edge or another hole)")
            check = {"op": kind, "diameter_mm": 2 * radius, "translation_mm": list(delta), "hole_verified": True}
        elif kind == "offset_face":
            if face.geom_type != GeomType.PLANE: raise ValueError("Face offset requires a planar CAD face")
            distance = number(op.get("distance_mm"), -20, 20)
            if abs(distance) < .001: raise ValueError("Face offset is too small")
            prism = Solid.extrude(face, face.normal_at() * distance)
            result = (base.fuse(prism) if distance > 0 else base.cut(prism)).clean()
            check = {"op": kind, "distance_mm": distance}
        else:
            raise ValueError("Unsupported micro operation; use regular Edit selected for this change")
        if not result.is_valid() or len(result.solids()) != 1 or result.volume <= 0:
            raise ValueError("Edit would produce an invalid or disconnected solid")
        # Boolean operations can return a single-solid Compound. Its color is
        # ignored by XCAF unless assigned to the actual exported solid leaf.
        result = result.solids()[0]
        result.label, result.color = original[index].label, original[index].color
        solids[index] = result
        if kind in {"move_body", "scale_body"}: transformed.add(body_id)
        if kind == "offset_face": offset_bodies.add(body_id)
        touched.add(index); checks.append({**check, "body_id": body_id})
    preserved = all(solids[i] is original[i] for i in range(len(solids)) if i not in touched)
    if not preserved: raise ValueError("An unselected body changed")
    export_step(Compound(label=Path(dest).stem, children=solids), dest)
    # Existing color-aware preview exporter shares its normal caching/quality policy.
    from backend.services.cad_service import tessellate_step_to_glb
    glb = tessellate_step_to_glb(Path(dest), Path(dest).with_suffix(".glb"), force=True)
    return {"step": str(dest), "glb": str(glb), "checks": checks, "valid": True,
            "body_count": len(solids), "edited_body_ids": [f"body:{i}" for i in sorted(touched)],
            "unselected_bodies_preserved": preserved, "intent_accuracy": "Awaiting user rating"}


if __name__ == "__main__":
    request = json.loads(Path(sys.argv[1]).read_text())
    try:
        if request["action"] == "inspect": result = inspect(request["step"], request.get("body_ids", []))
        else: result = apply(request["step"], request["dest"], request["plan"], request["body_ids"], request.get("face_ids"))
        response = {"ok": True, "result": result}
    except Exception as exc:
        response = {"ok": False, "error": str(exc)[:1800]}
    Path(sys.argv[2]).write_text(json.dumps(response))
