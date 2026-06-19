"""Deterministic component-mounting fixtures.

Given the *measured* geometry of referenced off-the-shelf components (from
``main._component_specs`` — real bounding boxes plus known mount patterns), this
builds an open, breadboard-style base plate that actually fits them: a round
collar mount for motors and a recessed pocket (with USB notch) for PCBs, all
sized to the parts. It also returns the world placements needed to drop the real
component files into those mounts, to scale.

The LLM authoring a correct mount program freehand is unreliable; this gives a
recognizable, dimensionally-correct result every time for case/mount/holder
requests that reference components.

Frame: Z-up, mm. Base plate sits on Z=0, mount features face +Z.
"""

from __future__ import annotations

from typing import Any

from build123d import Box, Cylinder, Pos

from backend.kernel.schema import Feature, FeatureProgram, PartSpec

PLATE_T = 4.0          # base plate thickness (mm)
MARGIN = 12.0          # plate border around the components
GAP = 16.0             # gap between adjacent component cells
FIT = 0.5              # clearance around parts
BOARD_STANDOFF_H = 5.0 # PCB/SBC support post height above the plate


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _board_dims(spec: dict[str, Any]) -> tuple[float, float, float]:
    """Footprint (bx, by, bz) for a board/SBC cell.

    Prefer catalog body length/width from ``standard_mount`` — raw mesh bbox axes
    are often wrong for STEP imports (e.g. Pi measured as 90 x 20 x 58 instead of
    85 x 56 x 18).
    """
    size = spec.get("size_mm") or [40.0, 40.0, 20.0]
    sx, sy, sz = [_num(size[0], 40), _num(size[1], 40), _num(size[2], 20)]
    sm = spec.get("standard_mount") or {}
    body = sm.get("body") or {}
    bl = _num(body.get("length_mm"), 0)
    bw = _num(body.get("width_mm"), 0)
    bh = _num(body.get("height_mm"), 0)
    if bl > 0 and bw > 0:
        bx, by = max(bl, bw), min(bl, bw)
        bz = bh if bh > 0 else sz
        return bx, by, bz
    bx, by = max(sx, sy), min(sx, sy)
    return bx, by, sz


def _classify(spec: dict[str, Any]) -> str:
    sm = spec.get("standard_mount") or {}
    body = sm.get("body") or {}
    hay = f"{spec.get('kind','')} {spec.get('label','')} {spec.get('stem','')}".lower()
    if body.get("diameter_mm") or "stepper" in hay or ("motor" in hay and "driver" not in hay):
        return "motor"
    return "board"


def _mount_data(spec: dict[str, Any]) -> dict[str, Any]:
    sm = spec.get("standard_mount") or {}
    return sm.get("mount") or {}


def _is_nema_motor(cell: dict[str, Any]) -> bool:
    mount = cell.get("mount") or {}
    hay = f"{(cell.get('spec') or {}).get('label','')} {(cell.get('spec') or {}).get('stem','')}".lower()
    return bool(mount.get("center_bore_mm")) or ("nema" in hay and "17" in hay)


def _xy_spacing(value: Any, default_x: float, default_y: float | None = None) -> tuple[float, float]:
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return _num(value[0], default_x), _num(value[1], default_y if default_y is not None else default_x)
    v = _num(value, default_x)
    return v, _num(default_y, v)


def plan_fixture(specs: list[dict[str, Any]]) -> dict[str, Any]:
    """Lay out the components side-by-side and resolve every feature dimension."""
    cells: list[dict[str, Any]] = []
    for s in specs:
        size = s.get("size_mm") or [40.0, 40.0, 20.0]
        size = [_num(size[0], 40), _num(size[1], 40), _num(size[2], 20)]
        sm = s.get("standard_mount") or {}
        kind = _classify(s)
        if kind == "motor":
            body = sm.get("body") or {}
            mount = _mount_data(s)
            dia = _num(body.get("diameter_mm"), min(size[0], size[1]))
            body_len = _num(body.get("height_mm"), size[2] * 0.7)
            r = dia / 2.0
            spacing_x, spacing_y = _xy_spacing(mount.get("hole_spacing_mm"), 2 * r + 7, 2 * r + 7)
            is_nema = bool(mount.get("center_bore_mm")) or ("nema" in f"{s.get('label','')} {s.get('stem','')}".lower())
            cell_span = max(spacing_x + 24, size[0] + 18, 2 * r + 24)
            cell_depth = max(spacing_y + 24, size[1] + 18, 2 * r + 24)
            cells.append({
                "spec": s, "kind": "motor", "r": r, "h": size[2], "body_len": body_len,
                "cw": cell_span, "cd": cell_depth, "mount": mount,
                "motor_style": "nema_faceplate" if is_nema else "tab_bracket",
            })
        else:
            mount = _mount_data(s)
            bx, by, bz = _board_dims(s)
            cells.append({
                "spec": s, "kind": "board", "bx": bx, "by": by, "bz": bz,
                "cw": bx + 18, "cd": by + 18, "mount": mount,
            })

    total_w = MARGIN * 2 + sum(c["cw"] for c in cells) + GAP * max(len(cells) - 1, 0)
    total_d = MARGIN * 2 + (max((c["cd"] for c in cells), default=40.0))
    x = -total_w / 2 + MARGIN
    for c in cells:
        c["cx"] = round(x + c["cw"] / 2.0, 3)
        c["cy"] = 0.0
        x += c["cw"] + GAP
    return {"W": round(total_w, 3), "D": round(total_d, 3), "T": PLATE_T, "cells": cells}


