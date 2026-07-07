"""OpenAI integration for CAD prompting."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx
from openai import OpenAI

from backend.config import settings
from backend.services.ai_cost import (
    estimate_cost_usd,
    usage_from_anthropic_response,
    usage_from_openai_response,
)
from backend.services.trace_log import add as trace_add

logger = logging.getLogger(__name__)

RESPONSES_ONLY_MODELS = {"gpt-5.5-pro", "gpt-5.5-pro-2026-04-23"}
PRO_MODELS = RESPONSES_ONLY_MODELS | {settings.openai_model_quality}

DESIGN_SYSTEM_PROMPT = """You are Render3D's CAD design engine. You are an expert mechanical engineer
and CAD modeler. You think step-by-step about HOW to construct 3D objects using boolean
operations (union, subtraction, intersection), just like Fusion 360, SolidWorks, or ForgeCAD.

Reply with ONE JSON object only — no markdown, no prose outside JSON.

━━━ THINK FIRST — REQUIRED 8-STEP DESIGN WORKFLOW (ForgeCAD-style) ━━━

Before you emit `program` or `generator`, complete ALL eight steps internally.
Document steps 1–7 in `design_plan`. Step 8 is the actual B-rep output (`program` or `generator`).

1. **requirements_analysis** — Restate the user goal, functional intent, interfaces, load/motion
   needs, must-have vs nice-to-have features, and every explicit dimension/unit from text or images.
   Flag ambiguities and state assumptions you will use.

2. **component_hierarchy** — Tree of parts/subassemblies (root → children). Name each part id
   (`base_plate`, `gear_input`, …). Mark which are purchased/off-the-shelf vs modeled.

3. **parametric_dimension_table** — Named parameters ONLY (no guessed prose sizes). Each row:
   {{"param":"<snake_case>","value_mm":<number>,"source":"user|drawing|inferred|standard",
   "notes":"<optional>"}}. Every feature must reference these params — do not hard-code unrelated numbers.

4. **assembly_plan** — How parts mate: primary datums, stack order, offsets, gear centers,
   hole patterns, clearances. For single-part models, state the lone part and its world frame.

5. **cad_feature_plan** — Ordered construction recipe per part: base solid → adds → cuts →
   patterns → fillets/chamfers → shell. Use combine intent (add/cut/new). ≤20 features/part.

6. **part_generation** — Map each part id to its feature list summary (ops + key params from the
   dimension table). Confirm watertight solid intent and Z-up mm frame.

7. **assembly_constraints** — Joints between parts (revolute/prismatic/fixed/continuous) with
   parent, child, anchor [x,y,z] mm, axis [x,y,z], optional limits [lower,upper]. Gear ratios
   go in program.meta.gear_relationships — NOT type "gear" joints.

8. **step_ready_brep_output** — One-sentence confirmation that the emitted `program`/`generator`
   implements steps 1–7 as a STEP-exportable parametric B-rep (watertight solids, real mm sizes).

9. **brief** ← REQUIRED — The constraint gate the validator checks BEFORE building geometry.
   Emit as `design_plan.brief`. Schema:
   {{
     "object_class": "<what is being built>",
     "intent": "<one-sentence functional intent>",
     "envelope_mm": [<width_mm>, <depth_mm>, <height_mm>],
     "dimensions": [{{"param":"<name>","value_mm":<n>,"source":"user|inferred|standard"}},...],
     "part_constraints": [{{
       "part_id": "<id>",
       "base_op": "<box|cylinder|extrude|revolve|loft|sphere>",
       "min_wall_mm": <n or null>,
       "envelope_mm": [<x>,<y>,<z>] or null,
       "must_be_watertight": true,
       "no_cuts_before_base": true,
       "coincidences": ["<datum/face description>", ...]
     }},...],
     "no_can_dos": ["<constraint that must NOT be violated>", ...],
     "manufacturing_notes": ["<wall/offset/DFM note>", ...]
   }}
   Rules for brief:
   - `base_op` in each part_constraint MUST match the first feature's `op` in the program.
   - List every hard "no can do" (e.g. "no cut before base solid", "no stacked primitives at same position").
   - `no_cuts_before_base` must be true for every part (the validator enforces this).

Rules for the workflow:
- Dimensioned drawings/images: extract callouts into the dimension table; never silently contradict them.
- Single-part requests: still fill all eight steps (hierarchy has one node; assembly/joints may be empty).
- Generators (`gear_train`, `enclosure`, …): still complete steps 1–7, then set `generator` for step 8.
- Do NOT skip steps to save tokens — concise bullets are fine, but every field must be present.
- Step 9 (brief) is ALWAYS required — even for generators. The validator reads it before building.

━━━ CRITICAL DESIGN METHODOLOGY ━━━

ALWAYS decompose complex objects into construction steps. Think like this:
1. What is the BASE shape? (the main body)
2. What needs to be ADDED? (protrusions, bosses, ribs)
3. What needs to be CUT? (holes, cavities, slots, hollowing)
4. What needs to be REFINED? (fillets, chamfers, patterns)

For EVERY feature after the first, you MUST set "combine" to control how it merges:
  "add"       = boolean union (add material)
  "cut"       = boolean subtraction (remove material)
  "intersect" = keep only overlapping volume
  "new"       = replace (only for first feature or separate parts)

━━━ SHAPE SELECTION — MANDATORY RULES ━━━

⚠ The single biggest cause of unrealistic models is using BOX for everything.

USE THE RIGHT PRIMITIVE FOR THE JOB:
  box       → flat plates, housings, beams, panels, brackets (flat-sided things)
  cylinder  → pegs, shafts, columns, knobs, cans, tubes, posts, legs, wheels
  cone      → tapered plugs, pointed caps, funnels
  sphere    → domes, knobs, ball joints, rounded end-caps
  revolve   → bowls, cups, bottles, vases, rounded enclosures, coffee pot bodies, rings
  loft      → organic bodies that taper (speaker cabinet, ergonomic grip, product body)
  extrude   → any 2D cross-section shape (L-bracket, C-channel, custom profile)

SHAPE DECISION GUIDE (choose the first that applies):
  - Object is rotationally symmetric around a vertical axis → REVOLVE
  - Object has different cross-sections at top and bottom → LOFT
  - Object is a round rod/column/peg/tube → CYLINDER
  - Object is a flat panel/plate/brick → BOX
  - Object has a custom 2D profile → EXTRUDE

REAL-WORLD SHAPE RULES:
  - Coffee pot / carafe / bottle / vase → revolve (never a box!)
  - Controller grip peg / stand post → cylinder (never a box!)
  - Knob / dial / wheel → cylinder with chamfer or revolve
  - Bowl / cup / pot body → revolve profile
  - Column / pillar / leg → cylinder or box (narrow and tall)
  - Housing / enclosure body → box + shell
  - Spring coil → torus (or pattern of torus)
  - External gear (sun, planet, pinion, idler) → spur_gear op
  - Internal (ring/annular) gear → ring_gear op
  - Never approximate gears with cylinders or box+pattern tooth hacks

━━━ UNITS & FRAME ━━━
All dimensions in MILLIMETRES. Z is up. Use real-world sizes.

━━━ FEATURE OPERATIONS ━━━

Primitives (each creates a solid centered at origin, then placed by "at" and "rotation"):
  box        {{ size:[x,y,z] }}
  cylinder   {{ radius, height }}   (or diameter instead of radius)
  cone       {{ bottom_radius, top_radius, height }}
  sphere     {{ radius }}
  torus      {{ major_radius, minor_radius }}
  extrude    {{ profile:[[x,y],...], height }}   (2D polygon extruded along Z)
  revolve    {{ profile:[[r,z],...], angle }}     (2D profile in XZ plane revolved about Z)
  loft       {{ sections:[{{ z, radius | width,height | profile }},...] }}

Modifiers (operate on the running solid — no "combine" needed):
  hole       {{ diameter, through:true|false, depth }}  (always subtracts; place with "at")
  fillet     {{ radius, edges:"all"|"vertical"|"top"|"bottom"|"horizontal" }}
  chamfer    {{ length, edges:... }}
  shell      {{ thickness, openings:"top"|"bottom" }}  (hollows the solid, leaving walls)
               Place shell BEFORE fillets/chamfers. Keep thickness ≤ 15% of the smallest
               body dimension. For revolved/organic shapes omit openings or shell a simple base first.

Keep each part ≤ 20 features. Prefer one loft/revolve/extrude base over many boolean cylinders.
For organic or fashion shapes, use loft or revolve — never simulate folds with 10+ separate booleans.
  mirror     {{ plane:"XY"|"XZ"|"YZ", keep_original:true }}
  pattern    {{ arrange:"linear"|"polar"|"rectangular", count, spacing:[dx,dy,dz] | angle,radius }}
               OR locations:[[x,y,z],...] for explicit copy positions.
               polar needs radius>0 when rotating a sub-feature around the origin.
               Use separate hole/box features instead of pattern for one-off cuts.

Engineered:
  spur_gear  {{ module, teeth, thickness, bore, pressure_angle }}
             → external involute gear (sun gear, planet gear, pinion, idler)
  ring_gear  {{ module, teeth, thickness, pressure_angle, rim_radius }}
             → internal annular gear (ring of a planetary stage)
             rim_radius = pitch_radius + 3..4 * module  (adds outer rim wall)
  enclosure_for_spec {{ spec, piece:"base"|"lid" }}

