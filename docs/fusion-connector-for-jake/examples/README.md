# Export code examples (for AI / Jake)

Selected **copies** of how Render Studio’s **Export → Fusion** and **Export → Onshape** flows work.
Give these files to an AI as reference when building Fusion and Onshape connectors.

No secrets are included. Env placeholders only — see parent `API-CHEATSHEET.md`.

## What to read (order)

| File | Cad tool | What it shows |
|------|----------|----------------|
| [01-fusion-upload-step.py](./01-fusion-upload-step.py) | Fusion / APS | Core upload: storage → S3 PUT → create item/version |
| [02-fusion-push-api.py](./02-fusion-push-api.py) | Fusion | Server route pattern: resolve solid STEP → Part flatten → upload |
| [03-fusion-export-ui.js](./03-fusion-export-ui.js) | Fusion | Browser Export menu: `POST /push-to-autodesk` |
| [04-onshape-export-step.py](./04-onshape-export-step.py) | Onshape | Create document → upload STEP blob → open URL |
| [05-onshape-push-api.py](./05-onshape-push-api.py) | Onshape | Server routes: push / export-to-onshape |
| [06-onshape-export-ui.js](./06-onshape-export-ui.js) | Onshape | Browser Export menu: push & export buttons |

## Shared pattern (both products)

```
UI Export button
  → auth’d POST with project id + filename (+ destination ids for Fusion)
  → backend loads / regenerates editable solid STEP (not raw .brep, not mesh-only)
  → vendor OAuth access token for the user
  → vendor API upload
  → return web URL / item id for success UI
```

## Critical CAD rule

Upload **solid B-rep STEP** (`MANIFOLD_SOLID_BREP`). Do **not** upload raw `.brep` or faceted mesh STEP if Extrude/Cut must work in Fusion.
