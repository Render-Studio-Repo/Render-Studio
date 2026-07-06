---
name: Silicone Mold Generation
description: Generate two-part silicone molds from selected objects, including negative cavities, registration, vents, sprues, and clip-together mold halves.
---

# Silicone Mold Generation

Use this skill when the user asks to create a silicone mold, casting mold, reverse mold, negative cavity, or clip-together mold around an existing part.

## Goal

Create a manufacturable mold assembly that is the reverse of the selected object and can be printed or machined as mold tooling for silicone casting workflows.

## Mold Requirements

- Build the mold as two or more solid mold halves around the source object.
- The source object becomes a negative cavity with clearance for release and silicone flow.
- Include a clear parting plane and label the halves as `mold_half_a` and `mold_half_b`.
- Add registration pins and matching sockets so the halves self-align.
- Add clip, clamp, or bolt features so the mold can close securely.
- Add sprue and vent channels unless the user explicitly says not to.
- Preserve the original object's scale and orientation unless the user asks for a different casting orientation.
- Keep wall thickness strong enough for repeated casting.
- Avoid undercuts when possible; call out unavoidable undercuts in the design notes.

## Default Parameters

Use these defaults unless the user gives better values:

```python
MOLD_WALL = 10.0          # mm around the cavity
MOLD_CLEARANCE = 0.4      # mm release clearance around source object
PIN_DIAMETER = 6.0        # mm registration pins
PIN_CLEARANCE = 0.3       # mm socket clearance
PIN_DEPTH = 7.0           # mm
SPRUE_DIAMETER = 8.0      # mm
VENT_DIAMETER = 2.0       # mm
CLIP_THICKNESS = 4.0      # mm
PARTING_GAP = 0.2         # mm visual/manufacturing gap
```

## Geometry Strategy

1. Measure the selected object bounding box.
2. Choose the parting plane that minimizes undercuts and places the broadest face on the mold split.
3. Create an outer mold block with at least `MOLD_WALL` around the object.
4. Split the mold block into halves along the parting plane.
5. Subtract the selected object plus `MOLD_CLEARANCE` from each half to form the negative cavity.
6. Add registration pins to one half and matching sockets to the other.
7. Add clip-together latch tabs or bolt ears outside the cavity region.
8. Add a sprue from the highest practical fill point and vents at air-trap regions.
9. Fillet external edges and label all outputs.

## Output

Return separate solid bodies/components:

- `mold_half_a`
- `mold_half_b`
- Optional `sprue_plug` or `casting_core` if needed

The final model should show the mold halves aligned but separable, with visible registration and closing features.