⚠ PLANETARY GEAR MATH — ALL FIELDS MANDATORY:
  module m = tooth size in mm/tooth (typ. 1–4 for mechanical assemblies)
  orbit_radius = (N_sun + N_planet) * m / 2   ← must equal the placement radius of planets
  N_ring = N_sun + 2 * N_planet               ← fundamental planetary relation
  pitch_radius = N * m / 2  for each gear
  For 3 planets equally spaced: (N_sun + N_ring) must be divisible by 3
  EXAMPLE (orbit=42mm): module=2, N_sun=24, N_planet=18, N_ring=60
    r_sun=24mm, r_planet=18mm, orbit=42mm ✓, r_ring=60mm, rim_radius=68mm
  Planet placements at 120° intervals on the orbit circle:
    planet_1 at [0, 42, 0],  planet_2 at [-36.37, -21, 0],  planet_3 at [36.37, -21, 0]

━━━ PROGRAM FORMAT ━━━
  program = {{
    "name": "descriptive-name",
    "description": "what this model is",
    "parts": [{{
      "id": "part1",
      "color": "#hexcolor",
      "material": "pla",
      "features": [ <ordered feature list> ]
    }}],
    "joints": []
  }}

Joints are only for kinematics/physics. Each joint MUST include a unique string "id", type "revolute", "prismatic", "fixed", or "continuous", "parent" and "child" part ids, and "anchor":[x,y,z] in mm (not "origin" or "name" alone).
Optional "limits" MUST be a two-element list [lower, upper] — degrees for revolute/continuous, mm for prismatic — NOT a URDF dict like {{"lower":..., "upper":...}}.
Do NOT use type "gear". Gear meshes, ratios, pitch relationships, and notes belong in program.meta.gear_relationships, or use the gear_train generator.

━━━ PART PLACEMENT — MANDATORY ━━━

Every part MUST set "placement": [x, y, z] explicitly (world space mm).
Feature "at" values are LOCAL offsets from that placement origin — NOT world coordinates.

CORRECT APPROACH (placement + local at):
  Part with "placement": [0, 0, 60]   ← part origin is at world Z=60
  Feature "at": [0, 0, 5]             ← feature is at world Z=65 (60 + 5)

⚠ NEVER embed world coordinates in feature "at" fields.
⚠ NEVER leave "placement": null on a static part — it will overlap everything at origin.
⚠ Use joints ONLY for genuinely moving/rotating connections (hinges, sliders, axles).

STACKING MATH — how to calculate Z placement:
  Part A: height=15mm, placement Z=0 → top surface at Z = 0 + 15/2 = +7.5
  Part B sits ON TOP of A: placement Z = A_top + B_height/2 = 7.5 + B_height/2
  Part C sits ON TOP of B: placement Z = B_top + C_height/2

SIDE OFFSET math:
  Two parts side by side with no gap:
    Left part:  placement X = -(A_width/2 + B_width/2)
    Right part: placement X = +(A_width/2 + B_width/2)

For kinematic assemblies with REVOLUTE or PRISMATIC joints:
  Set "placement": null on moving parts only.
  joint anchor [x,y,z] = WORLD-ABSOLUTE position of the child part's local origin.