def _post_height(cell: dict[str, Any]) -> float:
    """Height of the bracket posts so the motor body hangs clear of the plate.

    The flange sits near the top of the body, so the body drops ~body_length
    below the flange — the posts must lift the flange above that."""
    body_len = cell.get("body_len") or cell["h"]
    return round(min(max(body_len * 0.85, 12.0), 30.0), 2)


def _motor_mount_surface_z(cell: dict[str, Any]) -> float:
    if _is_nema_motor(cell):
        return PLATE_T + 8.0
    return PLATE_T + _post_height(cell)


def _bolt_spacing(cell: dict[str, Any]) -> float:
    mount = cell.get("mount") or {}
    s = mount.get("hole_spacing_mm")
    if isinstance(s, (int, float)) and s:
        return float(s)
    return round(cell["r"] * 2 + 7.0, 2)  # straddle the body


def _pocket_depth(cell: dict[str, Any]) -> float:
    return min(max(cell["bz"] * 0.6, 1.6), PLATE_T - 1.4)


def _fixture_solid(plan: dict[str, Any]) -> Any:
    W, D, T = plan["W"], plan["D"], plan["T"]
    solid = Pos(0, 0, T / 2) * Box(W, D, T)

    for c in plan["cells"]:
        cx, cy = c["cx"], c["cy"]
        if c["kind"] == "motor":
            r = c["r"]
            mount = c.get("mount") or {}
            hd = _num(mount.get("hole_diameter_mm"), 4.0)
            if _is_nema_motor(c):
                # Raised NEMA faceplate: 31x31 M3 pattern around the center bore.
                sx, sy = _xy_spacing(mount.get("hole_spacing_mm"), 31.0, 31.0)
                bore = _num(mount.get("center_bore_mm"), 22.0)
                pad_h = 8.0
                pad_w = max(sx + 18.0, 48.0)
                pad_d = max(sy + 18.0, 48.0)
                solid = solid + Pos(cx, cy, T + pad_h / 2.0) * Box(pad_w, pad_d, pad_h)
                solid = solid - Pos(cx, cy, T + pad_h / 2.0) * Cylinder(bore / 2.0, pad_h + T + 3.0)
                for xsgn in (-1.0, 1.0):
                    for ysgn in (-1.0, 1.0):
                        px = cx + xsgn * sx / 2.0
                        py = cy + ysgn * sy / 2.0
                        solid = solid - Pos(px, py, T + pad_h / 2.0) * Cylinder(hd / 2.0, pad_h + T + 3.0)
            else:
                # Two-post flange bracket for round geared steppers: ears bolt to
                # raised posts while the round body clears the base between them.
                ph = _post_height(c)
                spacing = _bolt_spacing(c)
                post_r = max(hd / 2.0 + 2.2, 3.6)
                for sgn in (-1.0, 1.0):
                    px = cx + sgn * spacing / 2.0
                    post = Pos(px, cy, T + ph / 2.0) * Cylinder(post_r, ph)
                    solid = solid + post
                    cap = Pos(px, cy, T + ph) * Box(hd + 6.0, hd + 8.0, 2.5)
                    solid = solid + cap
                    pilot = Pos(px, cy, T + ph - 9.0) * Cylinder(hd / 2.0, 22.0)
                    solid = solid - pilot
                solid = solid - Pos(cx, cy, T / 2.0) * Cylinder(r + FIT, T + 4.0)
        else:
            bx, by, bz = c["bx"], c["by"], c["bz"]
            mount = c.get("mount") or {}
            pd = _pocket_depth(c)
            pocket = Pos(cx, cy, T - pd / 2.0 + 0.01) * Box(bx + 2 * FIT, by + 2 * FIT, pd + 0.02)
            solid = solid - pocket
            # USB cutout on the +X short edge.
            solid = solid - Pos(cx + bx / 2.0, cy, T) * Box(10.0, 10.0, 10.0)
            # Wire-access slot through the floor.
            solid = solid - Pos(cx, cy, T / 2.0) * Box(bx * 0.5, by * 0.4, T + 4.0)
            # PCB/SBC mounting bosses: Pi/Nano boards need real standoff posts,
            # not just a recess in the plate.
            sx, sy = _xy_spacing(mount.get("hole_spacing_mm"), max(bx - 12.0, 10.0), max(by - 12.0, 10.0))
            hd = _num(mount.get("hole_diameter_mm"), 2.6)
            post_h = BOARD_STANDOFF_H
            post_r = max(hd / 2.0 + 2.2, 3.2)
            sx = min(sx, max(bx - 8.0, 8.0))
            sy = min(sy, max(by - 8.0, 8.0))
            for xsgn in (-1.0, 1.0):
                for ysgn in (-1.0, 1.0):
                    px = cx + xsgn * sx / 2.0
                    py = cy + ysgn * sy / 2.0
                    solid = solid + Pos(px, py, T + post_h / 2.0) * Cylinder(post_r, post_h)
                    solid = solid - Pos(px, py, T + post_h / 2.0) * Cylinder(hd / 2.0, post_h + T + 2.0)
    return solid


