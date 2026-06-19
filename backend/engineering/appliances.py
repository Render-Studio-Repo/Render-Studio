"""Deterministic appliance CAD generators."""

from __future__ import annotations

from backend.engineering.steppers import nema14_stepper_part, nema17_stepper_part
from backend.kernel.schema import Feature, FeatureProgram, PartSpec


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


def _fillet(radius: float, edges: str = "all") -> Feature:
    return Feature(op="fillet", id=f"fillet_{edges}", radius=radius, edges=edges)


def _shell(thickness: float, openings: str = "top") -> Feature:
    return Feature(op="shell", id=f"shell_{openings}", thickness=thickness, openings=openings)


def _fixed(parent: str, child: str, anchor: list[float]) -> dict:
    return {"id": f"{parent}_to_{child}", "type": "fixed", "parent": parent, "child": child, "anchor": anchor}


def _mixing_whisk_features(hub_z: float = 132) -> list[Feature]:
    """Balloon whisk toolhead: hub plus splayed wire loops."""
    features: list[Feature] = [_cylinder("hub", 18, 14, [0, 0, hub_z])]
    wire_count = 8
    for i in range(wire_count):
        angle = 360.0 * i / wire_count
        features.append(
            _cylinder(
                f"wire_{i}",
                2.5,
                58,
                [0, 0, hub_z - 8],
                combine="add",
                rotation=[20, 0, angle],
            )
        )
    return features


