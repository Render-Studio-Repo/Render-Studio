#!/usr/bin/env bash
# Daily Render3D models backup → Google Drive only
# (folder RENDER3D_DRIVE_BACKUP_FOLDER_ID / 1ovSbfq6D8kNlL72CJcNueRdKKDsOgt6M).
# Does not keep local model archives. Code snapshots stay in backups/snapshots/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${RENDER3D_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
PY="${ROOT}/.venv/bin/python3"
SCRIPT="${ROOT}/scripts/backup-to-drive.py"
LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"

if [[ ! -x "${PY}" ]]; then
  echo "[backup-daily] Missing venv python: ${PY}" >&2
  exit 1
fi
if [[ ! -f "${SCRIPT}" ]]; then
  echo "[backup-daily] Missing Drive backup script: ${SCRIPT}" >&2
  exit 1
fi

export RENDER3D_ROOT="${ROOT}"
export RENDER3D_DRIVE_BACKUP_FOLDER_ID="${RENDER3D_DRIVE_BACKUP_FOLDER_ID:-1ovSbfq6D8kNlL72CJcNueRdKKDsOgt6M}"

exec "${PY}" "${SCRIPT}" "$@"
