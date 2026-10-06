#!/bin/bash
set -euo pipefail
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
ZED_APP="$HOME/zed-sdk-mlx/build/zed-capture-diagnostics/ZEDCaptureDiagnostics.app"
if [[ -d "$ZED_APP" ]]; then
  open -n "$ZED_APP" --args -1
  echo ""
  echo "If macOS asked, click Allow for Camera."
  echo "Also enable ZEDCaptureDiagnostics in System Settings → Privacy & Security → Camera."
  read -r -p "Press Enter after allowing…"
  "$ZED_APP/Contents/MacOS/ZEDCaptureDiagnostics" -1 /tmp/zed-grant-test.yuv || true
  ls -la /tmp/zed-grant-test.yuv 2>/dev/null || echo "No frame yet — check Camera permission."
else
  echo "Missing $ZED_APP — run: cd ~/zed-sdk-mlx && make build-capture-app"
fi
