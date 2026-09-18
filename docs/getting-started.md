# Getting Started

This guide is for engineers who want a practical first run of Render Studio and a clear picture of the current setup reality.

## What Render Studio is

Render Studio is an AI-native 3D design environment built around a static JavaScript frontend, a FastAPI backend, and a parametric CAD kernel. It combines:

- prompt-based CAD generation
- direct 3D viewport interaction
- sketches, feature history, and file references
- XR review tools
- wiring, rigging, and robotics surfaces

If you have already read the root [README](../README.md), this page fills in the operational details.

## What you need

- Python 3
- a working virtual environment with the Render Studio backend dependencies
- at least one model key such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`

Optional, depending on what you want to test:

- Fusion credentials for Autodesk workflows
- Onshape credentials for cloud CAD import
- Supabase credentials for server-side integrations
- a MoveIt2-capable environment for advanced robotics planning

## Current bootstrap reality

The repository does **not** currently include a top-level `requirements.txt` or `pyproject.toml` for the main app. That means the reliable path today is to start from a provisioned environment instead of assuming a clean-room install.

### Fastest working path on a provisioned machine

```bash
git clone https://github.com/wprojects/Render-Studio.git
cd Render-Studio
cp .env.example .env
# Set at least one model key before booting
source /home/ubuntu/.venv/bin/activate
python run.py
```

By default, `run.py` starts the development server on:

- `http://127.0.0.1:8000`

Useful checks:

```bash
curl http://127.0.0.1:8000/api/health
```

## Environment configuration

The main app reads from `.env`. A few high-signal variables:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI-backed CAD and agent flows |
| `ANTHROPIC_API_KEY` | Claude-backed flows |
| `JWT_SECRET` | Local auth token signing |
| `HOST` / `PORT` | Dev server bind address and port |
| `ONSHAPE_CLIENT_ID` / `ONSHAPE_CLIENT_SECRET` | Onshape integration |
| `AUTODESK_CLIENT_ID` / `AUTODESK_CLIENT_SECRET` | Autodesk / Fusion integration |
| `RENDER3D_FUSION_BRIDGE_TOKEN` | Optional Fusion bridge auth |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Server-side Supabase services |

The example file contains many more product integrations; only configure what you actively need.

## First-run checklist

Once the server is up:

1. Open `http://127.0.0.1:8000/`
2. Create a project
3. Set units
4. Try an AI prompt in the Compose panel
5. Upload a reference file or model
6. Open:
   - `http://127.0.0.1:8000/getting-started.html`
   - `http://127.0.0.1:8000/docs.html`

## Product tour in one session

If you want a quick but representative pass through the product:

### 1. Design workflow

- Create a project
- Prompt a simple part
- Orbit, section, and inspect it in the viewport
- Use feature history or picks to revise the result

### 2. Studio tabs

Inside Design and related modes, look for:

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

### 3. Workspace modes

The currently enabled workspace modes are:

- `Design`
- `Architect`
- `Wiring Simulator`

The UI also includes placeholders for:

- `Simulation`
- `Manufacture`

Those appear in the source but are not enabled yet.

## Fresh-machine caveat

If you are setting this up on a brand-new machine, do not assume the repository is self-bootstrapping yet. The codebase clearly expects a working Python environment, but the root dependency manifest is not currently checked in.

That is a documentation and environment gap, not a hidden feature. Until it is fixed, the safe path is:

1. start from a known-good environment
2. capture/export the dependency set
3. standardize the bootstrap before onboarding more contributors

## Where to go next

- [Architecture](architecture.md)
- [Studio, workspaces, and XR](studio-and-xr.md)
- [Robotics, motion, and teleop hooks](robotics-and-motion.md)
- [Contributing and deploy-sync notes](contributing.md)
