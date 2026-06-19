# Example: automated cooking appliance

Reference schematic: `example-appliance-schematic.png` (infographic-style concept sheet with iso render, dimension lines, component list, workflow stages, and validation checklist).

Use this example when calibrating extraction quality for complex product schematics.

## Source image content

The schematic shows a **countertop automated cooking appliance** with:

- Iso render with dimension lines: **420 mm W × 360 mm D × 520 mm H**
- Zone map (chopper, motor, spice, oil regions)
- Component breakdown table with 11+ labeled parts
- Workflow infographic (input → interpretation → layout → breakdown → parametric plan → geometry → validation → deliverables)

## Stage 1 — understanding

```json
{
  "object_type": "countertop cooking appliance",
  "primary_function": "automated ingredient preparation and cooking",
  "assembly_type": "electromechanical system",
  "manufacturing_intent": "sheet metal and formed metal base, revolved bowl, machined shaft, purchased motor and UI",
  "input_modality": "concept schematic infographic with iso render and text tables"
}
```

## Stage 2 — dimensions (observed + assumed)

**Observed from image text:**

| Parameter | Value | Source |
|-----------|-------|--------|
| Overall width | 420 mm | dimension line |
| Overall depth | 360 mm | dimension line |
| Overall height | 520 mm | dimension line |
| Bowl diameter | 280 mm | parameter table |
| Base height | 140 mm | parameter table |
| Shaft diameter | 16 mm | parameter table |

**Assumed (not labeled — mark in output):**

- Column section ≈ 60 × 60 mm (proportion from iso; assumed)
- Wall thickness 2.0–3.0 mm for base enclosure (typical appliance; assumed)
- Spice dispenser OD ≈ 40 mm (proportion; assumed)

## Stage 3 — components

From the component list and iso render:

1. Base enclosure (stainless)
2. Cooking bowl (large, centered)
3. Support columns ×2 (rear corners)
4. Bridge assembly (spans columns)
5. Motor housing (above bowl, on bridge)
6. Mixing shaft (vertical, through motor into bowl)
7. Mixing paddle (on shaft, inside bowl)
8. Chopper hopper (left column)
9. Spice dispensers ×3 (right column)
10. Oil reservoir (small bottle on base)
11. Touchscreen control panel (base front)
12. Control knob (base front)

## Stage 4 — relationships (excerpt)

```json
[
  { "parent": "base_enclosure", "child": "cooking_bowl", "type": "fixed" },
  { "parent": "base_enclosure", "child": "support_column", "type": "fixed", "qty": 2 },
  { "parent": "support_column", "child": "bridge_assembly", "type": "fixed" },
  { "parent": "bridge_assembly", "child": "motor_housing", "type": "fixed" },
  { "parent": "motor_housing", "child": "mixing_shaft", "type": "revolute", "note": "centered in bowl" },
  { "parent": "mixing_shaft", "child": "mixing_paddle", "type": "fixed" },
  { "parent": "support_column", "child": "chopper_hopper", "type": "fixed", "note": "left column only" },
  { "parent": "support_column", "child": "spice_dispenser", "type": "fixed", "qty": 3, "note": "right column" },
  { "parent": "base_enclosure", "child": "oil_reservoir", "type": "fixed" },
  { "parent": "base_enclosure", "child": "touchscreen", "type": "fixed" },
  { "parent": "base_enclosure", "child": "control_knob", "type": "fixed" }
]
```

## Stage 5 — reconstruction plan (excerpt)

| Component | Operations |
|-----------|------------|
| base_enclosure | extrude 420×360×140, fillet, shell, cut UI openings |
| cooking_bowl | revolve profile Ø280, shell |
| support_column | extrude 60×60×(520−140), pattern mirror |
| bridge_assembly | extrude beam between column tops |
| motor_housing | revolve or extrude housing above bowl center |
| mixing_shaft | revolve Ø16 vertical shaft |
| mixing_paddle | extrude blade profile, mate to shaft bottom |

## Stage 6 — model tree

```text
AUTOMATED_COOKING_APPLIANCE
├── BASE_ENCLOSURE
├── COOKING_BOWL
├── LEFT_COLUMN
├── RIGHT_COLUMN
├── BRIDGE_ASSEMBLY
│   └── MOTOR_HOUSING
│       └── MIXING_SHAFT
│           └── MIXING_PADDLE
├── CHOPPER_HOPPER
├── SPICE_SYSTEM
│   └── SPICE_DISPENSER ×3
├── OIL_RESERVOIR
└── CONTROL_PANEL
    ├── TOUCHSCREEN
    └── CONTROL_KNOB
```

## Stage 7 — sample CAD handoff prompt

```text
Use the CAD skill to model this assembly from the attached schematic analysis.

Automated countertop cooking appliance — parametric assembly, mm, origin at base center, Z up.
Envelope: 420 × 360 × 520 mm.

Parts:
- Base enclosure: 420 × 360 × 140 mm, rounded corners, front cutouts for touchscreen and knob
- Cooking bowl: Ø280 mm revolved profile, seated in base center
- Two rear support columns, ~60 × 60 mm, height to bridge underside
- Bridge beam spanning columns; motor housing centered above bowl
- Mixing shaft Ø16 mm, revolute about vertical axis, concentric with bowl
- Mixing paddle fixed to shaft bottom inside bowl
- Chopper hopper on left column; three spice dispensers on right column
- Oil bottle on base; touchscreen + knob on front face

Constraints: shaft centered in bowl; all parts within envelope; bridge fixed to columns.

Output:
- STEP assembly
- STL per part or combined
- Preview in CAD Viewer

Validation: bbox 420×360×520; 12 components; shaft/bowl concentricity.
```

## Studio prompt example

Attach the schematic image and send:

```text
Use the Blueprint Vision skill to analyze this schematic, then model it with the CAD skill.

Extract all dimensions and labels from the image text. Produce the full 7-stage analysis,
then generate a parametric STEP assembly matching the 420×360×520 mm envelope.

Output: STEP, STL, CAD Viewer preview.
```
