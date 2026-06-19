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
    Kind,
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

from backend.kernel.errors import KernelBuildError
from backend.kernel.schema import Feature, FeatureProgram, PartSpec

logger = logging.getLogger(__name__)

# A "part" object in build123d algebra mode (Part / Solid / Compound).
Body = Any


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
    from build123d import Vector, extrude as _extrude  # local: avoid shadowing

    plane_ref = params.get("plane_ref")
    if isinstance(plane_ref, dict) and isinstance(plane_ref.get("origin"), (list, tuple)):
        try:
            origin = Vector(*[float(x) for x in plane_ref["origin"][:3]])
            x_dir = Vector(*[float(x) for x in (plane_ref.get("u_axis") or [1, 0, 0])[:3]])
            z_dir = Vector(*[float(x) for x in (plane_ref.get("normal") or [0, 0, 1])[:3]])
            pl = Plane(origin=origin, x_dir=x_dir, z_dir=z_dir)
            face = pl * Polygon(*pts, align=None)
            return _extrude(face, amount=amount)
        except Exception as exc:
            raise KernelBuildError(f"invalid face sketch plane: {exc}") from exc

    plane = str(params.get("plane", "XY")).upper()
    if plane == "XZ":
        face = Plane.XZ * Polygon(*pts, align=None)
    elif plane == "YZ":
        face = Plane.YZ * Polygon(*pts, align=None)
    else:
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


_EDGE_ALIASES = {
    "outside": "all",
    "outer": "all",
    "external": "all",
    "round": "all",
    "rounded": "all",
    "circular": "vertical",
    "circumferential": "vertical",
}


def _edge_count(edges) -> int:
    try:
        return len(edges)
    except TypeError:
        return 0


def _face_count(faces) -> int:
    if faces is None:
        return 0
    try:
        return len(faces)
    except TypeError:
        return 1


def _bbox_min_extent(body: Body) -> float:
    bbox = body.bounding_box()
    return min(
        float(bbox.max.X - bbox.min.X),
        float(bbox.max.Y - bbox.min.Y),
        float(bbox.max.Z - bbox.min.Z),
    )


_SHELL_OPENING_AXES = {
    "top": (Axis.Z, True),
    "bottom": (Axis.Z, False),
    "front": (Axis.Y, False),
    "back": (Axis.Y, True),
    "left": (Axis.X, False),
    "right": (Axis.X, True),
}


def _shell_openings(body: Body, sel: Any):
    """Resolve faces to remove for a shell; ``None`` leaves all faces closed."""
    if sel in (None, "", "all"):
        return None
    try:
        faces = _select_faces(body, sel)
        if _face_count(faces) > 0:
            return faces
    except KernelBuildError:
        pass
    if isinstance(sel, str):
        key = sel.lower()
        if key in _SHELL_OPENING_AXES:
            axis, want_max = _SHELL_OPENING_AXES[key]
            direction = axis.direction
            best = None
            best_score = float("-inf")
            for face in body.faces():
                normal = face.normal_at()
                align = float(normal.dot(direction))
                if abs(align) < 0.5:
                    continue
                center = face.center()
                coord = float(getattr(center, axis.name, 0.0))
                score = align + (coord if want_max else -coord) * 1e-6
                if score > best_score:
                    best_score = score
                    best = face
            if best is not None:
                logger.warning(
                    "Shell openings=%r had no grouped faces — using best-matching face",
                    sel,
                )
                return best
    logger.warning("Shell openings=%r could not be resolved — omitting openings", sel)
    return None


def _valid_shelled_body(body: Body) -> bool:
    if body is None:
        return False
    try:
        wrapped = getattr(body, "wrapped", None)
        if wrapped is not None and wrapped.IsNull():
            return False
        return float(body.volume) > 0
    except Exception:
        return False


