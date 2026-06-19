"""Mass properties (mass, centre of mass, inertia tensor) from real geometry.

Mass is computed from the exact B-rep volume x material density. The inertia
tensor is integrated over the tessellated solid (trimesh) and converted to SI
(kg, m). Everything is reported in SI so it drops straight into physics engines.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from backend.physics.materials import Material

MM3_TO_M3 = 1e-9
MM_TO_M = 1e-3


@dataclass
class MassProperties:
    material: str
    density_kg_m3: float
    volume_mm3: float
    volume_m3: float
    mass_kg: float
    center_of_mass_m: list[float]
    inertia_kg_m2: list[list[float]]  # 3x3 tensor about the COM, world-aligned
    inertia_diagonal_kg_m2: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "material": self.material,
            "density_kg_m3": self.density_kg_m3,
            "volume_mm3": round(self.volume_mm3, 4),
            "volume_cm3": round(self.volume_mm3 / 1000.0, 4),
            "mass_kg": self.mass_kg,
            "mass_g": round(self.mass_kg * 1000.0, 4),
            "center_of_mass_m": [round(c, 6) for c in self.center_of_mass_m],
            "inertia_kg_m2": [[round(v, 9) for v in row] for row in self.inertia_kg_m2],
            "inertia_diagonal_kg_m2": [round(v, 9) for v in self.inertia_diagonal_kg_m2],
        }


def mass_properties(body: Any, material: Material) -> MassProperties:
    """Compute SI mass properties for a build123d body of the given material."""
    from backend.kernel.export import body_to_trimesh  # local import avoids cycle

    mesh = body_to_trimesh(body)
    # Authoritative volume from the exact B-rep; mass from volume x density.
    volume_mm3 = float(getattr(body, "volume", mesh.volume))
    volume_m3 = volume_mm3 * MM3_TO_M3
    mass_kg = volume_m3 * material.density_kg_m3

    # Inertia: set mesh density in kg/mm^3 so the tensor comes out in kg*mm^2.
    mesh.density = material.density_kg_m3 * MM3_TO_M3
    com_mm = np.asarray(mesh.center_mass, dtype=float)
    inertia_kg_mm2 = np.asarray(mesh.moment_inertia, dtype=float)
    inertia_kg_m2 = inertia_kg_mm2 * (MM_TO_M ** 2)

    eig = np.linalg.eigvalsh(inertia_kg_m2)
    return MassProperties(
        material=material.key,
        density_kg_m3=material.density_kg_m3,
        volume_mm3=volume_mm3,
        volume_m3=volume_m3,
        mass_kg=mass_kg,
        center_of_mass_m=(com_mm * MM_TO_M).tolist(),
        inertia_kg_m2=inertia_kg_m2.tolist(),
        inertia_diagonal_kg_m2=sorted(float(v) for v in eig),
    )
