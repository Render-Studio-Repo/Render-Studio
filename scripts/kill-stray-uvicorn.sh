#!/usr/bin/env bash
# Kill stray uvicorn dev servers for Render3D.
# Production runs only via render3d.service on port 8001.
#
# Usage:
#   kill-stray-uvicorn.sh pre-start   # before render3d starts: clear everything
#   kill-stray-uvicorn.sh guard       # periodic: kill strays, keep production MainPID
set -euo pipefail

PROD_PORT=8001
DEV_PORTS=(8000)
APP_PATTERN='uvicorn backend.main:app'
MODE="${1:-guard}"

log() {
  echo "[kill-stray-uvicorn] $*"
}

render3d_main_pid() {
  local pid
  pid="$(systemctl show render3d.service -p MainPID --value 2>/dev/null || echo 0)"
  if [[ -z "$pid" || "$pid" == "0" ]]; then
    echo 0
    return
  fi
  echo "$pid"
}

is_protected_pid() {
  local pid="$1"
  local main_pid="$2"
  [[ "$main_pid" == "0" ]] && return 1
  [[ "$pid" == "$main_pid" ]] && return 0
  local ppid
  ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  [[ -n "$ppid" && "$ppid" == "$main_pid" ]] && return 0
  return 1
}

pids_on_port() {
  local port="$1"
  ss -tlnp "sport = :${port}" 2>/dev/null \
    | grep -oE 'pid=[0-9]+' \
    | cut -d= -f2 \
    | sort -un || true
}

collect_pids() {
  local main_pid="$1"
  local -A seen=()
  local pid port

  while read -r pid; do
    [[ -z "$pid" ]] && continue
    if [[ "$MODE" == "pre-start" ]] || ! is_protected_pid "$pid" "$main_pid"; then
      seen["$pid"]=1
    fi
  done < <(pgrep -f "$APP_PATTERN" 2>/dev/null || true)

  while read -r pid; do
    [[ -z "$pid" ]] && continue
    if [[ "$MODE" == "pre-start" ]] || ! is_protected_pid "$pid" "$main_pid"; then
      seen["$pid"]=1
    fi
  done < <(pgrep -f 'uvicorn.*--reload' 2>/dev/null || true)

  for port in "${DEV_PORTS[@]}"; do
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      if [[ "$MODE" == "pre-start" ]] || ! is_protected_pid "$pid" "$main_pid"; then
        seen["$pid"]=1
      fi
    done < <(pids_on_port "$port")
  done

  # Orphaned uvicorn --reload worker processes (no longer tied to a live parent).
  while read -r pid; do
    [[ -z "$pid" ]] && continue
    local ppid
    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    if [[ -z "$ppid" || "$ppid" == "1" ]]; then
      seen["$pid"]=1
    fi
  done < <(pgrep -f 'multiprocessing.spawn import spawn_main' 2>/dev/null || true)

  if [[ "$MODE" == "pre-start" ]]; then
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      seen["$pid"]=1
    done < <(pids_on_port "$PROD_PORT")
  fi

  if ((${#seen[@]} == 0)); then
    return 0
  fi
  printf '%s\n' "${!seen[@]}" | sort -un
}

terminate_pids() {
  local -a pids=("$@")
  local pid cmd

  for pid in "${pids[@]}"; do
    cmd="$(ps -o args= -p "$pid" 2>/dev/null | head -c 120 || echo "?")"
    log "SIGTERM pid=${pid} (${cmd})"
    kill -TERM "$pid" 2>/dev/null || true
  done

  local deadline=$((SECONDS + 8))
  while (( SECONDS < deadline )); do
    local alive=0
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
        break
      fi
    done
    (( alive == 0 )) && return 0
    sleep 0.5
  done

  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      cmd="$(ps -o args= -p "$pid" 2>/dev/null | head -c 120 || echo "?")"
      log "SIGKILL pid=${pid} (${cmd})"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

main() {
  if [[ "$MODE" != "pre-start" && "$MODE" != "guard" ]]; then
    echo "Usage: $0 {pre-start|guard}" >&2
    exit 2
  fi

  local main_pid
  main_pid="$(render3d_main_pid)"
  mapfile -t targets < <(collect_pids "$main_pid" || true)

  if ((${#targets[@]} == 0)); then
    log "${MODE}: no stray uvicorn processes found"
    exit 0
  fi

  log "${MODE}: terminating ${#targets[@]} stray process(es)"
  terminate_pids "${targets[@]}"
  log "${MODE}: done"
}

main "$@"
