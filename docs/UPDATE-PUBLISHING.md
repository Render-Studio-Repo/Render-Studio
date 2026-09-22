# Update publishing workflow

Trusted agents and automation use this document when publishing Render Studio
product updates. Read it from the **trusted release branch** (default: `master`)
before posting anywhere.

## Goals

- Publish each new eligible update **once** (docs first; Slack / Discord / LinkedIn when configured).
- Prefer real behavior GIFs when the change is visual.
- Never modify application code, merge PRs, or deploy as part of publication.
- Never claim success when configuration or tools are missing.

## Separation of settings (critical)

| Layer | Location | Git? | Purpose |
| --- | --- | --- | --- |
| Public defaults | `server-configurations/` in the repo | tracked | Templates for new installs / public cloud profile |
| Local runtime | `data/server-config/` | **ignored** | This machine’s real settings, ledgers, drafts |

`git pull` / `git push` must **not** overwrite local server settings. Dashboard
edits write only under `data/server-config/`. Importing a profile from the
`Server-Configurations` branch copies into local runtime — it does not rewrite
the public templates unless an admin explicitly exports.

Public-repo default profile turns **automatic update publishing ON** with
**docs only** (Slack/Discord/LinkedIn off until configured).

## Preconditions

1. Local settings exist (`data/server-config/local-settings.json`). If missing,
   seed once from `server-configurations/public-defaults.json`.
2. `update_publishing.enabled` is true in **local** settings.
3. Required tools for GIF capture are available when a visual is needed
   (Playwright / ffmpeg as used by `scripts/gif-demos/` and `scripts/brand-update-gifs.py`).
4. Channel secrets live in environment / secret store — **never** in committed JSON:
   - Docs: always available (writes under `frontend/docs/updates/`)
   - Slack: `SLACK_UPDATES_WEBHOOK_URL`
   - Discord: existing Discord bot/webhook env vars
   - LinkedIn: existing LinkedIn env vars

## Update log source

Read the configured update log (Markdown):

- Default path (local override): `data/server-config/updates/UPDATE-LOG.md`
- Profile template path: `server-configurations/profiles/<id>/updates/UPDATE-LOG.md`

Each entry uses:

```md
## update: my-update-id

- date: 2026-09-08
- title: Short title
- summary: One or two sentences for channels.
- kind: feature|tool|fix|improve
- href: /updates.html
- visual: optional/path/or/empty
- status: published|draft
- channels: docs,slack
```

Only `status: published` entries are eligible. Drafts are ignored.

## Persistent publication ledger

Ledger path: `data/server-config/publication-ledger.json`

Keys are update ids (and optional channel suffixes). If an id is already in the
ledger for a target channel, skip that channel unless `--force`.

## Workflow (do this in order)

1. **Read this file** from the trusted release branch.
2. **Load local settings.** If `update_publishing.enabled` is false, stop and
   report that auto publishing is off (do not post).
3. **Check the update log** for new eligible entries not fully present in the ledger.
4. If none, **stop without posting**.
5. For each new update:
   1. Verify the summary/title are non-empty and the id is stable kebab-case.
   2. Prepare the description (reuse summary; keep Discord/Slack short).
   3. If visual/GIF is appropriate and missing, capture or brand a GIF using the
      existing gif-demo / `brand-update-gifs.py` pipeline. Inspect the GIF before
      attaching. If capture tools are missing, report the gap and continue with
      text-only to docs when docs is enabled.
   4. Publish to each enabled target in local settings:
      - **docs** → append/sync `frontend/docs/updates/shipped.json` (+ milestones sync)
      - **slack** → webhook post (GIF as image URL or attachment when possible)
      - **discord** / **linkedin** → existing social update services
   5. Record successful channel posts in the ledger.
6. **Do not** modify unrelated application code, merge, or deploy.
7. Report results: posted ids, skipped (already posted), and any missing config/tools.

## CLI entrypoint

```bash
.venv/bin/python scripts/publish-server-updates.py
.venv/bin/python scripts/publish-server-updates.py --dry-run
.venv/bin/python scripts/publish-server-updates.py --force --id my-update-id
```

## Dashboard controls

Management dashboard → **Server Settings → Update publishing**:

- Master enable/disable for automatic publishing
- Per-channel toggles: Docs / Slack / Discord / LinkedIn
- Instructions for webhook/bot setup
- Note that local toggles survive git pull because they live under `data/`
