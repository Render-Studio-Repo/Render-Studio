# Render3D Fusion 360 Plugin Bridge

This is a local Fusion 360 add-in scaffold for Render3D Fusion mode.

## Install

1. Copy `Render3DLink/` into your Fusion 360 add-ins folder.
2. In Fusion 360, open `Utilities > Add-ins > Scripts and Add-ins`.
3. Select `Render3DLink` and click `Run`.
4. The bridge listens on `http://127.0.0.1:38630`.

## API

`GET /health` returns bridge status.

`POST /run-script` executes a generated Fusion API Python script in the active design.

Required header:

```text
x-render3d-token: <your RENDER3D_FUSION_BRIDGE_TOKEN value>
```

Request body:

```json
{
  "source": "def run(ctx):\n    app = ctx['app']\n    ui = ctx['ui']\n    ui.messageBox('Hello from Render3D')\n"
}
```

## Notes

The bridge is intentionally localhost-only. Set `RENDER3D_FUSION_BRIDGE_TOKEN` in your local environment before use. Do not commit real bridge tokens.
