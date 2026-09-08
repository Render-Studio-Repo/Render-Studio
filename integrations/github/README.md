# GitHub OAuth + automated source backups

Connect a GitHub account from **Server Setup**, optionally push source-code
backups on a timer, and (separately) opt into 3D model backups on Google Drive.

## Env / secrets (never commit real values)

| Key | Where | Notes |
| --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | `data/server-config/secrets/github/secret.env` or `.env` | Public OAuth App client id |
| `GITHUB_OAUTH_CLIENT_SECRET` | secrets vault only | OAuth App client secret |
| `GITHUB_OAUTH_REDIRECT_URI` | vault / `.env` | Default `https://render3d.app/oauth/github/callback` |
| `GITHUB_ACCESS_TOKEN` | vault (written by Connect) | Linked account token |
| `GITHUB_LOGIN` | vault (written by Connect) | Linked username |

Public placeholders: `.env.example` and `server-configurations/secrets-templates/github/`.

Create an OAuth App at https://github.com/settings/developers → **OAuth Apps**.
Authorization callback URL must match `GITHUB_OAUTH_REDIRECT_URI`.

## Server Setup flow

1. Open Management → **Server setup wizard** → **GitHub & backups**
2. **Connect GitHub** (OAuth) or **Skip for now**
3. If linked: enable automatic source backup → pick repo → branch → interval (`hourly` / `daily` / `monthly`)
4. Optional: **Set up 3D model backup to Google Drive** (reuses `scripts/backup-to-drive.py`)

State persists in gitignored `data/server-config/github-backup.json`.

## Fresh machine — unpack & install timers

```bash
export RENDER_STUDIO_ROOT="$(pwd)"   # wherever you cloned Render Studio
cp .env.example .env                # fill non-secret ids; secrets stay in vault

# Source-code → GitHub (default scope excludes models / venv / node_modules)
bash integrations/github/install-backup-timer.sh          # copy units
bash integrations/github/install-backup-timer.sh --enable # enable when ready
# or user units:  bash integrations/github/install-backup-timer.sh --user --enable

# Optional: 3D models → Google Drive
bash integrations/github/install-drive-model-backup.sh --auth
bash integrations/github/install-drive-model-backup.sh --enable
```

Unit templates live in `integrations/github/systemd/`. The install scripts rewrite
`REPLACE_WITH_RENDER_STUDIO_ROOT` to your absolute checkout — **no** `/home/ubuntu/...`
assumptions.

## Manual / dry-run

```bash
bash scripts/backup-to-github.sh --help
bash scripts/backup-to-github.sh --dry-run
bash scripts/backup-daily.sh      # models → Drive wrapper
```

## Related

- Local rolling snapshots: `scripts/backup-code.sh`
- Drive models: `scripts/backup-to-drive.py`
- Secrets vault: `instructions/server/SECRETS-VAULT.md`
