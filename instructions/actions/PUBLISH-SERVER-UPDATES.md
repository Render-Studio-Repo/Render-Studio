# Publish server updates (action playbook)

Read this before posting product updates from a Render Studio server.

Also read from the trusted release branch:
- `docs/UPDATE-PUBLISHING.md`
- `instructions/server/UPDATE-DOCS.md`

## Mission

1. Check the configured server update log for new **published** entries.
2. If none are eligible, **stop without posting**.
3. For each new update: verify changes, prepare the description, capture/inspect a GIF when appropriate, publish to configured channels.
4. Use the persistent publication ledger to prevent duplicates.
5. **Do not** modify application code, merge, or deploy.
6. Report missing configuration or tools without claiming success.

## Local vs public settings

| Layer | Path | Git? |
| --- | --- | --- |
| Public templates | `server-configurations/` | tracked |
| Local runtime | `data/server-config/` | **ignored** |

Dashboard toggles write only to local settings. Public-repo default: auto publish **ON → docs only**.

## Commands

```bash
.venv/bin/python scripts/publish-server-updates.py --dry-run
.venv/bin/python scripts/publish-server-updates.py
.venv/bin/python scripts/publish-server-updates.py --force --id <update-id>
```

## Secrets (never commit)

- Docs: always available (`frontend/docs/updates/shipped.json`)
- Slack: `SLACK_UPDATES_WEBHOOK_URL`
- Discord: bot/webhook env vars already used by the app
- LinkedIn: `LINKEDIN_ACCESS_TOKEN` (+ author URN)
