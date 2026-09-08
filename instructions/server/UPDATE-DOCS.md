# UPDATE-DOCS — Server update publication (agents)

Read this before posting product updates from a Render Studio server.

Canonical workflow detail also lives on the trusted release branch at
`docs/UPDATE-PUBLISHING.md`. Prefer the copy from that branch when present.

## Mission

Check the configured server update log for new published entries.
If no new eligible update exists, **stop without posting**.

For each new update, verify the changes, prepare the description,
capture and inspect a GIF of the actual behavior when appropriate,
and publish to the configured channels (docs / Slack / Discord / LinkedIn).

Use the persistent publication ledger to prevent duplicate posts.
**Do not** modify application code, merge changes, or deploy.
Report missing configuration or tools without claiming success.

## Separation of settings

| Layer | Path | In git? |
| --- | --- | --- |
| Public templates | `server-configurations/` | yes |
| Local runtime | `data/server-config/` | **no** (gitignored) |

Dashboard toggles write only to `data/server-config/local-settings.json`.
Importing a profile copies into local runtime — it does not rewrite public templates.

Public-repo defaults: **auto update publishing ON → docs only**.

## Steps

1. Read `docs/UPDATE-PUBLISHING.md` from the trusted release branch (`master` unless configured otherwise).
2. Load local settings via Management → Server Settings, or:
   ```bash
   .venv/bin/python -c "from backend.services import server_config_service as s; import json; print(json.dumps(s.admin_view()['update_publishing'], indent=2))"
   ```
3. If `update_publishing.enabled` is false, stop and report that auto publishing is off.
4. Run the publisher (preferred entrypoint):
   ```bash
   .venv/bin/python scripts/publish-server-updates.py
   .venv/bin/python scripts/publish-server-updates.py --dry-run
   .venv/bin/python scripts/publish-server-updates.py --force --id <update-id>
   ```
5. The script:
   - Reads `data/server-config/updates/UPDATE-LOG.md`
   - Skips drafts and ledger hits
   - Posts to enabled targets
   - Records successes in `data/server-config/publication-ledger.json`
6. For visual updates without a `visual:` URL, capture a GIF with
   `scripts/gif-demos/` + `scripts/brand-update-gifs.py`, inspect it, then set
   `visual:` on the log entry (or attach a public image URL for Slack).
7. If Slack/Discord/LinkedIn env vars are missing, report the gap — do not claim those channels succeeded.

## Channel secrets (never commit)

- Docs: always available (writes `frontend/docs/updates/shipped.json`)
- Slack: `SLACK_UPDATES_WEBHOOK_URL`
- Discord: `DISCORD_UPDATES_WEBHOOK_URL` or `DISCORD_BOT_TOKEN` + `DISCORD_UPDATES_CHANNEL_ID`
- LinkedIn: `LINKEDIN_ACCESS_TOKEN` (+ author URN as already used by the app)

## Dashboard

Management dashboard → **Server Settings → Update publishing**:

- Master enable/disable
- Per-channel toggles + setup instructions
- Reminder that local toggles survive `git pull`
