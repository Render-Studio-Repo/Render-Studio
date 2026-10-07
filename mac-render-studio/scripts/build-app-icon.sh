#!/usr/bin/env bash
# Build RenderStudio.icns from web app logo (frontend/render3d-logo.png).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="${RENDER_STUDIO_LOGO:-$ROOT/../frontend/render3d-logo.png}"
APP_DIR="$ROOT/app"
ICONSET="$APP_DIR/RenderStudio.iconset"
ICNS="$APP_DIR/render-studio.icns"
MOD_LOGO="$ROOT/Mod/RenderStudio/Resources/render3d-logo.png"

if [[ ! -f "$LOGO" ]]; then
  echo "Logo not found: $LOGO"
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$APP_DIR" "$ICONSET"
pairs=(
  "16:icon_16x16.png"
  "32:icon_16x16@2x.png"
  "32:icon_32x32.png"
  "64:icon_32x32@2x.png"
  "128:icon_128x128.png"
  "256:icon_128x128@2x.png"
  "256:icon_256x256.png"
  "512:icon_256x256@2x.png"
  "512:icon_512x512.png"
  "1024:icon_512x512@2x.png"
)
for entry in "${pairs[@]}"; do
  size="${entry%%:*}"
  name="${entry##*:}"
  sips -z "$size" "$size" "$LOGO" --out "$ICONSET/$name" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"
cp "$LOGO" "$MOD_LOGO"
echo "Built $ICNS and copied logo to Mod/Resources/"
