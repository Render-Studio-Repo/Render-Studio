# Mac local restore — 2026-08-02

Integrated from Downloads bundles:

- **Models:** `render3d-models-8-2-2026-001` → `projects/` (224 projects, ~12GB) + `data/` (~6.4MB, `render3d.db` 688KB)
- **System:** `system-migrate-8-2-2026/render3d-system-configs-8-2-2026.tar.gz` → `deploy/migrate-8-2-2026/` (systemd, caddy, cron, cloudflare)
- **Pip:** `requirements-freeze.txt` from production (Python 3.13 server freeze)

Pre-migration local stub backed up to `backups/pre-migrate-local-20260802/`.

## Mac host network (2026-08-01)

| | |
|--|--|
| LAN | **192.168.1.83** |
| Public | **70.238.226.63** |
| Gateway | **192.168.1.254** |
| App | `http://192.168.1.83:8001` |

See `deploy/mac/PORT-FORWARD.md` for router/DNS/Caddy.

## Mac-specific `.env` (LAN + public domains)

```
HOST=0.0.0.0
PORT=8001
PROJECTS_DIR=projects
DATA_DIR=data
PUBLIC_BASE_URL=https://render3d.app
*_REDIRECT_URI=https://render3d.app/oauth/...
```

Production secrets (`SECRETS_FERNET_KEY`, API keys, Stripe) already match the migrated bundle.

## Google Drive backup OAuth (optional)

From the extracted tarball:

```bash
mkdir -p ~/.config/render3d
cp /tmp/render3d-migrate-extract/google-oauth/* ~/.config/render3d/
chmod 600 ~/.config/render3d/*
```

Or re-auth: `.venv/bin/python scripts/backup-to-drive.py --auth`

## Start server

```bash
cd /Users/sam/Documents/Render-Studio
.venv/bin/python run.py
# → http://127.0.0.1:8001
```

## Push back to Ubuntu production

See `deploy/migrate-8-2-2026/MIGRATION.md` (reverse: copy `projects/` + `data/` to `/home/ubuntu`, restore `env/dotenv` → `/home/ubuntu/.env`, systemd units, crontab).
