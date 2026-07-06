#!/usr/bin/env bash
# Lightweight service startup hook.
# Keep one lightweight source snapshot. Older timestamped backups are pruned to
# prevent model/code backup bloat on the small root volume.
set -euo pipefail
ROOT="/home/ubuntu"
BACKUP_ROOT="${ROOT}/backups"
label="${1:-manual}"
snapshot="${BACKUP_ROOT}/latest"
tmp="${BACKUP_ROOT}/.latest.tmp"

mkdir -p "${BACKUP_ROOT}"
rm -rf "${tmp}"
mkdir -p "${tmp}"

copy_dir() {
  local name="$1"
  if [[ -d "${ROOT}/${name}" ]]; then
    mkdir -p "${tmp}/${name}"
    cp -a "${ROOT}/${name}/." "${tmp}/${name}/"
  fi
}

copy_dir backend
copy_dir frontend
copy_dir scripts
copy_dir services
copy_dir data
if [[ -f "${ROOT}/.env" ]]; then
  cp -a "${ROOT}/.env" "${tmp}/.env"
fi

printf '%s\n' "${label}" > "${tmp}/BACKUP_LABEL"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "${tmp}/BACKUP_CREATED_UTC"

rm -rf "${snapshot}"
mv "${tmp}" "${snapshot}"

# Keep only the single canonical snapshot.
for path in "${BACKUP_ROOT}"/*; do
  [[ "${path}" == "${snapshot}" ]] && continue
  rm -rf "${path}"
done

echo "[backup-code] wrote ${snapshot} (${label})"
