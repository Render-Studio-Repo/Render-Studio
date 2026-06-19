"""Parametric stepper motor solids for mechanism assemblies."""

from __future__ import annotations

from backend.kernel.schema import Feature, PartSpec


def _box(
    op_id: str,
    size: list[float],
    at: list[float],
    *,
    combine: str = "new",
    rotation: list[float] | None = None,
) -> Feature:
    return Feature(op="box", id=op_id, size=size, at=at, rotation=rotation or [0, 0, 0], combine=combine)


def _cylinder(
    op_id: str,
    radius: float,
    height: float,
    at: list[float],
    *,
    combine: str = "new",
    rotation: list[float] | None = None,
) -> Feature:
    return Feature(
        op="cylinder",
        id=op_id,
        radius=radius,
        height=height,
        at=at,
        rotation=rotation or [0, 0, 0],
        combine=combine,
    )


def nema17_stepper_part(
    part_id: str,
    *,
    shaft_axis: str = "z",
    color: str = "#1f2428",
) -> PartSpec:
    """NEMA-17 face (42.3 mm) with 5 mm output shaft.

    ``shaft_axis`` is ``z`` (vertical mount) or ``y`` (horizontal mount, shaft +Y).
    """
    face = 42.3
    body_h = 40.0
    shaft_r = 2.5
    shaft_h = 22.0

    if shaft_axis == "y":
        return PartSpec(
            id=part_id,
            material="polycarbonate",
            color=color,
            features=[
                _box("motor_body", [face, body_h, face], [0, body_h / 2, 0], rotation=[90, 0, 0]),
                _box("rear_cap", [face - 4, 6, face - 4], [0, body_h + 3, 0], combine="add", rotation=[90, 0, 0]),
                _cylinder("shaft", shaft_r, shaft_h, [0, body_h + shaft_h / 2, 0], rotation=[90, 0, 0]),
                _cylinder("boss", shaft_r + 3, 4, [0, body_h + 2, 0], combine="add", rotation=[90, 0, 0]),
            ],
        )

    return PartSpec(
        id=part_id,
        material="polycarbonate",
        color=color,
        features=[
            _box("motor_body", [face, face, body_h], [0, 0, body_h / 2]),
            _box("rear_cap", [face - 4, face - 4, 6], [0, 0, body_h + 3], combine="add"),
            _cylinder("shaft", shaft_r, shaft_h, [0, 0, body_h + shaft_h / 2]),
            _cylinder("boss", shaft_r + 3, 4, [0, 0, body_h + 2], combine="add"),
        ],
    )


def nema14_stepper_part(part_id: str, *, color: str = "#252a2e") -> PartSpec:
    """Compact NEMA-14 face (35.3 mm) for spice dispensers and dial drives."""
    face = 35.3
    body_h = 34.0
    shaft_r = 2.0
    shaft_h = 16.0
    return PartSpec(
        id=part_id,
        material="polycarbonate",
        color=color,
        features=[
            _box("motor_body", [face, face, body_h], [0, 0, body_h / 2]),
            _cylinder("shaft", shaft_r, shaft_h, [0, 0, body_h + shaft_h / 2]),
        ],
    )
