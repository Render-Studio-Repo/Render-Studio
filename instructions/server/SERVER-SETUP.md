# First-run server setup

Read this when installing Render Studio or reconfiguring a private server.

## Flow

1. Open Management dashboard → **Server setup wizard** (auto-opens when setup is incomplete)
2. Set server name + owner identity
3. **GitHub & backups** — Connect GitHub (OAuth) or skip; optionally enable source-code backups (repo / branch / hourly|daily|monthly). Opt-in Drive model backup button.
4. Add API keys via the secrets vault (or bulk `.txt` upload)
5. Choose ecosystem mode: `private` | `curated` | `public`
6. Enable authorized apps
7. Pick model storage (local / Google Drive / MySQL users / Supabase)
8. Review dashboard settings
9. Optionally export a **harness prompt** for Cursor / VS Code for custom wiring (2FA, MySQL, Drive, etc.)

## Local vs public

| Layer | Path | Git |
| --- | --- | --- |
| Public templates | `server-configurations/` | tracked |
| Local runtime | `data/server-config/` | ignored |
| Secrets | `data/server-config/secrets/` | ignored |
| GitHub backup state | `data/server-config/github-backup.json` | ignored |

## GitHub source backups

- Secrets: `data/server-config/secrets/github/` (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, …)
- Installer (portable): `bash integrations/github/install-backup-timer.sh`
- Script: `scripts/backup-to-github.sh` (source only by default)
- Docs: [`integrations/github/README.md`](../../integrations/github/README.md)

## Render Agent

Uses skill `backend/skills/server-setup/SKILL.md`. From the wizard side panel, ask questions or click **Copy harness prompt** to paste into Cursor/VS Code with file paths and follow-up questions about existing envs.

## Related

- [SECRETS-VAULT.md](./SECRETS-VAULT.md)
- [UPDATE-DOCS.md](./UPDATE-DOCS.md)
- `docs/UPDATE-PUBLISHING.md`
