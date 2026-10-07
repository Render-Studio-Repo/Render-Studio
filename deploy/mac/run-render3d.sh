#!/bin/bash
set -euo pipefail
ROOT="/Users/sam/Render-Studio"
cd "$ROOT"
mkdir -p "$ROOT/logs"
exec /bin/bash "$HOME/Library/Application Support/Render3D/run-uvicorn.sh"
