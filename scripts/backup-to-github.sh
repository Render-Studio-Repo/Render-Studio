#!/usr/bin/env bash
# Push a source-code-only snapshot to a configured GitHub repo/branch.
#
# Config (gitignored): data/server-config/github-backup.json
# Secrets (gitignored): data/server-config/secrets/github/secret.env
#
# Usage:
#   bash scripts/backup-to-github.sh [--dry-run] [--help]
#
# Env overrides (portable — never hard-code machine paths):
#   RENDER_STUDIO_ROOT   repo root (default: parent of scripts/)
#   GITHUB_BACKUP_REPO   owner/name (else from config)
#   GITHUB_BACKUP_BRANCH branch (else from config)
#   GITHUB_ACCESS_TOKEN  token (else from secrets vault)
set -euo pipefail

ROOT="${RENDER_STUDIO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG="${ROOT}/data/server-config/github-backup.json"
SECRET_ENV="${ROOT}/data/server-config/secrets/github/secret.env"
STAGING="${ROOT}/backups/github-staging"
LOG() { echo "[backup-to-github] $*"; }

usage() {
  cat <<'EOF'
Usage: backup-to-github.sh [--dry-run] [--help]

Pushes source code only to the GitHub repo/branch configured in
data/server-config/github-backup.json (set via Server Setup wizard).

Excludes by default: projects/, backups/, milestones/, data/, .venv/,
node_modules/, CAD binaries (*.glb, *.stl, …), and other large/runtime trees.

Requires: git, curl; GITHUB_ACCESS_TOKEN in secrets vault or env.
EOF
}

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

if [[ ! -f "${CONFIG}" ]]; then
  LOG "No config at ${CONFIG} — enable GitHub backup in Server Setup first."
  exit 0
fi

# Parse minimal JSON fields without requiring jq
read_json_field() {
  local key="$1"
  python3 - "$CONFIG" "$key" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
val = data.get(key, "")
if isinstance(val, bool):
    print("1" if val else "0")
else:
    print(val if val is not None else "")
PY
}

ENABLED="$(read_json_field backup_enabled)"
if [[ "${ENABLED}" != "1" ]]; then
  LOG "backup_enabled=false — nothing to do."
  exit 0
fi

REPO="${GITHUB_BACKUP_REPO:-$(read_json_field repo_full_name)}"
BRANCH="${GITHUB_BACKUP_BRANCH:-$(read_json_field branch)}"
BRANCH="${BRANCH:-main}"

TOKEN="${GITHUB_ACCESS_TOKEN:-}"
LOGIN="${GITHUB_LOGIN:-}"
if [[ -f "${SECRET_ENV}" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      GITHUB_ACCESS_TOKEN=*) TOKEN="${TOKEN:-${line#GITHUB_ACCESS_TOKEN=}}" ;;
      GITHUB_LOGIN=*) LOGIN="${LOGIN:-${line#GITHUB_LOGIN=}}" ;;
    esac
  done < "${SECRET_ENV}"
fi

if [[ -z "${REPO}" ]]; then
  LOG "repo_full_name missing — configure in Server Setup."
  exit 1
fi
if [[ -z "${TOKEN}" ]]; then
  LOG "GITHUB_ACCESS_TOKEN missing — Connect GitHub in Server Setup."
  exit 1
fi

ts="$(date -u +"%Y%m%dT%H%M%SZ")"
LOG "Root=${ROOT} repo=${REPO} branch=${BRANCH} dry_run=${DRY_RUN}"

rm -rf "${STAGING}"
mkdir -p "${STAGING}"

