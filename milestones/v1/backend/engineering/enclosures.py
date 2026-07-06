"""Parametric enclosures generated from real hardware specs.

Given a :class:`~backend.specs.registry.ComponentSpec`, this builds a two-piece
case (base tray + lid) that fits the real board exactly: board pocket sized to
the board outline + tolerance, standoff posts at the true mounting-hole
positions, and connector cut-outs at the real connector locations/sizes.

Everything is built in the *board frame* (origin at board centre, PCB top at
``z = 0``, +X = length, +Y = width), identical to the spec frame, so all
features line up by construction.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from build123d import Box, Cylinder, Pos

from backend.kernel.schema import Feature, FeatureProgram, PartSpec
from backend.specs.registry import ComponentSpec, get_spec


# --------------------------------------------------------------------------- #
# Geometry helpers
# --------------------------------------------------------------------------- #
def _box_between(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> Box:
    """Axis-aligned box spanning the given ranges (mm)."""
    dx, dy, dz = (x1 - x0), (y1 - y0), (z1 - z0)
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    return Pos(cx, cy, cz) * Box(abs(dx), abs(dy), abs(dz))


@dataclass
class CaseGeometry:
    """Resolved dimensions for a board enclosure (board frame, mm)."""

    spec: ComponentSpec
    wall: float = 2.0
    floor_thickness: float = 1.6
    lid_thickness: float = 2.0
    standoff_height: float = 3.0
    post_radius: float = 2.6
    screw_pilot_dia: float = 1.6
    lip_height: float = 2.5
    lip_wall: float = 1.5
    lid_clearance: float = 0.2  # gap between lip frame and cavity wall

    def __post_init__(self) -> None:
        b = self.spec.board
        tol = self.spec.tolerances
        self.bx = b.length / 2.0
        self.by = b.width / 2.0
        self.fit = tol.board_fit_clearance
        self.conn_clear = tol.connector_clearance
        self.top_clear = self.spec.component_height_top

        # XY half-extents
        self.ix = self.bx + self.fit            # inner cavity (board + fit)
        self.iy = self.by + self.fit
        self.ox = self.ix + self.wall           # outer
        self.oy = self.iy + self.wall

        # Z levels (PCB top at 0)
        self.board_bottom_z = -b.thickness
        self.inner_floor_z = self.board_bottom_z - self.standoff_height
        self.outer_bottom_z = self.inner_floor_z - self.floor_thickness
        self.split_z = self.top_clear           # top of base walls (open)
        self.lid_top_z = self.split_z + self.lid_thickness

    # -- outer dimensions exposed for assertions/inspection -- #
    def outer_length(self) -> float:
        return 2 * self.ox

    def outer_width(self) -> float:
        return 2 * self.oy

    def outer_height(self) -> float:
        return self.lid_top_z - self.outer_bottom_z


# --------------------------------------------------------------------------- #
# Base tray
# --------------------------------------------------------------------------- #
def _build_base(g: CaseGeometry) -> Any:
    # Outer solid block.
    base = _box_between(-g.ox, g.ox, -g.oy, g.oy, g.outer_bottom_z, g.split_z)

    # Hollow the board cavity (open top).
    cavity = _box_between(
        -g.ix, g.ix, -g.iy, g.iy, g.inner_floor_z, g.split_z + 1.0
    )
    base = base - cavity

    # Standoff posts at the true mounting-hole positions.
    for h in g.spec.mounting_holes:
        post = Pos(h.x, h.y, (g.inner_floor_z + g.board_bottom_z) / 2) * Cylinder(
            g.post_radius, g.standoff_height
        )
        base = base + post
        # Screw pilot hole up through floor + post.
        pilot = Pos(h.x, h.y, (g.outer_bottom_z + g.board_bottom_z) / 2) * Cylinder(
            g.screw_pilot_dia / 2.0, g.board_bottom_z - g.outer_bottom_z
        )
        base = base - pilot

    # Connector cut-outs at real positions/sizes (+ clearance).
    base = _apply_connector_cutouts(base, g)
    return base


def _apply_connector_cutouts(body: Any, g: CaseGeometry) -> Any:
    for conn in g.spec.connectors:
        if conn.type == "swd_3pad" and not getattr(g, "open_debug", True):
            continue
        w, h = conn.size[0], conn.size[1]
        cy = conn.center[1]
        cz = conn.center[2]
        half_w = w / 2.0 + g.conn_clear
        half_h = h / 2.0 + g.conn_clear
        y0, y1 = cy - half_w, cy + half_w
        z0, z1 = cz - half_h, cz + half_h
        # Cut fully through the relevant wall (extend beyond outer face).
        if conn.edge == "+x":
            cutter = _box_between(g.ix - 1.0, g.ox + 1.0, y0, y1, z0, z1)
        elif conn.edge == "-x":
            cutter = _box_between(-g.ox - 1.0, -g.ix + 1.0, y0, y1, z0, z1)
        elif conn.edge == "+y":
            cx = conn.center[0]
            half = w / 2.0 + g.conn_clear
            cutter = _box_between(cx - half, cx + half, g.iy - 1.0, g.oy + 1.0, z0, z1)
        else:  # -y
            cx = conn.center[0]
            half = w / 2.0 + g.conn_clear
            cutter = _box_between(cx - half, cx + half, -g.oy - 1.0, -g.iy + 1.0, z0, z1)
        body = body - cutter
    return body


# --------------------------------------------------------------------------- #
# Lid
# --------------------------------------------------------------------------- #
def _build_lid(g: CaseGeometry) -> Any:
    # Top plate covering the opening.
    lid = _box_between(-g.ox, g.ox, -g.oy, g.oy, g.split_z, g.lid_top_z)

    # Registration lip frame that inserts into the cavity for a friction fit.
    lip_out_x = g.ix - g.lid_clearance
    lip_out_y = g.iy - g.lid_clearance
    lip_in_x = lip_out_x - g.lip_wall
    lip_in_y = lip_out_y - g.lip_wall
    lip_z0 = g.split_z - g.lip_height
    outer = _box_between(-lip_out_x, lip_out_x, -lip_out_y, lip_out_y, lip_z0, g.split_z)
    inner = _box_between(-lip_in_x, lip_in_x, -lip_in_y, lip_in_y, lip_z0 - 1.0, g.split_z + 1.0)
    lip = outer - inner
    return lid + lip


# --------------------------------------------------------------------------- #
# Public op dispatch + program builder
# --------------------------------------------------------------------------- #
def _geometry_from_params(params: dict[str, Any]) -> CaseGeometry:
    spec_key = params.get("spec") or params.get("spec_key")
    if not spec_key:
        raise ValueError("enclosure requires a 'spec' key (e.g. raspberry_pi_pico_2)")
    spec = get_spec(str(spec_key))
    overrides = {
        k: float(params[k])
        for k in (
            "wall",
            "floor_thickness",
            "lid_thickness",
            "standoff_height",
            "post_radius",
            "screw_pilot_dia",
            "lip_height",
        )
        if k in params and params[k] is not None
    }
    g = CaseGeometry(spec=spec, **overrides)
    g.open_debug = bool(params.get("open_debug", True))
    return g


def enclosure_body_for_op(params: dict[str, Any]) -> Any:
    """Builder dispatch: return base or lid body for an ``enclosure_for_spec`` op."""
    piece = str(params.get("piece", "base")).lower()
    g = _geometry_from_params(params)
    if piece in ("base", "tray", "bottom"):
        return _build_base(g)
    if piece in ("lid", "top", "cover"):
        return _build_lid(g)
    raise ValueError(f"enclosure piece must be 'base' or 'lid', got {piece!r}")


def board_blank_body(params: dict[str, Any]) -> Any:
    """Solid the size of the real board (+ component envelope) for fit checks."""
    spec = get_spec(str(params.get("spec") or params.get("spec_key")))
    b = spec.board
    include_components = bool(params.get("include_components", False))
    z1 = spec.component_height_top if include_components else 0.0
    return _box_between(-b.length / 2, b.length / 2, -b.width / 2, b.width / 2, -b.thickness, z1)


def case_program(spec_key: str, **options: Any) -> FeatureProgram:
    """A complete two-part enclosure program (base + lid) for a spec."""
    spec = get_spec(spec_key)
    op_params = {"spec": spec.key, **options}
    return FeatureProgram(
        name=f"{spec.key}_case",
        description=f"Snap-fit enclosure for {spec.name} (dimensionally matched to {spec.source}).",
        parts=[
            PartSpec(
                id="case_base",
                color="#3a3f4b",
                material=options.get("material", "pla"),
                features=[Feature(op="enclosure_for_spec", piece="base", **op_params)],
            ),
            PartSpec(
                id="case_lid",
                color="#5b8def",
                material=options.get("material", "pla"),
                features=[Feature(op="enclosure_for_spec", piece="lid", **op_params)],
            ),
        ],
        meta={
            "spec": spec.key,
            "spec_source": spec.source,
            "board_mm": [spec.board.length, spec.board.width, spec.board.thickness],
            "mounting_pattern_mm": list(spec.hole_pattern_extent()),
        },
    )
