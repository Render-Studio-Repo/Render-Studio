# Studio, workspaces, and XR

This page explains the product from a user-workflow point of view: what the Studio is, how the workspaces are organized, and how XR fits into the same system.

## The Studio model

Render Studio's main surface is the **Studio**. In the source tree, that starts at `frontend/index.html` and is wired by `frontend/app.js`.

The Studio combines:

- project management
- AI prompting
- a 3D viewport
- history and direct edits
- reference files and markup
- exports, sharing, and helper tools

If you are looking for a separate "Workshop" product surface, note that the repo does not use that term in the shipped UI or code. The closest concepts are the main Studio shell plus its workspace modes and design tabs.

## Workspace modes

The current workspace switcher exposes three live modes:

| Workspace mode | What it is for |
|----------------|----------------|
| `Design` | Core modeling, prompting, editing, references, and review |
| `Architect` | Building and layout workflows built on the same app shell |
| `Wiring Simulator` | Electronics layout, code help, and actuator simulation |

Two more entries are visible in source but not enabled yet:

- `Simulation`
- `Manufacture`

## Design tabs

Within Design and related flows, the app exposes several focused tabs:

- `SOLID`
- `SKETCH`
- `RIGGING`
- `ARCHITECT`
- `ELECTRONICS`
- `ROBOTICS`
- `INSERT`
- `CATALOG`
- `TEXTURE`
- `CANVAS`

This matters for documentation because Render Studio is not a single-mode generator. It is a multi-surface design environment with a shared project model.

## Core Studio workflows

### 1. Prompt-driven CAD

Users can:

- describe geometry in plain English
- attach images, DXF, PDFs, or components
- reference faces, edges, corners, and paths inside prompts
- revise with follow-up instructions instead of starting over

### 2. Viewport-first editing

The viewport is a working environment, not just a preview:

- orbit, pan, zoom
- fit, section, grid, transparency
- transforms and direct selections
- feature history and rebuilds
- file visibility and export actions

### 3. Docs and guided learning inside the product

The product includes:

- `getting-started.html`
- `docs.html`
- guided tours
- a Quest Book
- Render Agent help

That is one of the stronger product-level signals in the repo: onboarding is part of the app, not an afterthought.

## XR workflow

Render Studio's XR implementation is tied into the same Studio project state rather than living in a separate demo.

### What ships

The source in `frontend/viewport-xr.js` shows support for:

- Quest-style controller models
- a left-hand quick tool dock
- world-space menus and project panels
- AI interaction in headset
- screenshot and recording actions
- export and Bambu actions from the XR menu

### Why that matters

For teams evaluating the product, this turns XR into a practical review and interaction surface instead of a novelty viewer.

## Reference and markup loop

Render Studio also supports a strong design-review loop around non-CAD artifacts:

- PDFs and images can live inside projects
- tabs can be marked up
- those references can be sent back into AI workflows

That makes the Studio useful for mixed-context work, not just pure solid modeling.

## Cloud and sharing workflows

The Studio also includes:

- public share links and remix flows
- workspace and teammate concepts
- Fusion and Onshape library/import workflows
- export paths for GLB, STL, STEP, and 3MF

## Suggested next reads

- [Architecture](architecture.md)
- [Robotics, motion, and teleop hooks](robotics-and-motion.md)
- [Contributing and deploy-sync notes](contributing.md)
