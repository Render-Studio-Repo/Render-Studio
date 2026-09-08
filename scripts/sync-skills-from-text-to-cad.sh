#!/usr/bin/env bash
# Sync agent skills from earthtojake/text-to-cad into Render3D backend/skills/.
set -euo pipefail

ROOT="${RENDER_STUDIO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEST="${ROOT}/backend/skills"
REPO="${SKILLS_SRC:-/tmp/text-to-cad}"
REF="${SKILLS_REF:-main}"

if [[ ! -d "${REPO}/.git" ]]; then
  git clone --depth 1 --branch "${REF}" https://github.com/earthtojake/text-to-cad.git "${REPO}"
else
  git -C "${REPO}" fetch origin "${REF}" --depth 1
  git -C "${REPO}" checkout "${REF}"
  git -C "${REPO}" pull --ff-only origin "${REF}" || true
fi

mkdir -p "${DEST}"
# Render3D-local skills (not in text-to-cad) — exclude from sync/delete
LOCAL_SKILLS=(
  architect
  blueprint-vision
  silicone-mold-generation
  wiring
  img2threejs
)
LOCAL_EXCLUDES=()
for skill in "${LOCAL_SKILLS[@]}"; do
  LOCAL_EXCLUDES+=(--exclude="${skill}/")
done

# Render3D-local files inside upstream skill trees (not in text-to-cad)
LOCAL_FILE_EXCLUDES=(
  --exclude='dxf/scripts/dxf/repair.py'
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

# Keep top-level package mirrors available for tooling that imports from packages/
mkdir -p "${ROOT}/backend/skills/_packages"
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  "${REPO}/packages/" "${ROOT}/backend/skills/_packages/"

git -C "${REPO}" rev-parse HEAD > "${DEST}/.source_rev"
date -u +%Y%m%d-%H%M%S > "${DEST}/.synced_at"
echo "[sync-skills] updated ${DEST} from text-to-cad@$(cat "${DEST}/.source_rev")"
"${ROOT}/scripts/patch-skills-for-render3d.sh"
