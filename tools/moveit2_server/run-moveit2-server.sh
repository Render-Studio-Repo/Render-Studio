#!/usr/bin/env bash
# Compatibility wrapper — canonical scripts live in integrations/moveit2/
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "${ROOT}/integrations/moveit2/run-moveit2-server.sh" "$@"
