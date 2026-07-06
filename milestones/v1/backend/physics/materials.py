"""Material registry: density (and a few mechanical properties) for mass calc.

Densities are in kg/m^3 at room temperature. Values are nominal/typical and are
adequate for mass, inertia, and simulation purposes; precise grades can be added
as needed.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    key: str
    name: str
    density_kg_m3: float
    youngs_modulus_pa: float | None = None
    friction: float = 0.5
    restitution: float = 0.2


_MATERIALS: dict[str, Material] = {
    # 3D-printing polymers
    "pla": Material("pla", "PLA", 1240.0, 3.5e9, 0.4, 0.2),
    "abs": Material("abs", "ABS", 1040.0, 2.3e9, 0.45, 0.25),
    "petg": Material("petg", "PETG", 1270.0, 2.1e9, 0.45, 0.25),
    "nylon": Material("nylon", "Nylon (PA)", 1140.0, 2.0e9, 0.3, 0.3),
    "tpu": Material("tpu", "TPU (flexible)", 1210.0, 0.03e9, 0.7, 0.4),
    "resin": Material("resin", "SLA resin", 1180.0, 2.5e9, 0.4, 0.2),
    # Metals
    "steel": Material("steel", "Steel", 7850.0, 200e9, 0.6, 0.4),
    "stainless": Material("stainless", "Stainless steel", 8000.0, 193e9, 0.6, 0.4),
    "aluminum": Material("aluminum", "Aluminium", 2700.0, 69e9, 0.5, 0.3),
    "brass": Material("brass", "Brass", 8500.0, 100e9, 0.4, 0.3),
    "bronze": Material("bronze", "Bronze", 8800.0, 110e9, 0.4, 0.3),
    # Other
    "acrylic": Material("acrylic", "Acrylic (PMMA)", 1180.0, 3.2e9, 0.5, 0.3),
    "wood": Material("wood", "Wood (hardwood)", 700.0, 11e9, 0.5, 0.3),
    "glass": Material("glass", "Glass", 2500.0, 70e9, 0.4, 0.2),
}

DEFAULT_MATERIAL = "pla"


def get_material(key: str | None) -> Material:
    if not key:
        return _MATERIALS[DEFAULT_MATERIAL]
    norm = key.strip().lower().replace(" ", "_")
    if norm in _MATERIALS:
        return _MATERIALS[norm]
    # graceful fallback so a typo never breaks a build
    return _MATERIALS[DEFAULT_MATERIAL]


def list_materials() -> list[str]:
    return sorted(_MATERIALS)
