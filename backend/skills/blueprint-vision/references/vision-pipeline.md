# Vision analysis pipeline

Read this file when executing Blueprint Vision Stages 1–7 on an attached schematic, drawing, or technical illustration.

## Stage 1: Image understanding

Identify from the full image (all panels, not just the hero render):

- Overall object purpose and product category
- Primary mechanical or electromechanical function
- Assembly type (single part, multi-part assembly, kinematic mechanism, appliance, fixture, etc.)
- Manufacturing intent (sheet metal, machined, molded, welded, purchased COTS + custom frame, etc.)
- Input modality (concept iso, orthographic blueprint, exploded view, infographic workflow sheet, hand sketch)

**Output shape:**

```json
{
  "object_type": "countertop cooking appliance",
  "primary_function": "automated ingredient preparation and cooking",
  "assembly_type": "electromechanical system",
  "manufacturing_intent": "sheet metal base, formed bowl, machined shaft, purchased motor",
  "input_modality": "concept schematic with iso render, dimension lines, and component table"
}
```

## Stage 2: Dimension extraction

Read **all visible text numbers** and graphic dimension lines:

- Overall width, depth, height (envelope)
- Component-level sizes (bowl diameter, column width, motor housing OD)
- Hole diameters, radii, fillets, chamfers, wall thickness callouts
- Distances, offsets, and repeated features (`4X`, `TYP.`)
- Scale bars, title-block units, and projection notes

Rules:

- Prefer explicit callouts over visual proportion
- When only one dimension is stated, use it to anchor scale for the rest (mark others as assumed)
- When two callouts conflict, record both and flag — do not pick silently
- Default units: millimeters unless the drawing states otherwise

**Output shape:**

```json
{
  "units": "mm",
  "overall_width_mm": 420,
  "overall_depth_mm": 360,
  "overall_height_mm": 520,
  "parameters": [
    { "name": "bowl_diameter", "symbol": "BD", "value_mm": 280, "source": "callout" },
    { "name": "base_height", "symbol": "BH", "value_mm": 140, "source": "table" }
  ],
  "assumed_parameters": [
    { "name": "wall_thickness", "value_mm": 2.5, "reason": "typical small appliance enclosure; not labeled" }
  ],
  "conflicts": []
}
```

## Stage 3: Component recognition

List every distinct component visible or strongly implied:

- Structural parts (base, columns, bridge, brackets)
- Functional parts (bowl, shaft, paddle, hopper, dispensers)
- Purchased or standard items (motor, touchscreen, knob, oil bottle)
- Subassemblies (chopper assembly, spice system, oil system)

Use stable snake_case IDs. Include qty when the image shows multiples.

**Output shape:**

```json
{
  "components": [
    { "id": "base_enclosure", "name": "base enclosure", "qty": 1 },
    { "id": "cooking_bowl", "name": "cooking bowl", "qty": 1 },
    { "id": "support_column", "name": "support column", "qty": 2 },
    { "id": "bridge_assembly", "name": "bridge assembly", "qty": 1 },
    { "id": "motor_housing", "name": "motor housing", "qty": 1 },
    { "id": "mixing_shaft", "name": "mixing shaft", "qty": 1 },
    { "id": "mixing_paddle", "name": "mixing paddle", "qty": 1 },
    { "id": "chopper_hopper", "name": "chopper hopper", "qty": 1 },
    { "id": "spice_dispenser", "name": "spice dispenser", "qty": 3 },
    { "id": "oil_reservoir", "name": "oil reservoir", "qty": 1 },
    { "id": "touchscreen", "name": "touchscreen control panel", "qty": 1 },
    { "id": "control_knob", "name": "control knob", "qty": 1 }
  ]
}
```

## Stage 4: Relationship graph

Determine assembly hierarchy and mates:

- Parent/child tree (what mounts to what)
- Mate types: fixed, revolute, sliding, concentric, coincident, tangent
- Functional constraints (shaft centered in bowl, bridge spans columns, motor drives shaft)

**Output shape:**

