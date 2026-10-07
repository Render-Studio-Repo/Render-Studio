#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.render3d.img2threejs-update"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
mkdir -p "${HOME}/Library/LaunchAgents" "${ROOT}/data/img2threejs-updates"

sed \
  -e "s#__ROOT__#${ROOT}#g" \
  -e "s#__LABEL__#${LABEL}#g" \
  "${ROOT}/scripts/launchd/img2threejs-update.plist.template" >"${PLIST}"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST}"
launchctl enable "gui/$(id -u)/${LABEL}"
echo "Installed ${LABEL}; patch-only updates run daily through the full test gate."
