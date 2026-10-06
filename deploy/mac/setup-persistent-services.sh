#!/usr/bin/env bash
# Install LaunchAgents so Render Studio + Healthy Justice survive crash, reboot, and screen lock.
# Runs in the logged-in user session (gui domain) — no GUI required once loaded.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAC_DEPLOY="$ROOT/deploy/mac"
HEALTH_ROOT="/Users/sam/AutoPrep"
UID_NUM="$(id -u)"
GUI="gui/$UID_NUM"

mkdir -p "$ROOT/logs" "$HEALTH_ROOT/logs" "$HOME/Library/LaunchAgents"

echo "=== Healthy Justice: ensure gunicorn ==="
if [[ ! -x "$HEALTH_ROOT/.venv/bin/gunicorn" ]]; then
  "$HEALTH_ROOT/.venv/bin/pip" install -q gunicorn
fi

echo "=== Stop ad-hoc processes ==="
launchctl bootout "$GUI/com.render3d.app" 2>/dev/null || true
launchctl bootout "$GUI/com.healthjustice.app" 2>/dev/null || true
pkill -f 'uvicorn backend.main:app' 2>/dev/null || true
pkill -f 'gunicorn.*app:app' 2>/dev/null || true
pkill -f 'python.*AutoPrep/app.py' 2>/dev/null || true
pkill -f 'python.*HealthWebsite/app.py' 2>/dev/null || true
sleep 1

install_plist() {
  local label="$1"
  local src="$2"
  local dst="$HOME/Library/LaunchAgents/${label}.plist"
  install -m 644 "$src" "$dst"
  launchctl bootout "$GUI/$label" 2>/dev/null || true
  launchctl bootstrap "$GUI" "$dst" 2>/dev/null \
    || launchctl load "$dst" 2>/dev/null \
    || true
  launchctl enable "$GUI/$label" 2>/dev/null || true
  launchctl kickstart -k "$GUI/$label" 2>/dev/null \
    || launchctl start "$label" 2>/dev/null \
    || true
}

echo "=== Install Render Studio supervisor + watchdog scripts ==="
SUPPORT="$HOME/Library/Application Support/Render3D"
mkdir -p "$SUPPORT/logs"
install -m 755 "$MAC_DEPLOY/run-uvicorn.sh" "$SUPPORT/run-uvicorn.sh"
install -m 755 "$MAC_DEPLOY/run-app-watchdog.sh" "$SUPPORT/run-app-watchdog.sh"

echo "=== Install Render Studio (uvicorn :8001) ==="
install_plist "com.render3d.app" "$MAC_DEPLOY/com.render3d.app.plist"
install_plist "com.render3d.watchdog" "$MAC_DEPLOY/com.render3d.watchdog.plist"

echo "=== Install Grok bot MCP (HTTP :8744) ==="
install_plist "com.render3d.grok-bot" "$MAC_DEPLOY/com.render3d.grok-bot.plist"

echo "=== Install Healthy Justice (gunicorn :5050) ==="
install_plist "com.healthjustice.app" "$MAC_DEPLOY/com.healthjustice.app.plist"

sleep 2
echo
echo "=== Status ==="
for label in com.render3d.app com.render3d.watchdog com.render3d.grok-bot com.healthjustice.app; do
  echo "--- $label ---"
  launchctl print "$GUI/$label" 2>&1 | grep -E 'state =|pid =|last exit|runs =|path =' | head -6 || echo "(not loaded)"
done

echo
echo -n "render3d health: "
curl -sS --max-time 5 "http://127.0.0.1:8001/api/health" || echo FAIL
echo
echo -n "healthjustice:   "
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 "http://127.0.0.1:5050/" || echo FAIL
echo
echo -n "grok-bot mcp:    "
curl -sS --max-time 5 "http://127.0.0.1:8744/health" || echo FAIL

echo
echo "Done. Both apps:"
echo "  • Start at login (RunAtLoad)"
echo "  • Restart on crash (KeepAlive)"
echo "  • Keep running when the screen is locked"
echo "Logs:"
echo "  $ROOT/logs/render3d-app*.log"
echo "  $HEALTH_ROOT/logs/healthjustice-app*.log"