def automated_cooking_appliance_program() -> FeatureProgram:
    """Countertop cooking appliance assembly built from clean named solids.

    Envelope: 420 W x 360 D x 520 H mm, Z-up, origin at the base center.
    """
    parts: list[PartSpec] = [
        PartSpec(
            id="base_enclosure",
            material="stainless_steel",
            color="#8f979b",
            features=[
                _box("base_box", [420, 360, 92], [0, 0, 46]),
                _fillet(6, "all"),
            ],
        ),
        PartSpec(
            id="cooking_bowl",
            material="stainless_steel",
            color="#c7d0d3",
            features=[
                Feature(
                    op="revolve",
                    id="bowl_wall_revolve",
                    profile=[
                        [102, 92],
                        [122, 92],
                        [140, 145],
                        [140, 173],
                        [132, 188],
                        [118, 188],
                        [125, 170],
                        [126, 148],
                        [108, 104],
                    ],
                    angle=360,
                    combine="new",
                ),
            ],
        ),
        PartSpec(
            id="left_column",
            material="stainless_steel",
            color="#7e8d94",
            features=[
                _box("left_column_body", [54, 54, 360], [-170, 122, 270]),
            ],
        ),
        PartSpec(
            id="right_column",
            material="stainless_steel",
            color="#7e8d94",
            features=[
                _box("right_column_body", [54, 54, 360], [170, 122, 270]),
            ],
        ),
        PartSpec(
            id="bridge_assembly",
            material="stainless_steel",
            color="#73858d",
            features=[
                _box("bridge_beam", [394, 62, 48], [0, 122, 462]),
                _box("front_stiffener", [360, 18, 24], [0, 84, 432], combine="add"),
                _box("motor_mount_pad", [58, 58, 8], [0, 122, 490], combine="add"),
            ],
        ),
        nema17_stepper_part("stepper_agitator", shaft_axis="z", color="#1a1f23"),
        PartSpec(
            id="agitator_coupler",
            material="aluminum",
            color="#9aa7ac",
            features=[
                _cylinder("coupler_sleeve", 10, 18, [0, 122, 448]),
                _cylinder("set_screw_boss", 12, 6, [0, 122, 438], combine="add"),
            ],
        ),
        PartSpec(
            id="mixing_shaft",
            material="stainless_steel",
            color="#d9e1e3",
            features=[
                _cylinder("vertical_shaft", 8, 190, [0, 0, 242]),
                _cylinder("lower_coupler", 16, 22, [0, 0, 150], combine="add"),
            ],
        ),
        PartSpec(
            id="mixing_paddle",
            material="stainless_steel",
            color="#d1d9dc",
            features=_mixing_whisk_features(),
        ),
        PartSpec(
            id="chopper_hopper",
            material="polycarbonate",
            color="#d5e4e2",
            features=[
                Feature(
                    op="loft",
                    id="hopper_taper",
                    sections=[
                        {"z": 160, "width": 70, "height": 54},
                        {"z": 252, "width": 116, "height": 94},
                    ],
                    combine="new",
                ),
            ],
            placement=[-150, -64, 0],
        ),
        PartSpec(
            id="chopper_mechanism",
            material="stainless_steel",
            color="#9ba8aa",
            features=[
                _box("feed_tube", [108, 34, 28], [-104, -42, 132]),
                _cylinder("cutter_hub", 18, 30, [-54, -42, 132], combine="add", rotation=[0, 90, 0]),
                _cylinder("feed_screw", 8, 72, [-88, -42, 132], combine="add", rotation=[0, 90, 0]),
            ],
        ),
        nema17_stepper_part("stepper_chopper", shaft_axis="y", color="#1a1f23"),
        PartSpec(
            id="output_chute",
            material="stainless_steel",
            color="#b7c2c5",
            features=[
                _box("angled_chute", [112, 34, 24], [-100, -50, 118], rotation=[0, 0, -7]),
            ],
        ),
        PartSpec(
            id="spice_shelf",
            material="stainless_steel",
            color="#c5cdd0",
            features=[
                _box("shelf_plate", [132, 88, 12], [128, -28, 198]),
                _box("rear_bracket", [132, 12, 72], [128, 12, 228], combine="add"),
            ],
        ),
    ]

    for i, x in enumerate([86, 128, 170], start=1):
        parts.append(
            PartSpec(
                id=f"spice_canister_{i}",
                material="glass",
                color="#d9e7ea",
                features=[
                    _cylinder("canister_body", 18, 92, [x, -38, 250]),
                    _cylinder("black_lid", 19, 10, [x, -38, 301], combine="add"),
                ],
            )
        )

    parts.extend(
        [
            PartSpec(
                id="dispenser_mechanisms",
                material="polycarbonate",
                color="#6f777b",
                features=[
                    _box("dispenser_bar", [128, 20, 24], [128, -84, 198]),
                    _cylinder("dial_1", 12, 10, [86, -96, 198], combine="add", rotation=[90, 0, 0]),
                    _cylinder("dial_2", 12, 10, [128, -96, 198], combine="add", rotation=[90, 0, 0]),
                    _cylinder("dial_3", 12, 10, [170, -96, 198], combine="add", rotation=[90, 0, 0]),
                ],
            ),
            nema14_stepper_part("stepper_spice_1", color="#252a2e"),
            nema14_stepper_part("stepper_spice_2", color="#252a2e"),
            nema14_stepper_part("stepper_spice_3", color="#252a2e"),
            PartSpec(
                id="oil_reservoir",
                material="glass",
                color="#e0d18a",
                features=[
                    _cylinder("reservoir_bottle", 18, 116, [196, 76, 176]),
                    _cylinder("oil_cap", 16, 12, [196, 76, 240], combine="add"),
                ],
            ),
            PartSpec(
                id="oil_tube",
                material="silicone",
                color="#e7d278",
                features=[
                    _cylinder("horizontal_tube", 5, 150, [124, 74, 244], rotation=[0, 90, 0]),
                    _cylinder("drop_tube", 5, 80, [54, 74, 202], combine="add"),
                ],
            ),
            PartSpec(
                id="oil_nozzle",
                material="stainless_steel",
                color="#d2dcde",
                features=[
                    _cylinder("nozzle_body", 8, 34, [28, 74, 164], rotation=[90, 0, 0]),
                    _cylinder("nozzle_tip", 4, 22, [28, 54, 152], combine="add", rotation=[90, 0, 0]),
                ],
            ),
            PartSpec(
                id="touchscreen",
                material="glass",
                color="#071523",
                features=[
                    _box("screen_glass", [112, 8, 44], [-70, -184, 46]),
                ],
            ),
            PartSpec(
                id="rotary_knob",
                material="aluminum",
                color="#b6c0c3",
                features=[
                    _cylinder("knob", 19, 18, [84, -190, 48], rotation=[90, 0, 0]),
                ],
            ),
        ]
    )

    joints = [
        _fixed("world", "base_enclosure", [0, 0, 0]),
        _fixed("base_enclosure", "cooking_bowl", [0, 0, 92]),
        _fixed("base_enclosure", "left_column", [-170, 122, 92]),
        _fixed("base_enclosure", "right_column", [170, 122, 92]),
        _fixed("left_column", "bridge_assembly", [-170, 122, 438]),
        _fixed("bridge_assembly", "stepper_agitator", [0, 122, 494]),
        _fixed("stepper_agitator", "agitator_coupler", [0, 122, 448]),
        {
            "id": "agitator_drive",
            "type": "continuous",
            "parent": "stepper_agitator",
            "child": "mixing_shaft",
            "anchor": [0, 122, 438],
            "axis": [0, 0, -1],
            "drive_velocity_dps": 120,
        },
        _fixed("mixing_shaft", "mixing_paddle", [0, 0, 132]),
        _fixed("left_column", "chopper_hopper", [-150, -64, 190]),
        _fixed("chopper_hopper", "chopper_mechanism", [-88, -42, 132]),
        _fixed("left_column", "stepper_chopper", [-148, -42, 132]),
        {
            "id": "chopper_drive",
            "type": "continuous",
            "parent": "stepper_chopper",
            "child": "chopper_mechanism",
            "anchor": [-124, -42, 132],
            "axis": [0, 1, 0],
            "drive_velocity_dps": 90,
        },
        _fixed("chopper_mechanism", "output_chute", [-100, -50, 118]),
        _fixed("right_column", "spice_shelf", [128, -28, 198]),
        _fixed("spice_shelf", "spice_canister_1", [86, -38, 204]),
        _fixed("spice_shelf", "spice_canister_2", [128, -38, 204]),
        _fixed("spice_shelf", "spice_canister_3", [170, -38, 204]),
        _fixed("spice_shelf", "dispenser_mechanisms", [128, -84, 198]),
        _fixed("dispenser_mechanisms", "stepper_spice_1", [86, -96, 176]),
        _fixed("dispenser_mechanisms", "stepper_spice_2", [128, -96, 176]),
        _fixed("dispenser_mechanisms", "stepper_spice_3", [170, -96, 176]),
        {
            "id": "spice_drive_1",
            "type": "revolute",
            "parent": "stepper_spice_1",
            "child": "spice_canister_1",
            "anchor": [86, -38, 204],
            "axis": [0, 0, 1],
            "limits": [0, 360],
            "drive_velocity_dps": 180,
        },
        {
            "id": "spice_drive_2",
            "type": "revolute",
            "parent": "stepper_spice_2",
            "child": "spice_canister_2",
            "anchor": [128, -38, 204],
            "axis": [0, 0, 1],
            "limits": [0, 360],
            "drive_velocity_dps": 180,
        },
        {
            "id": "spice_drive_3",
            "type": "revolute",
            "parent": "stepper_spice_3",
            "child": "spice_canister_3",
            "anchor": [170, -38, 204],
            "axis": [0, 0, 1],
            "limits": [0, 360],
            "drive_velocity_dps": 180,
        },
        _fixed("base_enclosure", "oil_reservoir", [196, 76, 118]),
        _fixed("oil_reservoir", "oil_tube", [124, 74, 244]),
        _fixed("oil_tube", "oil_nozzle", [28, 54, 152]),
        _fixed("base_enclosure", "touchscreen", [-70, -184, 46]),
        _fixed("base_enclosure", "rotary_knob", [84, -190, 48]),
    ]

    return FeatureProgram(
        name="countertop-automated-cooking-appliance",
        description=(
            "Complete clean parametric countertop cooking appliance assembly: "
            "base, support frame, bowl, NEMA-17 agitator/chopper steppers, NEMA-14 spice "
            "dispenser steppers, shaft, paddle, chopper, spice system, oil system, and controls "
            "within a 420 x 360 x 520 mm envelope."
        ),
        parts=parts,
        joints=joints,
        meta={
            "generator": "automated_cooking_appliance",
            "envelope_mm": [420, 360, 520],
            "validation_targets": {
                "required_bodies": [p.id for p in parts],
                "shaft_centered_in_bowl": True,
                "separate_named_bodies": True,
                "stepper_motors": [
                    "stepper_agitator",
                    "stepper_chopper",
                    "stepper_spice_1",
                    "stepper_spice_2",
                    "stepper_spice_3",
                ],
            },
        },
    )
