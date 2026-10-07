#!/bin/bash
# Hourly Recent Updates sync. Static files only — does not restart Studio.
set -euo pipefail
ROOT="${RENDER3D_ROOT:-/Users/sam/Render-Studio}"
cd "${ROOT}"
if [[ -x "${ROOT}/.venv/bin/python3" ]]; then
  PY="${ROOT}/.venv/bin/python3"
elif [[ -x "${ROOT}/.venv/bin/python" ]]; then
  PY="${ROOT}/.venv/bin/python"
else
  PY="python3"
fi
exec "${PY}" "${ROOT}/scripts/scan-milestones.py" --skip-social
