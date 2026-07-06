"""Physics / simulation-readiness layer.

Turns kernel solids + a Feature Program's joints into a documented simulation
package: per-part mass, centre of mass, and inertia tensor (from real geometry x
material density), joint definitions, and engine-import files (sim.json + URDF +
MJCF). This is what makes Render3D output behave correctly in Unity, Unreal,
Blender, MuJoCo, or any robotics simulator.
"""

from backend.physics.materials import Material, get_material, list_materials
from backend.physics.mass import MassProperties, mass_properties
from backend.physics.sim import build_sim_metadata, write_sim_artifacts, write_sim_sidecar

__all__ = [
    "Material",
    "get_material",
    "list_materials",
    "MassProperties",
    "mass_properties",
    "build_sim_metadata",
    "write_sim_artifacts",
    "write_sim_sidecar",
]
