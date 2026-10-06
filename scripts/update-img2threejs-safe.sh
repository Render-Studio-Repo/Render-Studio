#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PYTHON="${ROOT}/.venv/bin/python"
FORGE_PYTHON="${ROOT}/.venv-mac/bin/python"
SKILL="${ROOT}/backend/skills/img2threejs"
IMG2_HOME="${ROOT}/backend/skills/.img2"
STATE_DIR="${ROOT}/data/img2threejs-updates"
STATUS_FILE="${STATE_DIR}/status.json"
LOCK_DIR="${STATE_DIR}/update.lock"
BACKUP_ROOT="${RENDER3D_IMG2_BACKUPS:-${ROOT}/backups/img2threejs-updates}"
MODE="${1:---apply}"

mkdir -p "${STATE_DIR}" "${BACKUP_ROOT}"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then exit 0; fi
stage="$(mktemp -d /tmp/render-img2-update.XXXXXX)"
cleanup() { rmdir "${LOCK_DIR}" 2>/dev/null || true; rm -rf "${stage}"; }
trap cleanup EXIT

write_status() {
  local state="$1" detail="$2"
  STATUS_STATE="$state" STATUS_DETAIL="$detail" "${FORGE_PYTHON}" - <<'PY' >"${STATUS_FILE}.tmp"
import json, os
from datetime import datetime, timezone
print(json.dumps({"state": os.environ["STATUS_STATE"], "detail": os.environ["STATUS_DETAIL"],
                  "checked_at": datetime.now(timezone.utc).isoformat()}, indent=2))
PY
  mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"
}

version_from_json() {
  "${FORGE_PYTHON}" -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$1"
}
latest_tag() {
  git ls-remote --tags --refs "$1" 'refs/tags/v*' | awk '{print $2}' | sed 's#refs/tags/##' |
    grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1
}
compatible_patch() {
  local current="${1#v}" candidate="${2#v}"
  [[ "${current%.*}" == "${candidate%.*}" ]]
}
clone_release() {
  local repo="$1" tag="$2" dest="$3"
  git clone --quiet --depth 1 --branch "$tag" "$repo" "$dest"
}

core_current="v$(sed -n 's/^version:[[:space:]]*//p' "${SKILL}/SKILL.md" | head -1)"
harness_current="v$(version_from_json "${IMG2_HOME}/harness/package.json")"
character_current="v$(version_from_json "${IMG2_HOME}/plugins/character/plugin.json")"
cs2_current="v$(version_from_json "${IMG2_HOME}/plugins/cs2/plugin.json")"
core_latest="$(latest_tag https://github.com/img2threejs/img2threejs.git)"
harness_latest="$(latest_tag https://github.com/img2threejs/img2.git)"
character_latest="$(latest_tag https://github.com/img2threejs/plugin-character.git)"
cs2_latest="$(latest_tag https://github.com/img2threejs/plugin-cs2.git)"

for pair in "$core_current $core_latest" "$harness_current $harness_latest" \
            "$character_current $character_latest" "$cs2_current $cs2_latest"; do
  read -r current candidate <<<"$pair"
  if ! compatible_patch "$current" "$candidate"; then
    write_status review_required "A minor or major img2 ecosystem update is available; automatic promotion was refused."
    exit 0
  fi
done

if [[ "$MODE" == "--check" ]]; then
  if [[ "$core_current $harness_current $character_current $cs2_current" == \
        "$core_latest $harness_latest $character_latest $cs2_latest" ]]; then
    write_status current "Regular and Beta Mesh are on the newest compatible releases."
  else
    write_status update_available "A patch-only img2 ecosystem update is ready for gated promotion."
  fi
  exit 0
fi

clone_release https://github.com/img2threejs/img2threejs.git "$core_latest" "${stage}/img2threejs"
clone_release https://github.com/img2threejs/img2.git "$harness_latest" "${stage}/img2"
clone_release https://github.com/img2threejs/plugin-character.git "$character_latest" "${stage}/plugin-character"
clone_release https://github.com/img2threejs/plugin-cs2.git "$cs2_latest" "${stage}/plugin-cs2"

node --test "${stage}/img2/tests/"*.test.mjs
(cd "${stage}/img2" && PYTHONPATH=. "${FORGE_PYTHON}" -m unittest discover -s tests/python -p 'test_*.py')