```json
{
  "root": "automated_cooking_appliance",
  "relationships": [
    { "parent": "base_enclosure", "child": "cooking_bowl", "type": "fixed", "note": "bowl seated in base recess" },
    { "parent": "base_enclosure", "child": "support_column", "type": "fixed", "qty": 2 },
    { "parent": "support_column", "child": "bridge_assembly", "type": "fixed" },
    { "parent": "bridge_assembly", "child": "motor_housing", "type": "fixed" },
    { "parent": "motor_housing", "child": "mixing_shaft", "type": "revolute", "note": "centered in bowl" },
    { "parent": "mixing_shaft", "child": "mixing_paddle", "type": "fixed" }
  ]
}
```

## Stage 5: CAD reconstruction plan

Translate components into ordered modeling operations:

- Base primitives: extrude, revolve, loft, sweep, shell, fillet, chamfer, pattern
- Assembly order: stable base first, then bowl, columns, bridge, motor stack, accessories
- Reference datums for mates (bowl center, column centers, bridge span)

**Output shape:**

```json
{
  "operations": [
    { "component": "base_enclosure", "ops": ["extrude_footprint", "fillet_corners", "shell_cavity", "cut_control_openings"] },
    { "component": "cooking_bowl", "ops": ["revolve_profile", "shell"] },
    { "component": "support_column", "ops": ["extrude_column", "pattern_mirror"], "qty": 2 },
    { "component": "bridge_assembly", "ops": ["extrude_bridge_beam"] },
    { "component": "motor_housing", "ops": ["revolve_or_extrude_housing"] },
    { "component": "mixing_shaft", "ops": ["revolve_shaft"] },
    { "component": "mixing_paddle", "ops": ["extrude_paddle_blades"] }
  ],
  "assembly_order": [
    "base_enclosure",
    "cooking_bowl",
    "support_column",
    "bridge_assembly",
    "motor_housing",
    "mixing_shaft",
    "mixing_paddle",
    "chopper_hopper",
    "spice_dispenser",
    "oil_reservoir",
    "touchscreen",
    "control_knob"
  ]
}
```

## Stage 6: Parametric model tree

Emit a readable assembly tree with stable IDs matching Stage 3:

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
├── OIL_SYSTEM
│   └── OIL_RESERVOIR
└── CONTROL_PANEL
    ├── TOUCHSCREEN
    └── CONTROL_KNOB
```

Map tree nodes to Stage 2 parameters where applicable.

## Stage 7: Text-to-CAD prompt generation

Produce a **complete** generation prompt — not a summary. Include:

- Object name and envelope dimensions
- Every component with key dimensions
- Assembly constraints and joint types
- Coordinate convention (origin, base plane, +Z up)
- Output requests (STEP, STL, viewer preview)
- Validation targets (bbox, shaft centered in bowl, component count)

Formats to emit:

1. **CAD brief** (prose, for CAD skill / `cad-brief.md`)
2. **Render Studio Feature Program intent** (ordered features with combine ops when running in Studio)
3. **Build123D outline** (function names, parameters, major features — not full code unless requested)

Example prompt fragment:

```text
Build a parametric assembly: automated countertop cooking appliance.
Envelope: 420 × 360 × 520 mm (W × D × H). Units: mm, origin at base center, Z up.

Components:
- Base enclosure: 420 × 360 × 140 mm, stainless appearance, control cutout front-left
- Cooking bowl: Ø280 mm, revolved profile, seated in base
- Two support columns at rear corners, 60 × 60 mm section, full height to bridge
- Bridge spans columns; motor housing centered above bowl
- Mixing shaft: Ø16 mm, revolute joint, centered in bowl; paddle at bottom
- Left hopper on column; three spice dispensers on right column; oil bottle on base
- Touchscreen + knob on base front

Validate: envelope 420×360×520, shaft concentric with bowl, all listed components present.
Output: STEP assembly, STL meshes, CAD Viewer preview.
```

## Validation checklist

Before handing off to CAD, confirm:

- [ ] Every legible text label from the image appears in Stage 2 or Stage 3
- [ ] Envelope dimensions match stated callouts
- [ ] Component count matches the schematic
- [ ] Parent/child graph has no orphans
- [ ] Assumed values are listed separately from observed values
- [ ] Stage 7 prompt is sufficient to model without re-opening the image