def component_fixture_body(params: dict[str, Any]) -> Any:
    """Kernel op dispatch: build the fixture solid from an embedded plan."""
    plan = params.get("plan")
    if not plan:
        plan = plan_fixture(params.get("component_specs") or [])
    return _fixture_solid(plan)


def placements_for_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Seat instructions for each real component file.

    These carry a `mount` type plus the target XY and the surface Z where the
    part rests. `main._apply_part_placements` inspects the real mesh to align
    the flange / board bottom exactly (orientation + height), with the supplied
    `translation_mm`/`rotation_deg` as a fallback if mesh-aware seating fails.
    """
    T = plan["T"]
    out: list[dict[str, Any]] = []
    for c in plan["cells"]:
        stem = (c.get("spec") or {}).get("stem")
        if not stem:
            continue
        if c["kind"] == "motor":
            surface_z = _motor_mount_surface_z(c)  # flange rests on post caps / faceplate
            out.append({
                "stem": stem,
                "mount": "motor_flange",
                "cx": round(c["cx"], 2), "cy": round(c["cy"], 2),
                "surface_z": round(surface_z, 2),
                "translation_mm": [round(c["cx"], 2), round(c["cy"], 2), round(surface_z - c["h"] / 2.0, 2)],
                "rotation_deg": [0, 0, 0],
            })
        else:
            pd = _pocket_depth(c)
            surface_z = T + BOARD_STANDOFF_H  # board rests on standoff tops
            out.append({
                "stem": stem,
                "mount": "board_pocket",
                "cx": round(c["cx"], 2), "cy": round(c["cy"], 2),
                "surface_z": round(surface_z, 2),
                "translation_mm": [round(c["cx"], 2), round(c["cy"], 2), round(surface_z + c["bz"] / 2.0, 2)],
                "rotation_deg": [0, 0, 0],
            })
    return out


def fixture_program_from_specs(
    specs: list[dict[str, Any]],
) -> tuple[FeatureProgram, list[dict[str, Any]]]:
    """Build the fixture program + the component placements for a set of specs."""
    plan = plan_fixture(specs)
    placements = placements_for_plan(plan)
    motors = sum(1 for c in plan["cells"] if c["kind"] == "motor")
    boards = sum(1 for c in plan["cells"] if c["kind"] == "board")
    program = FeatureProgram(
        name="component_mounting_fixture",
        description=(
            "Open breadboard-style test fixture sized to the referenced components: "
            f"{motors} motor collar(s) + {boards} board pocket(s)."
        ),
        parts=[
            PartSpec(
                id="fixture_base",
                color="#9aa4b2",
                material="pla",
                features=[Feature(op="component_fixture", combine="new", plan=plan)],
            )
        ],
        meta={
            "fixture": True,
            "plate_mm": [plan["W"], plan["D"], plan["T"]],
            "components": [
                {"stem": (c.get("spec") or {}).get("stem"), "kind": c["kind"]}
                for c in plan["cells"]
            ],
        },
    )
    return program, placements