candidate_home="${stage}/home"
mkdir -p "$candidate_home/harness" "$candidate_home/plugins/character" "$candidate_home/plugins/cs2"
rsync -a --exclude .git "${stage}/img2/" "$candidate_home/harness/"
rsync -a --exclude .git "${stage}/plugin-character/" "$candidate_home/plugins/character/"
rsync -a --exclude .git "${stage}/plugin-cs2/" "$candidate_home/plugins/cs2/"
CORE_PATH="$candidate_home/harness" CHARACTER_SHA="$(git -C "${stage}/plugin-character" rev-parse HEAD)" \
CS2_SHA="$(git -C "${stage}/plugin-cs2" rev-parse HEAD)" "$FORGE_PYTHON" - "$candidate_home" <<'PY'
import json, os, sys
from pathlib import Path
home = Path(sys.argv[1])
registry = {"version": 1, "plugins": [
    {"id": "character", "repo": "img2threejs/plugin-character", "ref": "candidate", "resolvedSha": os.environ["CHARACTER_SHA"], "addedAt": "staged"},
    {"id": "cs2", "repo": "img2threejs/plugin-cs2", "ref": "candidate", "resolvedSha": os.environ["CS2_SHA"], "addedAt": "staged"},
]}
(home / "plugins.json").write_text(json.dumps(registry, indent=2) + "\n")
for plugin in ("character", "cs2"):
    (home / "plugins" / plugin / "tools" / "_img2_local.py").write_text(f'CORE = {os.environ["CORE_PATH"]!r}\n')
PY
IMG2_HOME="$candidate_home" node "$candidate_home/harness/bin/img2.mjs" doctor --json
(cd "${stage}/img2threejs" && IMG2_HOME="$candidate_home" "${FORGE_PYTHON}" -m pytest -q forge/tests)
(cd "${stage}/plugin-character" && IMG2_HOME="$candidate_home" "${FORGE_PYTHON}" -m pytest -q tests)
(cd "${stage}/plugin-cs2" && IMG2_HOME="$candidate_home" "${FORGE_PYTHON}" -m pytest -q tests)

if [[ "$MODE" == "--repair" || "$core_current $harness_current $character_current $cs2_current" != \
      "$core_latest $harness_latest $character_latest $cs2_latest" ]]; then
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  backup="${BACKUP_ROOT}/${stamp}"
  mkdir -p "$backup"
  rsync -a "$SKILL/" "$backup/img2threejs/"
  rsync -a "$IMG2_HOME/" "$backup/img2-home/"
  rollback() {
    rsync -a --delete "$backup/img2threejs/" "$SKILL/"
    rsync -a --delete "$backup/img2-home/" "$IMG2_HOME/"
    write_status rolled_back "A candidate failed Render integration tests; the prior runtime was restored."
  }
  trap 'rc=$?; if [[ $rc -ne 0 ]]; then rollback; fi; cleanup; exit $rc' EXIT
  rsync -a --delete --exclude .git "${stage}/img2threejs/" "$SKILL/"
  rsync -a --delete --exclude .git "${stage}/img2/" "$IMG2_HOME/harness/"
  rsync -a --delete --exclude .git "${stage}/plugin-character/" "$IMG2_HOME/plugins/character/"
  rsync -a --delete --exclude .git "${stage}/plugin-cs2/" "$IMG2_HOME/plugins/cs2/"
  git -C "${stage}/img2threejs" rev-parse HEAD >"$SKILL/.vendor_rev"
  date -u +%Y%m%d-%H%M%S >"$SKILL/.synced_at"
fi

IMG2_HOME="$IMG2_HOME" node "$IMG2_HOME/harness/bin/img2.mjs" doctor --json
IMG2_HOME="$IMG2_HOME" node "$IMG2_HOME/harness/bin/img2.mjs" sync
"${APP_PYTHON}" -m pytest -q \
  backend/tests/test_mesh_img2_runtime.py \
  backend/tests/test_mesh_acceptance.py \
  backend/tests/test_mesh_artifact_transaction.py \
  backend/tests/test_mesh_pipeline_acceptance.py \
  backend/tests/test_mesh_pass_gate.py \
  backend/tests/test_mesh_artifact_fidelity.py \
  backend/tests/test_mesh_3mf_convert.py
write_status updated "Regular and Beta Mesh passed upstream and Render integration gates."

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -print | sort -r | tail -n +4 | while read -r old; do
  rm -rf "$old"
done
trap cleanup EXIT
