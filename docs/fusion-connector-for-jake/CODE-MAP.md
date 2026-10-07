# Code map — files Jake should open

Paths are relative to the Render Studio repo root: `/Users/sam/Render-Studio/`

## Must-read (cloud connector)

| File | What to steal |
|------|----------------|
| `backend/services/autodesk_oauth.py` | Entire APS connector: OAuth, hubs, folders, `upload_step_to_folder`, S3 upload, create item/version |
| `backend/main.py` | `push_project_to_autodesk`, `_step_for_cloud_cad`, Autodesk browse/import routes, fusion-mirror routes |
| `backend/services/cad_service.py` | `ensure_fusion_part_step`, `is_editable_brep_step`, `export_step_as_single_part`, `classify_step_file_kind`, `step_has_assembly_links` |
| `backend/config.py` | `autodesk_client_id/secret/redirect_uri/scopes` |
| `backend/database.py` | `autodesk_tokens`, `project_fusion_mirrors` schema |
| `.env.example` | `AUTODESK_*` variable names |

## Frontend (how Studio calls it)

| File | What to steal |
|------|----------------|
| `frontend/components/file-actions.js` | Export UI → `POST .../push-to-autodesk` body |
| `frontend/cad/fusion-panel.js` | Fusion Library browse, link mirror, sync, push |
| `frontend/cad/fusion-unlink-howto.js` | Post-push “Break Link” UX |
| `frontend/studio/app.js` | Connect Autodesk status, realtime `fusion.mirror.updated` |

## Local add-in (optional — not STEP push)

| File | Notes |
|------|-------|
| `integrations/fusion-360/README.md` | Install + `/run-script` |
| `integrations/fusion-360/Render3DLink/Render3DLink.py` | Localhost bridge on `:38630` |

## Function checklist inside `autodesk_oauth.py`

Open these in order:

1. `configured_scopes`
2. `build_authorization_url`
3. `exchange_code_for_tokens`
4. `refresh_access_token`
5. `get_valid_access_token`
6. Hub/folder listing helpers (`list_*` near top of Data Management section)
7. `upload_step_to_folder` ← **core**
8. `upload_step_as_new_version`
9. `_create_storage`
10. `_upload_object_to_signed_s3`
11. `_create_item` / `_create_version`
12. MFG GraphQL helpers (only if you need Fusion design → STEP download)

## Function checklist inside `main.py`

Search for:

- `push_project_to_autodesk`
- `_step_for_cloud_cad`
- `_push_file_to_fusion_mirrors`
- `/api/autodesk/`
- `/fusion-mirror`

## Historical notes

`ai-context/worklog.md` has long Fusion push lessons (Part vs Assembly, faceted STEP, allow-lists, thumbnails). Useful when debugging Extrude/Cut failures.
