"""Fail-closed structural audit of Render Studio *.sim.json rig metadata.

It checks facts available in metadata. Geometry fit, regulatory compliance,
and real motor behavior require separate evidence and remain ``unknown``.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np


def audit(sim: dict[str, Any], spec: dict[str, Any] | None = None) -> dict[str, Any]:
    spec = spec or {}
    checks: list[dict[str, str]] = []

    def check(name: str, status: str, reason: str) -> None:
        checks.append({"name": name, "status": status, "reason": reason})

    parts = sim.get("parts") or []
    joints = sim.get("joints") or []
    units = sim.get("units") or {}
    units_ok = units.get("length") == "m" and units.get("mass") == "kg" and units.get("inertia") == "kg*m^2" and units.get("angle") == "deg"
    check("units", "pass" if units_ok else "fail", "expected Render sim SI/degree schema" if units_ok else "unexpected or undeclared units")
    ids = [str(p.get("id") or "") for p in parts]
    part_ids = set(ids)
    check("part_ids", "pass" if ids and len(ids) == len(part_ids) and all(ids) else "fail",
          "unique nonempty part IDs" if ids and len(ids) == len(part_ids) and all(ids) else "missing or duplicate part IDs")
    parents: dict[str, str] = {}
    seen_joints: set[str] = set()
    for j in joints:
        jid = str(j.get("id") or "")
        parent, child = str(j.get("parent") or ""), str(j.get("child") or "")
        valid_link = bool(jid and jid not in seen_joints and child in part_ids and
                          (parent in part_ids or parent == "world") and child != parent and child not in parents)
        check(f"joint:{jid or '?'}:links", "pass" if valid_link else "fail",
              "unique joint and valid single-parent links" if valid_link else "duplicate joint, missing link, self-link, or multiple parents")
        seen_joints.add(jid)
        if valid_link:
            parents[child] = parent
        axis = j.get("axis")
        axis_ok = isinstance(axis, list) and len(axis) == 3 and all(
            isinstance(v, (int, float)) and math.isfinite(v) for v in axis
        ) and math.isclose(math.sqrt(sum(float(v) ** 2 for v in axis)), 1.0, abs_tol=1e-3)
        check(f"joint:{jid or '?'}:axis", "pass" if axis_ok else "fail",
              "unit axis" if axis_ok else "axis must be a finite unit vector")
        anchor_mm, anchor_m = j.get("anchor_mm"), j.get("anchor_m")
        anchor_ok = isinstance(anchor_mm, list) and isinstance(anchor_m, list) and len(anchor_mm) == len(anchor_m) == 3 and all(
            isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isfinite(a) and math.isfinite(b) and abs(a * 0.001 - b) <= 1e-5
            for a, b in zip(anchor_mm, anchor_m)
        )
        check(f"joint:{jid or '?'}:anchor_units", "pass" if anchor_ok else "fail",
              "millimetre/metre anchors agree" if anchor_ok else "anchor unit mismatch or missing anchor")
        limits = j.get("limits")
        if j.get("type") in {"revolute", "prismatic"}:
            valid_limits = isinstance(limits, list) and len(limits) == 2 and all(
                isinstance(v, (int, float)) and math.isfinite(v) for v in limits
            ) and limits[0] < limits[1]
            check(f"joint:{jid or '?'}:limits", "pass" if valid_limits else "fail",
                  "ordered finite limits" if valid_limits else "missing, reversed, or invalid limits")
    cyclic = False
    for pid in part_ids:
        visited: set[str] = set()
        node = pid
        while node in parents and node != "world":
            if node in visited:
                cyclic = True
                break
            visited.add(node)
            node = parents[node]
    check("kinematic_cycle", "fail" if cyclic else "pass",
          "cycle found" if cyclic else "no cycle in declared parent links")
    for part in parts:
        pid = str(part.get("id") or "?")
        mp = part.get("mass_properties") or {}
        mass = mp.get("mass_kg")
        inertia = mp.get("inertia_kg_m2")
        mass_ok = isinstance(mass, (int, float)) and math.isfinite(mass) and mass > 0
        inertia_ok = isinstance(inertia, list) and len(inertia) == 3 and all(
            isinstance(row, list) and len(row) == 3 and all(
                isinstance(v, (int, float)) and math.isfinite(v) for v in row
            ) for row in inertia
        )
        if inertia_ok:
            tensor = np.asarray(inertia, dtype=float)
            inertia_ok = bool(np.allclose(tensor, tensor.T, rtol=1e-5, atol=1e-9) and np.linalg.eigvalsh(tensor).min() > 0)
        check(f"part:{pid}:mass_inertia", "pass" if mass_ok and inertia_ok else "fail",
              "positive mass and symmetric positive inertia" if mass_ok and inertia_ok else "missing/invalid mass or physically impossible inertia")
    for requirement in spec.get("requirements") or []:
        name = str(requirement.get("id") or "unnamed")
        source = str(requirement.get("source_url") or "")
        expected = requirement.get("expected")
        observed = requirement.get("observed")
        tolerance = requirement.get("tolerance")
        comparator = requirement.get("comparator", "absolute")
        numbers_ok = all(isinstance(v, (int, float)) and math.isfinite(v) for v in (expected, observed, tolerance))
        if requirement.get("observed_kind") == "synthetic_planned_mass":
            check(f"spec:{name}", "unknown", "synthetic planned load is not a measured part or assembled robot")
        elif not source.startswith("https://") or not numbers_ok or tolerance < 0 or comparator not in {"absolute", "lte", "gte"}:
            check(f"spec:{name}", "unknown", "source, measured value, or tolerance absent")
        else:
            delta = abs(float(observed) - float(expected))
            passed = (delta <= float(tolerance) if comparator == "absolute" else
                      float(observed) <= float(expected) - float(tolerance) if comparator == "lte" else
                      float(observed) >= float(expected) + float(tolerance))
            check(f"spec:{name}", "pass" if passed else "fail",
                  f"{observed} {comparator} {expected}, margin/tolerance {tolerance}; source={source}")
    for interface in spec.get("fit_requirements") or []:
        name = str(interface.get("id") or "unnamed")
        available = interface.get("available_mm")
        needed = interface.get("needed_mm")
        uncertainty = interface.get("uncertainty_mm")
        margin = interface.get("min_margin_mm")
        numbers_ok = all(isinstance(v, (int, float)) and math.isfinite(v) for v in (available, needed, uncertainty, margin))
        if not numbers_ok or uncertainty < 0 or margin < 0:
            check(f"fit:{name}", "unknown", "missing or invalid mating dimensions/tolerance")
            continue
        worst_case = float(available) - float(uncertainty) - float(needed) - float(margin)
        if worst_case < 0:
            check(f"fit:{name}", "fail", f"worst-case available clearance short by {-worst_case:.3f} mm")
        elif interface.get("evidence_kind") != "measured" or not str(interface.get("source_url") or "").startswith("https://"):
            check(f"fit:{name}", "unknown", f"numeric margin {worst_case:.3f} mm but mating geometry is not measured/source-backed")
        else:
            check(f"fit:{name}", "pass", f"source-backed measured worst-case margin {worst_case:.3f} mm")
    check("physical_fit", "unknown", "requires mating geometry, tolerance stack, and printed test fit")
    check("regulatory_compliance", "unknown", "requires named standard and applicable test evidence")
    check("real_motor_limits", "unknown", "requires OpenArm motor/controller source and hardware verification")
    return {
        "schema": "render3d.openarm.rig-audit/1.0",
        "checks": checks,
        "counts": {s: sum(c["status"] == s for c in checks) for s in ("pass", "fail", "unknown")},
        "ready_for_physical_motion": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sim", type=Path)
    parser.add_argument("--spec", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = audit(json.loads(args.sim.read_text()), json.loads(args.spec.read_text()) if args.spec else None)
    body = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(body)
    else:
        print(body, end="")


if __name__ == "__main__":
    main()
