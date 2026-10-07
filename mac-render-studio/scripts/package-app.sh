#!/usr/bin/env bash
# Branded Render Studio .app — thin launcher that always uses launch.sh + live Mod.
# Opening this .app MUST go through scripts/launch.sh (env, Mod link, workbench).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/dist/RenderStudio.app"
ICNS="$ROOT/app/render-studio.icns"

bash "$ROOT/scripts/link-mod.sh" >/dev/null
bash "$ROOT/scripts/build-app-icon.sh" >/dev/null || true

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Real Mach-O launcher (shell-only CFBundleExecutable fails with macOS -10669)
LAUNCHER_SRC="/tmp/rs_launcher.c"
cat > "$LAUNCHER_SRC" <<EOF
#include <unistd.h>
int main(int argc, char *argv[]) {
  (void)argc; (void)argv;
  execl("/bin/bash", "bash", "$ROOT/scripts/launch.sh", (char *)0);
  return 127;
}
EOF
clang -O2 -o "$APP/Contents/MacOS/RenderStudio" "$LAUNCHER_SRC"
chmod +x "$APP/Contents/MacOS/RenderStudio"
if [[ -f "$ICNS" ]]; then
  cp "$ICNS" "$APP/Contents/Resources/render-studio.icns"
fi

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Render Studio</string>
  <key>CFBundleDisplayName</key>
  <string>Render Studio</string>
  <key>CFBundleIdentifier</key>
  <string>app.render3d.mac</string>
  <key>CFBundleVersion</key>
  <string>0.2.0</string>
  <key>CFBundleShortVersionString</key>
  <string>0.2.0</string>
  <key>CFBundleExecutable</key>
  <string>RenderStudio</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>render-studio.icns</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# Finder-friendly .command fallback (always works if .app is blocked)
cat > "$ROOT/dist/Launch-Render-Studio.command" <<EOF
#!/usr/bin/env bash
cd "$ROOT"
exec bash scripts/launch.sh
EOF
chmod +x "$ROOT/dist/Launch-Render-Studio.command"

# Clear macOS quarantine / icon cache hints
xattr -cr "$APP" 2>/dev/null || true

echo "Created thin launcher: $APP"
echo "This app runs scripts/launch.sh (Mod + .env + RenderStudioWorkbench)"
echo "Also: $ROOT/dist/Launch-Render-Studio.command"
