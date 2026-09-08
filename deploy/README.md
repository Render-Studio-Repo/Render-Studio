# Render Studio systemd unit (example)

Copy and edit paths for **your** machine. Production hosts often use `/home/ubuntu`; laptops use your clone path.

```bash
export RENDER_STUDIO_ROOT="$(pwd)"   # from your checkout
# then substitute below, or set Environment=RENDER_STUDIO_ROOT=...
```

```ini
[Unit]
Description=Render Studio (uvicorn)
After=network.target

[Service]
Type=simple
WorkingDirectory=/ABS/PATH/TO/render-studio
EnvironmentFile=-/ABS/PATH/TO/render-studio/.env
Environment=RENDER_STUDIO_ROOT=/ABS/PATH/TO/render-studio
ExecStartPre=/ABS/PATH/TO/render-studio/scripts/kill-stray-uvicorn.sh pre-start
ExecStart=/ABS/PATH/TO/render-studio/.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8001
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Do not commit machine-specific absolute paths into shared docs. Prefer `RENDER_STUDIO_ROOT` + repo-relative scripts under `scripts/`.
