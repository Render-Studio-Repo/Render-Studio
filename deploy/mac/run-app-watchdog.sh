#!/bin/bash
# Fallback watchdog: if :8001 is down, start launchd app (no Terminal).
# Never kill a Python that is still importing — that is what caused Cloudflare 502s.
set -u
export HOME="/Users/sam"
APP_SUPPORT="$HOME/Library/Application Support/Render3D"
LOG="$APP_SUPPORT/logs/watchdog.log"
PLIST="$HOME/Library/LaunchAgents/com.render3d.app.plist"
mkdir -p "$APP_SUPPORT/logs"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
LABEL="${DOMAIN}/com.render3d.app"
FAILS=0
NEED=8
IMPORT_DEFER=0
IMPORT_LIMIT=18

up() {
  curl -sf --max-time 15 "http://127.0.0.1:8001/api/health" >/dev/null 2>&1
}

listening() {
  /usr/sbin/lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1
}

uvicorn_running() {
  /bin/ps -axo command= | /usr/bin/grep -q '[P]ython.*uvicorn backend.main:app'
}

supervisor_running() {
  /bin/ps -axo command= | /usr/bin/grep -q '[r]un-uvicorn.sh'
}

ROOT="/Users/sam/Render-Studio"
RESTORE="$ROOT/scripts/mac-restore-missing.sh"
SNAPSHOT="$ROOT/scripts/mac-snapshot-code.sh"
SNAP_EVERY=40
SNAP_I=0

restore_missing_code() {
  [[ -x "$RESTORE" ]] || return 0
  if [[ -s "$ROOT/frontend/index.html" && -s "$ROOT/frontend/studio/app.js" && -s "$ROOT/backend/main.py" ]]; then
    return 0
  fi
  echo "$(date) critical code missing — restore-missing" >>"$LOG"
  /bin/bash "$RESTORE" >>"$LOG" 2>&1 || true
}

maybe_snapshot() {
  SNAP_I=$((SNAP_I + 1))
  if [ "$SNAP_I" -lt "$SNAP_EVERY" ]; then
    return 0
  fi
  SNAP_I=0
  [[ -x "$SNAPSHOT" ]] || return 0
  /bin/bash "$SNAPSHOT" watchdog >>"$LOG" 2>&1 || true
}

reap_runaway_search() {
  /bin/ps -axo rss,pid,comm | /usr/bin/awk '
    BEGIN { limit = 400 * 1024 }
    $3 == "rg" || $3 == "ripgrep" {
      if ($1 + 0 >= limit) print $2, $1, $3
    }
  ' | while read -r pid rss comm; do
    echo "$(date) SIGKILL runaway $comm pid=$pid rss_kb=$rss" >>"$LOG"
    /bin/kill -9 "$pid" 2>>"$LOG" || true
  done
}

echo "$(date) watchdog start pid=$$ (launchctl, no Terminal)" >>"$LOG"
while true; do
  restore_missing_code
  reap_runaway_search
  if up; then
    FAILS=0
    IMPORT_DEFER=0
    maybe_snapshot
    sleep 15
    continue
  fi
  FAILS=$((FAILS + 1))
  echo "$(date) health miss $FAILS/$NEED" >>"$LOG"
  if listening; then
    # A wedged uvicorn process can keep its listener open while the event loop
    # no longer serves requests.  Give transient stalls time to recover, but
    # do not reset the consecutive failure count merely because the port exists.
    if [ "$FAILS" -lt "$NEED" ]; then
      echo "$(date) 8001 listening but unhealthy — defer kickstart $FAILS/$NEED" >>"$LOG"
      sleep 5
      continue
    fi
    echo "$(date) 8001 listening but health failed $FAILS times — kickstart $LABEL" >>"$LOG"
  else
    if uvicorn_running || supervisor_running; then
      IMPORT_DEFER=$((IMPORT_DEFER + 1))
      echo "$(date) uvicorn importing — defer kickstart $IMPORT_DEFER/$IMPORT_LIMIT" >>"$LOG"
      if [ "$IMPORT_DEFER" -lt "$IMPORT_LIMIT" ]; then
        sleep 20
        continue
      fi
      echo "$(date) import stuck >6min — kickstart $LABEL" >>"$LOG"
    else
      IMPORT_DEFER=0
      if [ "$FAILS" -lt "$NEED" ]; then
        sleep 5
        continue
      fi
      echo "$(date) health down and nothing listening — kickstart $LABEL" >>"$LOG"
    fi
  fi
  FAILS=0
  IMPORT_DEFER=0
  /bin/launchctl kickstart "$LABEL" 2>>"$LOG" || {
    /bin/launchctl bootstrap "$DOMAIN" "$PLIST" 2>>"$LOG" || true
    /bin/launchctl kickstart "$LABEL" 2>>"$LOG" || true
  }
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
    sleep 5
    if up; then
      echo "$(date) health ok" >>"$LOG"
      break
    fi
  done
  sleep 10
done
