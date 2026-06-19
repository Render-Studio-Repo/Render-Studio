"""Deterministic PET / soda bottle CAD generators."""

from __future__ import annotations

import math

from backend.kernel.schema import Feature, FeatureProgram, PartSpec

# Coca-Cola-style contour (mm, Z-up). Profile = [radius, z] revolved about Z.


def _coke_contour_profile(scale: float) -> list[list[float]]:
    """20 oz schematic-driven Coke contour.

    Hard constraints from the attached drawing:
    - overall with cap: 235 mm
    - bottle max OD: 73 mm
    - waist min OD: 58 mm
    - thread/cap OD: 28 mm

    The body stops below the cap so the cap can occupy the final 13 mm.
    """
    s = scale
    raw = [
        [0.0, 0.0],
        [25.0, 0.0],
        [31.5, 3.0],
        [35.5, 9.0],
        [36.5, 18.0],
        [34.5, 25.0],
        [31.0, 30.0],
        [33.8, 39.0],
        [36.0, 55.0],
        [34.0, 70.0],
        [30.0, 82.0],
        [29.0, 95.0],
        [30.8, 108.0],
        [34.8, 121.0],
        [36.5, 127.0],
        [36.5, 176.0],
        [35.0, 183.0],
        [31.0, 191.0],
        [25.0, 200.0],
        [18.0, 207.0],
        [14.2, 211.0],
        [14.2, 222.0],
        [0.0, 222.0],
    ]
    return [[round(r * s, 3), round(z * s, 3)] for r, z in raw]


def _label_band(scale: float) -> PartSpec:
    """Thin red sleeve around the straight center panel."""
    outer = 36.9 * scale
    inner = 36.45 * scale
    z0 = 126.5 * scale
    z1 = 193.5 * scale
    return PartSpec(
        id="red_label_band",
        color="#c41e3a",
        material="paper",
        features=[
            Feature(
                op="revolve",
                id="label_sleeve",
                profile=[
                    [inner, z0],
                    [outer, z0],
                    [outer, z1],
                    [inner, z1],
                ],
                angle=360,
                combine="new",
            )
        ],
    )


def _vertical_flute_cuts(scale: float, z0: float, height: float, radius: float) -> list[Feature]:
    """Five base flutes — explicit cuts, no polar pattern."""
    features: list[Feature] = []
    for i in range(5):
        angle = i * 72
        features.append(
            Feature(
                op="box",
                id=f"base_flute_{i + 1}",
                size=[2.2 * scale, radius * 1.95 * scale, height * scale],
                at=[0, 0, z0 * scale],
                rotation=[0, 0, angle],
                combine="cut",
            )
        )
    return features


def _horizontal_groove_cuts(scale: float) -> list[Feature]:
    """Lower-body circumferential grip grooves, below the label panel."""
    grooves = [
        (41 * scale, 33.8 * scale, 0.45 * scale),
        (49 * scale, 34.8 * scale, 0.45 * scale),
        (57 * scale, 35.5 * scale, 0.45 * scale),
        (65 * scale, 34.8 * scale, 0.45 * scale),
    ]
    features: list[Feature] = []
    for i, (z, major, minor) in enumerate(grooves, start=1):
        features.append(
            Feature(
                op="torus",
                id=f"grip_groove_{i}",
                major_radius=major,
                minor_radius=minor,
                at=[0, 0, z],
                combine="cut",
            )
        )
    return features


def _cap_features(scale: float, neck_z: float, cap_color: str) -> PartSpec:
    cap_r = 14.0 * scale
    return PartSpec(
        id="cap",
        color=cap_color,
        material="pp",
        features=[
            Feature(
                op="cylinder",
                id="cap_skirt",
                radius=cap_r,
                height=11 * scale,
                at=[0, 0, neck_z + 5.5 * scale],
                combine="new",
            ),
            Feature(
                op="torus",
                id="cap_top_bead",
                major_radius=cap_r - 0.6 * scale,
                minor_radius=0.55 * scale,
                at=[0, 0, neck_z + 11.1 * scale],
                combine="add",
            ),
            Feature(
                op="torus",
                id="tamper_band",
                major_radius=cap_r - 0.4 * scale,
                minor_radius=0.45 * scale,
                at=[0, 0, neck_z + 1.2 * scale],
                combine="add",
            ),
        ],
    )


def pet_soda_bottle_program(
    *,
    volume_ml: int = 591,
    capacity_ml: int | None = None,
    material: str = "pet",
    body_color: str = "#d4e8f0",
    cap_color: str = "#c41e3a",
    color: str | None = None,
    with_cap: bool = True,
    include_cap: bool | None = None,
    detail: str = "detailed",
    ribs: bool | None = None,
) -> FeatureProgram:
    """Coke-style PET bottle: contour revolve, grip grooves, base flutes, screw cap."""
    if capacity_ml is not None:
        volume_ml = int(capacity_ml)
    if color is not None:
        body_color = color
    if include_cap is not None:
        with_cap = bool(include_cap)

    # 20 oz / 591 ml is the schematic source size. Keep this profile close to
    # the drawing even for 500 ml prompts because Coke visual identity depends
    # more on silhouette than exact volume scaling.
    scale = max(0.88, min(1.08, (volume_ml / 591) ** (1 / 3)))
    detailed = (detail or "detailed").lower() != "simple"
    if ribs is None:
        ribs = detailed

    body_features: list[Feature] = [
        Feature(
            op="revolve",
            id="body_revolve",
            profile=_coke_contour_profile(scale),
            angle=360,
        ),
    ]

    if ribs:
        body_features.extend(_horizontal_groove_cuts(scale))
        body_features.extend(_vertical_flute_cuts(scale, z0=6, height=14, radius=34))

    # Neck support ring
    if detailed:
        body_features.append(
            Feature(
                op="torus",
                id="neck_support_ring",
                major_radius=15.3 * scale,
                minor_radius=0.75 * scale,
                at=[0, 0, 211 * scale],
                combine="add",
            )
        )
        body_features.append(
            Feature(
                op="torus",
                id="label_panel_top_bead",
                major_radius=36.1 * scale,
                minor_radius=0.45 * scale,
                at=[0, 0, 177 * scale],
                combine="add",
            )
        )
        body_features.append(
            Feature(
                op="torus",
                id="label_panel_bottom_bead",
                major_radius=36.1 * scale,
                minor_radius=0.45 * scale,
                at=[0, 0, 126 * scale],
                combine="add",
            )
        )

    parts: list[PartSpec] = [
        PartSpec(
            id="bottle_body",
            color=body_color,
            material=material,
            features=body_features,
        ),
        _label_band(scale),
    ]

    if with_cap:
        neck_z = 222 * scale
        parts.append(_cap_features(scale, neck_z, cap_color))

    slug_ml = int(volume_ml)
    name = f"coke-style-contour-{slug_ml}ml-bottle"
    rib_note = "horizontal grip grooves and base flutes" if ribs else "smooth body"
    return FeatureProgram(
        name=name,
        description=(
            f"Coca-Cola-style {volume_ml} ml PET bottle with wasp-waist contour, "
            f"{rib_note}, petaloid-base flutes, neck ring, and red screw cap."
        ),
        parts=parts,
        joints=[],
        meta={"generator": "pet_soda_bottle", "volume_ml": volume_ml, "detail": detail},
    )
