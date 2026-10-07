## DIMOS ↔ Sandbox (`dimoswire1`)

### Where

`/sandbox/` → OpenArm MuJoCo card → **DIMOS · ROBOT PC** strip (`frontend/sandbox/dimos-link.js`).

### What it does

1. Paste robot PC LAN IP (e.g. `192.168.1.77`).
2. **Connect DIMOS** → `persistDimosWsUrl` (same as Studio Preferences) + optional Grok link POST.
3. **Probe** → TCP/HTTPS reachability via `/api/integrations/grok-bot/dimos/probe` (sign-in).
4. **Coordinator** → `GET /api/dimos/coordinator` (local spawn status only).

### API

| Action | Path |
|--------|------|
| Save/link | `POST /api/integrations/grok-bot/dimos` `{"host":"192.168.1.77"}` |
| Probe | `POST /api/integrations/grok-bot/dimos/probe` |
| Pipe | `/api/dimos/ws?upstream=wss://HOST:8443/ws` |
| Coordinator | `GET /api/dimos/coordinator` |

### DIMOS sandbox install

**Ensure / install** → `POST /api/dimos/ensure-coordinator` (`teleop-quest-openarm`).
Starts local coordinator only if :8443 is down — never kills a live process, never arms joints.
Needs `dimos` on PATH or `integrations/dimos/.venv`. Token still `dimoswire1`.

## Live feed (`livefeed1`)

`/sandbox/` card: `/mcp/stats` + `/api/health` + REPORT logs + WebGL/XR client obs + Gauge next steps.
Bot controls: **1 male voice** (all bots → `echo`), **Generate tasks**, **Run bot test**.
Sandbox and Repair are mutually exclusive — opening one closes the other.

## Collaborate ID

Super IDE NW → **Collaborate ID** (agents / edits / icons) · OpenArm · Office. SE → **Debugger VR** / **File IDE**.
Pad: SW **Pad**. Team chat: side iframe.
