#!/usr/bin/env bash
# Sync agent skills from earthtojake/text-to-cad into Render3D backend/skills/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/backend/skills"
REPO="${SKILLS_SRC:-/tmp/text-to-cad}"
REF="${SKILLS_REF:-v0.7.15}"

if [[ ! -d "${REPO}/.git" ]]; then
  git clone --depth 1 --branch "${REF}" https://github.com/earthtojake/text-to-cad.git "${REPO}"
else
  git -C "${REPO}" fetch origin "refs/tags/${REF}:refs/tags/${REF}" --depth 1 2>/dev/null \
    || git -C "${REPO}" fetch origin "${REF}" --depth 1
  git -C "${REPO}" checkout "${REF}"
  git -C "${REPO}" pull --ff-only origin "${REF}" 2>/dev/null || true
fi

mkdir -p "${DEST}"
# Render3D-local skills (not in text-to-cad) — exclude from sync/delete
LOCAL_SKILLS=(
  architect
  blueprint-vision
  silicone-mold-generation
  wiring
  img2threejs
  vibecad
  implicit-cad
  marketplace-robot-data-explorer
  micro-edit
  ops-debuggers
  parts-replacement
  _packages
)
LOCAL_EXCLUDES=()
for skill in "${LOCAL_SKILLS[@]}"; do
  LOCAL_EXCLUDES+=(--exclude="${skill}/")
done

# Keep Render-owned CLI shims / viewer / robot generators. Jake 0.5 skills are
# instruction-only (cadgen is a pip package); rsync --delete would otherwise
# wipe backend/skills/cad/scripts and sibling skill CLIs.
LOCAL_FILE_EXCLUDES=(
  --exclude='cad/scripts/'
  --exclude='cad-viewer/scripts/'
  --exclude='dxf/scripts/'
  --exclude='urdf/scripts/'
  --exclude='srdf/scripts/'
  --exclude='sdf/scripts/'
  --exclude='implicit-cad/scripts/'
)

rsync -a --delete \
  "${LOCAL_EXCLUDES[@]}" \
  "${LOCAL_FILE_EXCLUDES[@]}" \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache' \
  --exclude='cad.backup-*' \
  "${REPO}/skills/" "${DEST}/"

# An older skill-local cadgen shadows the synced package mirror if it stays on PYTHONPATH.
rm -rf "${DEST}/cad/scripts/packages/cadgen"

# Keep top-level package mirrors available for tooling that imports from packages/
mkdir -p "${ROOT}/backend/skills/_packages"
if [[ -d "${REPO}/packages" ]]; then
  rsync -a --delete \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    "${REPO}/packages/" "${ROOT}/backend/skills/_packages/"
else
  echo "[sync-skills] upstream has no top-level packages/; skipping _packages mirror"
fi

git -C "${REPO}" rev-parse HEAD > "${DEST}/.source_rev"
git -C "${REPO}" describe --tags --exact-match HEAD 2>/dev/null > "${DEST}/.source_tag" || true
date -u +%Y%m%d-%H%M%S > "${DEST}/.synced_at"
echo "[sync-skills] updated ${DEST} from text-to-cad@$(cat "${DEST}/.source_rev")"
"${ROOT}/scripts/patch-skills-for-render3d.sh"
