---
name: server-setup
description: >
  Guide first-run Render Studio server setup — identity, API keys/secrets vault,
  ecosystem privacy, authorized apps, storage backends, and Cursor/VS Code harness
  prompts. Use when the admin is installing, configuring keys, wiring MySQL/Drive,
  or asking how to make marketplace items public/private.
---

# Server setup skill

## Mission

Help the operator finish **Server Setup** without leaking secrets into git.

## Local vs public

| Layer | Path | Git? |
| --- | --- | --- |
| Public templates | `server-configurations/` | yes |
| Local runtime | `data/server-config/` | **no** |
| Secrets vault | `data/server-config/secrets/<app>/secret.env` | **no** |
| Bulk upload example | `server-configurations/secrets-templates/EXAMPLE-bulk-settings.txt` | yes (empty values) |

## Ecosystem modes

- `private` — no public marketplace sync
- `curated` — only explicitly published items sync
- `public` — eligible public listings sync to Render’s main site

## Secrets workflow

1. Prefer Management → Server Setup → Secrets UI.
2. Or upload `EXAMPLE-bulk-settings.txt` style file.
3. Or edit `data/server-config/secrets/<app>/secret.env` directly.
4. Each app folder has a README with update instructions.

## Harness export

When the user wants Cursor / VS Code / Claude Code help:

1. Call / open harness prompt with their intent (2FA, MySQL users, Drive models, etc.).
2. The prompt must ask follow-ups about existing env values before creating new ones.
3. Never put raw secrets into the exported prompt — reference vault paths instead.

## Backup identity

Backups / premium push must verify owner via `OWNER_EMAIL`, `OWNER_GITHUB`, or `BACKUP_OWNER_TOKEN` in `secrets/owner/`.

## GitHub Connect + source backups

- Vault: `data/server-config/secrets/github/` (`GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`)
- Wizard step: **GitHub** — Connect or skip; optional repo/branch/interval for source-only remote backups
- Install timers: `integrations/github/install-backup-timer.sh` (and optional Drive models via `install-drive-model-backup.sh`)
- Never commit OAuth secrets; never enable production timers casually on a live host without operator intent

## Do not

- Commit `data/server-config/secrets/**`
- Grow `backend/main.py` / `frontend/app.js` beyond thin hooks
- Claim Slack/Discord success when env/vault values are missing
