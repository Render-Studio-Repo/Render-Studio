# Instructions: Fusion application connector

## Goal

Ship a connector that:

1. Authenticates a user to Autodesk (Fusion Team / ACC hubs)
2. Lets them pick a destination **project + folder**
3. Uploads a **solid STEP** file so it opens as editable geometry in Fusion
4. Optionally updates an existing Fusion item as a **new version** (replace) instead of creating duplicates

This is what Render Studio’s “Push to Fusion / Autodesk” path does today.

---

## Architecture (two different things — don’t mix them up)

### A) Cloud connector (what you want)

```
Your CAD (BREP/STEP)
    → solid STEP bytes (MANIFOLD_SOLID_BREP)
    → APS OAuth access token
    → Data Management: create storage
    → OSS signed S3 PUT of file bytes
    → create item (new) OR create version (replace)
    → Fusion Team shows the .step design
```

**Source of truth in this repo:** `backend/services/autodesk_oauth.py`

### B) Local Fusion add-in bridge (scripts only)

`integrations/fusion-360/` runs generated Fusion API Python on `127.0.0.1:38630`.  
It does **not** upload BREP/STEP to the cloud. Ignore it unless you need to drive Fusion desktop via scripts.

---

## APS app setup

1. Create an app at [APS](https://aps.autodesk.com).
2. Enable **Data Management API**.
3. If you also need Fusion design → STEP download, enable **Manufacturing Data Model**.
4. Set callback URL (local example):

   `http://127.0.0.1:8000/oauth/autodesk/callback`

5. Scopes (Render Studio default):

   ```text
   data:read data:write data:create viewables:read
   ```

6. Env vars (see `.env.example`):

   ```text
   AUTODESK_CLIENT_ID=
   AUTODESK_CLIENT_SECRET=
   AUTODESK_REDIRECT_URI=http://127.0.0.1:8000/oauth/autodesk/callback
   AUTODESK_SCOPES=data:read data:write data:create viewables:read
   ```

---

## OAuth flow (3-legged)

Implemented in `autodesk_oauth.py`:

| Step | Function / route |
|------|------------------|
| Build authorize URL | `build_authorization_url(user_id, return_url)` |
| Exchange code | `exchange_code_for_tokens(code)` |
| Refresh | `refresh_access_token(refresh_token)` |
| Persist | DB table `autodesk_tokens` via helpers in same file |
| Use | `get_valid_access_token(user_id)` |

HTTP surface in `backend/main.py`:

- `POST /api/autodesk/oauth-url` (or `GET /oauth/autodesk/start`)
- `GET /oauth/autodesk/callback`
- `GET /api/autodesk/status`
- `DELETE /api/autodesk/unlink`

Authorize base:

`https://developer.api.autodesk.com/authentication/v2/authorize`

Token:

`https://developer.api.autodesk.com/authentication/v2/token`

---

## File format rules (read carefully)

| Input | OK for Fusion cloud push? | Notes |
|-------|---------------------------|--------|
| Solid STEP with `MANIFOLD_SOLID_BREP` | **Yes** | Preferred |
| Linked assembly STEP | Only after flatten | Use Part flatten so Extrude/Cut work |
| Faceted / mesh STEP | No (unless opted in) | Looks like CAD but isn’t editable solid |
| Raw `.brep` / `.brp` | **No** | Export STEP first |
| `.f3d` / `.f3z` | Not pushed | Import-only on Render Studio side |
| GLB / STL | Not the Fusion push payload | Viewer meshes only |

Render Studio helpers:

- `_step_for_cloud_cad(...)` in `backend/main.py` — resolve / validate solid STEP
- `cad_service.is_editable_brep_step(path)`
- `cad_service.ensure_fusion_part_step(project_path, step_path)` — Part flatten for Extrude/Cut
- `cad_service.classify_step_file_kind(path)` — `assembly` / `faceted_mesh` / etc.

**Default push mode:** `step_mode=part` (flatten).  
Pass `step_mode=assembly|native|as_is` only when you intentionally want linked assemblies.

---

## Upload pipeline (core connector)

Function: `upload_step_to_folder` in `autodesk_oauth.py`

```text
1. list folder contents (detect same-name item)
2. conflict_mode=replace → new version on existing item
   conflict_mode=new     → unique filename if name taken
3. _create_storage(project_id, folder_id, filename)
4. parse bucket/object from storage id
5. _upload_object_to_signed_s3(...)
6. _create_version(...) OR _create_item(...)
7. kick off Model Derivative thumbnail (best-effort)
8. return item_id, version_id, web_url, name
```

Related: `upload_step_as_new_version(...)` when you already know `item_id`.

APS APIs used:

- Data Management `data/v1` — storage, items, versions, folders
- OSS `oss/v2` — signed upload URLs
- Project `project/v1` — hubs / projects browsing

---

## Studio HTTP entrypoint (already wired)

```http
POST /api/projects/{project_id}/push-to-autodesk
Authorization: Bearer <Render Studio JWT>
Content-Type: application/json

{
  "filename": "MyPart.step",
  "name": "MyPart.step",
  "aps_project_id": "<APS project id>",
  "folder_id": "<folder urn>",
  "hub_id": "<hub id>",
  "item_id": "",
  "step_mode": "part",
  "conflict_mode": "replace",
  "allow_faceted_step": false,
  "upload_source": false
}
```

Handler: `push_project_to_autodesk` in `backend/main.py`.

It:

1. Auth checks + Autodesk token
2. Resolves solid STEP via `_step_for_cloud_cad`
3. Optionally `ensure_fusion_part_step`
4. Calls `upload_step_to_folder` / `upload_step_as_new_version`
5. Returns Fusion item metadata + web URL

Frontend callers:

- `frontend/components/file-actions.js` (Export → Fusion)
- `frontend/cad/fusion-panel.js` (library / mirrors)

---

## Mirror sync (team folders)

Optional but useful: each user can bind a personal Fusion folder to a project.

| Endpoint | Purpose |
|----------|---------|
| `POST /api/projects/{id}/fusion-mirror` | Save linked folder |
| `DELETE /api/projects/{id}/fusion-mirror` | Unlink |
| `POST /api/projects/{id}/fusion-mirror/push-local` | Push local changes |
| `POST /api/projects/{id}/fusion-mirror/sync-from-fusion` | Pull |
| `GET /api/autodesk/fusion-mirrors` | List |

DB: `project_fusion_mirrors` (see `backend/database.py`).

---

## Recommended build order for a new app

1. APS app + OAuth token store (copy `autodesk_oauth.py` OAuth helpers).
2. Hub → project → folder browser (reuse `list_*` helpers / `/api/autodesk/*` routes).
3. Solid STEP export from your CAD kernel.
4. Call `upload_step_to_folder`.
5. Open `web_url`; document that users may need **Break Link** after first insert for a fully local Fusion copy (`frontend/fusion-unlink-howto.js`).
6. (Optional) Part flatten + mirrors.

---

## Failure modes we already hit (don’t repeat)

- Uploading mesh/faceted STEP → Fusion opens but Extrude/Cut fail.
- Uploading linked assemblies without flatten → same Extrude/Cut pain.
- Uploading companion `.py` source by default → duplicate junk files (`upload_source` defaults **false**).
- Missing Data Management scopes / ACC Custom Integrations → 403; reconnect OAuth after enabling APIs.
- Stale `*.part.step` cache newer than native STEP → always regenerate Part when native is newer (`ensure_fusion_part_step`).

---

## Acceptance criteria

- [ ] User can Connect Fusion (OAuth) and you store refreshable tokens
- [ ] User can pick a Fusion Team folder
- [ ] Solid STEP upload appears in that folder
- [ ] Geometry is editable B-rep in Fusion (Extrude/Cut on a Part)
- [ ] Replace mode versions the same item; New mode never overwrites silently
- [ ] Raw `.brep` is never uploaded as-is
