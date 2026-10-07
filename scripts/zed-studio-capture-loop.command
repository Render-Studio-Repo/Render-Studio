#!/bin/bash
set -euo pipefail
ZED_APP="$HOME/zed-sdk-mlx/build/zed-capture-diagnostics/ZEDCaptureDiagnostics.app/Contents/MacOS/ZEDCaptureDiagnostics"
PY="$HOME/zed-sdk-mlx/.venv/bin/python"
DECODE="$HOME/zed-sdk-mlx/scripts/decode_yuv422_frame.py"
OUT_DIR="/tmp/zed-studio-preview"
JPG="/tmp/zed-studio-latest.jpg"
YUV="/tmp/zed-studio-frame.yuv"
mkdir -p "$OUT_DIR"
echo "ZED capture loop — grant Camera to ZEDCaptureDiagnostics if prompted."
"$ZED_APP" --permission-only || true
while true; do
  if "$ZED_APP" -1 "$YUV"; then
    "$PY" "$DECODE" "$YUV" "$OUT_DIR" >/dev/null 2>&1 || true
    if [[ -f "$OUT_DIR/left.png" ]]; then
      sips -s format jpeg "$OUT_DIR/left.png" --out "$JPG" >/dev/null 2>&1 || cp "$OUT_DIR/left.png" "$JPG"
      echo "wrote $JPG"
    fi
  fi
  sleep 0.45
done
