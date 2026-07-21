#!/usr/bin/env bash
# Graceful Render3D reload: wait for live generations (optional), then restart
# with a long drain window so uvicorn workers can finish CAD jobs instead of
# getting SIGKILL after ~8–15s.
#
# Usage:
#   scripts/graceful-reload-render3d.sh           # wait up to drain budget, then restart
#   scripts/graceful-reload-render3d.sh --force   # restart now (still drains up to TimeoutStopSec)
#   scripts/graceful-reload-render3d.sh --status  # show live generations only
set -euo pipefail

ROOT="/home/ubuntu"
PY="${ROOT}/.venv/bin/python3"
SERVICE="render3d.service"
# Match systemd TimeoutStopSec / uvicorn --timeout-graceful-shutdown (seconds).
DRAIN_SEC="${RENDER3D_SHUTDOWN_DRAIN_SEC:-3600}"
FORCE=0
STATUS_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    --status|-s) STATUS_ONLY=1 ;;
    --help|-h)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

live_jobs_json() {
  "${PY}" - <<'PY'
from pathlib import Path
from backend.services.generation_service import count_all_live_running_jobs
jobs = count_all_live_running_jobs(Path("/home/ubuntu/projects"))
for j in jobs:
    print(
        f"{j.get('project_id')}\t{j.get('trace_id')}\t{j.get('model') or '-'}\t"
        f"pid={j.get('worker_pid')}\t{(j.get('prompt') or '')[:60]}"
    )
print(f"COUNT={len(jobs)}")
PY
}

echo "[graceful-reload] drain budget ${DRAIN_SEC}s"
mapfile -t LINES < <(live_jobs_json)
COUNT_LINE="${LINES[-1]}"
COUNT="${COUNT_LINE#COUNT=}"
JOB_LINES=("${LINES[@]:0:${#LINES[@]}-1}")

if [[ "${#JOB_LINES[@]}" -gt 0 && "${COUNT}" != "0" ]]; then
  echo "[graceful-reload] live generations:"
  printf '  %s\n' "${JOB_LINES[@]}"
else
  echo "[graceful-reload] no live generations"
  COUNT=0
fi

if [[ "$STATUS_ONLY" -eq 1 ]]; then
  exit 0
fi

if [[ "$COUNT" -gt 0 && "$FORCE" -eq 0 ]]; then
  echo "[graceful-reload] waiting for jobs to finish (max ${DRAIN_SEC}s); use --force to restart sooner"
  deadline=$((SECONDS + DRAIN_SEC))
  while (( SECONDS < deadline )); do
    mapfile -t LINES < <(live_jobs_json)
    COUNT_LINE="${LINES[-1]}"
    COUNT="${COUNT_LINE#COUNT=}"
    if [[ "$COUNT" == "0" ]]; then
      echo "[graceful-reload] all generations finished"
      break
    fi
    echo "[graceful-reload] still ${COUNT} live — waiting…"
    sleep 10
  done
fi

export RENDER3D_SHUTDOWN_DRAIN_SEC="$DRAIN_SEC"
echo "[graceful-reload] systemctl restart ${SERVICE}"
sudo systemctl restart "${SERVICE}"
sleep 2
systemctl is-active "${SERVICE}"
curl -s -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8001/health || true
