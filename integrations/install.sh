#!/usr/bin/env bash
# Portable bootstrap for integrations/ — resolves repo root from this script.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export RENDER_STUDIO_ROOT="${RENDER_STUDIO_ROOT:-$ROOT}"
export INTEGRATIONS_ROOT="${INTEGRATIONS_ROOT:-$ROOT/integrations}"
cd "$ROOT"
exec python3 "$ROOT/integrations/install.py" "$@"
