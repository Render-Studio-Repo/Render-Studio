#!/usr/bin/env bash
# Add autoprep.render3d.app → AutoPrep (:5050) to an existing Cloudflare tunnel config.
set -euo pipefail

ROOT="/Users/sam/Documents/Render-Studio"
CF="$ROOT/deploy/mac/bin/cloudflared"
CONF="$HOME/.cloudflared/config.yml"
TUNNEL_NAME="render3d"
HEALTH_HOST="autoprep.render3d.app"
HEALTH_URL="http://127.0.0.1:5050"

if [[ ! -f "$CONF" ]]; then
  echo "No $CONF — run deploy/mac/setup-cloudflare-tunnel.sh first."
  exit 1
fi

if grep -q "$HEALTH_HOST" "$CONF"; then
  echo "Already configured: $HEALTH_HOST"
else
  HEALTH_HOST="$HEALTH_HOST" HEALTH_URL="$HEALTH_URL" python3 <<'PY'
from pathlib import Path
import os

conf = Path(os.path.expanduser("~/.cloudflared/config.yml"))
lines = conf.read_text().splitlines()
out = []
inserted = False
health_host = os.environ["HEALTH_HOST"]
health_url = os.environ["HEALTH_URL"]
for line in lines:
    if not inserted and line.strip() == "- service: http_status:404":
        out.append(f"  - hostname: {health_host}")
        out.append(f"    service: {health_url}")
        inserted = True
    out.append(line)
if not inserted:
    raise SystemExit("Could not find catch-all rule in config.yml")
conf.write_text("\n".join(out) + "\n")
print(f"Added {health_host} -> {health_url}")
PY
  cp "$CONF" "$ROOT/deploy/mac/cloudflare/config.yml"
fi

if [[ -x "$CF" ]]; then
  "$CF" tunnel route dns "$TUNNEL_NAME" "$HEALTH_HOST" || true
  launchctl kickstart -k "gui/$(id -u)/com.render3d.cloudflared" 2>/dev/null || true
fi

echo "AutoPrep app root: /Users/sam/AutoPrep"
echo "Public URL: https://$HEALTH_HOST"
