#!/usr/bin/env bash
# Download and install VibeCAD.app into mac-render-studio/runtime/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$ROOT/runtime/VibeCAD.app"
TAG="${VIBECAD_RELEASE_TAG:-v26.3.1-RC3}"

if [[ -x "$RUNTIME/Contents/MacOS/FreeCAD" ]]; then
  echo "VibeCAD already installed at $RUNTIME"
  exit 0
fi

echo "Fetching release $TAG from 10-X-eng/vibecad…"
RELEASE=$(curl -sL "https://api.github.com/repos/10-X-eng/vibecad/releases/tags/${TAG}")
URL=$(python3 - <<PY
import json, os, sys
r = json.loads('''$RELEASE''')
assets = [a["browser_download_url"] for a in r.get("assets", []) if "macOS12-arm64.dmg" in a.get("name", "")]
if not assets:
    sys.exit("No macOS12-arm64.dmg asset in release")
print(assets[0])
PY
)

DMG="/tmp/VibeCAD-macOS-arm64.dmg"
MOUNT="/tmp/vibecad-mount-$$"
echo "Downloading $URL"
curl -L -o "$DMG" "$URL"
mkdir -p "$MOUNT"
hdiutil attach "$DMG" -nobrowse -mountpoint "$MOUNT"
rm -rf "$RUNTIME"
mkdir -p "$ROOT/runtime"
cp -R "$MOUNT/VibeCAD.app" "$RUNTIME"
hdiutil detach "$MOUNT"
rmdir "$MOUNT" 2>/dev/null || true
rm -f "$DMG"

echo "Installed: $RUNTIME"
file "$RUNTIME/Contents/MacOS/FreeCAD"
