#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if [[ ! -x .venv/bin/python ]]; then
  echo "Render Studio is not installed yet. Running the installer..."
  exec "$ROOT/Install Render Studio.command"
fi
(sleep 2; open "http://127.0.0.1:8001/") &
exec "$ROOT/.venv/bin/python" "$ROOT/run.py"
