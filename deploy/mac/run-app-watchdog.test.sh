#!/bin/bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/run-app-watchdog.sh"

bash -n "$SCRIPT"

listener_branch="$({
  awk '
    /if listening; then/ { capture=1 }
    capture { print }
    capture && /if uvicorn_running \|\| supervisor_running; then/ { exit }
  ' "$SCRIPT"
})"

grep -q 'if \[ "$FAILS" -lt "$NEED" \]' <<<"$listener_branch"
grep -q 'kickstart $LABEL' <<<"$listener_branch"
if grep -q 'FAILS=0' <<<"$listener_branch"; then
  echo "listener-health branch must not reset consecutive failures" >&2
  exit 1
fi

echo "watchdog hung-listener contract ok"
