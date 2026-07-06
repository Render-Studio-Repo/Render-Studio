#!/usr/bin/env bash
# Robust rolling backup for Render3D.
#
# Keeps up to MAX_SNAPSHOTS timestamped snapshots in backups/snapshots/
# AND always updates backups/latest/ to the newest VALID snapshot.
#
# A snapshot is VALID only if frontend/index.html AND backend/main.py both exist.
# Broken/incomplete states are quarantined in backups/quarantine/ and NEVER
# allowed to overwrite a healthy "latest".
#
# Also auto-commits all dirty git changes so no session work is ever lost.
#
# Usage:
#   backup-code.sh [label]        e.g. "service-restart", "manual", "cron"

set -euo pipefail

ROOT="/home/ubuntu"
BACKUP_ROOT="${ROOT}/backups"
SNAPSHOTS="${BACKUP_ROOT}/snapshots"
LATEST="${BACKUP_ROOT}/latest"
QUARANTINE="${BACKUP_ROOT}/quarantine"
MAX_SNAPSHOTS=20

label="${1:-manual}"
ts="$(date -u +"%Y%m%dT%H%M%SZ")"
snapshot="${SNAPSHOTS}/${ts}-${label}"
tmp="${BACKUP_ROOT}/.tmp-${ts}"

log() { echo "[backup-code] $*"; }

mkdir -p "${SNAPSHOTS}" "${QUARANTINE}" "${BACKUP_ROOT}"

# ── 1. Auto-commit all dirty/untracked git changes ───────────────────────────
if git -C "${ROOT}" rev-parse --git-dir &>/dev/null; then
  if ! git -C "${ROOT}" diff --quiet HEAD 2>/dev/null || \
     [ -n "$(git -C "${ROOT}" ls-files --others --exclude-standard 2>/dev/null)" ]; then
    log "Auto-committing dirty working tree before backup (label: ${label})"
    git -C "${ROOT}" add -A 2>/dev/null || true
    git -C "${ROOT}" commit -m "Auto-backup commit [${label} ${ts}]

Automatic commit triggered by backup-code.sh to preserve all session work.
" 2>/dev/null || true
  else
    log "Git working tree is clean — no auto-commit needed"
  fi
fi

# ── 2. Copy files into a temp directory ──────────────────────────────────────
rm -rf "${tmp}"
mkdir -p "${tmp}"

copy_dir() {
  local name="$1"
  if [[ -d "${ROOT}/${name}" ]]; then
    mkdir -p "${tmp}/${name}"
    cp -a "${ROOT}/${name}/." "${tmp}/${name}/"
  fi
}

copy_dir backend
copy_dir frontend
copy_dir scripts
copy_dir services
copy_dir data
copy_dir deploy
[[ -f "${ROOT}/.env" ]] && cp -a "${ROOT}/.env" "${tmp}/.env"
[[ -f "${ROOT}/requirements.txt" ]] && cp -a "${ROOT}/requirements.txt" "${tmp}/requirements.txt"

printf '%s\n' "${label}" > "${tmp}/BACKUP_LABEL"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "${tmp}/BACKUP_CREATED_UTC"
git -C "${ROOT}" rev-parse HEAD 2>/dev/null > "${tmp}/GIT_HEAD" || true

# ── 3. Validate before committing the snapshot ───────────────────────────────
VALID=1
[[ -f "${tmp}/frontend/index.html" ]]   || { log "INVALID: frontend/index.html missing"; VALID=0; }
[[ -f "${tmp}/backend/main.py" ]]       || { log "INVALID: backend/main.py missing"; VALID=0; }

if [[ "${VALID}" -eq 0 ]]; then
  # Quarantine the broken snapshot instead of promoting it
  quarantine_dest="${QUARANTINE}/${ts}-${label}"
  mv "${tmp}" "${quarantine_dest}"
  log "Snapshot quarantined (broken state): ${quarantine_dest}"
  # Prune quarantine to last 5
  mapfile -t qold < <(ls -1dt "${QUARANTINE}"/*/ 2>/dev/null | tail -n +6)
  for q in "${qold[@]}"; do rm -rf "${q}"; done
  exit 0
fi

# ── 4. Move into snapshots and update "latest" symlink ───────────────────────
mv "${tmp}" "${snapshot}"
log "Snapshot saved: ${snapshot}"

# Update latest to newest valid snapshot
rm -rf "${LATEST}"
ln -sfn "${snapshot}" "${LATEST}"
log "Updated latest -> ${snapshot}"

# ── 5. Prune old snapshots (keep MAX_SNAPSHOTS) ──────────────────────────────
mapfile -t old < <(ls -1dt "${SNAPSHOTS}"/*/ 2>/dev/null | tail -n +"$((MAX_SNAPSHOTS + 1))")
for old_snap in "${old[@]}"; do
  log "Pruning old snapshot: ${old_snap}"
  rm -rf "${old_snap}"
done

log "Done. Kept $(ls "${SNAPSHOTS}" | wc -l) snapshot(s). Latest: ${ts}-${label}"
