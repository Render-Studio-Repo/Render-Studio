#!/usr/bin/env bash
set -euo pipefail
ROOT="/Users/sam/Documents/Render-Studio"
CADDY="$ROOT/deploy/mac/bin/caddy"
PLIST_SRC="$ROOT/deploy/mac/.com.render3d.caddy.built.plist"
sed "s|/usr/local/bin/caddy|$CADDY|g" "$ROOT/deploy/mac/com.render3d.caddy.plist" > "$PLIST_SRC"

echo "Installing Caddy LaunchDaemon for auto HTTPS on :80/:443..."
sudo install -m 644 "$PLIST_SRC" /Library/LaunchDaemons/com.render3d.caddy.plist
sudo launchctl bootout system/com.render3d.caddy 2>/dev/null || true
sudo launchctl bootstrap system /Library/LaunchDaemons/com.render3d.caddy.plist
sudo launchctl enable system/com.render3d.caddy 2>/dev/null || true
sudo launchctl kickstart -k system/com.render3d.caddy
sleep 2
echo
echo "=== Listening ==="
sudo lsof -nP -iTCP:80 -sTCP:LISTEN || true
sudo lsof -nP -iTCP:443 -sTCP:LISTEN || true
echo
echo "=== Local HTTPS probe (may take a moment for first cert) ==="
curl -k -sS -o /dev/null -w "https://127.0.0.1 -> %{http_code}\n" --max-time 10 https://127.0.0.1/ || true
curl -sS -o /dev/null -w "http://render3d.app -> %{http_code}\n" --max-time 15 -H "Host: render3d.app" http://127.0.0.1/ || true
echo
echo "Done. If public site still fails, open router 192.168.1.254 and forward:"
echo "  TCP 80  -> 192.168.1.83:80"
echo "  TCP 443 -> 192.168.1.83:443"
