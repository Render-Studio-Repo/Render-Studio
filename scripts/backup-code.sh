#!/usr/bin/env bash
# Snapshot Render3D source code and lightweight settings before service starts.
set -euo pipefail

ROOT="/home/ubuntu"
BACKUP_ROOT="${ROOT}/backups"
MAX_BACKUPS="${RENDER3D_MAX_BACKUPS:-30}"
MIN_INTERVAL_SECONDS="${RENDER3D_BACKUP_MIN_INTERVAL_SECONDS:-600}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DEST="${BACKUP_ROOT}/${STAMP}"
REASON="${1:-service-restart}"

mkdir -p "${BACKUP_ROOT}"

if [[ "${REASON}" == "service-restart" && "${MIN_INTERVAL_SECONDS}" != "0" ]]; then
  latest_backup="$(ls -1dt "${BACKUP_ROOT}"/20*/ 2>/dev/null | head -1 || true)"
  if [[ -n "${latest_backup}" && -d "${latest_backup}" ]]; then
    now="$(date +%s)"
    latest_mtime="$(stat -c %Y "${latest_backup}" 2>/dev/null || echo 0)"
    latest_age=$((now - latest_mtime))
    if (( latest_age < MIN_INTERVAL_SECONDS )); then
      echo "[backup-code] skipped service-restart backup; latest is ${latest_age}s old (< ${MIN_INTERVAL_SECONDS}s)"
      exit 0
    fi
  fi
fi

copy_tree() {
  local src="$1"
  local name="$2"
  if [[ -e "${src}" ]]; then
    mkdir -p "${DEST}/${name}"
    cp -a "${src}/." "${DEST}/${name}/"
  fi
}

copy_project_settings() {
  local src="$1"
  local name="$2"
  if [[ ! -d "${src}" ]]; then
    return
  fi

  mkdir -p "${DEST}/${name}"
  (
    cd "${src}"
    find . -type f \( \
      -name '*.json' -o \
      -name '*.jsonl' -o \
      -name '*.yaml' -o \
      -name '*.yml' -o \
      -name '*.toml' -o \
      -name '*.ini' -o \
      -name '*.cfg' -o \
      -name '*.txt' -o \
      -name '*.md' \
    \) -exec sh -c '
      dest="$1"
      shift
      for file do
        mkdir -p "${dest}/$(dirname "${file}")"
        cp -a "${file}" "${dest}/${file}"
      done
    ' sh "${DEST}/${name}" {} +
  )
}

mkdir -p "${DEST}"

# ── source code ───────────────────────────────────────────────────────────────
copy_tree "${ROOT}/backend" "backend"
copy_tree "${ROOT}/frontend" "frontend"
copy_tree "${ROOT}/images" "images"

for file in run.py requirements.txt README.md; do
  if [[ -f "${ROOT}/${file}" ]]; then
    cp -a "${ROOT}/${file}" "${DEST}/${file}"
  fi
done

# ── user data ─────────────────────────────────────────────────────────────────
# SQLite database: users, hashed passwords, encrypted API keys, team data,
# Onshape tokens.  Use the SQLite online-backup API via the .dump command so
# the copy is always consistent even if the service is mid-write.
if [[ -f "${ROOT}/data/render3d.db" ]]; then
  mkdir -p "${DEST}/data"
  sqlite3 "${ROOT}/data/render3d.db" ".backup '${DEST}/data/render3d.db'" 2>/dev/null \
    || cp -a "${ROOT}/data/render3d.db" "${DEST}/data/render3d.db"
fi

# Project settings only.  Generated/imported models like GLB/STEP are large and
# should not be duplicated on every service restart.
copy_project_settings "${ROOT}/projects" "projects"

cat > "${DEST}/backup.meta" <<EOF
timestamp=${STAMP}
reason=${REASON}
host=$(hostname)
user=$(whoami)
EOF

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d | sort | head -n -"${MAX_BACKUPS}" | while read -r old; do
  rm -rf "${old}"
done

echo "[backup-code] saved ${DEST} (keeping last ${MAX_BACKUPS})"
