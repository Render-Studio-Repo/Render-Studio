#!/bin/bash
# Render Studio uvicorn supervisor — launchd KeepAlive is the backstop.
# Restarts uvicorn on crash without waiting for kickstart (avoids 502).
# App lives at ~/Render-Studio (outside Documents) so launchd is not TCC-blocked.
set -u
export HOME="/Users/sam"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="/Users/sam/Render-Studio"
LOGDIR="$HOME/Library/Application Support/Render3D/logs"
LOGIN_LOG="$LOGDIR/login-server.log"
STORAGE_LAUNCHER="$HOME/Library/Application Support/Render3D/Render3DStorageLauncher.app/Contents/MacOS/Render3DStorageLauncher"
mkdir -p "$LOGDIR"

if [ -z "${RENDER3D_NODE:-}" ]; then
  for candidate in \
    "$HOME/Library/Application Support/Render3D/node/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.local/bin/node"
  do
    if [ -x "$candidate" ]; then
      export RENDER3D_NODE="$candidate"
      break
    fi
  done
fi
if [ -z "${RENDER3D_NODE:-}" ] && [ -d "$HOME/.cursor-server/bin" ]; then
  newest="$(ls -t "$HOME"/.cursor-server/bin/darwin-*/*/node 2>/dev/null | head -1 || true)"
  if [ -n "$newest" ] && [ -x "$newest" ]; then
    export RENDER3D_NODE="$newest"
  fi
fi

for f in "$LOGDIR/render3d-app.log" "$LOGDIR/render3d-app.err.log" \
         "$LOGDIR/login-server.log" "$LOGDIR/caddy-user.err.log"; do
  if [ -f "$f" ]; then
    sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
    if [ "$sz" -gt 10485760 ]; then
      : > "$f"
    fi
  fi
done

unset VIRTUAL_ENV || true
export PYTHONHOME=""
export PYTHONPATH="$ROOT:$ROOT/.venv/lib/python3.9/site-packages"

cd "$ROOT" || {
  echo "$(date) cannot cd $ROOT" >>"$LOGDIR/render3d-app.err.log"
  exit 78
}

listening() {
  /usr/sbin/lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1
}

child=""
stop_child() {
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null || true
    sleep 2
    kill -KILL "$child" 2>/dev/null || true
  fi
  # The storage helper launches uvicorn as its own child. Stop that exact port
  # owner as well so launchd restarts cannot leave an orphan backend behind.
  backend_pid="$(/usr/sbin/lsof -tiTCP:8001 -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  if [ -n "$backend_pid" ]; then
    kill -TERM "$backend_pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$backend_pid" 2>/dev/null || true
  fi
  child=""
}

on_signal() {
  echo "$(date) supervisor received signal — stopping uvicorn" >>"$LOGIN_LOG"
  stop_child
  exit 0
}
trap on_signal TERM INT HUP

while true; do
  if listening; then
    echo "$(date) 8001 already listening — supervisor holding (no second uvicorn)" >>"$LOGIN_LOG"
    while listening; do
      sleep 8
    done
    echo "$(date) 8001 dropped — starting uvicorn" >>"$LOGIN_LOG"
  fi
  if [ -x "$STORAGE_LAUNCHER" ] && [ -L "$ROOT/projects" ]; then
    echo "$(date) starting authorized storage launcher ROOT=$ROOT" >>"$LOGIN_LOG"
    "$STORAGE_LAUNCHER" &
  else
    echo "$(date) starting uvicorn ROOT=$ROOT" >>"$LOGIN_LOG"
    /usr/bin/python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 &
  fi
  child=$!
  wait "$child"
  code=$?
  child=""
  echo "$(date) uvicorn exited code=$code — restart in 2s" >>"$LOGIN_LOG"
  sleep 2
done
