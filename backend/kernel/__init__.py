"""Render3D parametric CAD kernel (build123d / OpenCASCADE B-rep).

This package replaces the fragile trimesh-primitive engine with a real
parametric B-rep kernel. The public contract is the :class:`FeatureProgram`
schema (see :mod:`backend.kernel.schema`), which the AI emits and the
interpreter (:mod:`backend.kernel.builder`) turns into exact OCCT solids.

All geometry is expressed in millimetres. The kernel is the single source of
truth for dimensional accuracy; engineering generators (gears, enclosures)
plug in as high-level feature ops.
"""

from backend.kernel.schema import Feature, FeatureProgram, PartSpec
from backend.kernel.errors import KernelBuildError

# BuildResult and build_program require build123d / OCCT.  Lazy-load them so
# lightweight schema-only workers don't need build123d installed.
def __getattr__(name: str):
    if name in ("BuildResult", "build_program"):
        from backend.kernel import builder as _builder
        return getattr(_builder, name)
    raise AttributeError(f"module 'backend.kernel' has no attribute {name!r}")


__all__ = [
    "Feature",
    "FeatureProgram",
    "PartSpec",
    "BuildResult",
    "KernelBuildError",
    "build_program",
]
