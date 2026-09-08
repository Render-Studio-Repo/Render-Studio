#!/usr/bin/env bash
# Install (or refresh) the GitHub source-backup systemd user/system timer.
#
# Portable: resolve repo root from this script or RENDER_STUDIO_ROOT.
# Does NOT enable units on a live host unless --enable is passed.
#
# Usage:
#   bash integrations/github/install-backup-timer.sh           # copy units only
#   bash integrations/github/install-backup-timer.sh --enable  # copy + enable --now
#   bash integrations/github/install-backup-timer.sh --user    # systemd --user
#   bash integrations/github/install-backup-timer.sh --help
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${RENDER_STUDIO_ROOT:-$(cd "${HERE}/../.." && pwd)}"
UNIT_SRC="${HERE}/systemd"
CONFIG="${ROOT}/data/server-config/github-backup.json"

ENABLE=0
USER_MODE=0
SCOPE_ARGS=(--system)
UNIT_DIR="/etc/systemd/system"

usage() {
  cat <<EOF
Install Render Studio GitHub backup timer units.

  --enable   systemctl enable --now the timer after installing
  --user     install to systemd --user (\$XDG_CONFIG_HOME/systemd/user)
  --help     show this help

Repo root: ${ROOT}
Templates: ${UNIT_SRC}
EOF
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --enable) ENABLE=1 ;;
    --user) USER_MODE=1; SCOPE_ARGS=(--user); UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user" ;;
  esac
done

export RENDER_STUDIO_ROOT="${ROOT}"

INTERVAL="daily"
if [[ -f "${CONFIG}" ]]; then
  INTERVAL="$(python3 - "${CONFIG}" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8")).get("interval") or "daily")
except Exception:
    print("daily")
PY
)"
fi
case "${INTERVAL}" in
  hourly|daily|monthly) ;;
  *) INTERVAL="daily" ;;
esac

mkdir -p "${UNIT_DIR}"
SVC_OUT="${UNIT_DIR}/render-studio-github-backup.service"
TIMER_OUT="${UNIT_DIR}/render-studio-github-backup.timer"

sed -e "s|/REPLACE_WITH_RENDER_STUDIO_ROOT|${ROOT}|g" \
  "${UNIT_SRC}/render-studio-github-backup.service" > "${SVC_OUT}"

sed \
  -e "s|^OnCalendar=.*|OnCalendar=${INTERVAL}|g" \
  "${UNIT_SRC}/render-studio-github-backup.timer" > "${TIMER_OUT}"

echo "[install-backup-timer] Wrote ${SVC_OUT}"
echo "[install-backup-timer] Wrote ${TIMER_OUT} (OnCalendar=${INTERVAL})"
echo "[install-backup-timer] RENDER_STUDIO_ROOT=${ROOT}"

if [[ "${ENABLE}" == "1" ]]; then
  systemctl "${SCOPE_ARGS[@]}" daemon-reload
  systemctl "${SCOPE_ARGS[@]}" enable --now render-studio-github-backup.timer
  systemctl "${SCOPE_ARGS[@]}" status render-studio-github-backup.timer --no-pager || true
  echo "[install-backup-timer] Enabled timer."
else
  echo "[install-backup-timer] Units copied only. To enable:"
  if [[ "${USER_MODE}" == "1" ]]; then
    echo "  systemctl --user daemon-reload"
    echo "  systemctl --user enable --now render-studio-github-backup.timer"
  else
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl enable --now render-studio-github-backup.timer"
  fi
fi
