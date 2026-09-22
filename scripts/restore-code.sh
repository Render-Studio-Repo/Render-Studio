#!/usr/bin/env bash
# Restore Render3D source from a backup folder.
set -euo pipefail

ROOT="${RENDER_STUDIO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_ROOT="${ROOT}/backups"

usage() {
  echo "Usage: restore-code.sh <backup-folder-name|latest> [--yes]"
  echo ""
  echo "Examples:"
  echo "  restore-code.sh latest"
  echo "  restore-code.sh 20260603-033500 --yes"
  echo ""
  echo "Available backups:"
  ls -1dt "${BACKUP_ROOT}"/*/ 2>/dev/null | xargs -n1 basename || echo "  (none)"
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

TARGET="$1"
CONFIRM="${2:-}"

if [[ "${TARGET}" == "latest" ]]; then
  TARGET="$(ls -1dt "${BACKUP_ROOT}"/*/ 2>/dev/null | head -1 | xargs -n1 basename || true)"
  if [[ -z "${TARGET}" ]]; then
    echo "No backups found in ${BACKUP_ROOT}"
    exit 1
  fi
fi

SRC="${BACKUP_ROOT}/${TARGET}"
if [[ ! -d "${SRC}" ]]; then
  echo "Backup not found: ${SRC}"
  usage
  exit 1
fi

if [[ "${CONFIRM}" != "--yes" ]]; then
  echo "This will overwrite current code with backup: ${TARGET}"
  read -r -p "Type yes to continue: " answer
  if [[ "${answer}" != "yes" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

"${ROOT}/scripts/backup-code.sh" "pre-restore-${TARGET}"

restore_tree() {
  local name="$1"
  if [[ -d "${SRC}/${name}" ]]; then
    rm -rf "${ROOT}/${name}"
    mkdir -p "${ROOT}/${name}"
    cp -a "${SRC}/${name}/." "${ROOT}/${name}/"
  fi
}

restore_tree "backend"
restore_tree "frontend"
restore_tree "images"

for file in run.py requirements.txt README.md; do
  if [[ -f "${SRC}/${file}" ]]; then
    cp -a "${SRC}/${file}" "${ROOT}/${file}"
  fi
done

echo "[restore-code] restored from ${SRC}"
echo "Restart the service to apply: sudo systemctl restart render3d"
