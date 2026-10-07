#!/usr/bin/env bash
# Bind Render Studio to this Mac, install Caddy, load launchd services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAN_IP="${LAN_IP:-$(ipconfig getifaddr en1 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true)}"
PUBLIC_IP="$(curl -4 -s --max-time 5 https://api.ipify.org || true)"
BIN_DIR="$ROOT/deploy/mac/bin"
CADDY_BIN="$BIN_DIR/caddy"

echo "ROOT=$ROOT"
echo "LAN_IP=${LAN_IP:-unknown}"
echo "PUBLIC_IP=${PUBLIC_IP:-unknown}"

mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents" "$BIN_DIR"

# Install Caddy into project bin (no root)
if [[ ! -x "$CADDY_BIN" ]]; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64) CADDY_ARCH=arm64 ;;
    x86_64) CADDY_ARCH=amd64 ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
  esac
  echo "Downloading Caddy for darwin/$CADDY_ARCH..."
  curl -fsSL "https://caddyserver.com/api/download?os=darwin&arch=${CADDY_ARCH}" -o "$CADDY_BIN"
  chmod +x "$CADDY_BIN"
  echo "Installed $CADDY_BIN ($("$CADDY_BIN" version))"
fi

# Point LaunchDaemon plist at project-local caddy
PLIST_CADDY_SRC="$ROOT/deploy/mac/com.render3d.caddy.plist"
PLIST_CADDY_BUILT="$ROOT/deploy/mac/.com.render3d.caddy.built.plist"
sed "s|/usr/local/bin/caddy|$CADDY_BIN|g" "$PLIST_CADDY_SRC" > "$PLIST_CADDY_BUILT"

# Stop ad-hoc servers / old agents
launchctl bootout "gui/$(id -u)/com.render3d.app" 2>/dev/null || true
pkill -f '/Documents/Render-Studio/.venv/bin/python run.py' 2>/dev/null || true
pkill -f 'uvicorn backend.main:app' 2>/dev/null || true
sleep 1

# Load app (user LaunchAgent)
install -m 644 "$ROOT/deploy/mac/com.render3d.app.plist" "$HOME/Library/LaunchAgents/com.render3d.app.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.render3d.app.plist" 2>/dev/null \
  || launchctl load "$HOME/Library/LaunchAgents/com.render3d.app.plist" 2>/dev/null \
  || true
launchctl kickstart -k "gui/$(id -u)/com.render3d.app" 2>/dev/null \
  || launchctl start com.render3d.app 2>/dev/null \
  || true

# Caddy :80/:443 needs admin — GUI password prompt via osascript
echo "Requesting admin to install Caddy LaunchDaemon (ports 80/443)..."
osascript <<EOF
do shell script "install -m 644 '$PLIST_CADDY_BUILT' /Library/LaunchDaemons/com.render3d.caddy.plist && launchctl bootout system/com.render3d.caddy 2>/dev/null; launchctl bootstrap system /Library/LaunchDaemons/com.render3d.caddy.plist; launchctl kickstart -k system/com.render3d.caddy" with administrator privileges
EOF

sleep 2
echo
echo "=== Local checks ==="
echo -n "loopback: "; curl -sS --max-time 5 "http://127.0.0.1:8001/api/health" || echo FAIL
echo
if [[ -n "${LAN_IP:-}" ]]; then
  echo -n "lan: "; curl -sS --max-time 5 "http://${LAN_IP}:8001/api/health" || echo FAIL
  echo
  echo -n "caddy-lan: "; curl -sS --max-time 5 "http://${LAN_IP}/api/health" || echo FAIL
  echo
fi

echo
echo "=== Port forward on router ${LAN_IP%.*}.254 (this network: 192.168.1.254) ==="
echo "  TCP 80  → ${LAN_IP:-THIS_MAC}:80"
echo "  TCP 443 → ${LAN_IP:-THIS_MAC}:443"
echo "  (optional debug) TCP 8001 → ${LAN_IP:-THIS_MAC}:8001"
echo "=== DNS A records ==="
echo "  render3d.app / smartcallusa.com / www → ${PUBLIC_IP:-YOUR_PUBLIC_IP}"
echo "  Old LAN box was 192.168.1.25 — use this Mac ${LAN_IP:-?} behind the router."
echo "Done."