def _select_edges(body: Body, sel: Any):
    edges = body.edges()
    if sel in (None, "all", ""):
        return edges
    if isinstance(sel, str):
        s = sel.lower()
        if s in _EDGE_ALIASES:
            s = _EDGE_ALIASES[s]
        if s in ("all",):
            return edges
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
    running = _ensure_body(running, name="fillet target")
    radius = _num(params, "radius", "r", required=True)
    if radius <= 0:
        raise KernelBuildError("fillet radius must be > 0")
    sel = params.get("edges")
    edges = _select_edges(running, sel)
    if _edge_count(edges) == 0 and sel not in (None, "all", ""):
        logger.warning("Fillet selector %r matched no edges — retrying with all edges", sel)
        edges = _select_edges(running, "all")
    if _edge_count(edges) == 0:
        logger.warning("Skipping fillet radius=%s: no edges on solid", radius)
        return running
    last_exc: Exception | None = None
    for factor in (1.0, 0.5, 0.25, 0.1, 0.05):
        r = radius * factor
        if r <= 1e-6:
            continue
        try:
            return fillet(edges, radius=r)
        except Exception as exc:
            last_exc = exc
    logger.warning("Skipping failed fillet radius=%s selector=%s: %s", radius, params.get("edges"), last_exc)
    return running


def _op_chamfer(running: Body, params: dict[str, Any]) -> Body:
    if running is None:
        raise KernelBuildError("chamfer requires an existing solid")
    running = _ensure_body(running, name="chamfer target")
    length = _num(params, "length", "distance", "size", required=True)
    if length <= 0:
        raise KernelBuildError("chamfer length must be > 0")
    sel = params.get("edges")
    edges = _select_edges(running, sel)
    if _edge_count(edges) == 0 and sel not in (None, "all", ""):
        logger.warning("Chamfer selector %r matched no edges — retrying with all edges", sel)
        edges = _select_edges(running, "all")
    if _edge_count(edges) == 0:
        logger.warning("Skipping chamfer length=%s: no edges on solid", length)
        return running
    last_exc: Exception | None = None
    for factor in (1.0, 0.5, 0.25, 0.1, 0.05):
        d = length * factor
        if d <= 1e-6:
            continue
        try:
            return chamfer(edges, length=d)
        except Exception as exc:
            last_exc = exc
    logger.warning("Skipping failed chamfer length=%s selector=%s: %s", length, params.get("edges"), last_exc)
    return running


def _op_shell(running: Body, params: dict[str, Any]) -> Body:
    if running is None:
        raise KernelBuildError("shell requires an existing solid")
    running = _ensure_body(running, name="shell target")
    requested = _num(params, "thickness", "wall", required=True)
    if requested <= 0:
        raise KernelBuildError("shell thickness must be > 0")

    min_extent = _bbox_min_extent(running)
    max_safe = max(min_extent * 0.45, 0.05)
    thickness = min(requested, max_safe)
    if thickness < requested:
        logger.warning(
            "Shell thickness clamped from %s to %s (min part extent %.2f mm)",
            requested,
            thickness,
            min_extent,
        )

    openings_sel = params.get("openings")
    resolved_openings = _shell_openings(running, openings_sel) if openings_sel else None
    opening_variants = [resolved_openings, None] if openings_sel else [None]

    last_exc: Exception | None = None
    for thick_factor in (1.0, 0.75, 0.5, 0.35, 0.25, 0.15, 0.1):
        t = thickness * thick_factor
        if t < 0.05:
            continue
        for openings in opening_variants:
            for kind in (Kind.ARC, Kind.INTERSECTION):
                try:
                    result = offset(running, amount=-t, openings=openings, kind=kind)
                    if _valid_shelled_body(result):
                        if (
                            thick_factor < 1.0
                            or kind != Kind.ARC
                            or (openings is None and resolved_openings is not None)
                        ):
                            logger.warning(
                                "Shell recovered with thickness=%.3f kind=%s openings=%r",
                                t,
                                kind.name,
                                openings_sel if openings is not None else None,
                            )
                        return result
                except Exception as exc:
                    last_exc = exc

    logger.warning(
        "Skipping failed shell thickness=%s openings=%r: %s",
        requested,
        openings_sel,
        last_exc,
    )
    return running


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


def _is_vec3(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) == 3
        and all(isinstance(x, (int, float)) for x in value)
    )


def _vec3(value: Any, *, name: str) -> tuple[float, float, float]:
    if _is_vec3(value):
        return float(value[0]), float(value[1]), float(value[2])
    raise KernelBuildError(f"{name} must be [x,y,z] numbers")


