# Server secrets vault

Sensitive keys and passwords for **this install** live under:

```text
data/server-config/secrets/
  README.md
  manifest.json
  <app-id>/
    README.md
    secret.env
```

This tree is gitignored. Public documentation stubs (no real secrets) live in:

```text
server-configurations/secrets-templates/
  EXAMPLE-bulk-settings.txt
  <app-id>/README.md
```

## Update one app

1. Open `data/server-config/secrets/<app-id>/secret.env`
2. Set `KEY=value` lines
3. Or use Management → Server setup → API keys

## Bulk upload

1. Download `EXAMPLE-bulk-settings.txt` from the setup wizard
2. Fill in real values
3. Upload / paste in Server setup → Apply bulk secrets

## Owner gate for backups

Configure `secrets/owner/` with:

- `OWNER_EMAIL`
- `OWNER_GITHUB`
- `BACKUP_OWNER_TOKEN`

`scripts/backup-code.sh` checks these before taking premium/personal backups.

## GitHub OAuth (Connect + remote source backups)

Configure `secrets/github/` with:

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI`

After **Connect GitHub** in Server Setup, `GITHUB_ACCESS_TOKEN` / `GITHUB_LOGIN` are written automatically.
See `integrations/github/README.md` for timer install and Drive model opt-in.
