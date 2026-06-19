# Output schema

Use these field shapes for internal stage outputs. The user does not need to receive raw JSON unless they ask; translate into readable summaries plus the Stage 7 CAD handoff.

## Combined analysis document

```json
{
  "blueprint_vision": {
    "version": "1.0",
    "source": {
      "modality": "concept schematic",
      "panels_used": ["iso render", "dimension lines", "component table", "workflow infographic"]
    },
    "understanding": { },
    "dimensions": { },
    "components": [ ],
    "relationships": [ ],
    "reconstruction_plan": { },
    "model_tree": { },
    "assumptions": [ ],
    "conflicts": [ ]
  }
}
```

## Stage 1 — understanding

| Field | Type | Description |
|-------|------|-------------|
| `object_type` | string | Product category |
| `primary_function` | string | What it does |
| `assembly_type` | string | Part vs assembly vs mechanism |
| `manufacturing_intent` | string | Process hints |
| `input_modality` | string | Drawing type |

## Stage 2 — dimensions

| Field | Type | Description |
|-------|------|-------------|
| `units` | string | Default `mm` |
| `overall_width_mm` | number | Envelope W |
| `overall_depth_mm` | number | Envelope D |
| `overall_height_mm` | number | Envelope H |
| `parameters` | array | Named params with `source`: callout \| table \| label \| inferred |
| `assumed_parameters` | array | Inferred with `reason` |
| `conflicts` | array | `{ field, value_a, value_b, note }` |

## Stage 3 — components

Each entry:

```json
{
  "id": "cooking_bowl",
  "name": "cooking bowl",
  "qty": 1,
  "category": "structural | functional | purchased | interface",
  "visible_in": ["iso render", "component list"],
  "key_dimensions": [{ "name": "diameter_mm", "value": 280 }]
}
```

## Stage 4 — relationships

Each entry:

```json
{
  "parent": "bridge_assembly",
  "child": "motor_housing",
  "type": "fixed | revolute | sliding | concentric | coincident | tangent",
  "qty": 1,
  "note": "optional mate description"
}
```

## Stage 5 — reconstruction plan

Each entry:

```json
{
  "component": "base_enclosure",
  "ops": ["extrude_footprint", "fillet_corners", "shell"],
  "datum": "base_center_xy",
  "depends_on": []
}
```

## Stage 6 — model tree

```json
{
  "root_id": "automated_cooking_appliance",
  "nodes": [
    { "id": "base_enclosure", "parent_id": "automated_cooking_appliance", "label": "BASE" }
  ]
}
```

## Stage 7 — handoff bundle

```json
{
  "cad_brief_markdown": "…",
  "feature_program_intent": [ ],
  "build123d_outline": "…",
  "bom_draft": [
    { "part_id": "cooking_bowl", "name": "cooking bowl", "qty": 1, "material_hint": "stainless" }
  ],
  "outputs_requested": ["step", "stl", "viewer_preview"],
  "validation_targets": [
    "bbox 420×360×520 mm",
    "shaft centered in bowl",
    "12 components present"
  ]
}
```

## BOM draft fields

| Field | Required | Description |
|-------|----------|-------------|
| `part_id` | yes | Stable ID from Stage 3 |
| `name` | yes | Display name |
| `qty` | yes | Count |
| `material_hint` | no | When visible or obvious |
| `purchased` | no | true for COTS items (motor, touchscreen) |