def _ensure_body(body: Body, *, name: str = "pattern body") -> Body:
    if body is None:
        raise KernelBuildError(f"{name} is missing")
    if type(body).__name__ == "ShapeList":
        try:
            n = len(body)
        except TypeError:
            n = 0
        if n == 0:
            raise KernelBuildError(f"{name} is empty")
        merged = body[0]
        for item in body[1:]:
            merged = merged + _ensure_body(item, name=name)
        return merged
    if isinstance(body, list):
        if not body:
            raise KernelBuildError(f"{name} is empty")
        merged = body[0]
        for item in body[1:]:
            merged = merged + _ensure_body(item, name=name)
        return merged
    return body


def _parse_pattern_locations(params: dict[str, Any]) -> list[tuple[float, float, float]] | None:
    raw = params.get("locations") or params.get("positions") or params.get("instances") or params.get("offsets")
    if raw is None:
        return None
    if not isinstance(raw, (list, tuple)) or not raw:
        raise KernelBuildError("pattern locations must be a non-empty list of [x,y,z]")
    if not all(isinstance(item, (list, tuple)) for item in raw):
        raise KernelBuildError("pattern locations must be a list of [x,y,z] points")
    return [_vec3(item, name=f"locations[{i}]") for i, item in enumerate(raw)]


def _normalize_linear_spacing(spacing: Any) -> tuple[float, float, float]:
    if isinstance(spacing, dict):
        return (
            float(spacing.get("x", spacing.get("dx", 0.0))),
            float(spacing.get("y", spacing.get("dy", 0.0))),
            float(spacing.get("z", spacing.get("dz", 0.0))),
        )
    if isinstance(spacing, (int, float)):
        return float(spacing), 0.0, 0.0
    if isinstance(spacing, (list, tuple)):
        if len(spacing) == 3 and all(isinstance(x, (int, float)) for x in spacing):
            return float(spacing[0]), float(spacing[1]), float(spacing[2])
        if spacing and all(isinstance(x, (list, tuple)) and len(x) == 3 for x in spacing):
            raise KernelBuildError(
                "pattern spacing looks like a list of positions; use 'locations' instead"
            )
    raise KernelBuildError("linear pattern needs spacing [dx,dy,dz], a number, or {x,y,z}")


def _build_pattern_base(running: Body | None, params: dict[str, Any]) -> tuple[Body, bool]:
    """Return (base_body, pattern_running_body)."""
    sub_raw = params.get("of") or params.get("feature")
    if isinstance(sub_raw, list):
        if not sub_raw:
            raise KernelBuildError("pattern 'of' list is empty")
        merged: Body | None = None
        for item in sub_raw:
            if not isinstance(item, dict):
                raise KernelBuildError("pattern 'of' list items must be feature objects")
            sub = Feature.model_validate(item)
            body = _place(_build_primitive_body(sub), sub.at, sub.rotation)
            merged = body if merged is None else merged + body
        return _ensure_body(merged, name="pattern of"), False
    if isinstance(sub_raw, dict):
        sub = Feature.model_validate(sub_raw)
        base = _place(_build_primitive_body(sub), sub.at, sub.rotation)
        return _ensure_body(base, name="pattern of"), False
    if running is None:
        raise KernelBuildError("pattern needs an 'of' sub-feature or an existing solid to array")
    return _ensure_body(running, name="running solid"), True


