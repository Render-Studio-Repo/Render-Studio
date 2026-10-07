# Auto-restart (no Terminal)

Services run as LaunchAgents under `~/Library/LaunchAgents/`:

| Label | Role |
|-------|------|
| `com.render3d.app` | uvicorn supervisor (`run-uvicorn.sh`) on `:8001`, KeepAlive |
| `com.render3d.grok-bot` | Grok bot MCP HTTP on `127.0.0.1:8744`, KeepAlive; public `https://render3d.app/mcp` via Cloudflare |
| `com.render3d.cloudflared` | Cloudflare tunnel |
| `com.render3d.caddy-user` | local Caddy origin |
| `com.render3d.watchdog` | health probe; starts app if `:8001` is gone |
| `com.healthjustice.app` | AutoPrep gunicorn on `:5050` (`start-gunicorn-inner.sh`) |
| `com.healthjustice.watchdog` | AutoPrep probe; kickstarts if `:5050` is gone |

App path: **`/Users/sam/Render-Studio`** (moved out of `Documents` so launchd is not TCC-blocked).  
`Documents/Render-Studio` is a symlink to that folder.

AutoPrep path: **`/Users/sam/AutoPrep`**. `Documents/AutoPrep` and `Documents/HealthWebsite` are symlinks to that folder. Public URLs: `https://autoprep.render3d.app` and alias `https://health.render3d.app`.

## How crash recovery works

1. `run-uvicorn.sh` is a `while true` supervisor: if Python/uvicorn exits, it starts again in 2s. Caddy keeps proxying to `:8001` and the site comes back without anyone opening chat.
2. LaunchAgent `KeepAlive` + `ProcessType=Interactive` restarts that supervisor at login and if bash itself dies. Import of `backend.main` takes 1–2 minutes — the watchdog **must not** `kickstart -k` during that window.
3. `com.render3d.watchdog` only kickstarts (without `-k`) when nothing is listening **and** no uvicorn/supervisor process exists. If Python is still importing, it waits up to ~6 minutes.

Closing Terminal does **not** stop the site.

Logs:

- `~/Library/Application Support/Render3D/logs/render3d-app.err.log`
- `~/Library/Application Support/Render3D/logs/watchdog.log`
- `~/Library/Application Support/Render3D/logs/login-server.log`

Reinstall after editing the scripts:

```bash
bash /Users/sam/Render-Studio/deploy/mac/setup-persistent-services.sh
```