# Source-code tree only (portable rsync excludes)
RSYNC_EXCLUDES=(
  --exclude '.git/'
  --exclude '.venv/'
  --exclude 'myenv/'
  --exclude 'node_modules/'
  --exclude '__pycache__/'
  --exclude '.pytest_cache/'
  --exclude '.mypy_cache/'
  --exclude '.ruff_cache/'
  --exclude '.cache/'
  --exclude '.cursor/'
  --exclude '.cursor-server/'
  --exclude '.codex/'
  --exclude '.local/'
  --exclude 'snap/'
  --exclude 'projects/'
  --exclude 'backups/'
  --exclude 'milestones/'
  --exclude 'data/'
  --exclude 'inbox/'
  --exclude 'logs/'
  --exclude 'tmp_*/'
  --exclude 'tmp-*/'
  --exclude 'integrations/dimos/'
  --exclude '*.pyc'
  --exclude '*.pyo'
  --exclude '*.glb'
  --exclude '*.gltf'
  --exclude '*.stl'
  --exclude '*.step'
  --exclude '*.stp'
  --exclude '*.obj'
  --exclude '*.3mf'
  --exclude '*.ply'
  --exclude '*.fbx'
  --exclude '*.iges'
  --exclude '*.igs'
  --exclude '*.brep'
  --exclude '*.brp'
  --exclude '*.off'
  --exclude '*.dae'
  --exclude '*.usd'
  --exclude '*.usda'
  --exclude '*.usdc'
  --exclude '*.abc'
  --exclude '*.f3z'
  --exclude '.env'
  --exclude '.env.*'
  --exclude '*.pem'
  --exclude '*.key'
  --exclude 'backend/render3d.db'
)

if command -v rsync >/dev/null 2>&1; then
  rsync -a "${RSYNC_EXCLUDES[@]}" "${ROOT}/" "${STAGING}/"
else
  # Fallback: copy known source dirs
  for name in backend frontend scripts integrations server-configurations instructions ai-context deploy docs; do
    if [[ -d "${ROOT}/${name}" ]]; then
      mkdir -p "${STAGING}/${name}"
      cp -a "${ROOT}/${name}/." "${STAGING}/${name}/" 2>/dev/null || true
    fi
  done
  for f in README.md requirements.txt AGENTS.md .env.example run.py; do
    [[ -f "${ROOT}/${f}" ]] && cp -a "${ROOT}/${f}" "${STAGING}/${f}" || true
  done
fi

printf '%s\n' "${ts}" > "${STAGING}/BACKUP_CREATED_UTC.txt"
printf '%s\n' "${REPO}@${BRANCH}" > "${STAGING}/BACKUP_TARGET.txt"
git -C "${ROOT}" rev-parse HEAD 2>/dev/null > "${STAGING}/SOURCE_GIT_HEAD.txt" || true

if [[ "${DRY_RUN}" == "1" ]]; then
  LOG "Dry run — staged at ${STAGING} ($(du -sh "${STAGING}" | awk '{print $1}'))"
  exit 0
fi

# Init / push staging as a shallow backup branch
git -C "${STAGING}" init -q
git -C "${STAGING}" checkout -b "${BRANCH}" 2>/dev/null || git -C "${STAGING}" checkout -B "${BRANCH}"
git -C "${STAGING}" config user.email "backup@render-studio.local"
git -C "${STAGING}" config user.name "Render Studio Backup"
git -C "${STAGING}" add -A
git -C "${STAGING}" commit -q -m "Automated source backup ${ts}" || {
  LOG "Nothing to commit (identical tree)."
  exit 0
}

REMOTE_URL="https://x-access-token:${TOKEN}@github.com/${REPO}.git"
git -C "${STAGING}" remote add origin "${REMOTE_URL}"
if git -C "${STAGING}" push -f origin "HEAD:${BRANCH}"; then
  LOG "Pushed source backup to ${REPO}:${BRANCH}"
else
  LOG "Push failed — check token scopes (repo) and repo permissions."
  exit 1
fi

# Drop embedded token from remote URL
git -C "${STAGING}" remote remove origin 2>/dev/null || true
rm -rf "${STAGING}/.git"
LOG "Done."