def _op_pattern(running: Body | None, feat: Feature) -> Body:
    """Replicate a feature in a linear or polar array.

    Two modes:
      * with an ``of`` sub-feature  -> build that feature and array it, then
        combine with the running solid using ``feat.combine`` (classic);
      * without ``of``              -> array the *running solid* itself (the
        Fusion-style "pattern this body"), replacing the running solid.
    """
    params = feat.params()
    base, pattern_body = _build_pattern_base(running, params)

    arrange = str(params.get("arrange", "linear")).lower()
    if arrange in ("circular", "radial", "around"):
        arrange = "polar"
    if arrange == "grid":
        arrange = "rectangular"

    locations = _parse_pattern_locations(params)
    count = int(params.get("count", 0) or 0)
    if count < 1 and locations:
        count = len(locations)

    # For rectangular patterns, infer count from x_count * y_count if available
    if count < 1 and arrange == "rectangular":
        xc = int(params.get("x_count", params.get("count_x", 0)) or 0)
        yc = int(params.get("y_count", params.get("count_y", 0)) or 0)
        if xc >= 1 and yc >= 1:
            count = xc * yc

    if count < 1:
        raise KernelBuildError("pattern count must be >= 1 (or provide locations)")

    copies: list[Body] = []
    if locations:
        for x, y, z in locations:
            copies.append(Pos(x, y, z) * base)
    elif arrange == "linear":
        spacing = _normalize_linear_spacing(params.get("spacing", [0, 0, 0]))
        for i in range(count):
            copies.append(Pos(spacing[0] * i, spacing[1] * i, spacing[2] * i) * base)
    elif arrange == "rectangular":
        x_count = int(params.get("x_count", params.get("count_x", count)))
        y_count = int(params.get("y_count", params.get("count_y", 1)))
        x_spacing = float(params.get("x_spacing", params.get("spacing_x", 0.0)))
        y_spacing = float(params.get("y_spacing", params.get("spacing_y", 0.0)))
        if x_count < 1 or y_count < 1:
            raise KernelBuildError("rectangular pattern needs x_count and y_count >= 1")
        for iy in range(y_count):
            for ix in range(x_count):
                copies.append(Pos(ix * x_spacing, iy * y_spacing, 0) * base)
    elif arrange == "polar":
        total = _num(params, "angle", default=360.0)
        radius = _num(params, "radius", default=0.0)
        axis = params.get("axis", [0, 0, 1])
        if not _is_vec3(axis):
            raise KernelBuildError("polar pattern axis must be [x,y,z]")
        dom = max(range(3), key=lambda k: abs(float(axis[k])))
        denom = count if abs(total - 360.0) < 1e-6 else max(count - 1, 1)
        for i in range(count):
            ang = total * i / denom
            placed = Pos(radius, 0, 0) * base
            rot = [0.0, 0.0, 0.0]
            rot[dom] = ang
            copies.append(Rot(rot[0], rot[1], rot[2]) * placed)
    else:
        raise KernelBuildError(f"unknown pattern arrange '{arrange}'")

    if not copies:
        raise KernelBuildError("pattern produced no copies")

    merged = copies[0]
    for c in copies[1:]:
        merged = merged + c
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
    if op in ("ring_gear", "internal_gear"):
        from backend.engineering.gears import ring_gear_solid

        return ring_gear_solid(params)
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
    if op == "component_fixture":
        from backend.engineering.fixtures import component_fixture_body

        return component_fixture_body(params)
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


def _op_hole(running: Body | None, feat: Feature) -> Body:
    """Through/blind hole = a placed cylinder subtracted from the running solid.

    For through holes, the cutter spans the full bounding box diagonal to
    guarantee it passes through regardless of orientation.
    """
    if running is None:
        raise KernelBuildError("hole requires an existing solid")
    running = _ensure_body(running, name="hole target")
    params = feat.params()
    r = _num(params, "radius", default=0.0)
    if r <= 0:
        r = _num(params, "diameter", "d", required=True) / 2.0
    through = bool(params.get("through", True))
    if through:
        bbox = running.bounding_box()
        diagonal = ((bbox.max.X - bbox.min.X) ** 2 +
                     (bbox.max.Y - bbox.min.Y) ** 2 +
                     (bbox.max.Z - bbox.min.Z) ** 2) ** 0.5
        depth = diagonal + 4.0
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
def _volume_error_detail(part: PartSpec, body: Body) -> str:
    """Actionable hint when a part builds but has no solid volume."""
    ops = [str(f.op) for f in part.features if not (f.__pydantic_extra__ or {}).get("suppressed")]
    tail = ", ".join(ops[-4:]) if ops else "none"
    combines = [
        str((f.params() or {}).get("combine", "new" if i == 0 else "?"))
        for i, f in enumerate(part.features)
        if f.op not in ("fillet", "chamfer", "shell", "mirror")
    ][-4:]
    return (
        f"part '{part.id}' has zero/empty volume ({len(part.features)} features; "
        f"last ops: {tail}; recent combine modes: {', '.join(combines) or 'n/a'}). "
        "Usually caused by cut/intersect removing all material, booleans that do not overlap, "
        "or an 'assembly' part with no solid base (box/cylinder/revolve/extrude first)."
    )


