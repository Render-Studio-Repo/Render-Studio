# Render3D

A local CAD project visualizer inspired by ForgeCAD: orbit/zoom/pan a 3D viewport, upload meshes, edit transforms, and generate new geometry from natural-language prompts via **GPT-5.5 Pro**.

## Features

- **3D viewer** — Orbit, pan, zoom; grid toggle; fit-to-view
- **Edit timeline** — Fusion-style history; drag the slider or click steps to restore earlier states
- **Geometric references** — Pick corners/faces (`P` or **Pick ref**), insert `@corner-1` chips into prompts
- **Reference-aware AI** — e.g. “at @corner-1 drill a 3mm hole through the part”
- **File import** — STL, OBJ, GLB/GLTF, PLY, OFF
- **Gizmo edit** — Transform controls + server-side save
- **AI CAD prompting** — GPT-5.5 Pro builds/modifies geometry via Trimesh

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

Open **http://127.0.0.1:8001** (default port; set `PORT` in `.env` if needed)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Required for AI prompts |
| `OPENAI_MODEL` | `gpt-5.5-pro` | OpenAI model id |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8765` | HTTP port (8000/8001 often taken by Cursor) |

## API

- `GET /api/health` — Status and model
- `POST /api/projects` — Create project
- `POST /api/projects/{id}/upload` — Upload CAD file
- `POST /api/projects/{id}/prompt` — AI generate geometry
- `POST /api/projects/{id}/files/{name}/transform` — Apply transform

## Security

Never commit `.env` or API keys. If a key was shared in chat or logs, **rotate it** in the OpenAI dashboard.

## Roadmap

- STEP/IGES import (Open CASCADE / CadQuery)
- Parametric feature tree and sketch constraints
- Multi-part assemblies and BOM export
