#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
printf '\033]0;Render Studio Installer\007'
echo "Render Studio installer"
echo "======================="
bash scripts/install-render-studio.sh
echo
echo "Starting Render Studio..."
(sleep 3; open "http://127.0.0.1:8001/setup.html") &
exec "$ROOT/.venv/bin/python" "$ROOT/run.py"