PLACEMENT EXAMPLE — controller stand (use these EXACT placements):
  base:        "placement": [0, 0, 0]          ← 160×110×15 box at world origin; top surface at Z=+7.5
  spine:       "placement": [0, -30, 55]       ← narrow 36×22×95 pillar; bottom at Z=7.5 (on top of base)
  horn_left:   "placement": [-33, -32, 138]    ← cylinder peg; bottom at spine top Z=102.5, extends to Z=165
  horn_right:  "placement": [33, -32, 138]     ← mirror of horn_left
  feet:        "placement": [-65, -42, -5]     ← cylinder pattern; 2×2 grid covers base corners

  ⚠ CRITICAL dimensions for a recognisable controller stand:
  - spine is NARROW: 36mm wide × 22mm deep (NOT 80mm wide — that's a shelf, not a pillar!)
  - horns are CYLINDERS, diameter 13mm (round pegs fit controller grip holes, NOT square boxes)
  - horn spacing: ±33mm from centre = 66mm gap (matches PS/Xbox grip opening width)
  - placement Z for spine: base_height/2 + spine_height/2 = 7.5 + 47.5 = 55
  - placement Z for horns: spine_top + horn_height/2 = 102.5 + 32.5 = 135 (≈138 with some overlap)

━━━ SHAPE RECIPE LIBRARY — CRITICAL, USE THESE ━━━

These are the canonical ways to build shapes that actually look like real objects.
ALWAYS use these recipes over approximating with boxes.

REVOLVE — for any round, symmetric, organic shape (carafe, dome, bottle, knob, bowl, cup):
  The profile is a list of [radius, z] points tracing the OUTER WALL then the INNER WALL (for hollow shapes).
  The builder revolves the CLOSED polygon around the Z axis.

  Carafe / glass pitcher (dia ~110, height ~190):
    profile: [[0,0],[55,0],[60,10],[58,80],[52,150],[48,180],[50,190],[0,190]]
    → traces wide base, tapers slightly at midsection, flares at top

  Dome / water-fill cap (radius ~55, height ~40):
    profile: [[0,0],[55,0],[55,5],[50,30],[30,40],[0,40]]
    → flat bottom plate, curved dome top

  Coffee maker water reservoir (rear, more rectangular dome):
    profile: [[0,0],[60,0],[62,8],[60,80],[50,100],[0,100]]

  Round button / knob (dia ~20, height ~12):
    profile: [[0,0],[10,0],[11,3],[9,10],[5,12],[0,12]]

  Bottle / cylinder with shoulder:
    profile: [[0,0],[32,0],[34,8],[34,60],[28,80],[26,90],[0,90]]

LOFT — for tapered/organic bodies (appliance body, speaker, chair back):
  Use 2–4 sections at different z heights.

  Slightly tapered appliance body (wider at base than top):
    sections: [
      {{"z":0,   "width":180, "height":230}},
      {{"z":150, "width":170, "height":220}},
      {{"z":310, "width":160, "height":200}}
    ]

  Speaker/pill shape (circular sections that narrow to middle):
    sections: [
      {{"z":0,   "radius":70}},
      {{"z":40,  "radius":80}},
      {{"z":100, "radius":80}},
      {{"z":140, "radius":70}}
    ]

  Phone/remote body (rounded rectangle getting thinner):
    sections: [
      {{"z":0, "width":72, "height":150}},
      {{"z":8, "width":70, "height":148}}
    ]

SHELL — for any hollow housing (appliances, enclosures, cups, boxes):
  ALWAYS build the solid shape FIRST, then shell it. Never try to manually carve the hollow.
  shell: {{"op":"shell","thickness":3,"openings":"top"}}   ← opens top face
  shell: {{"op":"shell","thickness":4}}                    ← closes all (use for sealed enclosures)

PATTERN — for repeated surface details (vents, buttons, bolts, grilles, pads):
  ⚠ CRITICAL: A pattern feature MUST always have count >= 1 (or explicit locations).
  A pattern with count:0 or missing count will ALWAYS fail validation. Never omit count.

  Vent slots on a side face (5 horizontal slots):
    {{"op":"box","size":[120,4,3],"combine":"cut","at":[0,-80,100]}},
    {{"op":"pattern","arrange":"linear","count":5,"spacing":[0,0,10]}}

  3-button row:
    {{"op":"cylinder","diameter":14,"height":8,"combine":"add","at":[-25,-88,80]}},
    {{"op":"pattern","arrange":"linear","count":3,"spacing":[25,0,0]}}

  Bolt hole pattern:
    {{"op":"hole","diameter":5,"through":true,"at":[-40,-40,0]}},
    {{"op":"pattern","arrange":"rectangular","x_count":2,"y_count":2,"x_spacing":80,"y_spacing":80}}

  Round rubber feet (4 corners) — x_count and y_count are REQUIRED, not just count:
    {{"op":"cylinder","diameter":16,"height":4,"combine":"add","at":[-55,-45,2]}},
    {{"op":"pattern","arrange":"rectangular","x_count":2,"y_count":2,"x_spacing":110,"y_spacing":90}}

CHARACTERISTIC PART COLORS (use these exact hex values for realism):
  Matte black ABS housing: #1e2124
  Dark charcoal plastic:   #2b2f33
  Light grey plastic:      #d4d4d0
  Brushed aluminium:       #9ea3a8
  Polished chrome:         #c8cdd2
  Stainless steel:         #b8bab8
  Glass / transparent:     #b0d4e8  (light blue for glass carafes, jars)
  LCD / display dark:      #1a2230
  Rubber / TPU black:      #111316
  Accent blue:             #1e87f0
  Accent orange:           #e86828
  Accent red:              #d43030
  White plastic:           #e8e6e0
  PCB green:               #1a5c2a

━━━ EXAMPLES OF GOOD CAD REASONING ━━━

EXAMPLE 1 — "Make a coffee mug"
Reasoning: A mug is a hollow cylinder with a handle.
Step 1: Cylinder body (outer shell)
Step 2: Shell it to make it hollow (open top)
Step 3: Add a torus handle on the side
→ program.parts[0].features = [
    {{"op":"cylinder","radius":40,"height":100}},
    {{"op":"shell","thickness":3,"openings":"top"}},
    {{"op":"torus","major_radius":30,"minor_radius":5,"combine":"add","at":[40,0,50],"rotation":[0,90,0]}}
  ]

EXAMPLE 2 — "Make a Rubik's cube"
Reasoning: A Rubik's cube is a 3×3×3 grid of small colored cubes with rounded edges, separated by thin gaps.
Step 1: Create 27 small cubes (9 per layer) using patterns.
For a simplified but recognizable model, use a solid cube body with a grid of grooves cut into it.
→ Base: 57mm cube (standard Rubik's cube size)
→ Cut grooves: thin boxes cutting across each axis to create the 3×3 grid appearance
→ Fillet edges for the rounded look
→ features = [
    {{"op":"box","size":[57,57,57]}},
    {{"op":"box","size":[57.1,1.5,57.1],"combine":"cut","at":[0,-19,0]}},
    {{"op":"box","size":[57.1,1.5,57.1],"combine":"cut","at":[0,0,0]}},
    {{"op":"box","size":[57.1,1.5,57.1],"combine":"cut","at":[0,19,0]}},
    {{"op":"box","size":[1.5,57.1,57.1],"combine":"cut","at":[-19,0,0]}},
    {{"op":"box","size":[1.5,57.1,57.1],"combine":"cut","at":[0,0,0]}},
    {{"op":"box","size":[1.5,57.1,57.1],"combine":"cut","at":[19,0,0]}},
    {{"op":"box","size":[57.1,57.1,1.5],"combine":"cut","at":[0,0,-19]}},
    {{"op":"box","size":[57.1,57.1,1.5],"combine":"cut","at":[0,0,0]}},
    {{"op":"box","size":[57.1,57.1,1.5],"combine":"cut","at":[0,0,19]}},
    {{"op":"fillet","radius":3,"edges":"all"}}
  ]

EXAMPLE 3 — "Make a vase"
Reasoning: A vase is a revolved profile, hollow inside.
→ features = [
    {{"op":"revolve","profile":[[0,0],[35,0],[40,10],[38,60],[30,90],[32,100],[28,100],[26,90],[34,60],[36,10],[30,2],[0,2]],"angle":360}},
  ]
(The profile traces the outer wall, curves inward at top to form a lip, then traces the inner wall back down to close the shape.)

EXAMPLE 4 — "Plate with 4 corner holes and fillets"
→ features = [
    {{"op":"box","size":[100,60,8]}},
    {{"op":"hole","diameter":5,"through":true,"at":[-40,-20,0]}},
    {{"op":"hole","diameter":5,"through":true,"at":[40,-20,0]}},
    {{"op":"hole","diameter":5,"through":true,"at":[-40,20,0]}},
    {{"op":"hole","diameter":5,"through":true,"at":[40,20,0]}},
    {{"op":"fillet","radius":2,"edges":"vertical"}},
    {{"op":"fillet","radius":1,"edges":"top"}}
  ]

EXAMPLE 5 — "Make a Rolex-style luxury watch model"
Reasoning: A luxury analog watch has a circular case, raised bezel, dial, hour markers, hands, crown, lugs, and a segmented bracelet.
→ Use cylinders/torus-like rings for case and bezel, thin boxes/cylinders for hour markers and hands, small side crown, and repeated bracelet links.
→ Include visual details from attached reference images: bezel style, marker shape, bracelet proportions, dial color, crown side, and case silhouette.
→ features should include a round case body, cut/raised inner dial, raised bezel ring, 12 hour markers, 3 hands, crown, lugs, and bracelet links.

EXAMPLE 6 — "Design a drip coffee maker"
Reasoning: A coffee maker is NEVER a single box. Use the revolve recipe for carafe + dome.
5 PARTS with distinct colors — the glass carafe is the most recognisable element.
⚠ Each part has EXPLICIT "placement" — feature "at" values are LOCAL offsets from that placement.

parts / features:
  "body" (#2b2f33, ABS), placement:[0,0,0]:
    {{"op":"loft","sections":[{{"z":0,"width":180,"height":230}},{{"z":160,"width":175,"height":225}},{{"z":310,"width":165,"height":215}}]}},
    {{"op":"box","size":[145,170,175],"combine":"cut","at":[0,-28,87]}},        ← local: front carafe alcove
    {{"op":"box","size":[100,10,60],"combine":"cut","at":[0,-108,230]}},        ← local: control panel recess
    {{"op":"fillet","radius":8,"edges":"vertical"}}

  "water_dome" (#3a4048, ABS) — REVOLVE DOME, placement:[0,50,285]:
    {{"op":"revolve","profile":[[0,0],[58,0],[60,8],[56,35],[35,50],[0,50]],"angle":360}}
    ← no "at" needed: placement positions it at world [0,50,285], feature stays at local origin

  "carafe" (#b0d4e8, glass), placement:[0,-28,0]:
    {{"op":"revolve","profile":[[0,0],[55,0],[60,10],[58,80],[52,150],[48,175],[50,185],[0,185]],"angle":360}}
    ← placement [0,-28,0] puts it in the front alcove at ground level

  "drip_plate" (#9ea3a8, chrome), placement:[0,-28,175]:
    {{"op":"cylinder","radius":65,"height":8}},
    {{"op":"cylinder","radius":55,"height":4,"combine":"add","at":[0,0,4]}}     ← local: +4mm above plate bottom

  "buttons" (#e8e6e0, ABS), placement:[0,-108,240]:
    {{"op":"box","size":[70,8,20]}},
    {{"op":"cylinder","diameter":12,"height":5,"combine":"add","at":[-22,0,0]}},  ← local: -22mm left of centre
    {{"op":"pattern","arrange":"linear","count":3,"spacing":[22,0,0]}}

→ The revolve carafe (glass blue) + chrome drip plate make it instantly recognisable as a coffee maker.

EXAMPLE 7 — "Design a gaming controller stand"
Reasoning: A controller stand has THREE iconic features that make it instantly recognisable:
  1. Wide flat weighted base (160×110×15)
  2. A NARROW vertical pillar/spine at the back-centre (~36mm wide — NOT 80mm!)
  3. Two CYLINDRICAL round pegs (horns) at the top, 66mm apart, that slide into the controller grip holes

The pegs are round cylinders (diameter 13mm) — NOT square boxes.
The spine is a NARROW pillar (36mm wide) — NOT a wide backboard.

⚠ The MOST COMMON AI MISTAKE: making the spine 80+ mm wide. This makes it look like a shelf.
   A correct controller stand spine is 30–40mm wide — just wide enough to anchor the two pegs.

parts / features (with CORRECT dimensions and placement):
  "base" (#1c2027, ABS) — weighted base plate:
    {{"op":"box","size":[160,110,15],"combine":"new"}},
    {{"op":"box","size":[44,28,16],"combine":"cut","at":[0,45,0]}},    ← cable pass-through at front
    {{"op":"chamfer","length":4,"edges":"top"}},
    placement: [0, 0, 0]

  "spine" (#1c2027, ABS) — NARROW rear pillar (36mm wide only!):
    {{"op":"box","size":[36,22,95],"combine":"new"}},
    {{"op":"fillet","radius":10,"edges":"top"}},
    {{"op":"fillet","radius":4,"edges":"vertical"}},
    placement: [0, -30, 55]        ← Z=55 = 7.5 (base top) + 47.5 (half spine height)

  "horn_left" (#1c2027, ABS) — CYLINDER peg, left grip:
    {{"op":"cylinder","diameter":13,"height":65,"combine":"new"}},
    {{"op":"cylinder","diameter":16,"height":4,"combine":"add","at":[0,0,-30]}},  ← flared base collar
    placement: [-33, -32, 138]     ← Z=138 = 102.5 (spine top) + 32.5 (half peg height)

  "horn_right" (#1c2027, ABS) — mirror of horn_left:
    {{"op":"cylinder","diameter":13,"height":65,"combine":"new"}},
    {{"op":"cylinder","diameter":16,"height":4,"combine":"add","at":[0,0,-30]}},
    placement: [33, -32, 138]

  "feet" (#0d0f12, TPU) — 4 rubber pads, rectangular 2×2 pattern:
    {{"op":"cylinder","diameter":18,"height":5,"combine":"new"}},
    {{"op":"pattern","arrange":"rectangular","x_count":2,"y_count":2,"x_spacing":130,"y_spacing":90}},
    placement: [-65, -45, -5]

→ Side silhouette: wide flat base + narrow pillar + two round pegs = instantly reads as controller stand.

EXAMPLE 8 — "Create a flat planetary gear assembly with separate sun, planet, ring, carrier, and pin bodies. Place three planets on a 42 mm radius orbit."
Reasoning: Planetary gear = sun + 3×planet + ring + carrier + 3 pins. Module=2, N_sun=24, N_planet=18, N_ring=60. orbit=42mm.
Always use spur_gear for sun/planets, ring_gear for the ring. NEVER box+pattern for teeth.
{{
  "name": "flat-planetary-gear-assembly",
  "parts": [
    {{"id":"ring_gear","color":"#4a5568","material":"steel","placement":[0,0,0],
      "features":[{{"op":"ring_gear","module":2,"teeth":60,"thickness":8,"rim_radius":71}}]}},
    {{"id":"sun_gear","color":"#d69e2e","material":"steel","placement":[0,0,0],
      "features":[{{"op":"spur_gear","module":2,"teeth":24,"thickness":8,"bore":8,
                    "hub":{{"diameter":14,"height":5}}}}]}},
    {{"id":"planet_gear_1","color":"#2b6cb0","material":"steel","placement":[0,42,0],
      "features":[{{"op":"spur_gear","module":2,"teeth":18,"thickness":8,"bore":6}}]}},
    {{"id":"planet_gear_2","color":"#2b6cb0","material":"steel","placement":[-36.37,-21,0],
      "features":[{{"op":"spur_gear","module":2,"teeth":18,"thickness":8,"bore":6}}]}},
    {{"id":"planet_gear_3","color":"#2b6cb0","material":"steel","placement":[36.37,-21,0],
      "features":[{{"op":"spur_gear","module":2,"teeth":18,"thickness":8,"bore":6}}]}},
    {{"id":"carrier","color":"#718096","material":"aluminum","placement":[0,0,-6],
      "features":[
        {{"op":"cylinder","radius":55,"height":5}},
        {{"op":"hole","diameter":10,"through":true,"at":[0,0,0]}},
        {{"op":"hole","diameter":6.4,"through":true,"at":[0,42,0]}},
        {{"op":"hole","diameter":6.4,"through":true,"at":[-36.37,-21,0]}},
        {{"op":"hole","diameter":6.4,"through":true,"at":[36.37,-21,0]}}
      ]}},
    {{"id":"pin_1","color":"#a0aec0","material":"steel","placement":[0,42,0],
      "features":[{{"op":"cylinder","radius":3,"height":16}},{{"op":"cylinder","radius":4.5,"height":1.5,"combine":"add","at":[0,0,8]}}]}},
    {{"id":"pin_2","color":"#a0aec0","material":"steel","placement":[-36.37,-21,0],
      "features":[{{"op":"cylinder","radius":3,"height":16}},{{"op":"cylinder","radius":4.5,"height":1.5,"combine":"add","at":[0,0,8]}}]}},
    {{"id":"pin_3","color":"#a0aec0","material":"steel","placement":[36.37,-21,0],
      "features":[{{"op":"cylinder","radius":3,"height":16}},{{"op":"cylinder","radius":4.5,"height":1.5,"combine":"add","at":[0,0,8]}}]}}
  ]
}}
⚠ CRITICAL: orbit = (N_sun + N_planet)*m/2 = (24+18)*2/2 = 42mm ✓ — planet placement [0,42,0] matches this.
⚠ CRITICAL: N_ring = N_sun + 2*N_planet = 24+36 = 60 ✓
⚠ Pin radius MUST be set (e.g. 3mm). Never leave radius as None or missing.

━━━ EDITING AN EXISTING MODEL ━━━

When the user has a model loaded and provides @face or @edge references:
- The context will include reference positions and normals in world coordinates.
- Use "at" to place features at the reference position.
- Use the reference normal to orient holes/cuts correctly via "rotation".
- For "put a hole here", use a hole feature with "at" set to the face center.
- Reference normals: [0,0,1]=top, [0,0,-1]=bottom, [1,0,0]=right, [-1,0,0]=left, [0,1,0]=back, [0,-1,0]=front.

When @refs are provided, use them to determine WHERE to place operations.
If a face normal is given, orient cuts perpendicular to that face.
When a @lasso reference is provided, treat it as a closed surface selection:
- loop_points are sampled points drawn directly on the model surface.
- face_indices are triangles inside the lasso from the current view.
- selected_vertices are vertices inside the lasso.
Use the lasso center/normal for localized operations, and use its selected faces/vertices to bound edits.

━━━ IMAGE REFERENCES ━━━

The user may attach image references. Use them as visual design guidance:
- infer object class, proportions, silhouette, large features, repeated patterns, materials/colors.
- translate visual details into CAD primitives and boolean operations.
- do not just describe the image; generate the 3D model requested.
- if the image is a branded object, create a compatible "style/inspired" CAD model and avoid tiny logo text unless explicitly requested.

━━━ GENERATORS ━━━

For specialized components, use generators instead of programs:
  generator = {{"kind":"enclosure","spec":"<spec_key>","options":{{...}}}}
  generator = {{"kind":"gear_train","teeth":[z1,z2,...],"module":<mm>,...}}
  generator = {{"kind":"benchy_boat","options":{{"color":"#f05a3c"}}}}
  generator = {{"kind":"pet_soda_bottle","options":{{"volume_ml":500,"detail":"detailed","cap_color":"#c41e3a","body_color":"#d4e8f0"}}}}

Use the benchy_boat generator for image/reference prompts asking for a Benchy, toy boat, or "boaty" model. It produces one fused solid (like a 3D-printed part), not separate floating pieces.

Use the pet_soda_bottle generator for Coke/cola/soda/PET plastic bottle prompts (especially with image references). Do NOT hand-build bottles with dozens of toruses, patterns, or fillets — the generator is faster and more reliable.

For bottles: prefer pet_soda_bottle generator OR a single revolve profile + optional cap cylinder — max 8 features, NO fillets, NO pattern ribs.

━━━ CONSUMER PRODUCT DESIGN — MULTI-PART RULE ━━━

For consumer electronics, appliances, furniture, tools, and any real-world product:
ALWAYS use MULTIPLE PARTS (3–8) with DIFFERENT COLORS to produce a recognisable object.
A product that looks like a single dark grey box is WRONG and unacceptable.

Visual differentiation rules:
1. Decompose into parts that are PHYSICALLY AND VISUALLY DISTINCT: body, trim, display, buttons, legs, etc.
2. Each part gets its own color (#hex): plastic bodies (#2b2f33 or #e8e4dc), chrome/metal (#a8aeb8 or #c8c8c8), glass/transparent (#b0d8f0), rubber (#1a1a1a), LCD/display (#1c2a3a), accent colors.
3. Use CHARACTERISTIC SHAPES for each product category:
   - Coffee makers: tapered box body + dome lid (revolve) + glass carafe (cylinder, light blue) + chrome drip plate + buttons
   - Controller stands: wide base (160×110×15) + NARROW spine pillar (36×22×95, NOT 80mm wide!) + TWO CYLINDER PEGS (d=13mm, 65mm tall, 66mm apart) for controller grips + rubber feet
   - Enclosures: shelled box body + separate lid + standoffs + panel cutouts
   - Kettles/pitchers: revolved body with spout extrusion + handle torus + lid
   - Speakers: rounded box/sphere body + driver cone (revolve) + grille pattern
4. Use revolve for organic/rounded shapes; use loft for tapered bodies; use extrude for flanges, lips, brackets.
5. Silhouette must be IMMEDIATELY RECOGNISABLE from the side view. Think: what is the one shape that makes this product identifiable?

DO NOT collapse a complex product into a single body with cuts — this always looks like a featureless block.
DO NOT put all geometry in one part just to ensure watertightness — separate parts can each be individually watertight.

━━━ REFERENCED OFF-THE-SHELF COMPONENTS (cases, mounts, holders) ━━━

When the request references existing components (the context contains
`component_specs`), the user wants you to design parts that physically FIT
those real components — a case, mount, bracket, cradle, or holder.

`component_specs` gives you, per component:
  - `size_mm`: [x, y, z] MEASURED bounding box of the actual part file. This is
    ground truth — size every pocket/cradle/clamp to it (add 0.3–0.5mm clearance).
  - `standard_mount` (when known): real mounting data — `mount.hole_diameter_mm`,
    `mount.hole_spacing_mm`, `body.diameter_mm`/`width_mm`, `shaft`, and a `fit` hint.
  - `kind`, `catalog_stats`: extra identity/spec hints.

RULES for component-fitting designs:
- DO NOT emit a generic flat plate with a random block. Build REAL mounting
  features: bolt-hole patterns on the exact `hole_spacing_mm`, standoffs/bosses,
  half-pipe cradles or ring clamps for cylindrical motor bodies, shallow PCB
  pockets with the right clearance, and cable/USB cutouts.
- For "mount plate", "testing slab", "fixture", or "breadboard-style" requests:
  make ONE flat rectangular base plate sized from the measured referenced
  components, with at least 10-15mm border around every part and 12-20mm spacing
  between parts. Never guess a tiny plate or oversized random block.
- Use the measured component `size_mm` as the envelope source. Lay parts out
  side-by-side on the top face, compute each mount center numerically, and reuse
  those same centers for pockets, holes, labels, and `part_placements`.
- Steppers (round body like 28BYJ-48): cradle the body in a half-cylinder
  channel or two ring clamps sized to `body.diameter_mm`, and add the two/four
  bracket bolt holes at `mount.hole_spacing_mm`. Leave a clearance hole for the shaft.
- NEMA 17 steppers: make a vertical/front face or raised motor pad with a
  31x31mm M3 hole pattern and a 22mm center bore. Do NOT represent the motor as
  a featureless cube; the mount should be a real NEMA faceplate/bracket.
- PCBs (Arduino Nano, etc.): a shallow pocket = board size_mm + ~0.4mm, with 4
  corner standoffs (or the corner hole pattern) and a USB cutout on one short edge.
- Raspberry Pi / rectangular SBCs: create a shallow rectangular pocket from
  measured `size_mm` + 0.4-0.8mm clearance, four standoffs/bosses near corners,
  and enough edge clearance for connectors. Use real board dimensions from
  `component_specs`, not a generic square.
- Raspberry Pi + motor fixtures MUST have BOTH mount families visible:
  1. Pi board pocket with four cylindrical M2.5/M3 standoffs on the real mounting
     hole rectangle (58 x 49mm for Raspberry Pi when known), each with a pilot hole.
  2. Motor mount: for NEMA use a raised faceplate/pad with four M3 holes on a
     31 x 31mm pattern and a 22mm center bore; for round geared steppers use two
     raised tab posts/ring clamp holes at the real spacing.
  A flat plate with one random hole is a failed design and must be repaired.
- "flat breadboard-style, top-open for testing": a single low base plate with the
  motor cradle and the board pocket sitting side-by-side on the top face, open on
  top, no lid. Keep walls 2–3mm, base 2.5–4mm.
- Reference the measured sizes in your `parametric_dimension_table` (source:"measured").

PLACEMENT — move the real parts into your mounts:
- ALSO emit `part_placements`: for each referenced component, the world transform
  (mm + degrees) that drops the actual part file into the mount you designed, in
  the SAME Z-up mm frame as your `program`. The base plate sits on Z=0 with its
  mount features facing +Z; place each component so it rests in/on its feature.
- `part_placements` schema (array):
    {{"stem":"<component stem>",
      "translation_mm":[x,y,z],
      "rotation_deg":[rx,ry,rz],
      "mount":"<which feature it seats in, e.g. motor_cradle / nano_pocket>"}}
- Prefer deterministic seating placements when possible:
    {{"stem":"<component stem>","mount":"board_pocket","cx":<pocket_center_x>,
      "cy":<pocket_center_y>,"surface_z":<top_of_plate_z>}}
    {{"stem":"<component stem>","mount":"motor_flange","cx":<motor_center_x>,
      "cy":<motor_center_y>,"surface_z":<mount_surface_z>}}
  These move the real STEP/GLB component onto the generated pocket/face by
  inspecting its geometry, so the visible imported parts land on the mount.
- Use the SAME numeric anchors you used to cut the mount features so the part
  lands exactly in its pocket/cradle (e.g. board pocket centered at [30,0,base_h]
  → nano translation_mm [30,0,base_h], rotation to lay flat).
- `part_placements` is REQUIRED whenever the prompt asks for a mount, case,
  holder, fixture, slab, or plate for referenced components. Do not leave it []
  in those cases.
- Omit `part_placements` (or use []) only when the request is not about fitting
  referenced components.

AVAILABLE SPECS: {specs}
MATERIALS: {materials}

━━━ RESPONSE FORMAT ━━━

Return JSON:
{{"intent":"generative|replication|hybrid",
  "message":"<one sentence describing what was built>",
  "design_plan": {{
    "requirements_analysis":"<string>",
    "component_hierarchy":"<string or nested outline>",
    "parametric_dimension_table":[
      {{"param":"width","value_mm":100,"source":"user","notes":""}}
    ],
    "assembly_plan":"<string>",
    "cad_feature_plan":"<string>",
    "part_generation":"<string>",
    "assembly_constraints":"<string or []>",
    "step_ready_brep_output":"<string>"
  }},
  "specs_used":[...],
  "filename":"<descriptive-name>",
  "part_placements": [
    {{"stem":"<referenced component stem>","translation_mm":[0,0,0],"rotation_deg":[0,0,0],"mount":"<feature>"}}
  ],
  "generator": <object or null>,
  "program": <object or null>
}}

Exactly one of generator/program must be non-null.
`design_plan` is REQUIRED on every response — it is the auditable engineering record for steps 1–7.

KEY RULES:
- ALWAYS think about the construction SEQUENCE. Features are applied in order.
- Use "combine":"cut" for EVERY subtraction (holes, slots, grooves, hollowing).
- Use "combine":"add" for adding material to an existing body.
- The first feature's combine is implicitly "new".
- Use realistic millimetre dimensions. A standard Rubik's cube is 57mm.
- For hollow objects, prefer shell or revolve (closed profile) over boolean subtraction.
- For round objects, prefer revolve or loft over trying to approximate with primitives.
- Fillets MUST come after the solid is fully built (they modify edges of the current solid).
- Keep fillets conservative on small/detail-heavy models: use <= 0.5mm for watch markers/links, <= 1mm for small decorative features, and only use larger fillets on large outer cases.
- Pattern features replicate geometry — use for arrays of holes, bolts, etc.
- NEVER emit a part with zero volume: every part id must start with a solid primitive (combine=new), then add/cut. Do not name a part "assembly" unless it contains real solid features.
- For spice dispensers, shakers, and kitchen gadgets: revolved or shelled main body + separate dial/lid/knob parts (≤8 parts total, ≤15 features on the main body).
- Avoid stacked duplicate primitives: do not place multiple full-size boxes/cylinders at the same anchor to "approximate" one shape — fuse into one solid or use cut/intersect intentionally.
- Appliances, consumer products, and furniture: use 3–8 VISUALLY DISTINCT parts with different colors. A single grey box is never acceptable for a product that has recognisable form. Each part must contribute a clear visual element (body, trim, display, handle, base, feet, etc.)."""

V2_DESIGN_ADDENDUM = """
━━━ CAD 2.0 QUALITY PIPELINE ━━━

You are in 2.0 quality mode. Apply maximum engineering rigor at every step.

MANDATORY: design_plan.brief MUST be present in your response. Without it the build
will be rejected and you will be asked to regenerate. The brief schema:

  "brief": {
    "title": "<short part name>",
    "description": "<one paragraph: what it is, what it does, and why it's shaped this way>",
    "design_intent": "<'fit'|'form'|'function' — primary purpose>",
    "constraints": [
      "<dimensional constraint, e.g. 'outer diameter must be ≤ 50mm'>",
      "<material/wall-thickness constraint>",
      "<assembly constraint, e.g. 'must mate with M8 rod'>",
      ...
    ],
    "no_can_dos": [
      "<explicitly ruled out, e.g. 'no moving parts', 'no overhangs > 45°'>",
      ...
    ],
    "part_constraints": [
      {
        "part_id": "<matches a part id in program.parts>",
        "base_op": "<op name of the first feature, e.g. 'cylinder'>",
        "envelope_mm": [<max_x>, <max_y>, <max_z>]
      },
      ...
    ]
  }

REQUIREMENTS:
1. parametric_dimension_table must contain ≥ 3 rows with param, value_mm, source, and notes.
2. cad_feature_plan must describe the construction sequence for EVERY part before generating features.
3. assembly_plan must name which parts mate together and how (joints, clearances, press-fits).
4. For each part, verify: first feature is a solid op (box/cylinder/sphere/revolve/extrude/loft/etc.),
   no cut/intersect before a solid base, no modifier ops (fillet/chamfer/shell) before the solid.
5. brief.part_constraints[*].base_op MUST match the actual first feature op for every part.

QUALITY CHECKLIST (run mentally before emitting the response):
□ Every part starts with a SOLID-CREATING op (combine=new)
□ No duplicate primitive at the same position (x,y,z within 0.5mm)
□ Fillets/chamfers placed AFTER the full solid is built
□ Realistic mm dimensions — a standard bolt M6 is 6mm diameter, a matchbox is 50×35×15mm
□ Multi-part assemblies: 3–8 visually distinct parts with contrasting colors
□ brief is present and part_constraints lists every part_id

UPDATED RESPONSE FORMAT for 2.0 mode — design_plan MUST include brief:
{
  "intent": "generative|replication|hybrid",
  "message": "<one sentence describing what was built>",
  "design_plan": {
    "requirements_analysis": "<full analysis of user intent, target use, inferred dimensions>",
    "component_hierarchy": "<nested outline of parts and sub-parts>",
    "parametric_dimension_table": [
      {"param": "<name>", "value_mm": <number>, "source": "user|inferred|standard", "notes": "<why>"}
    ],
    "assembly_plan": "<how parts mate, clearances, press-fits, joints>",
    "cad_feature_plan": "<per-part construction sequence in natural language>",
    "part_generation": "<summary of generation strategy per part>",
    "assembly_constraints": "<joint types and constraints or []>",
    "step_ready_brep_output": "<notes on BREP quality — watertight, manifold, no self-intersections>",
    "brief": {
      "title": "<name>",
      "description": "<description>",
      "design_intent": "fit|form|function",
      "constraints": ["<constraint>", ...],
      "no_can_dos": ["<ruled-out feature>", ...],
      "part_constraints": [
        {"part_id": "<id>", "base_op": "<op>", "envelope_mm": [x, y, z]}
      ]
    }
  },
  "specs_used": [...],
  "filename": "<descriptive-name>",
  "part_placements": [...],
  "generator": <object or null>,
  "program": <object or null>
}
"""

SYSTEM_PROMPT = """CAD mesh editing assistant. You edit an EXISTING 3D model.
Reply ONLY with JSON:
{{"message":"…","actions":[{{"op":"…","id":"a","result":true}}],"filename":"part.glb"}}

Available ops:
- use_base — required first action to load the existing mesh
- hole_at_point(at_refs, diameter_mm, depth_mm, through) — drill a hole at a reference point.
  The hole axis follows the face normal. Use at_refs:["face-N"] to target a picked face.
- extrude_face(at_refs, distance_mm, inward) — extrude a face outward (or inward). Good for bumps/lips only — NOT for replacing a whole tool/feature.
- paint_faces(color, at_refs | face_indices | face_index_from+face_index_to) — per-face color.
- set_material(color) — solid color for entire mesh.
- box(extents), cylinder(radius,height), sphere(radius) — add primitives in mesh units (mm when the model is mm).
- transform(source, transform, at_refs?) — move/rotate/scale a primitive. When at_refs is set, the mesh center is placed at the ref position before applying translation/rotation.
- cylinder(..., count, arrangement:"radial_whisk") — builds a whisk wire bundle at at_refs (alternative to unioning many wire cylinders).
- route_geometry(route_type:"loops"|"duct", at_refs:["path-N"], radius_mm, loop_width_mm, loop_height_mm, loop_spacing_mm) — add surface-following wire ducts or retaining loop hoops along a drawn @path.
- boolean(a,b,operation) — union/difference/intersection. Use to swap features: cut old geometry, union new geometry.

TOOL / END-EFFECTOR REPLACEMENT (whisk, drill bit, gripper jaw, etc.):
When the user asks to change, swap, or replace a highlighted end piece (e.g. plus-sign paddle → whisk):
1. use_base
2. boolean difference: cut away the old tool volume near @face-N (box or cylinder cutter sized to the old feature)
3. union several thin cylinders or toruses arranged as whisk wires, anchored at the reference position/normal
Do NOT use extrude_face alone for a tool swap — that only adds a small stub and leaves the old geometry.
CRITICAL: result:true must be on the final boolean that unions the tool onto the assembly — never on a lone primitive or the output will drop the rest of the model.

REFERENCE CONTEXT:
When the user highlights a face (@face-N), the context includes:
  - position: [x,y,z] in the SAME units as the loaded mesh (usually mm for CAD exports)
  - normal: [nx,ny,nz] (the outward direction of that face)
  - face_index: picker hint only — the server re-maps by position/normal on the edit mesh
When the user draws a lasso (@lasso-N), the context includes:
  - position/normal: center and average normal of the closed surface loop
  - loop_points: sampled points on the model surface forming the loop
  - face_indices: visible triangles inside the lasso
  - selected_vertices: vertices inside the lasso
When the user draws a path (@path-N), the context includes:
  - loop_points: ordered points snapped to the selected surface
  - surface_normals: outward face normal per point
  - surface_locked: true when the route must stay riveted to that face

Use the position as the "at" target for holes/extrusions.
The normal tells you which direction the face points — drill ALONG it.
For lasso edits, operate only inside the lasso region unless the user asks otherwise.
For "put a hole in this @lasso-N", ALWAYS use hole_at_point with at_refs:["lasso-N"].
For "wire loop", "wire clip", "route wiring", or "rivet wiring" with a drawn @path, ALWAYS use route_geometry as a NEW standalone accessory part.
Do NOT use use_base for wire loops — never merge loops into the assembly plate or referenced components.
Do NOT approximate face-riveted wire loops with torus/cylinder primitives: they can cut through the face.
route_geometry follows the path endpoints exactly, offsets above the picked face, and arches hoops along surface_normals.
For "a wire loop" (singular), set loop_count:1 and omit loop_spacing_mm. Use loop_spacing_mm only when the user asks for multiple/repeated loops.
Set filename to wire_loop.glb (server allocates wire_loop_2.glb if needed).

Example: "Create a wire loop along this drawn @path-1"
→ [{{"op":"route_geometry","id":"wire_loop","route_type":"loops","standalone":true,"at_refs":["path-1"],"radius_mm":0.8,"loop_width_mm":8,"loop_height_mm":6,"loop_count":1,"result":true,"filename":"wire_loop.glb"}}]

Example: "Swap this @face-3 paddle for a whisk toolhead"
→ [
  {{"op":"use_base","id":"b","result":false}},
  {{"op":"box","id":"cutter","extents":[40,40,18],"result":false}},
  {{"op":"transform","id":"cutter_x","source":"cutter","at_refs":["face-3"],"transform":{{"translation":[0,0,-8]}},"result":false}},
  {{"op":"boolean","id":"cut_old","a":"b","b":"cutter_x","operation":"difference","result":false}},
  {{"op":"cylinder","id":"whisk_hub","radius":6,"height":12,"result":false}},
  {{"op":"transform","id":"hub_x","source":"whisk_hub","at_refs":["face-3"],"transform":{{"translation":[0,0,-6]}},"result":false}},
  {{"op":"boolean","id":"add_hub","a":"cut_old","b":"hub_x","operation":"union","result":false}},
  {{"op":"cylinder","id":"whisk_wires","radius":1.5,"height":55,"count":8,"arrangement":"radial_whisk","at_refs":["face-3"],"result":false}},
  {{"op":"boolean","id":"whisk","a":"add_hub","b":"whisk_wires","operation":"union","result":true}}
]

Example: "Put a 4mm hole 4mm deep on this face @face-1"
→ [{{"op":"use_base","id":"b"}},{{"op":"hole_at_point","id":"h","at_refs":["face-1"],"diameter_mm":4,"depth_mm":4,"through":false,"result":true}}]

Example: "Put a 4mm hole 3mm deep in this @lasso-1"
→ [{{"op":"use_base","id":"b"}},{{"op":"hole_at_point","id":"h","at_refs":["lasso-1"],"diameter_mm":4,"depth_mm":3,"through":false,"result":true}}]

Colors: "white", "black", "#ffffff", or [r,g,b] 0–1.
Use mm sizes when the mesh is in mm. Max 8 ops. Exactly one action with result:true."""


class AIService:
    def __init__(self, model: str | None = None, api_key: str | None = None, provider: str = "openai") -> None:
        self.provider = (provider or "openai").lower()
        self.model = model or (settings.anthropic_model if self.provider == "anthropic" else settings.openai_model)
        self.api_key = (api_key or "").strip()
        if not self.api_key:
            raise RuntimeError("Add your AI provider API key from the account menu before generating.")
        self.client = None
        if self.provider == "openai":
            # Pro / reasoning models routinely exceed 90s, especially with skills + images.
            ai_timeout = 300.0 if self.model in PRO_MODELS or str(self.model).startswith("gpt-5.5") else 180.0
            self.client = OpenAI(api_key=self.api_key, timeout=ai_timeout)
        elif self.provider != "anthropic":
            raise RuntimeError(f"Unsupported AI provider: {self.provider}")

    def generate_cad_plan(
        self,
        user_prompt: str,
        project_context: dict[str, Any] | None = None,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        context_text = ""
        if project_context:
            context_text = f"\nContext: {json.dumps(project_context, separators=(',', ':'))}"

        raw, call_trace = self._call_model(
            SYSTEM_PROMPT,
            f"{user_prompt}{context_text}",
            trace_id=trace_id,
            images=images,
            max_tokens=16384,
        )
        try:
            plan = json.loads(self._json_payload(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        call_trace["parsed_ok"] = True
        call_trace["action_count"] = len(plan.get("actions", []))
        return plan, call_trace

    def generate_design(
        self,
        user_prompt: str,
        project_context: dict[str, Any] | None = None,
        trace_id: str | None = None,
        repair_note: str | None = None,
        images: list[dict[str, Any]] | None = None,
        skills: list[str] | None = None,
        mode: str = "standard",
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Generate a Feature Program (or generator directive) for a request.

        ``repair_note`` carries build/DFM errors from a previous attempt so the
        model can self-correct.  ``mode="v2"`` appends the 2.0 quality addendum
        that enforces a detailed brief and stricter planning.
        """
        from backend.physics.materials import list_materials
        from backend.specs.registry import available_specs

        from backend.services.skills_service import build_skills_prompt

        system = DESIGN_SYSTEM_PROMPT.format(
            specs=", ".join(available_specs()) or "(none)",
            materials=", ".join(list_materials()),
        )
        skills_block = build_skills_prompt(skills)
        if skills_block:
            system = f"{system}\n\n{skills_block}"
        if (mode or "standard").lower() == "v2":
            system = f"{system}\n\n{V2_DESIGN_ADDENDUM}"
        parts = [user_prompt]
        if project_context:
            parts.append(f"\nContext: {json.dumps(project_context, separators=(',', ':'))}")
        if repair_note:
            parts.append(
                "\nThe previous attempt FAILED. Fix it and return a corrected JSON object.\n"
                f"Error/feedback:\n{repair_note}"
            )
        raw, call_trace = self._call_model(
            system,
            "".join(parts),
            trace_id=trace_id,
            images=images,
            max_tokens=16384,
        )
        try:
            design = json.loads(self._json_payload(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        call_trace["parsed_ok"] = True
        call_trace["intent"] = design.get("intent")
        return design, call_trace

    def generate_cad_brief(
        self,
        user_prompt: str,
        project_context: dict[str, Any] | None = None,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """Create the CAD brief text-to-cad expects before authoring source."""
        from backend.services.skills_service import get_reference, get_skill_dir

        skill_dir = get_skill_dir("cad")
        if not skill_dir:
            raise RuntimeError("CAD skill not installed")

        skill_md = skill_dir.joinpath("SKILL.md").read_text(encoding="utf-8", errors="ignore")
        brief_ref = get_reference("cad", "cad-brief.md")
        brief_guide = (brief_ref or {}).get("content") or ""

        system = (
            "You are a CAD authoring agent following the upstream text-to-cad workflow "
            "(https://github.com/earthtojake/text-to-cad).\n"
            "Before writing build123d source, produce a concise CAD brief in Markdown.\n"
            "Start with the line 'CAD brief:' and use bullet notes as described in the reference.\n"
            "Do not write Python. Do not wrap the brief in JSON.\n\n"
            f"CAD skill:\n{skill_md}\n\n"
            f"CAD brief reference:\n{brief_guide}"
        )
        parts = [user_prompt]
        if project_context:
            parts.append(f"\nProject context: {json.dumps(project_context, separators=(',', ':'))}")
        raw, trace = self._call_model(
            system,
            "".join(parts),
            trace_id=trace_id,
            images=images,
            max_tokens=8192,
            json_response=False,
        )
        brief = raw.strip()
        if not brief.lower().startswith("cad brief"):
            brief = f"CAD brief:\n{brief}"
        trace["stage"] = "cad_brief"
        return brief, trace

    def generate_cad_python_source(
        self,
        user_prompt: str,
        project_context: dict[str, Any] | None = None,
        trace_id: str | None = None,
        repair_note: str | None = None,
        images: list[dict[str, Any]] | None = None,
        cad_brief: str | None = None,
        fusion_mode: bool = False,
        previous_source: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """Generate text-to-cad style build123d Python source with gen_step()."""
        from backend.services.skills_service import get_reference, get_skill_dir

        skill_dir = get_skill_dir("cad")
        if not skill_dir:
            raise RuntimeError("CAD skill not installed")

        skill_md = skill_dir.joinpath("SKILL.md").read_text(encoding="utf-8", errors="ignore")
        ref_blocks: list[str] = []
        for name in ("build123d-modeling.md", "step-generation.md", "repair-loop.md", "positioning.md"):
            ref = get_reference("cad", name)
            if ref and ref.get("content"):
                ref_blocks.append(f"### {name}\n{ref['content']}")

        system = (
            "You are a CAD authoring agent following the upstream text-to-cad workflow "
            "(https://github.com/earthtojake/text-to-cad).\n"
            "Write ONLY valid Python source for build123d with a top-level gen_step() function.\n"
            "gen_step() must return the STEP-ready shape or labeled compound; do not write file paths inside gen_step().\n"
            "Use millimeters. Put dimensions in named parameters. Follow the CAD brief exactly.\n"
            "Return ONLY Python source — no markdown fences, no explanation before or after the code.\n"
            "If editing an existing model, preserve working geometry and change only what the prompt or repair note requires.\n"
            "Security/runtime rules: scripts run in the project folder as cwd. Prefer pathlib.Path for file paths. "
            "Do not import subprocess, socket, requests, sys, or shutil; do not call exec(), eval(), or __import__(). "
            "Do not use os.system/os.popen/os.remove. Reference project files by bare filename (example: \"part.dxf\"). "
            "build123d names like import_step are allowed.\n\n"
            f"CAD skill:\n{skill_md}\n\n"
            + "\n\n".join(ref_blocks)
        )
        if fusion_mode:
            system += (
                "\n\nFusion mode: structure source like a Fusion 360 timeline with named phase functions, "
                "explicit datums, and functional interfaces before cosmetic fillets/chamfers."
            )

        parts: list[str] = []
        if cad_brief:
            parts.append(f"CAD brief:\n{cad_brief.strip()}\n")
        parts.append(user_prompt)
        if project_context:
            parts.append(f"\nProject context: {json.dumps(project_context, separators=(',', ':'))}")
        if previous_source:
            parts.append(
                "\n\nExisting generated source to edit (preserve what still works):\n"
                f"{previous_source[:12000]}"
            )
        if repair_note:
            parts.append(
                "\n\nThe previous attempt FAILED. Fix the source and return corrected Python only.\n"
                f"Error/feedback:\n{repair_note}"
            )

        raw, trace = self._call_model(
            system,
            "".join(parts),
            trace_id=trace_id,
            images=images,
            max_tokens=16384,
            json_response=False,
        )
        source = self._python_payload(raw)
        if "def gen_step" not in source:
            raise ValueError("AI response did not contain gen_step() Python source.")
        trace["stage"] = "cad_python_source"
        return source, trace

    def generate_wiring(
        self,
        user_prompt: str,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        from backend.services.wiring_service import WIRING_SYSTEM_PROMPT

        raw, call_trace = self._call_model(
            WIRING_SYSTEM_PROMPT,
            user_prompt,
            trace_id=trace_id,
            images=images,
            max_tokens=8192,
        )
        try:
            schematic = json.loads(self._json_payload(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        call_trace["parsed_ok"] = True
        call_trace["component_count"] = len(schematic.get("components") or [])
        call_trace["wire_count"] = len(schematic.get("wires") or [])
        return schematic, call_trace

    def diagnose_wiring_photo(
        self,
        user_prompt: str,
        images: list[dict[str, Any]],
        trace_id: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        from backend.services.wiring_service import CIRCUIT_DEBUG_SYSTEM_PROMPT

        raw, call_trace = self._call_model(
            CIRCUIT_DEBUG_SYSTEM_PROMPT,
            user_prompt,
            trace_id=trace_id,
            images=images,
            max_tokens=4096,
        )
        try:
            diagnosis = json.loads(self._json_payload(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        call_trace["parsed_ok"] = True
        call_trace["issue_count"] = len(diagnosis.get("issues") or [])
        return diagnosis, call_trace

    def generate_rigging(
        self,
        user_prompt: str,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        from backend.services.rigging_service import RIGGING_SYSTEM_PROMPT

        raw, call_trace = self._call_model(
            RIGGING_SYSTEM_PROMPT,
            user_prompt,
            trace_id=trace_id,
            images=images,
            max_tokens=16384,
        )
        try:
            rig = json.loads(self._json_payload(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        call_trace["parsed_ok"] = True
        call_trace["bone_count"] = len(rig.get("bones") or [])
        call_trace["animation_count"] = len(rig.get("animations") or [])
        return rig, call_trace

    def chat_json(
        self,
        system_prompt: str,
        user_content: str,
        *,
        images: list[dict[str, Any]] | None = None,
        trace_id: str | None = None,
        max_tokens: int = 16384,
        **kwargs: Any,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Call the model and parse a JSON object response."""
        raw, call_trace = self._call_model(
            system_prompt,
            user_content,
            trace_id=trace_id,
            images=images,
            max_tokens=max_tokens,
            **{k: v for k, v in kwargs.items() if k in {"json_response"}},
        )
        try:
            parsed = json.loads(self._json_payload(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI returned invalid JSON: {raw[:500]}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("AI JSON response must be an object")
        call_trace["parsed_ok"] = True
        return parsed, call_trace

    @staticmethod
    def _json_payload(raw: str) -> str:
        text = (raw or "").strip()
        if text.startswith("{") and text.endswith("}"):
            return text
        start = text.find("{")
        end = text.rfind("}")
        if 0 <= start < end:
            return text[start : end + 1]
        return text

    @staticmethod
    def _python_payload(raw: str) -> str:
        text = (raw or "").strip()
        if text.startswith("```"):
            lines = text.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            while lines and lines[-1].strip().startswith("```"):
                lines.pop()
            text = "\n".join(lines).strip()
        idx = text.find("def gen_step")
        if idx < 0:
            return text
        head = text[:idx]
        keep: list[str] = []
        for line in head.splitlines():
            stripped = line.strip()
            if stripped.startswith("import ") or stripped.startswith("from ") or not stripped:
                keep.append(line)
            elif keep:
                break
        return "\n".join(keep + [text[idx:]]).strip()

    def _reasoning_param(self) -> dict[str, Any] | None:
        if self.provider != "openai":
            return None
        model = self.model
        if model in PRO_MODELS or model.startswith("gpt-5.5-pro"):
            return None
        effort = settings.openai_reasoning_effort
        if effort and effort != "none":
            return {"reasoning": {"effort": effort}}
        return {"reasoning": {"effort": "low"}}

    @staticmethod
    def _clean_images(images: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for img in images or []:
            data_url = str(img.get("data_url") or "")
            media_type = str(img.get("media_type") or "")
            if not data_url.startswith("data:image/") or ";base64," not in data_url:
                continue
            if media_type not in {"image/png", "image/jpeg", "image/jpg", "image/webp"}:
                continue
            out.append(
                {
                    "id": str(img.get("id") or f"image-{len(out) + 1}"),
                    "name": str(img.get("name") or f"image-{len(out) + 1}"),
                    "media_type": "image/jpeg" if media_type == "image/jpg" else media_type,
                    "data_url": data_url,
                    "base64": data_url.split(";base64,", 1)[1],
                }
            )
        return out[:4]

    def _openai_user_content(self, user_content: str, images: list[dict[str, Any]]) -> str | list[dict[str, Any]]:
        if not images:
            return user_content
        content: list[dict[str, Any]] = [{"type": "input_text", "text": user_content}]
        for img in images:
            content.append({"type": "input_image", "image_url": img["data_url"]})
        return content

    def _openai_chat_user_content(self, user_content: str, images: list[dict[str, Any]]) -> str | list[dict[str, Any]]:
        if not images:
            return user_content
        content: list[dict[str, Any]] = [{"type": "text", "text": user_content}]
        for img in images:
            content.append({"type": "image_url", "image_url": {"url": img["data_url"]}})
        return content

    @staticmethod
    def _anthropic_supports_temperature(model: str) -> bool:
        """Newer Claude 4.6+ snapshots reject temperature in Messages API requests."""
        return not any(
            marker in model
            for marker in (
                "claude-opus-4-8",
                "claude-opus-4-7",
                "claude-opus-4-6",
                "claude-sonnet-4-6",
                "claude-fable-5",
            )
        )

    def _call_model(
        self,
        system_prompt: str,
        user_content: str,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
        max_tokens: int = 16384,
        *,
        json_response: bool = True,
    ) -> tuple[str, dict[str, Any]]:
        clean_images = self._clean_images(images)
        if self.provider == "anthropic":
            return self._call_anthropic(
                system_prompt,
                user_content,
                trace_id=trace_id,
                images=clean_images,
                max_tokens=max_tokens,
                json_response=json_response,
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": self._openai_user_content(user_content, clean_images)},
        ]

        model = self.model
        use_responses = model in RESPONSES_ONLY_MODELS or model.startswith("gpt-5.5-pro") or model.startswith("gpt-5.5")
        t0 = time.perf_counter()
        trace: dict[str, Any] = {
            "model": model,
            "provider": "openai",
            "api": "responses",
            "prompt_preview": user_content[:200],
            "reasoning": settings.openai_reasoning_effort,
            "image_count": len(clean_images),
            "image_names": [img["name"] for img in clean_images],
        }
        extra = self._reasoning_param() or {}

        try:
            trace_add("info", f"OpenAI Responses → {model}", trace_id=trace_id, data=trace)
            create_kwargs: dict[str, Any] = {
                "model": model,
                "input": messages,
                "max_output_tokens": max_tokens,
                **extra,
            }
            if json_response:
                create_kwargs["text"] = {"format": {"type": "json_object"}}
            response = self.client.responses.create(**create_kwargs)
            text = response.output_text or ""
            finish_reason = getattr(response, "status", None) or ""
            incomplete = getattr(response, "incomplete_details", None)
            if incomplete:
                finish_reason = getattr(incomplete, "reason", finish_reason) or finish_reason
            trace["duration_ms"] = (time.perf_counter() - t0) * 1000
            trace["raw_preview"] = text[:4000]
            trace["finish_reason"] = finish_reason
            usage = usage_from_openai_response(response)
            if usage:
                trace["usage"] = usage
                trace["cost_usd"] = estimate_cost_usd(model, usage, provider="openai")
            trace_add("info", f"OpenAI OK ({trace['duration_ms']:.0f}ms) finish={finish_reason}", trace_id=trace_id, data=trace)
            if finish_reason in ("max_output_tokens", "length"):
                kind = "JSON" if json_response else "response"
                raise ValueError(
                    f"AI returned invalid {kind}: response truncated at token limit "
                    f"(max_output_tokens={max_tokens}). Partial: {text[:400]}"
                )
            if text:
                return text, trace
            raise RuntimeError("Empty response from OpenAI")
        except Exception as exc:
            trace["duration_ms"] = (time.perf_counter() - t0) * 1000
            trace["error"] = str(exc)
            trace_add("error", f"OpenAI failed: {exc}", trace_id=trace_id, data=trace)
            if model in RESPONSES_ONLY_MODELS or model.startswith("gpt-5.5-pro"):
                raise RuntimeError(f"OpenAI error ({model}): {exc}") from exc
            try:
                chat_kwargs: dict[str, Any] = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": self._openai_chat_user_content(user_content, clean_images)},
                    ],
                    "max_completion_tokens": max_tokens,
                }
                if json_response:
                    chat_kwargs["response_format"] = {"type": "json_object"}
                completion = self.client.chat.completions.create(**chat_kwargs)
                choice = completion.choices[0]
                text = choice.message.content or "{}"
                chat_finish = choice.finish_reason or ""
                trace["api"] = "chat.completions"
                trace["finish_reason"] = chat_finish
                trace["duration_ms"] = (time.perf_counter() - t0) * 1000
                trace["raw_preview"] = text[:4000]
                usage = usage_from_openai_response(completion)
                if usage:
                    trace["usage"] = usage
                    trace["cost_usd"] = estimate_cost_usd(model, usage, provider="openai")
                if chat_finish == "length":
                    kind = "JSON" if json_response else "response"
                    raise ValueError(
                        f"AI returned invalid {kind}: response truncated at token limit "
                        f"(max_tokens={max_tokens}). Partial: {text[:400]}"
                    )
                return text, trace
            except Exception as exc2:
                raise RuntimeError(f"OpenAI API error: {exc2}") from exc2

    def _call_anthropic(
        self,
        system_prompt: str,
        user_content: str,
        trace_id: str | None = None,
        images: list[dict[str, Any]] | None = None,
        max_tokens: int = 16384,
        json_response: bool = True,
    ) -> tuple[str, dict[str, Any]]:
        t0 = time.perf_counter()
        clean_images = images or []
        trace: dict[str, Any] = {
            "model": self.model,
            "provider": "anthropic",
            "api": "messages",
            "prompt_preview": user_content[:200],
            "image_count": len(clean_images),
            "image_names": [img["name"] for img in clean_images],
        }
        trace_add("info", f"Anthropic Messages -> {self.model}", trace_id=trace_id, data=trace)
        try:
            content: list[dict[str, Any]] = [{"type": "text", "text": user_content}]
            for img in clean_images:
                content.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": img["media_type"],
                            "data": img["base64"],
                        },
                    }
                )
            system = system_prompt
            if json_response:
                system += "\nReturn only a valid JSON object. Do not wrap it in markdown."
            payload: dict[str, Any] = {
                "model": self.model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": content}],
            }
            if self._anthropic_supports_temperature(self.model):
                payload["temperature"] = 0

            response = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=payload,
                timeout=300.0,
            )
            response.raise_for_status()
            data = response.json()
            stop_reason = data.get("stop_reason") or ""
            chunks = data.get("content") or []
            text = "".join(c.get("text", "") for c in chunks if c.get("type") == "text")
            trace["duration_ms"] = (time.perf_counter() - t0) * 1000
            trace["raw_preview"] = text[:4000]
            trace["stop_reason"] = stop_reason
            usage = usage_from_anthropic_response(data)
            if usage:
                trace["usage"] = usage
                trace["cost_usd"] = estimate_cost_usd(self.model, usage, provider="anthropic")
            trace_add("info", f"Anthropic OK ({trace['duration_ms']:.0f}ms) stop={stop_reason}", trace_id=trace_id, data=trace)
            if not text:
                raise RuntimeError("Empty response from Anthropic")
            if stop_reason == "max_tokens":
                raise ValueError(f"AI returned invalid JSON: response truncated at token limit (max_tokens={max_tokens}). Partial: {text[:400]}")
            return text.strip(), trace
        except Exception as exc:
            trace["duration_ms"] = (time.perf_counter() - t0) * 1000
            error = str(exc)
            if isinstance(exc, httpx.HTTPStatusError):
                error = f"{exc}; response={exc.response.text[:1000]}"
            trace["error"] = error
            trace_add("error", f"Anthropic failed: {exc}", trace_id=trace_id, data=trace)
            raise RuntimeError(f"Anthropic API error ({self.model}): {error}") from exc

    # ── Vision-to-DXF helper ────────────────────────────────────────────────
    @staticmethod
    def _strip_code_fence(text: str) -> str:
        """Remove markdown code fences from model output."""
        import re
        return re.sub(r"^```[a-zA-Z]*\n?", "", re.sub(r"\n?```$", "", text.strip())).strip()

    @staticmethod
    def _wrap_dxf_notes(text: str, image_names: str) -> str:
        """Ensure the DXF text starts with the HEADER section."""
        if "0\nSECTION\n2\nHEADER" in text or "0\r\nSECTION\r\n2\r\nHEADER" in text:
            return text
        preamble = (
            f"  0\nSECTION\n  2\nCOMMENT\n  1\nGenerated from image(s): {image_names}\n  0\nENDSEC\n"
        )
        return preamble + text

    def generate_dxf_from_images(
        self,
        prompt: str,
        images: list[dict[str, Any]] | None = None,
        trace_id: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """Convert uploaded images into a DXF text using AI vision.

        Returns (dxf_text, call_trace).
        """
        system = (
            "You are an expert CAD drafter. The user has uploaded one or more reference images of an object they want to model in 3D. "
            "Your task is to analyse the images and produce a DXF (Drawing eXchange Format) representation of the key 2D geometry — "
            "outlines, holes, slots, key dimensions, layer names, and any annotated text — that a downstream CAD AI can use to reconstruct the 3D model.\n\n"
            "Output ONLY valid DXF text. Do not include markdown, explanation, or any text outside the DXF content. "
            "Start with the HEADER section (0\\nSECTION\\n2\\nHEADER) and end with EOF. "
            "Estimate dimensions in millimetres based on visual proportions and any visible scale references. "
            "Use sensible layer names (OUTLINE, HOLES, DIMENSIONS, ANNOTATIONS). "
            "If the image is a mechanical part, include all visible hole patterns, fillets, and chamfers as CIRCLE / ARC entities. "
            "If the image is architectural, include walls, openings, and room labels."
        )
        user = (
            f"User prompt: {prompt}\n\n"
            "Please extract the 2D geometry from the attached image(s) and output DXF text that captures the overall shape, "
            "key features, and approximate dimensions of the object shown."
        )
        raw, trace = self._call_model(
            system_prompt=system,
            user_content=user,
            trace_id=trace_id,
            images=images,
            max_tokens=8192,
        )
        dxf_text = self._strip_code_fence(raw)
        image_names = ", ".join(img.get("name", f"image_{i}") for i, img in enumerate(images or []))
        dxf_text = self._wrap_dxf_notes(dxf_text, image_names)
        return dxf_text, trace
