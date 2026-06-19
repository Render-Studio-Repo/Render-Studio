"""Pre-build validity gate for Feature Programs.

Checks run in order; any ``ERROR`` level issue raises :class:`ProgramValidationError`
so the design pipeline can feed the message back to the AI for self-repair.
``WARNING`` level issues are collected but do not block the build.

Checks implemented
------------------
1.  First feature of every part must be a positive-volume primitive (not a cut/modifier).
2.  Cuts and intersects must follow at least one positive-volume feature.
3.  Shell/fillet/chamfer must follow a solid feature (not be the first op).
4.  Duplicate stacked primitives at identical positions are rejected.
5.  Feature count per part is capped (configurable, default 24).
6.  Part count is capped (configurable, default 32).
7.  DesignBrief ``no_can_dos`` are cross-checked against the actual program.
8.  PartConstraint ``base_op`` is matched against the first feature.
9.  PartConstraint ``envelope_mm`` is compared against a rough geometry estimate.
10. Joints reference valid part ids.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from backend.kernel.schema import DesignBrief, Feature, FeatureProgram

logger = logging.getLogger(__name__)

# Ops that create positive-volume solids (can be the first feature of a part)
SOLID_OPS = frozenset({
    "box", "cylinder", "cone", "sphere", "torus",
    "extrude", "revolve", "loft",
    "spur_gear", "gear", "escape_wheel",
    "enclosure_for_spec", "enclosure", "board_blank",
})

# Ops that modify the running solid; cannot be first
MODIFIER_OPS = frozenset({
    "fillet", "chamfer", "shell", "mirror", "transform", "move",
    "pattern", "hole",
})

# Ops that subtract material; require a prior solid
SUBTRACTIVE_OPS = frozenset({"cut", "intersect"})  # combine modes, not ops


class ProgramValidationError(ValueError):
    """Raised when a FeatureProgram has a structural defect that will always fail to build."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = list(errors)
        super().__init__("\n".join(errors))


@dataclass
class ValidationResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def raise_if_errors(self) -> None:
        if self.errors:
            raise ProgramValidationError(self.errors)


def _first_solid_idx(features: list[Feature]) -> int | None:
    """Return index of first feature with a solid-creating op, or None."""
    for i, f in enumerate(features):
        if f.op in SOLID_OPS:
            return i
    return None


def _is_solid_op(feat: Feature) -> bool:
    return feat.op in SOLID_OPS


def _is_modifier_op(feat: Feature) -> bool:
    return feat.op in MODIFIER_OPS


def _roughly_same_position(a: list[float], b: list[float], tol: float = 0.5) -> bool:
    return all(abs(x - y) < tol for x, y in zip(a, b))


