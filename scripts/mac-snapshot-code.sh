#!/usr/bin/env bash
# Snapshot Render Studio code OUTSIDE the project tree so panics, Cursor
# undos, and iCloud eviction cannot wipe the only copy.
set -euo pipefail

ROOT="/Users/sam/Render-Studio"
APP="$HOME/Library/Application Support/Render3D"
SNAPROOT="$APP/code-snapshots"
LOG="$APP/logs/code-guard.log"
label="${1:-periodic}"
ts="$(date -u +"%Y%m%dT%H%M%SZ")"
dest="$SNAPROOT/${ts}-${label}"
latest="$SNAPROOT/latest"

log() { echo "$(date) [snapshot] $*" >>"$LOG"; }

mkdir -p "$SNAPROOT" "$APP/logs"

need=(
  "$ROOT/frontend/index.html"
  "$ROOT/frontend/studio/app.js"
  "$ROOT/frontend/studio/styles.css"
  "$ROOT/backend/main.py"
)
for f in "${need[@]}"; do
  if [[ ! -s "$f" ]]; then
    log "SKIP (invalid live tree): missing $f"
    exit 0
  fi
done

tmp="$SNAPROOT/.tmp-${ts}"
rm -rf "$tmp"
mkdir -p "$tmp/frontend" "$tmp/backend" "$tmp/scripts"

# Copy code only — not projects, venv, node_modules, backups.
/usr/bin/rsync -a --delete \
  --exclude '.venv/' --exclude '__pycache__/' --exclude '*.pyc' \
  "$ROOT/frontend/" "$tmp/frontend/"
/usr/bin/rsync -a --delete \
  --exclude '.venv/' --exclude '__pycache__/' --exclude '*.pyc' \
  --exclude 'skills/cad.backup-*/' \
  "$ROOT/backend/" "$tmp/backend/"
/usr/bin/rsync -a --delete "$ROOT/scripts/" "$tmp/scripts/" 2>/dev/null || true

printf '%s\n' "$label" > "$tmp/BACKUP_LABEL"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$tmp/BACKUP_CREATED_UTC"

mv "$tmp" "$dest"
rm -rf "$latest"
/bin/cp -a "$dest" "$latest"
log "saved $dest"

# Keep 12 snapshots
old="$(ls -1dt "$SNAPROOT"/20* 2>/dev/null | tail -n +13 || true)"
if [[ -n "$old" ]]; then
  echo "$old" | while read -r p; do
    [[ -n "$p" ]] || continue
    rm -rf "$p"
    log "pruned $p"
  done
fi
