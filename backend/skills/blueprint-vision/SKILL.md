---
name: Blueprint Vision
description: Analyze engineering drawings, concept schematics, blueprints, patent drawings, hand sketches, whiteboard photos, exploded views, and technical illustrations with embedded text. Extract dimensions, components, assembly hierarchy, and constraints; convert visual engineering information into structured CAD reasoning data and a text-to-CAD handoff brief. Use as a preprocessor before the CAD skill when the user attaches reference images or schematic screenshots.
---

# Blueprint Vision

Render3D-local skill: vision analysis for schematic-to-CAD workflows.

## Purpose

Analyze engineering drawings, concept schematics, manufacturing blueprints, patent drawings, hand sketches, whiteboard diagrams, screenshots, exploded views, assembly instructions, and technical illustrations — especially images that mix **visual geometry with text** (dimension callouts, labels, notes, title blocks, zone maps, BOM tables).

Convert visual engineering information into **structured CAD reasoning data** that downstream skills can execute. This skill is a **preprocessor for text-to-CAD**; it does not replace the CAD skill for geometry generation.

## Use this skill when

Use when the user:

- Attaches a reference image, schematic, blueprint, or drawing screenshot to a prompt
- Asks to "model this from the image", "build from this schematic", or "reproduce this drawing"
- Supplies concept art, patent figures, manufacturing layouts, or exploded-view diagrams
- Needs dimensions, components, and assembly structure extracted before CAD modeling
- Provides mixed image+text inputs where labels and callouts carry engineering intent

Pair with the **CAD** skill for actual STEP/STL generation. Pair with **step-parts** when named off-the-shelf components appear in the schematic.

Do not use for render-only artwork, non-engineering photos, or tasks that need no structured extraction.

## Accepted inputs

- Engineering blueprints and manufacturing schematics
- Patent drawings and product concept sheets
- Assembly diagrams and exploded views
- Hand sketches and whiteboard photos
- CAD screenshots and PDF drawing exports (as images)
- Technical illustrations with dimension lines, zone maps, and callout text
- Infographic-style reasoning sheets that combine iso views, tables, and component lists

In Render3D Studio, attach images to the prompt composer. Treat every visible string — part names, `420mm`, `4X Ø8`, zone labels, BOM rows — as first-class data, not decoration.

## Required workflow

Run all seven stages in order. Scale depth to input complexity; a single iso concept sheet still needs Stages 1–3 and 5–7, while multi-view blueprints need full dimension cross-checking in Stage 2.

1. **Image understanding** — object purpose, category, mechanical function, assembly type, manufacturing intent
2. **Dimension extraction** — read callouts, scale bars, title blocks; build a parametric envelope; flag conflicts
3. **Component recognition** — name every distinct part, subassembly, and interface visible or implied
4. **Relationship graph** — parent/child hierarchy, mates, joint types, constraints
5. **CAD reconstruction plan** — ordered modeling operations per component
6. **Parametric model tree** — feature tree / assembly tree with stable part IDs
7. **Text-to-CAD handoff** — complete CAD brief + generation prompt for the CAD skill

Write internal stage outputs as structured notes (JSON-shaped blocks are fine for agent reasoning). The user-facing response should include a readable summary plus the handoff brief.

Load reference docs only when needed:

- `references/vision-pipeline.md` — stage definitions, quality bar, conflict handling
- `references/output-schema.md` — JSON field shapes for each stage
- `references/example-appliance.md` — worked example: countertop automated cooking appliance

## Quality bar

High-quality extraction means:

- **Every readable text label** in the image is captured (dimensions, part names, notes, zones)
- **Dimensioned values beat proportions**; undimensioned geometry is estimated and marked as assumed
- **Cross-view consistency** — when multiple panels or views appear, reconcile conflicts explicitly
- **Manufacturing intent** — wall thickness, hole standards, clearances, and assembly order are inferred when visible
- **Actionable handoff** — Stage 7 output is detailed enough that CAD can model without re-interpreting the image

When text is illegible or scale is unknown, ask one focused clarification question. Otherwise proceed with explicit assumptions.

## Deliverables

Always produce:

1. **Structured analysis** — Stages 1–6 as JSON or equivalent structured notes
2. **Component hierarchy** — tree with stable IDs
3. **Mechanical relationships** — mates and joint types
4. **Dimensions and parametric variables** — named parameters with units (mm default)
5. **CAD feature / assembly tree**
6. **Text-to-CAD prompt** — complete brief for the CAD skill (or Render3D Feature Program intent)
7. **Build123D script outline** — high-level `gen_step()` structure when CAD source is expected
8. **BOM draft** — part name, qty, material hints when visible

When the CAD skill is enabled, continue into geometry generation using the Stage 7 handoff. When only Blueprint Vision is enabled, stop after structured analysis and the handoff prompt unless the user asks to model.

## Handoff to CAD

After Stages 1–7, emit a **CAD brief** compatible with the CAD skill's `references/cad-brief.md`:

```text
CAD brief (from Blueprint Vision):
- Model: <assembly or part name>
- Task type: new assembly | new part | …
- Inputs: <attached schematic; list views/panels used>
- Units: millimeters
- Coordinate convention: <origin, base plane, up axis>
- Overall dimensions: <W × D × H from Stage 2>
- Components: <from Stage 3>
- Assembly structure: <from Stage 4>
- Modeling plan: <from Stage 5>
- Feature tree: <from Stage 6>
- Validation targets: envelope, component count, key mates, critical dimensions
- Assumptions: <inferred values only>
```

Then instruct the CAD skill (or Render3D kernel) to build parametric geometry, export STEP/STL, and validate.

## Non-negotiables

- Do not skip text in the image — read callouts, tables, legends, and title blocks
- Do not silently merge distinct components visible in the schematic
- Do not report dimensions that are not visible or defensibly inferred
- Do not claim certification, tolerance stack-up, or FEA conclusions from a schematic alone
- Always separate **observed** (read from image) from **assumed** (inferred)

## Goal

Convert visual engineering drawings into machine-readable CAD reasoning data so downstream CAD skills can generate editable STEP, BREP, STL, GLB, URDF, and manufacturing-ready models.

<!-- render3d-studio -->

## Render3D Studio

On the Render3D server this skill lives at `backend/skills/blueprint-vision/`.

- **References:** `backend/skills/blueprint-vision/references/` (includes `example-appliance-schematic.png`)
- **Prompts:** attach schematic images in Studio; Blueprint Vision enables automatically when an image is attached (disable in Skills Library to opt out)
- **Local skill:** preserved across `scripts/sync-skills-from-text-to-cad.sh` (not synced from text-to-cad)
- **Handoffs:** after analysis, enable CAD to generate geometry from the Stage 7 brief

See `backend/skills/RENDER3D.md` for full integration notes.
