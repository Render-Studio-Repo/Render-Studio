---
name: architect
description: Generate modular house CAD kits: rooms, walls, windows, roof panels, snap connectors, grid placement metadata, and robot-assembly-friendly labels.
---

# Architect Mode: Room-First Modular House CAD

Use this skill when the user is designing houses, rooms, architectural modules, wall/window/door panels, roofs, floors, service cores, or construction kits that should snap together in a grid like Lego blocks.

The primary modeling unit is a complete room module made from separate pieces. Do not start with abstract blocks or isolated plates unless the user explicitly asks for a single part. A "room" should look like a recognizable miniature house room from the first preview.

Quality bar: generated houses should look like believable modular house kits, not sci-fi boxes, random panel walls, or abstract connector sculptures. Prefer simple recognizable residential forms: floor plates, straight wall panels, corner pillars/posts, framed windows, framed doors, roof caps, trim, and visible room layout.

## Defaults

- Units: millimeters.
- Coordinate system: XY is the floor plan grid, Z is vertical.
- Default grid: 1000 mm modules unless the prompt specifies another grid size.
- Default wall height: 2800 mm unless specified.
- Default wall thickness: 140 mm for exterior panels, 90 mm for interior panels.
- Keep components rectangular and grid-aligned unless the user asks for curves or custom shapes.
- Output valid STEP-first solids with separate, named components/parts. Floors, each wall, each window insert, each door insert, roof/ceiling pieces, trim, and connectors must be individually named and selectable.
- Default materials/colors: warm wood/tan floor slabs, light drywall/plaster wall panels, darker charcoal/brown roof modules, blue-tinted glass inserts, and contrasting trim/connectors. Keep snap interfaces visible rather than hiding them in the same material.
- Default room size: 2 x 3 grid cells for a starter room, unless the prompt specifies a different footprint.
- Default preview style: leave one wall partially open, lowered, or cut away so the generated asset reads as an interior room, not a closed cube.
- Default manufacturing intent: design parts as printable modular pieces with practical connector geometry. Use simple print-friendly shapes: rectangular tabs, sockets, pegs/holes, dovetail-like rails, corner posts, alignment keys, and robot gripper flats.

## Required Modeling Behavior

1. Build rooms at a time by default, but make the room out of separate pieces. A room module must include a separate floor slab, separate north/south/east/west wall panels, at least one separate door module or door opening, at least one separate window module when reasonable, trim/baseboards, corner connectors, and roof/ceiling attachment points.
2. Treat every part as reusable: room bay, wall panel, window insert, door panel, roof/ceiling module, floor slab, corner connector, stair module, or service core.
3. Include snap features: tabs, sockets, rails, alignment keys, dovetail-like guides, or simple peg/hole connectors sized for the selected grid.
4. Name major solids/components semantically: `room_floor_A`, `wall_north_exterior`, `window_insert_01_glass`, `door_panel_A`, `roof_panel_left`, `robot_lift_tab_A`.
5. Add robot-assembly intent in source comments and labels: pick points, lift points, assembly order, mating side, and connector type.
6. Make window and door modules replaceable inserts, not just visual cutouts.
7. Prefer kit assemblies over one fused monolith. Never fuse the room into a single solid. Keep room parts as distinct components/bodies so Render Studio can select a wall and run wall-level generative edits.
8. Add clear reference dimensions in comments: module grid count, room footprint, wall height, panel thickness, connector spacing, and intended snap side.
9. Assign house-like visual styling/material labels to major solids so the Render Studio preview reads as a house kit without manual coloring.
10. Add architectural cues: baseboards, sill/lintel pieces, trim frames, studs or panel seams, simple interior floor finish, and visible wall thickness.
11. Make each wall length adjustable after generation. Avoid modeling walls as one merged perimeter; make each wall a standalone body with its own origin/center, label, length dimension, connector endpoints, and snap-side metadata.
12. Design every structural part as if it may be 3D printed and robot assembled. Include connector clearances, lead-in chamfers, oversized robot pick tabs, flat gripping faces, and visible orientation labels such as `TOP`, `INSIDE`, `NORTH`, and `SNAP_A`.

## Prompt Expansion

When the user asks for a room, infer a complete kit:

- floor slab with warm wood/tan material
- four separate wall panels with visible thickness and light wall/plaster material
- one wall partially open, lowered, or cut away for interior visibility unless the user asks for a sealed exterior module
- at least one door opening plus a removable door insert
- at least one window opening plus a blue-glass window insert when reasonable
- baseboards, trim, sill/lintel parts, and simple panel seams
- corner posts/connectors
- snap rails/tabs around the floor perimeter and wall bottoms
- ceiling/roof sockets, even if the roof module is not included
- labeled mating interfaces and assembly-order comments
- print-friendly connectors and robot pick/lift features on each major part

When the user asks for a house, infer a small starter house kit:

- one or two complete room modules on separate floor slabs
- exterior wall panels as separate editable bodies, never a perimeter shell
- interior divider walls as separate shorter panels when useful
- corner pillars/posts at floor corners and wall intersections
- at least one real front door with frame and threshold
- at least two framed windows with blue glass inserts
- separate roof panels or roof caps that mate to wall tops
- printable wall-to-floor tabs/sockets and wall-to-pillar connectors
- robot pick tabs/grip flats on floor, wall, pillar, and roof modules
- an open/cutaway side or removable roof so the house reads as rooms

