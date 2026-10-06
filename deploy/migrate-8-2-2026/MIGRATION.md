# Render Studio system migration bundle

Companion to the projects+data archive. Restore order:

1. Unpack app code under `/home/ubuntu` (backend, frontend, scripts, deploy, integrations/supabase, ai-context).
2. Copy `env/dotenv` → `/home/ubuntu/.env` (mode 600).
3. Recreate venv: `python3 -m venv .venv && .venv/bin/pip install -r env/requirements-freeze.txt`
4. Install systemd units from `systemd/` + drop-ins from `systemd-dropins/`, then `daemon-reload`.
5. Install Caddyfile from `caddy/` (prefer `etc-caddy.Caddyfile` → `/etc/caddy/Caddyfile`).
6. Restore crontab: `crontab cron/ubuntu.crontab`
7. Enable: `render3d.service`, timers (`stray-cleanup`, `worker-watch`, `supabase-keepalive`), optional `render3d-tunnel.service`.
8. Unpack projects+data archive into `/home/ubuntu/projects` and `/home/ubuntu/data`.
9. Optional: restore Google Drive OAuth from `google-oauth/` → `~/.config/render3d/`.

Generated for Drive folder 14Rsv--QR60JFY3vFubltr6fwOUpriCro.
