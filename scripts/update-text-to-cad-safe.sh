#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="${ROOT}/backend/skills"
CAD_PYTHON="${ROOT}/.venv-mac/bin/python"
STATE_DIR="${ROOT}/data/text-to-cad-updates"
STATUS_FILE="${STATE_DIR}/status.json"
LOCK_DIR="${STATE_DIR}/update.lock"
BACKUP_ROOT="${RENDER3D_TEXT_TO_CAD_BACKUPS:-${ROOT}/backups/text-to-cad-updates}"
REPOSITORY="https://github.com/earthtojake/text-to-cad.git"
MODE="${1:---apply}"

mkdir -p "${STATE_DIR}" "${BACKUP_ROOT}"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  exit 0
fi
cleanup() { rmdir "${LOCK_DIR}" 2>/dev/null || true; }
trap cleanup EXIT

write_status() {
  local state="$1" current="$2" candidate="$3" detail="$4"
  STATUS_STATE="$state" STATUS_CURRENT="$current" STATUS_CANDIDATE="$candidate" STATUS_DETAIL="$detail" \
    "${CAD_PYTHON}" - <<'PY' >"${STATUS_FILE}.tmp"
import json, os
from datetime import datetime, timezone
print(json.dumps({
    "state": os.environ["STATUS_STATE"],
    "current": os.environ["STATUS_CURRENT"],
    "candidate": os.environ["STATUS_CANDIDATE"],
    "detail": os.environ["STATUS_DETAIL"],
    "checked_at": datetime.now(timezone.utc).isoformat(),
}, indent=2))
PY
  mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"
}

current="$(cat "${SKILLS}/.source_tag" 2>/dev/null || true)"
current="${current:-v0.0.0}"
latest="$(git ls-remote --tags --refs "${REPOSITORY}" 'v*' \
  | awk '{print $2}' \
  | sed 's#refs/tags/##' \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  | sort -V \
  | tail -1)"

if [[ -z "${latest}" ]]; then
  write_status "check_failed" "${current}" "" "Could not determine the latest stable release."
  exit 1
fi
if [[ "${latest}" == "${current}" ]]; then
  write_status "current" "${current}" "${latest}" "No update is available."
  exit 0
fi

version_parts() {
  local value="${1#v}"
  IFS=. read -r VERSION_MAJOR VERSION_MINOR VERSION_PATCH <<<"${value}"
}
version_parts "${current}"
current_major="${VERSION_MAJOR}"; current_minor="${VERSION_MINOR}"
version_parts "${latest}"
latest_major="${VERSION_MAJOR}"; latest_minor="${VERSION_MINOR}"

if [[ "${current_major}" != "${latest_major}" || "${current_minor}" != "${latest_minor}" ]]; then
  write_status "review_required" "${current}" "${latest}" "Minor or major releases require a manual compatibility review."
  exit 0
fi
if [[ "${MODE}" == "--check" ]]; then
  write_status "update_available" "${current}" "${latest}" "A compatible patch release is ready for gated installation."
  exit 0
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
backup="${BACKUP_ROOT}/${stamp}-${current#v}"
mkdir -p "${backup}"
rsync -a "${SKILLS}/" "${backup}/skills/"
old_cadgen="$("${CAD_PYTHON}" -c 'from importlib.metadata import version; print(version("cadgen"))')"

rollback() {
  rsync -a --delete "${backup}/skills/" "${SKILLS}/"
  uv pip install --python "${CAD_PYTHON}" "cadgen==${old_cadgen}" >/dev/null
  write_status "rolled_back" "${current}" "${latest}" "Candidate failed validation. Restored skills and cadgen ${old_cadgen}."
}
trap 'rc=$?; if [[ $rc -ne 0 ]]; then rollback; fi; cleanup; exit $rc' EXIT

SKILLS_REF="${latest}" "${ROOT}/scripts/sync-skills-from-text-to-cad.sh"
uv pip install --python "${CAD_PYTHON}" "cadgen==${latest#v}"

cd "${ROOT}"
.venv/bin/python -m pytest -q \
  backend/tests/test_jake_acceptance.py \
  backend/tests/test_native_assembly_motion.py \
  backend/tests/test_joint_export_transport.py \
  backend/tests/test_cad_harness_hardware.py \
  backend/tests/test_prompt_references.py \
  backend/tests/test_reference_capture_folders.py \
  backend/tests/test_cad_edit_intent.py \
  backend/tests/test_prompt_history_running.py \
  backend/tests/test_cad_host_runtime.py
node --test \
  frontend/components/reference-files-pane.test.js \
  frontend/components/reference-files-folders.test.js \
  frontend/components/reference-files-tab.test.js \
  frontend/components/prompt-design-chat.test.js \
  frontend/components/render-agent-design-chat.test.js \
  frontend/components/prompt-history.test.js

write_status "updated" "${latest}" "${latest}" "Compatibility gates passed and the candidate was promoted."
launchctl kickstart -k "gui/$(id -u)/com.render3d.app" || true
BACKUP_ROOT_VALUE="${BACKUP_ROOT}" "${CAD_PYTHON}" - <<'PY'
import os, shutil
from pathlib import Path
root = Path(os.environ["BACKUP_ROOT_VALUE"])
for old in sorted((path for path in root.iterdir() if path.is_dir()), reverse=True)[3:]:
    shutil.rmtree(old)
PY

trap cleanup EXIT
