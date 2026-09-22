# Update log (profile template)

Copy once into `data/server-config/updates/UPDATE-LOG.md` on each server.
Append new `status: published` entries when you ship. The publisher reads this
file and skips ids already in the local publication ledger.

## update: example-welcome-docs

- date: 2026-09-08
- title: Welcome to server update publishing
- summary: Docs-only automatic updates are enabled for the public Render Studio profile. Slack and Discord stay off until configured in Server Settings.
- kind: improve
- href: /updates.html
- visual:
- status: draft
- channels: docs
