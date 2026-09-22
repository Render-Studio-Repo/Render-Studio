# Fusion 360 local bridge

Local Autodesk Fusion add-in that exposes a **localhost-only** HTTP bridge so Render Studio can run generated Fusion API scripts in the active design.

## Install (any machine)

1. Copy `Render3DLink/` into your Fusion add-ins folder (Fusion → Utilities → Add-Ins → Scripts and Add-Ins → green + → pick this folder’s parent, or copy into the standard AddIns path for your OS).
2. In Fusion: **Utilities → Add-Ins → Scripts and Add-Ins**.
3. Select **Render3DLink** → **Run**.
4. Bridge listens on `http://127.0.0.1:38630`.

### Typical add-in folders

| OS | Path pattern |
|---|---|
| macOS | `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/` |
| Windows | `%APPDATA%\\Autodesk\\Autodesk Fusion 360\\API\\AddIns\\` |
| Linux (rare) | follow Autodesk docs for your build |

Do **not** hard-code another developer’s home directory — always copy from this repo’s `integrations/fusion360/Render3DLink`.

## Configure Render Studio

Set in `.env` (repo root):

```bash
RENDER3D_FUSION_BRIDGE_TOKEN=generate-a-long-random-string
```

Optional Autodesk **cloud** OAuth (Data Panel / APS) is documented under [`../autodesk/`](../autodesk/).

## API

- `GET /health` — bridge status
- `POST /run-script` — run Fusion Python (`x-render3d-token` header required)

## Upstream

- Autodesk Fusion API docs: https://help.autodesk.com/view/fusion360/ENU/
- This bridge is maintained in-repo (not a separate GitHub product).
