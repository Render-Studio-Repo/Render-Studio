# Onshape

Cloud / SaaS integration for Render Studio.

## Upstream

- GitHub / org: https://github.com/onshape-public
- Docs: https://onshape.com/developers

## Render Studio wiring

Runtime clients live in the main app (`backend.services.onshape_oauth` and related modules). This folder holds **portable setup notes** so another machine can configure the same integration without local absolute paths.

## Configure

1. Copy `.env.example` → `.env` at the **repo root** (not inside this folder).
2. Set: `ONSHAPE_CLIENT_ID,ONSHAPE_CLIENT_SECRET,ONSHAPE_REDIRECT_URI`
3. Restart the API process after changing secrets.

## Paths

All file paths should be resolved from the repo root:

```bash
export RENDER_STUDIO_ROOT="$(cd \"$(dirname "$0")/../..\" && pwd)"  # if used from a script
```

Or in Python: `from integrations.paths import repo_root`.
