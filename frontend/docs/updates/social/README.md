# Social update auto-post

Drafts live in this folder. Posting is automatic when you ship updates.

## Post recorded drafts now

```bash
# Discord (needs bot invite OR webhook)
.venv/bin/python scripts/create-social-update-posts.py --post-discord --wait-discord 600

# LinkedIn (needs token + author URN)
.venv/bin/python scripts/create-social-update-posts.py --post-linkedin

# Both
.venv/bin/python scripts/create-social-update-posts.py --post-all
```

## Auto-post on future updates

`scripts/ship-update.py` and `scripts/scan-milestones.py` call
`backend.services.social_updates_service`, which announces to:

- **Discord** — bot token + channel, or `DISCORD_UPDATES_WEBHOOK_URL`
- **LinkedIn** — `LINKEDIN_ACCESS_TOKEN` + `LINKEDIN_AUTHOR_URN`

## Discord setup

1. Invite the bot (Attach Files enabled):
   https://discord.com/oauth2/authorize?client_id=1527052867742076958&permissions=52224&scope=bot
2. Or create a channel webhook and set `DISCORD_UPDATES_WEBHOOK_URL` in `.env`

## LinkedIn setup

1. Create a LinkedIn developer app with Share on LinkedIn / Community Management
2. OAuth a token with `w_member_social` (personal) or `w_organization_social` (company page)
3. Set in `.env`:
   - `LINKEDIN_ACCESS_TOKEN=…`
   - `LINKEDIN_AUTHOR_URN=urn:li:person:…` or `urn:li:organization:…`
   - `LINKEDIN_ENABLED=true`
