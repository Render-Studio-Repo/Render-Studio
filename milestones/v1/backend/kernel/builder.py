"""Interpret a :class:`FeatureProgram` into exact build123d / OCCT solids.

The builder is deterministic and unit-aware (mm). It supports generic CAD
features and dispatches high-level engineered components (gears, enclosures) to
:mod:`backend.engineering`. Every op validates its inputs and raises
:class:`KernelBuildError` with an actionable message so the AI orchestration
layer can self-repair.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from build123d import (
    Axis,
    Box,
    Cone,
    Cylinder,
    Plane,
    Polygon,
    Pos,
    Rot,
    Sphere,
    Torus,
    chamfer,
    fillet,
    loft,
    mirror,
    offset,
    revolve,
)

from backend.kernel.schema import Feature, FeatureProgram, PartSpec

logger = logging.getLogger(__name__)

# A "part" object in build123d algebra mode (Part / Solid / Compound).
Body = Any


class KernelBuildError(ValueError):
    """Raised when a feature program cannot be realised into valid geometry."""


@dataclass
class BuildResult:
    """Result of building a whole program."""

    program: FeatureProgram
    parts: dict[str, Body] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def part_list(self) -> list[Body]:
        return list(self.parts.values())


# --------------------------------------------------------------------------- #
# Placement / boolean helpers
# --------------------------------------------------------------------------- #
def _nonzero(vec: list[float]) -> bool:
    return any(abs(float(x)) > 1e-12 for x in vec)


def _place(body: Body, at: list[float], rotation: list[float]) -> Body:
    """Apply intrinsic XYZ rotation (deg) then translation (mm)."""
    if _nonzero(rotation):
        body = Rot(float(rotation[0]), float(rotation[1]), float(rotation[2])) * body
    if _nonzero(at):
        body = Pos(float(at[0]), float(at[1]), float(at[2])) * body
    return body


def _combine(running: Body | None, body: Body, mode: str) -> Body:
    if running is None or mode == "new":
        return body
    if mode == "add":
        return running + body
    if mode == "cut":
        return running - body
    if mode == "intersect":
        return running & body
    raise KernelBuildError(f"unknown combine mode '{mode}'")


# --------------------------------------------------------------------------- #
# Parameter coercion
# --------------------------------------------------------------------------- #
def _num(params: dict[str, Any], *names: str, default: float | None = None, required: bool = False) -> float:
    for n in names:
        if n in params and params[n] is not None:
            try:
                return float(params[n])
            except (TypeError, ValueError) as exc:
                raise KernelBuildError(f"parameter '{n}' must be a number, got {params[n]!r}") from exc
    if required:
        raise KernelBuildError(f"missing required parameter (one of {names})")
    return float(default if default is not None else 0.0)


def _size3(params: dict[str, Any]) -> tuple[float, float, float]:
    if "size" in params and isinstance(params["size"], (list, tuple)) and len(params["size"]) == 3:
        x, y, z = params["size"]
        return float(x), float(y), float(z)
    return (
        _num(params, "length", "x", "width_x", required=True),
        _num(params, "width", "y", "depth", required=True),
        _num(params, "height", "z", "thickness", required=True),
    )


def _points2d(raw: Any) -> list[tuple[float, float]]:
    if not isinstance(raw, (list, tuple)) or len(raw) < 3:
        raise KernelBuildError("profile needs at least 3 [x,y] points")
    pts: list[tuple[float, float]] = []
    for p in raw:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise KernelBuildError(f"profile point must be [x,y], got {p!r}")
        pts.append((float(p[0]), float(p[1])))
    return pts


# --------------------------------------------------------------------------- #
# Primitive builders (centered at origin in their natural frame)
# --------------------------------------------------------------------------- #
def _make_box(params: dict[str, Any]) -> Body:
    x, y, z = _size3(params)
    if min(x, y, z) <= 0:
        raise KernelBuildError("box dimensions must be > 0")
    return Box(x, y, z)


def _make_cylinder(params: dict[str, Any]) -> Body:
    r = _num(params, "radius", "r", default=0.0)
    if r <= 0:
        d = _num(params, "diameter", "d", required=True)
        r = d / 2.0
    h = _num(params, "height", "h", "length", required=True)
    if r <= 0 or h <= 0:
        raise KernelBuildError("cylinder radius and height must be > 0")
    return Cylinder(r, h)


def _make_cone(params: dict[str, Any]) -> Body:
    rb = _num(params, "bottom_radius", "radius", "r1", required=True)
    rt = _num(params, "top_radius", "r2", default=0.0)
    h = _num(params, "height", "h", required=True)
    if rb <= 0 or h <= 0 or rt < 0:
        raise KernelBuildError("cone bottom_radius>0, height>0, top_radius>=0 required")
    return Cone(rb, rt, h)


def _make_sphere(params: dict[str, Any]) -> Body:
    r = _num(params, "radius", "r", default=0.0)
    if r <= 0:
        r = _num(params, "diameter", "d", required=True) / 2.0
    if r <= 0:
        raise KernelBuildError("sphere radius must be > 0")
    return Sphere(r)


def _make_torus(params: dict[str, Any]) -> Body:
    major = _num(params, "major_radius", "radius", required=True)
    minor = _num(params, "minor_radius", "tube", required=True)
    if major <= 0 or minor <= 0:
        raise KernelBuildError("torus radii must be > 0")
    return Torus(major, minor)


def _make_extrude(params: dict[str, Any]) -> Body:
    pts = _points2d(params.get("profile"))
    amount = _num(params, "height", "amount", "thickness", required=True)
    if amount <= 0:
        raise KernelBuildError("extrude height must be > 0")
    from build123d import extrude as _extrude  # local: avoid shadowing

    face = Polygon(*pts, align=None)
    return _extrude(face, amount=amount)


def _make_revolve(params: dict[str, Any]) -> Body:
    # profile points are [radius, z] in the X-Z plane, revolved about Z.
    pts = _points2d(params.get("profile"))
    if any(r < -1e-9 for r, _ in pts):
        raise KernelBuildError("revolve profile radii (x) must be >= 0")
    angle = _num(params, "angle", "arc", default=360.0)
    face = Plane.XZ * Polygon(*pts, align=None)
    return revolve(face, Axis.Z, revolution_arc=angle)


def _make_loft(params: dict[str, Any]) -> Body:
    sections_raw = params.get("sections")
    if not isinstance(sections_raw, (list, tuple)) or len(sections_raw) < 2:
        raise KernelBuildError("loft needs >= 2 sections")
    sketches = []
    for sec in sections_raw:
        z = float(sec.get("z", 0.0))
        plane = Plane(origin=(0, 0, z))
        if "radius" in sec or "diameter" in sec:
            from build123d import Circle

            r = float(sec.get("radius", sec.get("diameter", 0) / 2.0))
            sketches.append(plane * Circle(r))
        elif "width" in sec and "height" in sec:
            from build123d import Rectangle

            sketches.append(plane * Rectangle(float(sec["width"]), float(sec["height"])))
        elif "profile" in sec:
            sketches.append(plane * Polygon(*_points2d(sec["profile"]), align=None))
        else:
            raise KernelBuildError("loft section needs radius | (width,height) | profile")
    return loft(sketches)


PRIMITIVES: dict[str, Callable[[dict[str, Any]], Body]] = {
    "box": _make_box,
    "cylinder": _make_cylinder,
    "cone": _make_cone,
    "sphere": _make_sphere,
    "torus": _make_torus,
    "extrude": _make_extrude,
    "revolve": _make_revolve,
    "loft": _make_loft,
}


# --------------------------------------------------------------------------- #
# Selectors for fillet / chamfer / shell
# --------------------------------------------------------------------------- #
_AXES = {"X": Axis.X, "Y": Axis.Y, "Z": Axis.Z}
_FACE_BY_NAME = {
    "top": ("Z", "max"),
    "bottom": ("Z", "min"),
    "right": ("X", "max"),
    "left": ("X", "min"),
    "front": ("Y", "min"),
    "back": ("Y", "max"),
}


def _select_edges(body: Body, sel: Any):
    edges = body.edges()
    if sel in (None, "all", ""):
        return edges
    if isinstance(sel, str):
        s = sel.lower()
        if s in ("vertical", "z"):
            return edges.filter_by(Axis.Z)
        if s in ("horizontal",):
            return edges.filter_by(Axis.X) + edges.filter_by(Axis.Y)
        if s in _FACE_BY_NAME:
            axis_name, extreme = _FACE_BY_NAME[s]
            faces = body.faces().group_by(_AXES[axis_name])
            face = faces[-1] if extreme == "max" else faces[0]
            return face.edges()
        raise KernelBuildError(f"unknown edge selector '{sel}'")
    if isinstance(sel, dict):
        if "parallel_to" in sel:
            return edges.filter_by(_AXES[str(sel["parallel_to"]).upper()])
        if "axis" in sel and "extreme" in sel:
            groups = edges.group_by(_AXES[str(sel["axis"]).upper()])
            return groups[-1] if sel["extreme"] == "max" else groups[0]
    raise KernelBuildError(f"unsupported edge selector: {sel!r}")


def _select_faces(body: Body, sel: Any):
    faces = body.faces()
    if sel in (None, "all", ""):
        return faces
    if isinstance(sel, str) and sel.lower() in _FACE_BY_NAME:
        axis_name, extreme = _FACE_BY_NAME[sel.lower()]
        grouped = faces.group_by(_AXES[axis_name])
        return grouped[-1] if extreme == "max" else grouped[0]
    if isinstance(sel, dict) and "axis" in sel and "extreme" in sel:
        grouped = faces.group_by(_AXES[str(sel["axis"]).upper()])
        return grouped[-1] if sel["extreme"] == "max" else grouped[0]
    raise KernelBuildError(f"unsupported face selector: {sel!r}")


# --------------------------------------------------------------------------- #
# Modifier ops (operate on the running solid)
# --------------------------------------------------------------------------- #
def _op_fillet(running: Body, params: dict[str, Any]) -> Body:
    if running is None:
        raise KernelBuildError("fillet requires an existing solid")
    radius = _num(params, "radius", "r", required=True)
    if radius <= 0:
        raise KernelBuildError("fillet radius must be > 0")
    edges = _select_edges(running, params.get("edges"))
    if not edges:
        raise KernelBuildError("fillet selected no edges")
    return fillet(edges, radius=radius)


def _op_chamfer(running: Body, params: dict[str, Any]) -> Body:
    if running is None:
        raise KernelBuildError("chamfer requires an existing solid")
    length = _num(params, "length", "distance", "size", required=True)
    if length <= 0:
        raise KernelBuildError("chamfer length must be > 0")
    edges = _select_edges(running, params.get("edges"))
    if not edges:
        raise KernelBuildError("chamfer selected no edges")
    return chamfer(edges, length=length)


def _op_shell(running: Body, params: dict[str, Any]) -> Body:
    if running is None:
        raise KernelBuildError("shell requires an existing solid")
    thickness = _num(params, "thickness", "wall", required=True)
    if thickness <= 0:
        raise KernelBuildError("shell thickness must be > 0")
    openings = None
    if params.get("openings"):
        openings = _select_faces(running, params["openings"])
    # Negative amount hollows inward, leaving a wall of `thickness`.
    return offset(running, amount=-thickness, openings=openings)


def _op_transform(running: Body, params: dict[str, Any]) -> Body:
    if running is None:
        raise KernelBuildError("transform requires an existing solid")
    body = running
    rot = params.get("rotation") or [0, 0, 0]
    trans = params.get("translation") or params.get("at") or [0, 0, 0]
    if _nonzero(rot):
        body = Rot(float(rot[0]), float(rot[1]), float(rot[2])) * body
    if _nonzero(trans):
        body = Pos(float(trans[0]), float(trans[1]), float(trans[2])) * body
    if params.get("scale"):
        body = body.scale(float(params["scale"]))
    return body


def _op_pattern(running: Body | None, feat: Feature) -> Body:
    """Replicate a feature in a linear or polar array.

    Two modes:
      * with an ``of`` sub-feature  -> build that feature and array it, then
        combine with the running solid using ``feat.combine`` (classic);
      * without ``of``              -> array the *running solid* itself (the
        Fusion-style "pattern this body"), replacing the running solid.
    """
    params = feat.params()
    sub_raw = params.get("of") or params.get("feature")
    pattern_body = not isinstance(sub_raw, dict)
    if pattern_body:
        if running is None:
            raise KernelBuildError("pattern needs an 'of' sub-feature or an existing solid to array")
        base = running
    else:
        sub = Feature.model_validate(sub_raw)
        base = _build_primitive_body(sub)
        base = _place(base, sub.at, sub.rotation)

    arrange = str(params.get("arrange", "linear")).lower()
    count = int(params.get("count", 0))
    if count < 1:
        raise KernelBuildError("pattern count must be >= 1")

    copies: list[Body] = []
    if arrange == "linear":
        spacing = params.get("spacing", [0, 0, 0])
        if not (isinstance(spacing, (list, tuple)) and len(spacing) == 3):
            raise KernelBuildError("linear pattern needs spacing [dx,dy,dz]")
        for i in range(count):
            copies.append(Pos(spacing[0] * i, spacing[1] * i, spacing[2] * i) * base)
    elif arrange == "polar":
        total = _num(params, "angle", default=360.0)
        radius = _num(params, "radius", default=0.0)
        axis = params.get("axis", [0, 0, 1])
        if not (isinstance(axis, (list, tuple)) and len(axis) == 3):
            raise KernelBuildError("polar pattern axis must be [x,y,z]")
        # Dominant axis component selects the rotation axis (Z default).
        dom = max(range(3), key=lambda k: abs(float(axis[k])))
        # Even spacing; a full 360 sweep avoids a duplicate at 0 and 360.
        denom = count if abs(total - 360.0) < 1e-6 else max(count - 1, 1)
        for i in range(count):
            ang = total * i / denom
            placed = Pos(radius, 0, 0) * base if radius else base
            rot = [0.0, 0.0, 0.0]
            rot[dom] = ang
            copies.append(Rot(rot[0], rot[1], rot[2]) * placed)
    else:
        raise KernelBuildError(f"unknown pattern arrange '{arrange}'")

    merged = copies[0]
    for c in copies[1:]:
        merged = merged + c
    # When arraying the running body, copies[0] is the body itself, so the
    # merged compound already contains the original — replace the running solid.
    if pattern_body:
        return merged
    return _combine(running, merged, feat.combine)


_MIRROR_PLANES = {
    "XY": Plane.XY,
    "XZ": Plane.XZ,
    "YZ": Plane.YZ,
}


def _op_mirror(running: Body, params: dict[str, Any]) -> Body:
    """Mirror the running solid across a principal plane.

    ``keep_original`` (default true) unions the reflection with the source for a
    symmetric body; set it false to replace the body with only its reflection.
    """
    if running is None:
        raise KernelBuildError("mirror requires an existing solid")
    plane_name = str(params.get("plane", "YZ")).upper()
    plane = _MIRROR_PLANES.get(plane_name)
    if plane is None:
        raise KernelBuildError(f"unknown mirror plane '{plane_name}' (use XY | XZ | YZ)")
    reflected = mirror(running, about=plane)
    keep = params.get("keep_original", True)
    if keep in (False, "false", 0, "0"):
        return reflected
    return running + reflected


# --------------------------------------------------------------------------- #
# Engineered component dispatch (gears, enclosures, ...)
# --------------------------------------------------------------------------- #
def _build_engineered(op: str, params: dict[str, Any]) -> Body | None:
    """Return a build123d body for high-level ops, or None if not engineered."""
    if op in ("spur_gear", "gear"):
        from backend.engineering.gears import spur_gear_solid

        return spur_gear_solid(params)
    if op == "escape_wheel":
        from backend.engineering.escapement import escape_wheel_solid

        return escape_wheel_solid(params)
    if op in ("enclosure_for_spec", "enclosure"):
        from backend.engineering.enclosures import enclosure_body_for_op

        return enclosure_body_for_op(params)
    if op == "board_blank":
        # A solid representing the real board volume (for fit-check / visualization).
        from backend.engineering.enclosures import board_blank_body

        return board_blank_body(params)
    return None


# --------------------------------------------------------------------------- #
# Feature dispatch
# --------------------------------------------------------------------------- #
def _build_primitive_body(feat: Feature) -> Body:
    op = feat.op
    params = feat.params()
    if op in PRIMITIVES:
        return PRIMITIVES[op](params)
    engineered = _build_engineered(op, params)
    if engineered is not None:
        return engineered
    raise KernelBuildError(f"'{op}' is not a primitive/engineered body op")


# Convenience cut op: a through/blind hole = a placed cylinder subtracted.
def _op_hole(running: Body | None, feat: Feature) -> Body:
    if running is None:
        raise KernelBuildError("hole requires an existing solid")
    params = feat.params()
    r = _num(params, "radius", default=0.0)
    if r <= 0:
        r = _num(params, "diameter", "d", required=True) / 2.0
    through = bool(params.get("through", True))
    if through:
        bbox = running.bounding_box()
        depth = (bbox.max.Z - bbox.min.Z) + 4.0  # span the part along local Z
    else:
        depth = _num(params, "depth", required=True)
    cutter = Cylinder(r, depth)
    cutter = _place(cutter, feat.at, feat.rotation)
    return running - cutter


MODIFIERS: dict[str, Callable[[Body, dict[str, Any]], Body]] = {
    "fillet": _op_fillet,
    "chamfer": _op_chamfer,
    "shell": _op_shell,
    "mirror": _op_mirror,
    "transform": _op_transform,
    "move": _op_transform,
}


def _apply_feature(running: Body | None, feat: Feature, part_id: str, idx: int) -> Body:
    op = feat.op
    try:
        if op in MODIFIERS:
            return MODIFIERS[op](running, feat.params())
        if op == "pattern":
            return _op_pattern(running, feat)
        if op == "hole":
            return _op_hole(running, feat)
        # primitive or engineered body -> place + combine
        body = _build_primitive_body(feat)
        body = _place(body, feat.at, feat.rotation)
        mode = "new" if running is None else feat.combine
        return _combine(running, body, mode)
    except KernelBuildError:
        raise
    except Exception as exc:  # OCCT / build123d failure
        raise KernelBuildError(
            f"part '{part_id}' feature #{idx} ('{op}') failed: {exc}"
        ) from exc


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def build_part(part: PartSpec) -> Body:
    """Build a single part from its ordered feature list."""
    running: Body | None = None
    for idx, feat in enumerate(part.features):
        running = _apply_feature(running, feat, part.id, idx)
    if running is None:
        raise KernelBuildError(f"part '{part.id}' produced no geometry")
    if part.placement and _nonzero(part.placement):
        running = Pos(*[float(v) for v in part.placement]) * running
    return running


def build_program(program: FeatureProgram) -> BuildResult:
    """Build every part in a program. Raises :class:`KernelBuildError` on failure."""
    result = BuildResult(program=program)
    for part in program.parts:
        body = build_part(part)
        vol = float(getattr(body, "volume", 0.0) or 0.0)
        if vol <= 1e-9:
            raise KernelBuildError(f"part '{part.id}' has zero/empty volume")
        result.parts[part.id] = body
    return result
