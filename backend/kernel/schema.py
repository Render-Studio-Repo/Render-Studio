"""Feature Program schema — the AI/kernel contract for parametric models.

A :class:`FeatureProgram` describes one or more parts, each built from an
ordered list of :class:`Feature` operations, plus optional assembly joints and
material assignments used by the physics layer.

Also contains the :class:`DesignBrief` intermediate schema that the AI emits
*before* the Feature Program. It captures semantic intent, envelope targets,
named dimensions, and constraint sketch inputs. The validator uses it to gate
bad programs before any geometry is attempted.

Design notes
------------
* Units are millimetres everywhere.
* ``Feature`` is intentionally permissive (``extra="allow"``) because the op
  set is open-ended. The builder performs semantic validation per op and raises
  actionable errors that can be fed back to the model for self-repair.
* ``DesignBrief`` is strict: unknown fields are ignored so old clients round-trip
  cleanly, but the validator rejects briefs that violate hard constraints before
  any OCCT work happens.
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


# ---------------------------------------------------------------------------
# Design Brief — semantic intent layer (emitted before FeatureProgram)
# ---------------------------------------------------------------------------

class NamedDimension(BaseModel):
    """One row of the parametric dimension table."""

    model_config = ConfigDict(extra="ignore")

    param: str = Field(..., description="snake_case parameter name")
    value_mm: float = Field(..., description="Numeric value in millimetres")
    source: Literal["user", "drawing", "inferred", "standard"] = "inferred"
    notes: str | None = None


class PartConstraint(BaseModel):
    """Per-part constraint sketch: named datums, coincidences, no-go checks.

    The validator uses these to detect impossible programs before build:
    - ``base_op`` must be a positive-volume primitive (box/cylinder/sphere/extrude/revolve/loft).
    - ``min_wall_mm`` is a manufacturing assertion checked post-build by DFM.
    - ``envelope_mm`` [x,y,z] is checked against the built bounding box.
    - ``must_be_watertight`` gates STEP export; default True.
    - ``no_cuts_before_base`` rejects programs where the first feature is a cut.
    - ``coincidences`` are informational datums (face names, axis refs) kept for
      future constraint-sketch resolution.
    """

    model_config = ConfigDict(extra="ignore")

    part_id: str
    base_op: str | None = Field(
        None,
        description="Expected first-feature op (box/cylinder/extrude/revolve/loft/sphere). "
        "Validator rejects if first feature op doesn't match.",
    )
    min_wall_mm: float | None = Field(None, description="DFM wall-thickness assertion (mm)")
    envelope_mm: list[float] | None = Field(
        None,
        description="[x,y,z] max bounding-box extents (mm). Validator warns if built bbox exceeds this.",
    )
    must_be_watertight: bool = True
    no_cuts_before_base: bool = True
    coincidences: list[str] = Field(
        default_factory=list,
        description="Named datums / face-axis references that constrain placement of add/cut features.",
    )

    @field_validator("envelope_mm")
    @classmethod
    def _three_positive(cls, v: list[float] | None) -> list[float] | None:
        if v is not None:
            if len(v) != 3 or any(x <= 0 for x in v):
                raise ValueError("envelope_mm must be [x,y,z] with all values > 0")
        return v


class DesignBrief(BaseModel):
    """Semantic intent captured before Feature Program construction.

    The AI emits this as ``design_plan.brief`` inside the design JSON.
    ``design_service.py`` validates it, then passes it to the FeatureProgram
    validator so we catch bad construction *before* any OCCT geometry is attempted.
    """

    model_config = ConfigDict(extra="ignore")

    object_class: str = Field(
        "",
        description="What is being built, e.g. 'mounting bracket', 'gear train', 'enclosure'.",
    )
    intent: str = Field("", description="One sentence functional intent.")
    envelope_mm: list[float] | None = Field(
        None,
        description="Target [width, depth, height] bounding box in mm. Used as envelope guard.",
    )
    dimensions: list[NamedDimension] = Field(
        default_factory=list,
        description="Parametric dimension table (named params only — no free-form numbers).",
    )
    part_constraints: list[PartConstraint] = Field(
        default_factory=list,
        description="Per-part constraints: base op, walls, envelope, coincidences.",
    )
    no_can_dos: list[str] = Field(
        default_factory=list,
        description="Explicit list of operations this design must NOT do, e.g. "
        "'do not cut before base', 'no thin walls < 1.5 mm', 'no stacked duplicate primitives'.",
    )
    manufacturing_notes: list[str] = Field(
        default_factory=list,
        description="Wall thickness, surface offset, and process notes surfaced to DFM checks.",
    )

    def dim(self, param: str) -> float | None:
        """Look up a named dimension value by snake_case param name."""
        for d in self.dimensions:
            if d.param == param:
                return d.value_mm
        return None

    def constraint_for(self, part_id: str) -> PartConstraint | None:
        for pc in self.part_constraints:
            if pc.part_id == part_id:
                return pc
        return None