def build_part(part: PartSpec) -> Body:
    """Build a single part from its ordered feature list."""
    running: Body | None = None
    for idx, feat in enumerate(part.features):
        # Feature-timeline suppression: skip without removing from the program.
        if (feat.__pydantic_extra__ or {}).get("suppressed"):
            continue
        running = _apply_feature(running, feat, part.id, idx)
    if running is None:
        raise KernelBuildError(f"part '{part.id}' produced no geometry")
    if part.placement and _nonzero(part.placement):
        running = Pos(*[float(v) for v in part.placement]) * running
    return running


def _part_features_are_origin_centered(part: PartSpec) -> bool:
    """Return True if all solid-add features have zero (or no) 'at' params.

    When True the part's geometric mass is near local origin and the joint
    anchor is the only positioning signal.  When False the part's features
    already encode absolute world coordinates in their 'at' fields, so adding
    a joint offset would double-count the translation.
    """
    MODIFIER_OPS = {"fillet", "chamfer", "shell", "mirror", "pattern"}
    for feat in part.features:
        if str(feat.op) in MODIFIER_OPS:
            continue
        at = feat.at if hasattr(feat, "at") else (feat.__pydantic_extra__ or {}).get("at")
        if at and _nonzero(at):
            return False
    return True


def _compute_world_positions(program: FeatureProgram) -> dict[str, list[float]]:
    """Resolve each part's world-space origin from joints or explicit placement.

    **Anchor semantics (how the AI generates joints):**
    The AI consistently emits joint anchors as WORLD-ABSOLUTE coordinates, not as
    parent-relative offsets.  Summing up the hierarchy therefore double-counts parent
    positions and sends parts miles off target.  We treat anchor directly as the
    child's world origin.

    This matches how every observed multi-level assembly is authored:
      - base at anchor [0,0,0]   → world [0,0,0]   ✓
      - column at anchor [-170,122,92]  → world [-170,122,92]  ✓
      - bridge at anchor [-170,122,438] → world [-170,122,438] ✓ (NOT −340,244,530)

    Parts with explicit `placement` always override joint-derived positions.
    Joint-derived translation is only applied when part features are origin-centred.
    """
    # Map child_id → anchor (treated as world-absolute position)
    child_to_anchor: dict[str, list[float]] = {}
    for joint in (program.joints or []):
        if joint.child and joint.parent and joint.anchor:
            child_to_anchor[joint.child] = list(joint.anchor)

    def world_pos(part_id: str, depth: int = 0) -> list[float]:
        # Anchor IS the world position — use it directly.
        if part_id not in child_to_anchor:
            return [0.0, 0.0, 0.0]
        return child_to_anchor[part_id]

    # Build a lookup of part_id → PartSpec
    part_map = {p.id: p for p in program.parts}

    positions: dict[str, list[float]] = {}
    for p in program.parts:
        if p.placement and _nonzero(p.placement):
            # Explicit placement always wins
            positions[p.id] = list(p.placement)
        elif p.id in child_to_anchor and _part_features_are_origin_centered(p):
            # Part is local-origin-centred; use the joint anchor as world position
            positions[p.id] = world_pos(p.id)
        else:
            # Part encodes absolute coords in its feature 'at' params — no offset
            positions[p.id] = [0.0, 0.0, 0.0]
    return positions


def build_program(program: FeatureProgram, progress: Callable[[dict[str, Any]], None] | None = None) -> BuildResult:
    """Build every part in a program. Raises :class:`KernelBuildError` on failure."""
    result = BuildResult(program=program)
    total = max(1, len(program.parts))

    # Resolve joint-derived world positions so parts assemble correctly
    world_positions = _compute_world_positions(program)

    for idx, part in enumerate(program.parts):
        if progress:
            progress(
                {
                    "stage": "build",
                    "part": part.id,
                    "index": idx + 1,
                    "total": total,
                    "label": f"Building {part.id.replace('_', ' ')} ({idx + 1}/{total})…",
                }
            )
        body = build_part(part)
        vol = float(getattr(body, "volume", 0.0) or 0.0)
        if vol <= 1e-9:
            raise KernelBuildError(_volume_error_detail(part, body))

        # Apply joint-derived translation if not already handled by placement
        wp = world_positions.get(part.id, [0.0, 0.0, 0.0])
        if _nonzero(wp) and not (part.placement and _nonzero(part.placement)):
            body = Pos(float(wp[0]), float(wp[1]), float(wp[2])) * body

        result.parts[part.id] = body
    return result
