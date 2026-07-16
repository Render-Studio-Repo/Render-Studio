#!/usr/bin/env bash
# Cleanup stale Render3D helper processes that can starve the small production VM.
#
# This is intentionally conservative: it only targets old headless Chromium /
# Chrome diagnostic sessions using temp profiles or remote debugging. It does not
# kill normal desktop/browser processes.
set -euo pipefail

MODE="${1:-guard}"
MAX_AGE_SECONDS="${RENDER3D_STALE_HEADLESS_CHROME_SECONDS:-900}"

log() {
  echo "[cleanup-stale-render3d] $*"
}

usage() {
  echo "Usage: $0 {guard|pre-start}" >&2
}

if [[ "$MODE" != "guard" && "$MODE" != "pre-start" ]]; then
  usage
  exit 2
fi

is_stale_headless_chrome() {
  local etimes="$1"
  local args="$2"

  [[ "$etimes" =~ ^[0-9]+$ ]] || return 1
  (( etimes >= MAX_AGE_SECONDS )) || return 1

  # Cursor/browser diagnostics use headless Chromium with temp profiles and/or
  # remote debugging. These are safe to reap when old; regular user browsers are
  # not matched.
  if [[ "$args" == *"--headless"* && "$args" == *"/tmp/org.chromium."* ]]; then
    return 0
  fi
  if [[ "$args" == *"--headless"* && "$args" == *"--remote-debugging-port="* ]]; then
    return 0
  fi
  if [[ "$args" == *"chromium-browser"* && "$args" == *"--type=gpu-process"* && "$args" == *"--headless"* ]]; then
    return 0
  fi
  return 1
}

collect_targets() {
  ps -eo pid=,etimes=,stat=,pcpu=,args= | while read -r pid etimes stat pcpu args; do
    [[ -n "${pid:-}" && -n "${args:-}" ]] || continue
    case "$args" in
      *chromium*|*chrome*) ;;
      *) continue ;;
    esac
    if is_stale_headless_chrome "$etimes" "$args"; then
      printf '%s\n' "$pid"
    fi
  done | sort -un
}

terminate_pids() {
  local -a pids=("$@")
  local pid args

  for pid in "${pids[@]}"; do
    args="$(ps -o args= -p "$pid" 2>/dev/null | cut -c1-180 || echo "?")"
    log "SIGTERM stale headless Chromium pid=${pid} (${args})"
    kill -TERM "$pid" 2>/dev/null || true
  done

  local deadline=$((SECONDS + 5))
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
      args="$(ps -o args= -p "$pid" 2>/dev/null | cut -c1-180 || echo "?")"
      log "SIGKILL stale headless Chromium pid=${pid} (${args})"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}

main() {
  mapfile -t targets < <(collect_targets || true)
  if ((${#targets[@]} == 0)); then
    log "${MODE}: no stale headless Chromium processes found"
    exit 0
  fi
  log "${MODE}: terminating ${#targets[@]} stale process(es)"
  terminate_pids "${targets[@]}"
  log "${MODE}: done"
}

main "$@"
