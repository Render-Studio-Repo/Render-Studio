# Integrations

Third-party and CAD/robotics integrations for **Render Studio** live here so they stay out of the core app tree and install cleanly on any machine.

Every path in this folder is **repo-relative**. Do not hard-code `/Users/...`, `/home/ubuntu`, or other machine-specific roots. Use:

```bash
# from repo root
export RENDER_STUDIO_ROOT="$(pwd)"
export INTEGRATIONS_ROOT="$RENDER_STUDIO_ROOT/integrations"
python integrations/install.py --list
python integrations/install.py dimos
```

Or in Python:

```python
from integrations.paths import INTEGRATIONS_ROOT, integration_dir
print(integration_dir("dimos"))
```

## Catalog

| Integration | Role | Location | Upstream |
|---|---|---|---|
| **DiMOS (Dimensional OS)** | Agentic OS for humanoids / quadrupeds / drones | [`dimos/`](./dimos/) — **clone via** `install.sh` (gitignored checkout; see [`dimos.md`](./dimos.md)) | [github.com/dimensionalOS/dimos](https://github.com/dimensionalOS/dimos) |
| **Fusion 360 bridge** | Local Fusion add-in ↔ Render Studio | [`fusion360/`](./fusion360/) | Local add-in (Autodesk Fusion) — see README |
| **MoveIt2 server** | Local motion planning WebSocket for CAD Viewer / SRDF | [`moveit2/`](./moveit2/) | RoboStack / MoveIt2 — see README |
| **Premium agent service** | Paid agent workers / billing boundary | [`premium-agent/`](./premium-agent/) | Hosted boundary — see README |
| **Onshape** | Cloud CAD OAuth + sync | [`onshape/`](./onshape/) | [onshape.com/developers](https://onshape.com/developers) |
| **Autodesk / Fusion cloud** | OAuth + Data Management / Model Derivative | [`autodesk/`](./autodesk/) | [aps.autodesk.com](https://aps.autodesk.com/) |
| **Supabase** | Auth / DB / storage option | [`supabase/`](./supabase/) | [github.com/supabase/supabase](https://github.com/supabase/supabase) |
| **Discord** | Updates channel + account link | [`discord/`](./discord/) | [discord.com/developers](https://discord.com/developers/docs/intro) |
| **LinkedIn** | Product-update posting | [`linkedin/`](./linkedin/) | [linkedin.com/developers](https://www.linkedin.com/developers/) |
| **Stripe** | Marketplace / AI credits | [`stripe/`](./stripe/) | [github.com/stripe/stripe-python](https://github.com/stripe/stripe-python) |
| **Slack** | Optional update publishing | [`slack/`](./slack/) | [api.slack.com](https://api.slack.com/) |
| **Twitter / X** | Connect X / Share to X | [`twitter/`](./twitter/) | [developer.x.com](https://developer.x.com) |
| **GitHub** | OAuth Connect + source-code backup timers | [`github/`](./github/) | [github.com/settings/developers](https://github.com/settings/developers) |

Core OAuth/API client code stays under `backend/services/` (thin runtime). Setup docs, installers, plugins, and vendored SDKs live here.

## Quick install

```bash
# clone / pull Render Studio, then:
python -m venv .venv && source .venv/bin/activate   # or your OS equivalent
pip install -r requirements.txt                     # if present
bash integrations/install.sh --list                 # or: python integrations/install.py --list
bash integrations/install.sh dimos                  # refresh DiMOS vendor (optional)
# bash integrations/install.sh --all                # docs-only entries + optional vendors
cp .env.example .env                                # fill keys from each integration README
```

`integrations/install.py` / `install.sh` resolve the repo root from this folder’s location, so they work no matter where the checkout lives.

## Adding a new integration

1. Create `integrations/<name>/` with a `README.md` (upstream link, env vars, setup).
2. Add an entry to `MANIFEST.json`.
3. Prefer cloning upstream with `install.py` over copying random absolute paths.
4. Wire the app with thin imports via `integrations.paths` — never `/Users/...` or `/home/...`.

## Compatibility shims

Old folders still exist as pointers so older docs/scripts don’t break:

- `fusion360-plugin/` → `integrations/fusion360/`
- `tools/moveit2_server/` → `integrations/moveit2/`
- `services/premium-agent-service/` → `integrations/premium-agent/`
