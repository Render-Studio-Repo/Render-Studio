#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 1; }
python3 - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Render Studio requires Python 3.10 or newer.")
PY

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
fi
mkdir -p data projects
.venv/bin/python scripts/bootstrap_render_instance.py

echo
echo "Render Studio dependencies are installed."
echo "1. Edit $ROOT/.env (at minimum, add an AI provider key if you use AI generation)."
echo "2. Start: $ROOT/.venv/bin/python $ROOT/run.py"
echo "3. Open: http://127.0.0.1:8001/setup.html"
echo "4. Choose storage, name the instance, and decide separately whether to join the marketplace ecosystem or share aggregate health."
