#!/usr/bin/env bash
# Run Jake's MoveIt2 server with a Render3D project folder as --repo-root.
# Usage:
#   scripts/run-moveit2-for-project.sh <project_id_or_abs_path> [extra server args...]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOVEIT2_DIR="${ROOT}/integrations/moveit2_server"
TARGET="${1:-${PROJECT_ID:-${MOVEIT2_REPO_ROOT:-}}}"

if [[ -z "${TARGET}" ]]; then
  echo "Usage: $0 <project_id|/absolute/project/path> [extra server args...]" >&2
  echo "  Starts Jake MoveIt2 on ws://127.0.0.1:8765/ws with that project as repo root." >&2
  exit 2
fi
shift || true

if [[ -d "${TARGET}" ]]; then
  REPO_ROOT="$(cd "${TARGET}" && pwd)"
elif [[ -d "${ROOT}/projects/${TARGET}" ]]; then
  REPO_ROOT="$(cd "${ROOT}/projects/${TARGET}" && pwd)"
else
  echo "Project not found: ${TARGET}" >&2
  exit 1
fi

if [[ ! -f "${MOVEIT2_DIR}/run-moveit2-server.sh" ]]; then
  echo "Missing vendored MoveIt2 server at ${MOVEIT2_DIR}" >&2
  exit 1
fi

export MOVEIT2_SERVER_HOST="${MOVEIT2_SERVER_HOST:-127.0.0.1}"
export MOVEIT2_SERVER_PORT="${MOVEIT2_SERVER_PORT:-8765}"
export MOVEIT2_SERVER_REPO_ROOT="${REPO_ROOT}"

echo "[moveit2] repo-root=${REPO_ROOT}"
echo "[moveit2] ws://${MOVEIT2_SERVER_HOST}:${MOVEIT2_SERVER_PORT}/ws"
cd "${MOVEIT2_DIR}"
exec bash ./run-moveit2-server.sh "$@"
