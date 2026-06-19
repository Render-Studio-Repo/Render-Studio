#!/usr/bin/env bash
# Sync agent skills from earthtojake/text-to-cad into Render3D backend/skills/.
set -euo pipefail

ROOT="/home/ubuntu"
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
LOCAL_SKILLS=(blueprint-vision)
LOCAL_EXCLUDES=()
for skill in "${LOCAL_SKILLS[@]}"; do
  LOCAL_EXCLUDES+=(--exclude="${skill}/")
done

rsync -a --delete \
  "${LOCAL_EXCLUDES[@]}" \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.pytest_cache' \
  "${REPO}/skills/" "${DEST}/"

git -C "${REPO}" rev-parse HEAD > "${DEST}/.source_rev"
date -u +%Y%m%d-%H%M%S > "${DEST}/.synced_at"
echo "[sync-skills] updated ${DEST} from text-to-cad@$(cat "${DEST}/.source_rev")"
"${ROOT}/scripts/patch-skills-for-render3d.sh"
