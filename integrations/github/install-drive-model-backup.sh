#!/usr/bin/env bash
# Opt-in installer for 3D model backups → Google Drive.
# Reuses scripts/backup-daily.sh + scripts/backup-to-drive.py (no parallel system).
#
# Usage:
#   bash integrations/github/install-drive-model-backup.sh           # copy units
#   bash integrations/github/install-drive-model-backup.sh --enable  # enable timer
#   bash integrations/github/install-drive-model-backup.sh --auth    # run OAuth once
#   bash integrations/github/install-drive-model-backup.sh --help
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${RENDER_STUDIO_ROOT:-$(cd "${HERE}/../.." && pwd)}"
UNIT_SRC="${HERE}/systemd"
SECRET_ENV="${ROOT}/data/server-config/secrets/google-drive/secret.env"

ENABLE=0
DO_AUTH=0
USER_MODE=0
SCOPE_ARGS=(--system)
UNIT_DIR="/etc/systemd/system"

usage() {
  cat <<EOF
Set up 3D model backup to Google Drive (opt-in; code backups stay on GitHub).

Prereqs (gitignored secrets):
  data/server-config/secrets/google-drive/secret.env
    GOOGLE_DRIVE_CLIENT_ID=
    GOOGLE_DRIVE_CLIENT_SECRET=
    GOOGLE_DRIVE_REFRESH_TOKEN=   # filled by --auth

Or export GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET and run --auth.

  --auth     run scripts/backup-to-drive.py --auth (browser / local server once)
  --enable   systemctl enable --now the daily timer
  --user     systemd --user units
  --help

Repo root: ${ROOT}
EOF
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --enable) ENABLE=1 ;;
    --auth) DO_AUTH=1 ;;
    --user) USER_MODE=1; SCOPE_ARGS=(--user); UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user" ;;
  esac
done

export RENDER_STUDIO_ROOT="${ROOT}"

# Load vault secrets into env when present
if [[ -f "${SECRET_ENV}" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      GOOGLE_DRIVE_CLIENT_ID=*)
        export GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-${line#GOOGLE_DRIVE_CLIENT_ID=}}"
        ;;
      GOOGLE_DRIVE_CLIENT_SECRET=*)
        export GOOGLE_OAUTH_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET:-${line#GOOGLE_DRIVE_CLIENT_SECRET=}}"
        ;;
      GOOGLE_CLIENT_ID=*)
        export GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-${line#GOOGLE_CLIENT_ID=}}"
        ;;
      GOOGLE_CLIENT_SECRET=*)
        export GOOGLE_OAUTH_CLIENT_SECRET="${GOOGLE_OAUTH_CLIENT_SECRET:-${line#GOOGLE_CLIENT_SECRET=}}"
        ;;
    esac
  done < "${SECRET_ENV}"
fi

if [[ -x "${ROOT}/.venv/bin/python3" ]]; then
  PY="${ROOT}/.venv/bin/python3"
elif [[ -x "${ROOT}/.venv/bin/python" ]]; then
  PY="${ROOT}/.venv/bin/python"
else
  PY="python3"
fi

if [[ "${DO_AUTH}" == "1" ]]; then
  echo "[install-drive-model-backup] Running one-time Google Drive OAuth…"
  "${PY}" "${ROOT}/scripts/backup-to-drive.py" --auth
fi

mkdir -p "${UNIT_DIR}"
SVC_OUT="${UNIT_DIR}/render-studio-drive-models.service"
TIMER_OUT="${UNIT_DIR}/render-studio-drive-models.timer"

sed -e "s|/REPLACE_WITH_RENDER_STUDIO_ROOT|${ROOT}|g" \
  "${UNIT_SRC}/render-studio-drive-models.service" > "${SVC_OUT}"
cp "${UNIT_SRC}/render-studio-drive-models.timer" "${TIMER_OUT}"

echo "[install-drive-model-backup] Wrote ${SVC_OUT}"
echo "[install-drive-model-backup] Wrote ${TIMER_OUT}"
echo "[install-drive-model-backup] Models use scripts/backup-to-drive.py (projects/ only)."
echo "[install-drive-model-backup] Docs: integrations/github/README.md + instructions/server/SECRETS-VAULT.md"

if [[ "${ENABLE}" == "1" ]]; then
  systemctl "${SCOPE_ARGS[@]}" daemon-reload
  systemctl "${SCOPE_ARGS[@]}" enable --now render-studio-drive-models.timer
  systemctl "${SCOPE_ARGS[@]}" status render-studio-drive-models.timer --no-pager || true
else
  echo "[install-drive-model-backup] Units copied only. To enable:"
  if [[ "${USER_MODE}" == "1" ]]; then
    echo "  systemctl --user daemon-reload && systemctl --user enable --now render-studio-drive-models.timer"
  else
    echo "  sudo systemctl daemon-reload && sudo systemctl enable --now render-studio-drive-models.timer"
  fi
fi