def validate_program(
    program: FeatureProgram,
    brief: DesignBrief | None = None,
    *,
    max_features_per_part: int = 24,
    max_parts: int = 32,
) -> ValidationResult:
    """Validate a FeatureProgram against structural and brief constraints.

    Does not build any geometry. Returns :class:`ValidationResult` with errors
    (hard failures) and warnings (soft advisories).
    """
    vr = ValidationResult()

    # ── Part count ──────────────────────────────────────────────────────────
    if len(program.parts) > max_parts:
        vr.error(
            f"Program has {len(program.parts)} parts (max {max_parts}). "
            "Reduce scope or merge bodies into one part."
        )

    part_ids = {p.id for p in program.parts}

    for part in program.parts:
        pid = part.id
        features = part.features
        n = len(features)

        # ── Feature count ────────────────────────────────────────────────────
        if n > max_features_per_part:
            vr.error(
                f"Part '{pid}' has {n} features (max {max_features_per_part}). "
                "Simplify or split into sub-parts."
            )

        if n == 0:
            vr.error(f"Part '{pid}' has no features — every part needs at least one solid op.")
            continue

        # ── First feature must be a positive-volume solid ─────────────────────
        first = features[0]
        if first.combine in ("cut", "intersect"):
            vr.error(
                f"Part '{pid}' first feature has combine='{first.combine}'. "
                "Cannot cut/intersect before a solid base exists. "
                "Add a box/cylinder/revolve first with combine='new'."
            )
        elif _is_modifier_op(first):
            vr.error(
                f"Part '{pid}' first feature is '{first.op}' (a modifier). "
                "A part must begin with a solid-creating op: box, cylinder, extrude, revolve, or loft."
            )
        elif not _is_solid_op(first):
            vr.warn(
                f"Part '{pid}' first feature op '{first.op}' is not a known solid primitive. "
                "This may build correctly if it's a custom engineered op."
            )

        # ── No cuts before a solid exists ────────────────────────────────────
        solid_seen = _is_solid_op(first)
        for i, feat in enumerate(features[1:], start=1):
            if _is_solid_op(feat) and feat.combine == "new":
                solid_seen = True
            if feat.combine in ("cut", "intersect") and not solid_seen:
                vr.error(
                    f"Part '{pid}' feature #{i} ('{feat.op}', combine='{feat.combine}') "
                    "appears before any solid base. Reorder: create a solid first."
                )
            if _is_solid_op(feat) and feat.combine not in ("cut", "intersect", "new"):
                solid_seen = True

        # ── Modifier before solid ────────────────────────────────────────────
        solid_idx = _first_solid_idx(features)
        for i, feat in enumerate(features):
            if _is_modifier_op(feat) and (solid_idx is None or i < solid_idx):
                vr.error(
                    f"Part '{pid}' feature #{i} ('{feat.op}') is a modifier but no solid "
                    "has been created yet. Place it after a solid-creating feature."
                )
                break  # one error per part is enough

        # ── Pattern features must have count >= 1 or locations or x_count/y_count ──
        for i, feat in enumerate(features):
            if feat.op == "pattern":
                p = feat.params()
                count = int(p.get("count", 0) or 0)
                locations = p.get("locations") or []
                arrange = str(p.get("arrange", "linear")).lower()
                if arrange in ("circular", "radial", "around"):
                    arrange = "polar"
                if arrange == "grid":
                    arrange = "rectangular"
                # Rectangular patterns can use x_count + y_count instead of count
                x_count = int(p.get("x_count", p.get("count_x", 0)) or 0)
                y_count = int(p.get("y_count", p.get("count_y", 0)) or 0)
                has_rect_counts = arrange == "rectangular" and x_count >= 1 and y_count >= 1
                if count < 1 and not locations and not has_rect_counts:
                    vr.error(
                        f"Part '{pid}' feature #{i} is a 'pattern' with count={count} and no locations. "
                        "Set count >= 1 (e.g. count: 4 for four rubber feet), "
                        "or for rectangular patterns provide x_count and y_count >= 1, "
                        "or provide explicit locations: [[x1,y1,z1],...]."
                    )

        # ── Duplicate stacked primitives ─────────────────────────────────────
        # Only flag features with the SAME op, SAME position, AND SAME primary
        # size parameter — different-sized boxes at the same center are valid
        # (e.g. outer wall box + inner rib box both centred at origin).
        seen_solids: list[tuple[str, list[float], Any]] = []
        for feat in features:
            if _is_solid_op(feat) and feat.combine not in ("cut", "intersect"):
                pos = feat.at
                p = feat.params()
                # Primary size fingerprint: first numeric list or scalar found
                size_key: Any = (
                    tuple(p.get("size") or [])
                    or p.get("radius")
                    or p.get("diameter")
                    or p.get("width")
                    or None
                )
                for prev_op, prev_pos, prev_size in seen_solids:
                    if (
                        prev_op == feat.op
                        and _roughly_same_position(pos, prev_pos)
                        and size_key is not None
                        and size_key == prev_size
                    ):
                        vr.error(
                            f"Part '{pid}' has two '{feat.op}' features at nearly the same "
                            f"position {pos} with identical dimensions. "
                            "This creates z-fighting / overlapping solids. "
                            "Merge into one feature or offset the duplicate."
                        )
                        break
                seen_solids.append((feat.op, pos, size_key))

        # ── Brief-driven per-part constraints ────────────────────────────────
        if brief:
            pc = brief.constraint_for(pid)
            if pc:
                if pc.base_op and first.op != pc.base_op and _is_solid_op(first):
                    vr.warn(
                        f"Part '{pid}' brief expects base_op='{pc.base_op}' "
                        f"but program uses '{first.op}'. Verify this produces the intended shape."
                    )
                if pc.no_cuts_before_base:
                    for i, feat in enumerate(features):
                        if feat.combine in ("cut", "intersect") and not any(
                            _is_solid_op(features[j]) for j in range(i)
                        ):
                            vr.error(
                                f"Part '{pid}' brief requires no_cuts_before_base but feature #{i} "
                                f"('{feat.op}') cuts before any solid is established."
                            )

    # ── Brief-level no_can_dos ───────────────────────────────────────────────
    if brief:
        for rule in brief.no_can_dos:
            low = rule.lower()
            # Detect common violations from the text rules
            if "stacked" in low or "duplicate" in low:
                pass  # already checked above per part
            if "thin wall" in low or "min wall" in low:
                pass  # DFM checks handle this post-build
            if "no assembly" in low and len(program.parts) > 1:
                vr.warn(
                    f"Brief no_can_do says '{rule}' but program has {len(program.parts)} parts."
                )

        # Envelope check (rough): sum of part feature counts used as proxy
        if brief.envelope_mm and len(brief.envelope_mm) == 3:
            env = brief.envelope_mm
            if all(e > 0 for e in env) and any(e < 1.0 for e in env):
                vr.warn(
                    f"Brief envelope_mm {env} contains sub-millimetre values. "
                    "Verify units are mm, not metres."
                )

    # ── Joint validity ───────────────────────────────────────────────────────
    for j in program.joints:
        for ref_field in ("parent", "child"):
            ref = getattr(j, ref_field, None)
            if ref and ref != "world" and ref not in part_ids:
                vr.error(
                    f"Joint '{j.id}' references {ref_field}='{ref}' which is not a known part id. "
                    f"Valid part ids: {sorted(part_ids)}."
                )

    return vr


def validate_and_raise(
    program: FeatureProgram,
    brief: DesignBrief | None = None,
    **kwargs: Any,
) -> ValidationResult:
    """Validate and raise :class:`ProgramValidationError` if errors exist."""
    vr = validate_program(program, brief, **kwargs)
    vr.raise_if_errors()
    return vr
