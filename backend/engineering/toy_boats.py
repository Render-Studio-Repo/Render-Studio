"""Deterministic toy boat / Benchy-style CAD generators."""

from __future__ import annotations

from backend.kernel.schema import Feature, FeatureProgram, PartSpec

# Official #3DBenchy reference dimensions (mm): 60 L x 31 W x 48 H.
# https://www.3dbenchy.com/dimensions/


def benchy_boat_program(*, material: str = "pla", color: str = "#e85d4a") -> FeatureProgram:
    """Generate a single-solid Benchy-style toy boat.

    Everything is built as one fused part (like a real 3D-printed Benchy), with
    openings cut into that solid rather than assembling separate filled pieces.
    """

    features = [
        # --- base solid: lofted hull ---
        Feature(
            op="loft",
            id="hull",
            sections=[
                {
                    "z": 0,
                    "profile": [
                        [-28, 0],
                        [-10, -1.8],
                        [12, -2.2],
                        [27, 0],
                        [12, 2.2],
                        [-10, 1.8],
                    ],
                },
                {
                    "z": 5,
                    "profile": [
                        [-29, -5],
                        [-6, -9],
                        [18, -7],
                        [29, -1],
                        [29, 1],
                        [18, 7],
                        [-6, 9],
                        [-29, 5],
                    ],
                },
                {
                    "z": 10,
                    "profile": [
                        [-30, -10],
                        [-2, -14],
                        [20, -11],
                        [30, -3],
                        [30, 3],
                        [20, 11],
                        [-2, 14],
                        [-30, 10],
                    ],
                },
                {
                    "z": 15.5,
                    "profile": [
                        [-30, -15],
                        [-8, -15.5],
                        [16, -14],
                        [30, 0],
                        [16, 14],
                        [-8, 15.5],
                        [-30, 15],
                    ],
                },
                {
                    "z": 17.5,
                    "profile": [
                        [-30, -15.2],
                        [-8, -15.8],
                        [16, -14.3],
                        [30.2, 0],
                        [16, 14.3],
                        [-8, 15.8],
                        [-30, 15.2],
                    ],
                },
            ],
        ),
        # --- fuse all superstructure into the hull (no gaps) ---
        Feature(op="box", id="stern_box", size=[12, 10.81, 9], at=[-24, 0, 20], combine="add"),
        Feature(op="box", id="cabin", size=[16, 22, 11], at=[-4, 0, 21.5], combine="add"),
        Feature(op="box", id="roof", size=[23, 24, 2.2], at=[-4, 0, 28.1], combine="add"),
        Feature(op="cylinder", id="chimney", radius=3.5, height=18.8, at=[-10, 0, 38.6], combine="add"),
        Feature(op="cone", id="bow_stem", bottom_radius=4.5, top_radius=1.2, height=6, at=[28, 0, 12], rotation=[0, 90, 0], combine="add"),
        Feature(op="box", id="port_gunwale", size=[52, 1.2, 1.8], at=[-2, -15.8, 17.2], combine="add"),
        Feature(op="box", id="starboard_gunwale", size=[52, 1.2, 1.8], at=[-2, 15.8, 17.2], combine="add"),
        # --- cut openings into the unified solid ---
        Feature(op="box", id="deck_opening", size=[20, 22, 10], at=[10, 0, 21], combine="cut"),
        Feature(op="cylinder", id="hawsepipe", radius=2.0, height=8, at=[24, 0, 14], rotation=[0, 90, 0], combine="cut"),
        Feature(op="box", id="stern_box_hollow", size=[8, 7, 8.5], at=[-24, 0, 20.5], combine="cut"),
        Feature(op="cylinder", id="stern_window", radius=4.5, height=3, at=[-25.5, -7, 23], rotation=[90, 0, 0], combine="cut"),
        Feature(op="box", id="door_lower", size=[3, 10.5, 7.5], at=[4.2, 0, 23], combine="cut"),
        Feature(
            op="cylinder",
            id="door_arch",
            radius=5.25,
            height=3.5,
            at=[4.2, 0, 29.5],
            rotation=[0, 90, 0],
            combine="cut",
        ),
        Feature(op="cylinder", id="port_window", radius=4.5, height=3, at=[-4, -10.8, 25], rotation=[90, 0, 0], combine="cut"),
        Feature(op="cylinder", id="starboard_window", radius=4.5, height=3, at=[-4, 10.8, 25], rotation=[90, 0, 0], combine="cut"),
        Feature(op="cylinder", id="chimney_bore", radius=1.5, height=12, at=[-10, 0, 40], combine="cut"),
    ]

    return FeatureProgram(
        name="benchy_style_toy_boat",
        description=(
            "Single-solid Benchy-style toy boat (60x31x48 mm): one fused body with "
            "lofted hull, cabin, roof, chimney, and cut openings for deck, door, and portholes."
        ),
        parts=[
            PartSpec(
                id="benchy_boat",
                color=color,
                material=material,
                features=features,
            ),
        ],
        joints=[],
        meta={"generator": "benchy_boat", "style": "3dbenchy-single-solid"},
    )
