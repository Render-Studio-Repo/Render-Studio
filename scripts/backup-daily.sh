#!/usr/bin/env bash
# Daily Render3D backup: code + models -> local dated folder -> Google Drive.
# Keeps 7 days locally and on Drive. Excludes .venv, myenv, node_modules, etc.
set -euo pipefail

ROOT="/home/ubuntu"
PY="${ROOT}/.venv/bin/python3"
SCRIPT="${ROOT}/scripts/backup-to-drive.py"
LOG_DIR="${ROOT}/logs"
mkdir -p "${LOG_DIR}"

if [[ ! -x "${PY}" ]]; then
  echo "[backup-daily] Missing venv python: ${PY}" >&2
  exit 1
fi

exec "${PY}" "${SCRIPT}" "$@"
