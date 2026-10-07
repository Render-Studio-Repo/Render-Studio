# Fusion connector handoff (for Jake)

This folder is the handoff pack for building an **Autodesk Platform Services (APS) application connector** that sends **solid B-rep CAD** into **Fusion 360 / Fusion Team**.

## Start here

1. Read **[INSTRUCTIONS.md](./INSTRUCTIONS.md)** — how the connector works and what to build.
2. Give an AI the **[examples/](./examples/)** folder — selected copies of Export → Fusion **and** Export → Onshape code.
3. Use **[CODE-MAP.md](./CODE-MAP.md)** — exact files and functions to copy from in this repo.
4. Skim **[API-CHEATSHEET.md](./API-CHEATSHEET.md)** — endpoints, env vars, and the push request body.

## Important format fact

Fusion’s **cloud Data Management upload does not accept raw `.brep` / `.brp`**.

Render Studio always:

1. Ensures an **editable solid STEP** (`MANIFOLD_SOLID_BREP`)
2. Optionally flattens to a **single Part** STEP (so Extrude/Cut work)
3. Uploads that `.step` via APS (create storage → S3 PUT → create item/version)

If your generator outputs OCC BREP, **export solid STEP first**, then call the same upload path.

## Repo paths (absolute on this machine)

```
/Users/sam/Render-Studio/docs/fusion-connector-for-jake/
/Users/sam/Render-Studio/backend/services/autodesk_oauth.py
/Users/sam/Render-Studio/backend/main.py          # POST /api/projects/{id}/push-to-autodesk
/Users/sam/Render-Studio/backend/services/cad_service.py
/Users/sam/Render-Studio/frontend/cad/fusion-panel.js
/Users/sam/Render-Studio/frontend/components/file-actions.js
/Users/sam/Render-Studio/integrations/fusion-360/        # local script bridge only (not STEP push)
```

## Prompt for Jake (copy/paste)

> Build Autodesk (Fusion) and Onshape application connectors using the selected code copies in `docs/fusion-connector-for-jake/examples/`.
>
> **Fusion:** solid B-rep STEP (`MANIFOLD_SOLID_BREP`) → OAuth → pick Fusion Team folder → APS upload (create storage → S3 PUT → create item/version). Mirror `01-fusion-upload-step.py`, `02-fusion-push-api.py`, `03-fusion-export-ui.js`. Do not upload raw `.brep` or mesh-only STEP. Prefer flattened Part STEP so Extrude/Cut work. Scopes: `data:read data:write data:create viewables:read`.
>
> **Onshape:** same STEP → OAuth → create document → upload STEP as blob element → return document URL. Mirror `04-onshape-export-step.py`, `05-onshape-push-api.py`, `06-onshape-export-ui.js`. Scopes: `OAuth2Read OAuth2ReadPII OAuth2Write`.
>
> Also use INSTRUCTIONS.md, CODE-MAP.md, and API-CHEATSHEET.md in the parent folder.
