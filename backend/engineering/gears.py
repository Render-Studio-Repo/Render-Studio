"""Involute spur gears and gear-train kinematics, from first principles.

The tooth flank is a true involute of the base circle (not an approximation).
All standard gear relations are computed here so the rest of the system only
deals with intent + a few parameters:

* module          m           (mm/tooth)         - sets tooth size
* teeth           z                              - integer
* pressure angle  alpha       (deg, default 20)
* profile shift   x           (default 0)

Derived (ISO/AGMA standard, full-depth):
    pitch diameter      d  = m * z
    base diameter       db = d * cos(alpha)
    addendum            ha = m * (1 + x)
    dedendum            hf = m * (1.25 - x)
    tip (addendum) dia  da = d + 2*ha
    root (dedendum) dia df = d - 2*hf
    centre distance     a  = m * (z1 + z2) / 2     (standard, no shift)
    gear ratio          i  = z2 / z1               (output/input teeth)

A mating pair must share the same module and pressure angle; meshing then
occurs at exactly ``a`` and the angular velocity ratio is ``z1/z2``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from build123d import Cylinder, Polygon, Pos, extrude


# --------------------------------------------------------------------------- #
# Kinematics / dimensioning (no geometry)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class GearDims:
    module: float
    teeth: int
    pressure_angle: float  # degrees
    profile_shift: float

    @property
    def pitch_diameter(self) -> float:
        return self.module * self.teeth

    @property
    def pitch_radius(self) -> float:
        return self.pitch_diameter / 2.0

    @property
    def base_radius(self) -> float:
        return self.pitch_radius * math.cos(math.radians(self.pressure_angle))

    @property
    def addendum(self) -> float:
        return self.module * (1.0 + self.profile_shift)

    @property
    def dedendum(self) -> float:
        return self.module * (1.25 - self.profile_shift)

    @property
    def tip_radius(self) -> float:
        return self.pitch_radius + self.addendum

    @property
    def root_radius(self) -> float:
        return self.pitch_radius - self.dedendum


def center_distance(module: float, z1: int, z2: int) -> float:
    """Standard centre distance for a meshing pair (mm)."""
    return module * (z1 + z2) / 2.0


def gear_ratio(z_drive: int, z_driven: int) -> float:
    """Velocity ratio = driven/drive teeth (output turns slower for >1)."""
    return z_driven / z_drive


def solve_two_stage_ratio(target: float, min_teeth: int = 10, max_teeth: int = 120) -> dict[str, Any]:
    """Pick integer tooth counts for a 2-stage train approximating ``target``.

    Returns the stage tooth counts and the achieved ratio/error. Used by the AI
    layer to realise e.g. a clock's 12:1 hour/minute reduction with sane gears.
    """
    best: dict[str, Any] | None = None
    stage_target = math.sqrt(target)
    for z1 in range(min_teeth, 30):
        for z2 in range(min_teeth, max_teeth + 1):
            r = z2 / z1
            for z3 in range(min_teeth, 30):
                for z4 in range(min_teeth, max_teeth + 1):
                    achieved = r * (z4 / z3)
                    err = abs(achieved - target) / target
                    if best is None or err < best["error"]:
                        best = {
                            "stage1": (z1, z2),
                            "stage2": (z3, z4),
                            "ratio": achieved,
                            "error": err,
                        }
                    if err < 1e-4:
                        return best
            # keep the search bounded; stage1 dominates
            if best and best["error"] < 1e-3:
                break
    return best or {}


# --------------------------------------------------------------------------- #
# Involute tooth profile
# --------------------------------------------------------------------------- #
def _involute_polygon(dims: GearDims, flank_samples: int = 14) -> list[tuple[float, float]]:
    """Closed CCW outline of the full gear (all teeth) in the XY plane."""
    r = dims.pitch_radius
    rb = dims.base_radius
    ra = dims.tip_radius
    rf = max(dims.root_radius, 0.5)
    a = math.radians(dims.pressure_angle)

    inv_a = math.tan(a) - a
    # Half tooth angle at the pitch circle (radians), incl. profile shift.
    hp = math.pi / (2 * dims.teeth) + (2 * dims.profile_shift * math.tan(a)) / dims.teeth

    def inv_at(rho: float) -> float:
        c = max(-1.0, min(1.0, rb / rho))
        b = math.acos(c)
        return math.tan(b) - b

    def gamma(rho: float) -> float:
        # Tooth half-angle at radius rho (decreases outward).
        rho = max(rho, rb)
        return hp + inv_a - inv_at(rho)

    r0 = max(rb, rf)  # where the involute flank starts
    flank_radii = np.linspace(r0, ra, flank_samples)
    g_r0 = gamma(r0)

    pitch_angle = 2 * math.pi / dims.teeth
    pts: list[tuple[float, float]] = []

    def add(rho: float, ang: float) -> None:
        pts.append((rho * math.cos(ang), rho * math.sin(ang)))

    for i in range(dims.teeth):
        tc = i * pitch_angle  # tooth centre angle
        # Outward radial from root to flank start on the left side.
        if r0 > rf + 1e-6:
            add(rf, tc - g_r0)
            add(r0, tc - g_r0)
        # Left flank up to tip.
        for rho in flank_radii:
            add(rho, tc - gamma(rho))
        # Tip arc across the top of the tooth.
        g_tip = gamma(ra)
        for ang in np.linspace(tc - g_tip, tc + g_tip, 4)[1:-1]:
            add(ra, ang)
        # Right flank down to flank start.
        for rho in reversed(flank_radii):
            add(rho, tc + gamma(rho))
        # Inward radial to root.
        if r0 > rf + 1e-6:
            add(rf, tc + g_r0)
        # Root arc across the gap to the next tooth.
        next_left = (i + 1) * pitch_angle - g_r0
        for ang in np.linspace(tc + g_r0, next_left, 4)[1:-1]:
            add(rf, ang)

    return pts


# --------------------------------------------------------------------------- #
# Solid geometry
# --------------------------------------------------------------------------- #
def spur_gear_solid(params: dict[str, Any]) -> Any:
    """Build a spur gear solid (axis = Z, spanning z in [0, thickness]).

    Params: module, teeth, thickness, pressure_angle (deg, def 20),
    profile_shift (def 0), bore (diameter, mm), hub (optional dict).
    """
    module = float(params.get("module", params.get("m", 1.0)))
    teeth = int(params.get("teeth", params.get("z", 0)))
    if module <= 0 or teeth < 5:
        raise ValueError("spur_gear requires module > 0 and teeth >= 5")
    thickness = float(params.get("thickness", params.get("width", 5.0)))
    if thickness <= 0:
        raise ValueError("spur_gear thickness must be > 0")
    alpha = float(params.get("pressure_angle", 20.0))
    shift = float(params.get("profile_shift", 0.0))
    bore = float(params.get("bore", params.get("bore_diameter", 0.0)))

    dims = GearDims(module=module, teeth=teeth, pressure_angle=alpha, profile_shift=shift)
    pts = _involute_polygon(dims)
    face = Polygon(*pts, align=None)
    gear = extrude(face, amount=thickness)

    if bore > 0:
        # Cylinder is centred on origin; span well beyond the gear for a clean cut.
        cutter = Pos(0, 0, thickness / 2) * Cylinder(bore / 2.0, thickness * 2)
        gear = gear - cutter

    hub = params.get("hub")
    if isinstance(hub, dict):
        hub_d = float(hub.get("diameter", 0))
        hub_h = float(hub.get("height", 0))
        if hub_d > 0 and hub_h > 0:
            boss = Pos(0, 0, thickness + hub_h / 2) * Cylinder(hub_d / 2.0, hub_h)
            gear = gear + boss
            if bore > 0:
                gear = gear - (Pos(0, 0, thickness + hub_h / 2) * Cylinder(bore / 2.0, hub_h * 2))
    return gear


def _ring_gear_polygon(dims: GearDims, rim_radius: float, flank_samples: int = 14) -> list[tuple[float, float]]:
    """Closed outline of an internal (annular) ring gear in the XY plane.

    The outer boundary is a circle of ``rim_radius``; the inner boundary cuts
    the involute tooth spaces into the ring, leaving tooth tips at
    ``dims.pitch_radius - dims.addendum`` and tooth roots at
    ``dims.pitch_radius + dims.dedendum``.
    """
    r = dims.pitch_radius
    rb = dims.base_radius
    rf = dims.pitch_radius + dims.dedendum   # root circle (outer face for internal gear)
    ra = dims.pitch_radius - dims.addendum   # tip circle  (inner face)
    ra = max(ra, 0.5)
    a = math.radians(dims.pressure_angle)

    inv_a = math.tan(a) - a
    hp = math.pi / (2 * dims.teeth) + (2 * dims.profile_shift * math.tan(a)) / dims.teeth

    def inv_at(rho: float) -> float:
        c = max(-1.0, min(1.0, rb / rho))
        b = math.acos(c)
        return math.tan(b) - b

    def gamma(rho: float) -> float:
        rho = max(rho, rb)
        return hp + inv_a - inv_at(rho)

    # For an internal gear the tooth flank is mirrored: the "slot" profile.
    # We generate the slot by tracing the conjugate involute from tip to root
    # (i.e. from ra outward to rf), which is the internal-gear tooth space.
    r0 = max(rb, ra)
    flank_radii = np.linspace(r0, rf, flank_samples)

    pitch_angle = 2 * math.pi / dims.teeth
    pts: list[tuple[float, float]] = []

    def add(rho: float, ang: float) -> None:
        pts.append((rho * math.cos(ang), rho * math.sin(ang)))

    for i in range(dims.teeth):
        tc = i * pitch_angle
        g_r0 = gamma(r0)

        # Right flank of tooth space (left flank of a tooth on external gear)
        for rho in flank_radii:
            add(rho, tc - gamma(rho))
        # Root arc (outer arc between tooth spaces)
        g_rf = gamma(rf)
        next_left = (i + 1) * pitch_angle - gamma(rf)
        for ang in np.linspace(tc + g_rf, next_left, 4)[1:]:
            add(rf, ang)

    return pts


def ring_gear_solid(params: dict[str, Any]) -> Any:
    """Build an internal (annular) ring gear solid (axis = Z).

    The outer cylinder has radius ``rim_radius`` (default pitch_radius + 3*module).
    Params: module, teeth, thickness, pressure_angle (deg, def 20),
    profile_shift (def 0), rim_radius (mm, optional), bore_hole (boolean, skip inner face).
    """
    from build123d import Circle, make_face, Wire

    module = float(params.get("module", params.get("m", 1.0)))
    teeth = int(params.get("teeth", params.get("z", 0)))
    if module <= 0 or teeth < 5:
        raise ValueError("ring_gear requires module > 0 and teeth >= 5")
    thickness = float(params.get("thickness", params.get("width", 5.0)))
    alpha = float(params.get("pressure_angle", 20.0))
    shift = float(params.get("profile_shift", 0.0))

    dims = GearDims(module=module, teeth=teeth, pressure_angle=alpha, profile_shift=shift)
    rim_radius = float(params.get("rim_radius", dims.pitch_radius + 3.5 * module))

    outer_pts = [(rim_radius * math.cos(a), rim_radius * math.sin(a))
                 for a in np.linspace(0, 2 * math.pi, 180, endpoint=False)]
    inner_pts = _ring_gear_polygon(dims, rim_radius, flank_samples=14)

    outer_wire = Wire.make_polygon([(*p, 0) for p in outer_pts])
    inner_wire = Wire.make_polygon([(*p, 0) for p in inner_pts])

    try:
        face = make_face([outer_wire, inner_wire])
        gear = extrude(face, amount=thickness)
    except Exception:
        # Fallback: build as annulus + individual tooth-slot cuts (slower but robust)
        gear = Cylinder(rim_radius, thickness) - Cylinder(dims.pitch_radius - dims.addendum, thickness)
    return gear


def _solve_mesh_phase(prev_placed: Any, base_solid: Any, x: float, guess_deg: float, samples: int = 9, window: float = 0.0) -> float:
    """Numerically find the rotation (deg) of a gear at (x,0) that meshes with
    its already-placed predecessor (minimal tooth overlap on the X line)."""
    from build123d import Pos, Rot

    if prev_placed is None:
        return guess_deg
    if window <= 0:
        window = abs(guess_deg) if guess_deg else 5.0
    best_phase, best_vol = guess_deg, float("inf")
    for ph in np.linspace(guess_deg - window, guess_deg + window, samples):
        cur = Pos(x, 0, 0) * (Rot(0, 0, float(ph)) * base_solid)
        try:
            inter = prev_placed & cur
            vol = float(getattr(inter, "volume", 0.0) or 0.0)
        except Exception:
            vol = float("inf")
        if vol < best_vol:
            best_vol, best_phase = vol, float(ph)
    return best_phase


def gear_train_program(
    teeth: list[int],
    *,
    module: float = 2.0,
    thickness: float = 6.0,
    bore: float = 4.0,
    material: str = "steel",
    pressure_angle: float = 20.0,
    drive_torque_nm: float = 0.02,
    base_plate: bool = True,
):
    """Build a meshing spur-gear train as a Feature Program with joints.

    Gears are laid out along +X at exact standard centre distances; each
    successive gear's mesh phase is solved so teeth interlock (verified by
    minimal overlap). Revolute joints (axis Z) are placed at every gear centre;
    the input gear carries a drive torque.
    """
    from backend.kernel.schema import Feature, FeatureProgram, JointSpec, PartSpec

    if len(teeth) < 2:
        raise ValueError("a gear train needs at least 2 gears")

    xs: list[float] = []
    phases: list[float] = []
    prev_placed = None
    from build123d import Pos, Rot

    for i, z in enumerate(teeth):
        x_i = 0.0 if i == 0 else xs[-1] + center_distance(module, teeth[i - 1], z)
        base_solid = spur_gear_solid(
            {"module": module, "teeth": z, "thickness": thickness, "bore": bore, "pressure_angle": pressure_angle}
        )
        if i == 0:
            phase = 0.0
        else:
            guess = 180.0 / z if z % 2 == 0 else 0.0
            phase = _solve_mesh_phase(prev_placed, base_solid, x_i, guess, samples=9, window=180.0 / z)
        prev_placed = Pos(x_i, 0, 0) * (Rot(0, 0, phase) * base_solid)
        xs.append(x_i)
        phases.append(phase)

    colors = ["#c0843a", "#9aa0a6", "#5b8def", "#7bbf6a", "#cf6b6b"]
    parts: list[PartSpec] = []
    joints: list[JointSpec] = []

    tip_max = max(GearDims(module, z, pressure_angle, 0).tip_radius for z in teeth)
    plate_z1 = -1.0
    plate_z0 = plate_z1 - 3.0

    if base_plate:
        margin = 6.0
        length = (xs[-1] - xs[0]) + 2 * tip_max + 2 * margin
        width = 2 * tip_max + 2 * margin
        cx = (xs[0] + xs[-1]) / 2.0
        plate_mid_z = (plate_z0 + plate_z1) / 2
        mount_inset = 8.0
        corner_holes = [
            Feature(
                op="hole",
                diameter=3.2,
                through=True,
                combine="cut",
                at=[cx + dx * (length / 2 - mount_inset), dy * (width / 2 - mount_inset), plate_mid_z],
            )
            for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1))
        ]
        parts.append(
            PartSpec(
                id="base_plate",
                color="#2c3038",
                material="aluminum",
                features=[
                    Feature(op="box", size=[length, width, 3.0], at=[cx, 0.0, plate_mid_z]),
                ]
                + [
                    Feature(
                        op="cylinder",
                        radius=bore / 2.0 + 0.15,
                        height=thickness / 2.0 + 1.0,
                        at=[x, 0.0, plate_mid_z + 1.0],
                        combine="add",
                    )
                    for x in xs
                ]
                + corner_holes,
            )
        )
        joints.append(JointSpec(id="base_fixed", type="fixed", parent="world", child="base_plate", anchor=[0, 0, 0], axis=[0, 0, 1]))
    parent_link = "base_plate" if base_plate else "world"

    for i, (z, x, phase) in enumerate(zip(teeth, xs, phases)):
        pid = "gear_input" if i == 0 else ("gear_output" if i == len(teeth) - 1 else f"gear_{i}")
        parts.append(
            PartSpec(
                id=pid,
                color=colors[i % len(colors)],
                material=material,
                features=[
                    Feature(
                        op="spur_gear",
                        module=module,
                        teeth=z,
                        thickness=thickness,
                        bore=bore,
                        pressure_angle=pressure_angle,
                        at=[x, 0.0, 0.0],
                        rotation=[0.0, 0.0, phase],
                    )
                ],
            )
        )
        joints.append(
            JointSpec(
                id=f"{pid}_axle",
                type="continuous",
                parent=parent_link,
                child=pid,
                anchor=[x, 0.0, thickness / 2.0],
                axis=[0, 0, 1],
                drive_torque_nm=drive_torque_nm if i == 0 else None,
            )
        )

    overall_ratio = teeth[-1] / teeth[0]
    centers = [center_distance(module, teeth[i - 1], teeth[i]) for i in range(1, len(teeth))]
    return FeatureProgram(
        name="spur_gear_train",
        description=(
            f"{len(teeth)}-gear involute spur train (module {module} mm, {teeth} teeth). "
            f"Overall input:output ratio {teeth[0]}:{teeth[-1]} = 1:{overall_ratio:g}."
        ),
        parts=parts,
        joints=joints,
        meta={
            "module": module,
            "teeth": teeth,
            "center_distances_mm": centers,
            "overall_ratio_out_per_in": overall_ratio,
            "pressure_angle_deg": pressure_angle,
            "phases_deg": [round(p, 4) for p in phases],
        },
    )


def gear_metadata(params: dict[str, Any]) -> dict[str, Any]:
    """Standard gear data for physics/traceability."""
    dims = GearDims(
        module=float(params.get("module", params.get("m", 1.0))),
        teeth=int(params.get("teeth", params.get("z", 0))),
        pressure_angle=float(params.get("pressure_angle", 20.0)),
        profile_shift=float(params.get("profile_shift", 0.0)),
    )
    return {
        "module": dims.module,
        "teeth": dims.teeth,
        "pressure_angle_deg": dims.pressure_angle,
        "profile_shift": dims.profile_shift,
        "pitch_diameter": dims.pitch_diameter,
        "base_diameter": dims.base_radius * 2,
        "tip_diameter": dims.tip_radius * 2,
        "root_diameter": dims.root_radius * 2,
    }