Use a simple layout before adding style: `floor_A`, `floor_B`, `wall_front`, `wall_back`, `wall_left`, `wall_right`, `interior_wall_01`, `pillar_front_left`, `pillar_front_right`, `door_front_insert`, `window_left_01`, `window_right_01`, `roof_panel_A`, `roof_panel_B`.

For a room output, use a naming pattern like:

- `room_floor_wood`
- `wall_north_exterior`
- `wall_south_open_cutaway`
- `wall_east_plaster`
- `wall_west_plaster`
- `window_insert_north_01`
- `door_insert_south_01`
- `baseboard_trim_north`
- `corner_connector_NE`
- `snap_tab_wall_north_A`
- `socket_floor_north_A`
- `robot_pick_tab_wall_north`

Wall-level edits must preserve the selected wall as a separate editable piece. If adding a window to a wall, create/modify only that wall plus a separate `window_insert_*` and trim/lintel/sill pieces.

## Room Output Contract

Every generated room or house must be an assembly of named/selectable pieces. At minimum:

- `room_floor_*`
- `wall_north_*`
- `wall_south_*`
- `wall_east_*`
- `wall_west_*`
- `corner_connector_*`
- `baseboard_trim_*`
- `roof_socket_*` or `ceiling_socket_*`
- `snap_tab_*`
- `snap_socket_*`
- `alignment_key_*`
- `robot_pick_tab_*`

If a room has a window or door, they must be separate pieces:

- `window_insert_*`
- `window_glass_*`
- `window_trim_*`
- `door_insert_*`
- `door_frame_*`

The user must be able to select an individual wall and later run wall tools such as "add window", "add door", "resize/extend wall", or "generative wall idea" without regenerating the entire room as one fused object.

## Printable Connector Contract

Every generated room/house kit should include physical connector logic:

- Floor edges should have rail/socket features for walls.
- Wall bottoms should have matching tabs/feet for floor rails.
- Wall ends should include peg/socket, dovetail, or keyed connectors for corner posts and neighboring walls.
- Roof/ceiling panels should include sockets or clips that mate to wall tops.
- Windows and doors should be removable inserts with their own small snap tabs or frame pockets.
- Include simple clearance notes in source comments, for example "connector clearance target: 0.2-0.4 mm for printed scale prototypes" when relevant.
- Avoid fragile needle-like features. Use chunky tabs, chamfered lead-ins, and flat gripping surfaces.

## Robot Assembly Contract

Every major part should include robot-assembly affordances:

- At least one `robot_pick_tab_*`, grip flat, or lift hole on floor/wall/roof modules.
- Assembly-order labels/comments such as `step_01_place_floor`, `step_02_snap_wall_north`, `step_03_insert_window_north`.
- Mating-side labels on connectors, e.g. `mates_to_floor_north_rail` or `mates_to_corner_connector_NE`.
- Orientation labels on visible or edge surfaces where practical: `INSIDE`, `OUTSIDE`, `TOP`, `NORTH`.

When the user asks for a house, generate one room module at a time unless they explicitly ask for a full multi-room assembly. A good first output is a `starter_room_2x3` kit that can accept additional room modules later.

When the user asks for walls, floors, roofs, windows, or doors from Architect mode, bias the output toward a module that can plug into a complete room. Include the matching interfaces that make it obvious where it attaches.

When the user asks for robot construction instructions, include:

- ordered assembly steps
- pick/lift tab geometry
- approximate module mass assumptions if useful
- safe gripping flats or holes
- alignment features that tolerate small placement error

## Avoid

- Do not make decorative-only boxes with no snap or assembly features.
- Do not use vague mesh-like geometry when parametric solids can represent the module.
- Do not fuse all parts if the prompt asks for modular construction.
- Do not generate a single closed house shell, random skyscraper-like block, sci-fi bunker, or generic cube with bumps. A house must have readable floors, walls, doors, windows, roof pieces, and separate connector/pillar bodies.
- Do not claim code compliance, structural certification, or safety certification.

<!-- render3d-studio -->

## Render Studio

On the Render Studio server this skill lives at `backend/skills/architect/`.

- **Python tools:** `backend/skills/architect/scripts/` (run from the **project directory**, not the skill folder)
- **References:** `backend/skills/architect/references/`
- **CAD 2.0 / Fusion / Architect modes:** follow this skill exactly — author complete build123d Python with `gen_step()`, then run `scripts/step`, `scripts/inspect`, and `scripts/snapshot` like upstream text-to-cad. Do **not** emit Render Studio JSON Feature Programs in those modes.
- **Standard mode only:** when the product asks for a Feature Program, emit Render Studio JSON Feature Programs instead of Python.
- **Handoffs:** ignore `$cad-viewer` / cross-skill CLI handoffs unless that skill is also enabled in Skills Library; Render Studio's own viewer loads the generated STEP/GLB.
- **Sync:** `scripts/sync-skills-from-text-to-cad.sh` then `scripts/patch-skills-for-render3d.sh`

See `backend/skills/RENDER3D.md` for full integration notes.
