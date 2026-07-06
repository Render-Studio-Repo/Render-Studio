"""Assemble the simulation metadata package (sim.json) + engine files.

``build_sim_metadata`` produces a documented, engine-agnostic dict describing
every part's SI mass properties, the joints, materials, and gravity. It is the
single source of truth that the URDF/MJCF exporters and the viewer consume.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from backend.kernel.builder import BuildResult
from backend.physics.mass import mass_properties
from backend.physics.materials import get_material

SCHEMA_VERSION = "render3d.sim/1.0"
MM_TO_M = 1e-3


def _normalize(vec: list[float]) -> list[float]:
    n = math.sqrt(sum(c * c for c in vec))
    if n < 1e-12:
        return [0.0, 0.0, 1.0]
    return [c / n for c in vec]


def build_sim_metadata(result: BuildResult) -> dict[str, Any]:
    """Build the engine-agnostic simulation description for a build result."""
    program = result.program
    material_by_part = {p.id: p.material for p in program.parts}

    parts_out: list[dict[str, Any]] = []
    total_mass = 0.0
    for pid, body in result.parts.items():
        material = get_material(material_by_part.get(pid))
        mp = mass_properties(body, material)
        total_mass += mp.mass_kg
        parts_out.append(
            {
                "id": pid,
                "material": material.key,
                "friction": material.friction,
                "restitution": material.restitution,
                "mass_properties": mp.to_dict(),
            }
        )

    joints_out: list[dict[str, Any]] = []
    for j in program.joints:
        joints_out.append(
            {
                "id": j.id,
                "type": j.type,
                "parent": j.parent,
                "child": j.child,
                "anchor_mm": [round(c, 4) for c in j.anchor],
                "anchor_m": [round(c * MM_TO_M, 6) for c in j.anchor],
                "axis": _normalize(j.axis),
                "limits": j.limits,
                "drive": {
                    "torque_nm": j.drive_torque_nm,
                    "velocity_dps": j.drive_velocity_dps,
                },
            }
        )

    return {
        "schema": SCHEMA_VERSION,
        "name": program.name,
        "units": {"length": "m", "mass": "kg", "inertia": "kg*m^2", "angle": "deg"},
        "gravity_m_s2": [0.0, 0.0, -9.80665],
        "parts": parts_out,
        "joints": joints_out,
        "total_mass_kg": round(total_mass, 6),
        "meta": program.meta,
    }


def write_sim_sidecar(sim: dict[str, Any], path: Path) -> Path:
    path.write_text(json.dumps(sim, indent=2))
    return path


def write_sim_artifacts(result: BuildResult, out_dir: Path, basename: str) -> tuple[dict[str, Any], dict[str, Path]]:
    """Write sim.json + per-part STLs + URDF + MJCF. Returns (sim, files)."""
    from backend.physics.urdf import export_part_stls, to_mjcf, to_urdf

    sim = build_sim_metadata(result)
    files: dict[str, Path] = {}

    files["sim"] = write_sim_sidecar(sim, out_dir / f"{basename}.sim.json")

    part_meshes = export_part_stls(result, out_dir, basename)

    urdf_path = out_dir / f"{basename}.urdf"
    urdf_path.write_text(to_urdf(sim, part_meshes, name=result.program.name))
    files["urdf"] = urdf_path

    mjcf_path = out_dir / f"{basename}.mjcf.xml"
    mjcf_path.write_text(to_mjcf(sim, part_meshes, name=result.program.name))
    files["mjcf"] = mjcf_path

    return sim, files
