#!/usr/bin/env bash
# Fill holes only. Never overwrite a file that still exists.
# Sources (first match): App Support latest snapshot, then Aug 5 golden.
set -u

ROOT="/Users/sam/Render-Studio"
APP="$HOME/Library/Application Support/Render3D"
SNAP="$APP/code-snapshots/latest"
GOLD="$ROOT/backups/golden/golden-working-production-20260805T214857Z"
LOG="$APP/logs/code-guard.log"

log() { echo "$(date) [restore] $*" >>"$LOG"; }
mkdir -p "$APP/logs"

sources=()
[[ -d "$SNAP/frontend" ]] && sources+=("$SNAP")
[[ -d "$GOLD/frontend" ]] && sources+=("$GOLD")
if [[ ${#sources[@]} -eq 0 ]]; then
  log "no snapshot or golden available"
  exit 1
fi

restored=0
EXCLUDE_FILE="$APP/logs/frontend-path-map.excludes"
python3 - <<'PY' >"$EXCLUDE_FILE" 2>/dev/null || true
import json
from pathlib import Path
p = Path("/Users/sam/Render-Studio/frontend/path-map.json")
if p.is_file():
    for name in json.loads(p.read_text()):
        print(name)
PY

restore_tree() {
  local rel="$1"  # frontend or backend
  local dest="$ROOT/$rel"
  mkdir -p "$dest"
  for src in "${sources[@]}"; do
    local from="$src/$rel"
    [[ -d "$from" ]] || continue
    # --ignore-existing = never clobber live files
    extra=()
    if [[ "$rel" == "frontend" && -s "$EXCLUDE_FILE" ]]; then
      extra+=(--exclude-from="$EXCLUDE_FILE")
    fi
    /usr/bin/rsync -a --ignore-existing \
      --exclude '.venv/' --exclude '__pycache__/' --exclude '*.pyc' \
      --exclude 'skills/cad.backup-*/' \
      "${extra[@]}" \
      "$from/" "$dest/"
  done
}

restore_tree frontend
restore_tree backend

# Drop pre-reorg flat copies if the live dest already exists.
python3 - <<'PY' 2>/dev/null || true
import json
from pathlib import Path
fe = Path("/Users/sam/Render-Studio/frontend")
mp = fe / "path-map.json"
if not mp.is_file():
    raise SystemExit
for name, dest in json.loads(mp.read_text()).items():
    src = fe / name
    target = fe / dest
    if src.is_file() and target.is_file() and src.resolve() != target.resolve():
        src.unlink()
PY

need=(
  frontend/index.html
  frontend/studio/app.js
  frontend/studio/styles.css
  frontend/xr/viewport-xr.js
  frontend/scripting/mesh-animation-runtime.js
  frontend/social/social-network-ui.js
  backend/main.py
  backend/services/jake_tool_agent.py
  backend/services/cad_service.py
  backend/services/ai_service.py
  backend/services/design_service.py
  backend/services/vibecad_service.py
  backend/services/vibecad_agent.py
)
missing=0
for rel in "${need[@]}"; do
  if [[ ! -s "$ROOT/$rel" ]]; then
    log "STILL MISSING $rel"
    missing=1
  fi
done

# Count newly appeared files vs a cheap marker: if index.html exists now, we are usable.
if [[ -s "$ROOT/frontend/index.html" && -s "$ROOT/backend/main.py" ]]; then
  log "critical files present"
  exit 0
fi
exit "$missing"
