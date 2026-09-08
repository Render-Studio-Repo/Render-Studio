#!/usr/bin/env bash
# Daily Render3D models backup → Google Drive only
# (folder RENDER3D_DRIVE_BACKUP_FOLDER_ID / 1ovSbfq6D8kNlL72CJcNueRdKKDsOgt6M).
# Does not keep local model archives. Code snapshots stay in backups/snapshots/.
set -euo pipefail

ROOT="${RENDER_STUDIO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [[ -x "${ROOT}/.venv/bin/python3" ]]; then
  PY="${ROOT}/.venv/bin/python3"
elif [[ -x "${ROOT}/.venv/bin/python" ]]; then
  PY="${ROOT}/.venv/bin/python"
else
  PY="python3"
fi
SCRIPT="${ROOT}/scripts/backup-to-drive.py"
LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"

if ! command -v "${PY}" >/dev/null 2>&1 && [[ ! -x "${PY}" ]]; then
  echo "[backup-daily] Missing python: ${PY}" >&2
  exit 1
fi

export RENDER3D_DRIVE_BACKUP_FOLDER_ID="${RENDER3D_DRIVE_BACKUP_FOLDER_ID:-1ovSbfq6D8kNlL72CJcNueRdKKDsOgt6M}"

exec "${PY}" "${SCRIPT}" "$@"
