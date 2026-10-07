#!/usr/bin/env bash
# Launch VibeCAD with Render Studio Mod available.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VCAD="$ROOT/runtime/VibeCAD.app/Contents/MacOS/FreeCAD"

if [[ ! -x "$VCAD" ]]; then
  echo "VibeCAD missing at $VCAD"
  echo "Run: bash $ROOT/scripts/install-vibecad-runtime.sh"
  exit 1
fi

bash "$ROOT/scripts/link-mod.sh" >/dev/null

export RENDER_STUDIO_API_BASE="${RENDER_STUDIO_API_BASE:-http://127.0.0.1:8001}"
export RENDER_STUDIO_PROJECTS_DIR="${RENDER_STUDIO_PROJECTS_DIR:-$ROOT/../projects}"
export RENDER_STUDIO_ENV="${RENDER_STUDIO_ENV:-$ROOT/../.env}"
export RENDER_STUDIO_WORKSPACE="${RENDER_STUDIO_WORKSPACE:-$ROOT/..}"

echo "Starting VibeCAD (Render Studio)…"
echo "API: $RENDER_STUDIO_API_BASE"
echo "Projects: $RENDER_STUDIO_PROJECTS_DIR"
echo "Env: $RENDER_STUDIO_ENV"
# Do NOT pass --workbench here: if InitGui fails to register, FreeCAD aborts in
# Gui::MainWindow::delayedStartup(). startup.py activates RenderStudioWorkbench
# after a short delay once the Mod has loaded.
exec "$VCAD" "$@"
