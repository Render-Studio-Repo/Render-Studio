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

ROOT="${RENDER_STUDIO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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

# ── 0. Sync Recent Updates milestones from shipped sources ───────────────────
if [[ -x "${ROOT}/.venv/bin/python" ]]; then
  PY="${ROOT}/.venv/bin/python"
else
  PY="python3"
fi
if [[ -f "${ROOT}/scripts/scan-milestones.py" ]]; then
  log "Scanning milestones for Recent Updates page"
  "${PY}" "${ROOT}/scripts/scan-milestones.py" --quiet || log "Milestone scan skipped/failed (non-fatal)"
fi

# ── 0b. Owner identity gate (premium / personal backups) ─────────────────────
# Only continue automatic premium backups when this machine is owned by the
# configured operator (OWNER_EMAIL / OWNER_GITHUB / BACKUP_OWNER_TOKEN).
if [[ "${BACKUP_REQUIRE_OWNER:-1}" == "1" ]]; then
  OWNER_EMAIL_ENV="${OWNER_EMAIL:-}"
  OWNER_GITHUB_ENV="${OWNER_GITHUB:-}"
  BACKUP_TOKEN_ENV="${BACKUP_OWNER_TOKEN:-}"
  if [[ -f "${ROOT}/data/server-config/secrets/owner/secret.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    # Read KEY=value lines without executing
    while IFS= read -r line; do
      case "$line" in
        OWNER_EMAIL=*) OWNER_EMAIL_ENV="${line#OWNER_EMAIL=}" ;;
        OWNER_GITHUB=*) OWNER_GITHUB_ENV="${line#OWNER_GITHUB=}" ;;
        BACKUP_OWNER_TOKEN=*) BACKUP_TOKEN_ENV="${line#BACKUP_OWNER_TOKEN=}" ;;
      esac
    done < "${ROOT}/data/server-config/secrets/owner/secret.env"
    set +a
  fi
  if [[ -z "${OWNER_EMAIL_ENV}" && -z "${OWNER_GITHUB_ENV}" && -z "${BACKUP_TOKEN_ENV}" ]]; then
    log "Owner identity not configured — skipping backup (set secrets/owner or BACKUP_REQUIRE_OWNER=0)"
    exit 0
  fi
  CLAIM_EMAIL="${BACKUP_CLAIM_EMAIL:-${OWNER_EMAIL_ENV}}"
  CLAIM_GITHUB="${BACKUP_CLAIM_GITHUB:-${OWNER_GITHUB_ENV}}"
  CLAIM_TOKEN="${BACKUP_CLAIM_TOKEN:-${BACKUP_TOKEN_ENV}}"
  if [[ -n "${OWNER_EMAIL_ENV}" && "${CLAIM_EMAIL}" != "${OWNER_EMAIL_ENV}" ]]; then
    log "Backup blocked: OWNER_EMAIL mismatch (not the configured owner)"
    exit 0
  fi
  if [[ -n "${OWNER_GITHUB_ENV}" && "${CLAIM_GITHUB}" != "${OWNER_GITHUB_ENV}" ]]; then
    log "Backup blocked: OWNER_GITHUB mismatch (not the configured owner)"
    exit 0
  fi
  if [[ -n "${BACKUP_TOKEN_ENV}" && -n "${BACKUP_CLAIM_TOKEN:-}" && "${CLAIM_TOKEN}" != "${BACKUP_TOKEN_ENV}" ]]; then
    log "Backup blocked: BACKUP_OWNER_TOKEN mismatch"
    exit 0
  fi
  log "Owner identity check passed for backups"
fi

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
