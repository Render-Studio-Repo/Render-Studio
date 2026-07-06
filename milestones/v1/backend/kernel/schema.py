"""Feature Program schema — the AI/kernel contract for parametric models.

A :class:`FeatureProgram` describes one or more parts, each built from an
ordered list of :class:`Feature` operations, plus optional assembly joints and
material assignments used by the physics layer.

Design notes
------------
* Units are millimetres everywhere. This is stated explicitly so the AI never
  has to guess scale and so dimensional assertions are unambiguous.
* ``Feature`` is intentionally permissive (``extra="allow"``) because the op
  set is open-ended: generic CAD ops (``box``, ``extrude``, ``fillet`` ...) and
  high-level engineered components (``spur_gear``, ``enclosure_for_spec`` ...)
  share the same envelope. The builder performs semantic validation per op and
  raises actionable errors that can be fed back to the model for self-repair.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Combine = Literal["add", "cut", "intersect", "new"]
"""How a feature's solid combines with the part built so far.

``new`` starts/replaces the running solid, ``add`` unions, ``cut`` subtracts,
``intersect`` keeps the common volume. The first feature is implicitly ``new``.
"""


class Feature(BaseModel):
    """A single parametric operation within a part.

    Known fields are typed for convenience; op-specific parameters are accepted
    as extra fields and validated by the builder for the relevant op.
    """

    model_config = ConfigDict(extra="allow")

    op: str = Field(..., description="Operation name, e.g. box, cylinder, extrude, fillet, spur_gear")
    id: str | None = Field(None, description="Optional stable id for referencing/debugging")
    combine: Combine = Field("add", description="add | cut | intersect | new")

    # Placement (mm / degrees) applied to the feature's solid before combining.
    at: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], description="[x,y,z] translation in mm")
    rotation: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], description="[rx,ry,rz] degrees (intrinsic XYZ)")

    @field_validator("at", "rotation")
    @classmethod
    def _three_floats(cls, v: list[float]) -> list[float]:
        if len(v) != 3:
            raise ValueError("must be a 3-element [x,y,z] list")
        return [float(x) for x in v]

    def params(self) -> dict[str, Any]:
        """Return op-specific params (everything except envelope fields)."""
        reserved = {"op", "id", "combine", "at", "rotation"}
        extra = dict(self.__pydantic_extra__ or {})
        return {k: v for k, v in extra.items() if k not in reserved}


class PartSpec(BaseModel):
    """A named solid body built from an ordered feature list."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Unique part id (used for joints, assembly nodes)")
    features: list[Feature] = Field(default_factory=list)
    color: str | list[float] | None = Field(None, description="Display color: name, #hex, or [r,g,b] 0-1")
    material: str | None = Field(None, description="Material key for density/mass (see physics.materials)")
    placement: list[float] | None = Field(
        None, description="Optional [x,y,z] assembly placement in mm (applied at export/physics time)"
    )

    @field_validator("features")
    @classmethod
    def _non_empty(cls, v: list[Feature]) -> list[Feature]:
        if not v:
            raise ValueError("part must have at least one feature")
        return v


class JointSpec(BaseModel):
    """A kinematic joint between two parts (consumed by the physics layer).

    Geometry is in mm; ``axis`` is a unit-ish direction (will be normalised).
    """

    model_config = ConfigDict(extra="allow")

    id: str
    type: Literal["revolute", "prismatic", "fixed", "continuous"] = "revolute"
    parent: str = Field(..., description="Parent part id (or 'world')")
    child: str = Field(..., description="Child part id")
    anchor: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], description="Joint origin in mm (world frame)")
    axis: list[float] = Field(default_factory=lambda: [0.0, 0.0, 1.0], description="Joint axis direction")
    limits: list[float] | None = Field(None, description="[lower, upper] in deg (revolute) or mm (prismatic)")
    # Optional drive (e.g. mainspring torque, gravity-driven pendulum) for sims.
    drive_torque_nm: float | None = None
    drive_velocity_dps: float | None = None


class FeatureProgram(BaseModel):
    """Top-level model: parts + assembly joints + metadata.

    This is what the AI returns and what the kernel consumes. It is also the
    artifact persisted alongside each generated model for full reproducibility.
    """

    model_config = ConfigDict(extra="ignore")

    name: str = Field("model", description="Human/file friendly name")
    units: Literal["mm"] = Field("mm", description="All lengths are millimetres")
    description: str | None = None
    parts: list[PartSpec] = Field(default_factory=list)
    joints: list[JointSpec] = Field(default_factory=list)
    # Free-form metadata: source specs, intent, ratios, notes for traceability.
    meta: dict[str, Any] = Field(default_factory=dict)

    @field_validator("parts")
    @classmethod
    def _unique_ids(cls, v: list[PartSpec]) -> list[PartSpec]:
        if not v:
            raise ValueError("program must define at least one part")
        ids = [p.id for p in v]
        if len(ids) != len(set(ids)):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"duplicate part ids: {dupes}")
        return v

    def part_ids(self) -> list[str]:
        return [p.id for p in self.parts]
