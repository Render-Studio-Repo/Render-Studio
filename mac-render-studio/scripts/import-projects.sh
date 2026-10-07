#!/usr/bin/env bash
# Headless import of projects/*.step into a new FreeCAD document (saved under dist/).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FC="$ROOT/runtime/FreeCAD.app/Contents/MacOS/FreeCAD"
OUT_DIR="$ROOT/dist"
mkdir -p "$OUT_DIR"
OUT_FCSTD="$OUT_DIR/imported-projects.FCStd"
PROJECTS="${RENDER_STUDIO_PROJECTS_DIR:-$ROOT/../projects}"
LIMIT="${IMPORT_LIMIT:-30}"

if [[ ! -x "$FC" ]]; then
  echo "FreeCAD missing at $FC"
  exit 1
fi

bash "$ROOT/scripts/link-mod.sh" >/dev/null

# FreeCAD -c runs console Python
"$FC" -c "
import sys
sys.path.insert(0, r'$ROOT/Mod')
import FreeCAD as App
from RenderStudio import project_import
doc = App.newDocument('RenderStudioImport')
n = project_import.import_projects_tree(r'$PROJECTS', doc, limit=int('$LIMIT'))
path = r'$OUT_FCSTD'
doc.saveAs(path)
print(f'SAVED {n} solids -> {path}')
" 2>&1 | tee "$ROOT/logs/import-projects.log"

echo
echo "Open in FreeCAD: $OUT_FCSTD"
