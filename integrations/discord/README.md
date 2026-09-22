# Discord

Cloud / SaaS integration for Render Studio.

## Upstream

- GitHub / org: https://github.com/discord
- Docs: https://discord.com/developers/docs/intro

## Render Studio wiring

Runtime clients live in the main app (`backend.services.discord_updates_service` and related modules). This folder holds **portable setup notes** so another machine can configure the same integration without local absolute paths.

## Configure

1. Copy `.env.example` → `.env` at the **repo root** (not inside this folder).
2. Set: `DISCORD_BOT_TOKEN,DISCORD_UPDATES_CHANNEL_ID,DISCORD_CLIENT_ID,DISCORD_CLIENT_SECRET`
3. Restart the API process after changing secrets.

## Paths

All file paths should be resolved from the repo root:

```bash
export RENDER_STUDIO_ROOT="$(cd \"$(dirname "$0")/../..\" && pwd)"  # if used from a script
```

Or in Python: `from integrations.paths import repo_root`.
