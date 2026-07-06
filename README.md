# Render3D

A local CAD project visualizer inspired by ForgeCAD: orbit/zoom/pan a 3D viewport, upload meshes, edit transforms, generate CAD from natural-language prompts, wire electronics, and turn selected geometry references into local Draw edits.

## Features

- **3D viewer** — Orbit, pan, zoom; depth-aware grid, fit-to-view, object selection, hide/show from the component context menu
- **Edit timeline** — Fusion-style history; drag the slider or click steps to restore earlier states
- **Geometric references** — Pick corners, faces, edges, lasso regions, or Line paths; insert `@corner-1`, `@face-1`, or `@path-1` chips into prompts
- **Reference-aware AI** — e.g. “at @corner-1 drill a 3mm hole through the part”
- **Draw mode** — Local selected-face hole commands, circular blind-hole patterns, and Line-tool ducts/wire loops
- **File import** — STL, OBJ, GLB/GLTF, PLY, OFF, 3MF, STEP/STP-derived previews
- **Gizmo and color edits** — Transform controls, server-side save, object/face paint tools
- **AI CAD prompting** — GPT/OpenAI or Claude-backed geometry generation with Stop generating
- **Component-aware fixtures** — Profile/source imported components, measure real part bounds, and place referenced meshes into generated mounts
- **Wiring simulator** — Drag components to the simulator, validate motor drivers, generate Arduino-style code, and simulate actuators
- **AI cost analytics** — Compare cost, tokens, prompts, and calls by date range, user, project, or recent prompt
- **Project draft persistence** — Prompt drafts and references are saved per project when switching

## Visual workflows

```text
Line tool → click points between objects → Enter → @path-1
Draw prompt: "create wire loops along this path"
Result: deterministic route geometry added to the current model
```

```text
@component:arduino_nano_r4 + @component:adafruit_858_stepper_motor_5vdc
        ↓
component profile + measured dimensions
        ↓
fixture generator
        ↓
board pocket + motor posts + placed component meshes
```

```text
AI cost analytics:
Range: 7d / 30d / 90d / year
View: mine / shared / individual
Metric: cost / tokens / prompts / calls
Chart: bars / line / area / person / project / recent prompts
```

## Quick start

```bash
cd /Users/og/Documents/Render3d
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
python run.py
```

Open **http://127.0.0.1:8001** (default port; set `PORT` in `.env` if needed).

In-app documentation is available at **http://127.0.0.1:8001/docs.html**.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | OpenAI key for AI prompts |
| `ANTHROPIC_API_KEY` | — | Anthropic key for Claude-backed prompts |
| `JWT_SECRET` | — | Required secret used to sign local auth tokens |
| `OPENAI_MODEL` | `gpt-5.5` | OpenAI model id |
| `OPENAI_MODEL_QUALITY` | `gpt-5.5-pro` | Higher-quality model for slower prompts |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8000` | HTTP port |
| `ONSHAPE_CLIENT_ID` / `ONSHAPE_CLIENT_SECRET` | — | Onshape OAuth app credentials |
| `AUTODESK_CLIENT_ID` / `AUTODESK_CLIENT_SECRET` | — | Autodesk/Fusion OAuth app credentials |
| `RENDER3D_FUSION_BRIDGE_TOKEN` | — | Shared token for the optional local Fusion bridge |

## API

- `GET /api/health` — Status and model
- `POST /api/projects` — Create project
- `POST /api/projects/{id}/upload` — Upload CAD file
- `POST /api/projects/{id}/prompt` — AI generate geometry
- `POST /api/projects/{id}/generation/cancel` — Stop an in-flight generation
- `POST /api/projects/{id}/files/{name}/transform` — Apply transform
- `POST /api/projects/{id}/files/{name}/paint` — Paint object or selected face
- `POST /api/projects/{id}/files/{name}/draw-hole` — Draw selected-face holes and circular patterns
- `POST /api/projects/{id}/files/{name}/draw-route` — Draw ducts or wire loops along a Line-tool path
- `GET /api/user/ai-costs` — AI spend, token, project, user, and prompt analytics

## Security

Never commit `.env` or API keys. If a key was shared in chat or logs, **rotate it** in the OpenAI dashboard.

## Roadmap

- STEP/IGES import (Open CASCADE / CadQuery)
- Parametric feature tree and sketch constraints
- Multi-part assemblies and BOM export
