#!/usr/bin/env bash
# Symlink Mod/RenderStudio into VibeCAD + FreeCAD user Mod paths.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOD_SRC="$ROOT/Mod/RenderStudio"

# Guard against a polluted $HOME (e.g. agent shells that captured freecadcmd stdout).
if [[ -z "${HOME:-}" || "$HOME" != /Users/* || "$HOME" == *$'\n'* ]]; then
  HOME="$(cd ~ && pwd)"
  export HOME
fi

link_one() {
  local base="$1"
  local ver="$2"
  local target="${base}/${ver}/Mod/RenderStudio"
  mkdir -p "${base}/${ver}/Mod"
  if [[ -L "$target" || -e "$target" ]]; then
    rm -rf "$target"
  fi
  ln -sfn "$MOD_SRC" "$target"
  echo "Linked: $target -> $MOD_SRC"
}

# VibeCAD 26.x uses Application Support/VibeCAD (NOT FreeCAD)
VIBE_BASE="${HOME}/Library/Application Support/VibeCAD"
FC_BASE="${HOME}/Library/Application Support/FreeCAD"

for ver in v26-3 v26 v1-1; do
  link_one "$VIBE_BASE" "$ver"
  link_one "$FC_BASE" "$ver"
done

echo
echo "Next: bash $ROOT/scripts/launch.sh"
echo "Workbench menu → Render Studio"
