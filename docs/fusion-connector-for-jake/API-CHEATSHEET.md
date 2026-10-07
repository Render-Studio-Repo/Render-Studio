# API + env cheat sheet

## Environment

```bash
AUTODESK_CLIENT_ID=
AUTODESK_CLIENT_SECRET=
AUTODESK_REDIRECT_URI=http://127.0.0.1:8000/oauth/autodesk/callback
AUTODESK_SCOPES=data:read data:write data:create viewables:read

# Optional — local Fusion add-in only
RENDER3D_FUSION_BRIDGE_TOKEN=
```

APS bases used by `autodesk_oauth.py`:

```text
https://developer.api.autodesk.com/authentication/v2/authorize
https://developer.api.autodesk.com/authentication/v2/token
https://developer.api.autodesk.com/userprofile/v1/users/@me
https://developer.api.autodesk.com/project/v1
https://developer.api.autodesk.com/data/v1
https://developer.api.autodesk.com/oss/v2
https://developer.api.autodesk.com/mfg/graphql
```

---

## OAuth / status

| Method | Path |
|--------|------|
| POST | `/api/autodesk/oauth-url` |
| GET | `/oauth/autodesk/start` |
| GET | `/oauth/autodesk/callback` |
| GET | `/api/autodesk/status` |
| DELETE | `/api/autodesk/unlink` |

---

## Browse Fusion Team

| Method | Path |
|--------|------|
| GET | `/api/autodesk/hubs` |
| GET | `/api/autodesk/hubs/{hub_id}/projects` (and related top-folders / contents routes in `main.py`) |
| POST | `/api/autodesk/import` |
| POST | `/api/autodesk/download` |

Exact browse routes: search `autodesk` in `backend/main.py`.

---

## Push solid STEP to Fusion

```http
POST /api/projects/{project_id}/push-to-autodesk
```

```json
{
  "filename": "MyPart.step",
  "name": "MyPart.step",
  "aps_project_id": "b.xxxx",
  "folder_id": "urn:adsk.wipprod:fs.folder:co.xxxx",
  "hub_id": "b.xxxx",
  "item_id": null,
  "step_mode": "part",
  "conflict_mode": "replace",
  "allow_faceted_step": false,
  "upload_source": false,
  "allowed_filenames": []
}
```

| Field | Meaning |
|-------|---------|
| `step_mode` | `part` (default) flatten to single Part; `assembly`/`native`/`as_is` keep assembly |
| `conflict_mode` | `replace` = new version on same name; `new` = unique filename |
| `allow_faceted_step` | only if you knowingly push mesh STEP |
| `upload_source` | also upload companion `.py` (default **false**) |
| `item_id` | if set, force `upload_step_as_new_version` |

Python core (no HTTP):

```python
from backend.services.autodesk_oauth import (
    get_valid_access_token,
    upload_step_to_folder,
)

token = get_valid_access_token(user_id)
result = upload_step_to_folder(
    token,
    project_id=aps_project_id,
    folder_id=folder_id,
    filename="MyPart.step",
    data=step_bytes,
    conflict_mode="replace",
)
# result: item_id, version_id, name, web_url, ...
```

---

## Fusion mirrors

| Method | Path |
|--------|------|
| POST | `/api/projects/{id}/fusion-mirror` |
| DELETE | `/api/projects/{id}/fusion-mirror` |
| GET | `/api/projects/{id}/fusion-mirrors` |
| POST | `/api/projects/{id}/fusion-mirror/push-local` |
| POST | `/api/projects/{id}/fusion-mirror/push-all-to-teammates` |
| POST | `/api/projects/{id}/fusion-mirror/sync-from-fusion` |
| GET | `/api/autodesk/fusion-mirrors` |

---

## Local add-in bridge (not cloud push)

```text
GET  http://127.0.0.1:38630/health
POST http://127.0.0.1:38630/run-script
Header: x-render3d-token: <RENDER3D_FUSION_BRIDGE_TOKEN>
Body: { "source": "def run(ctx): ..." }
```
