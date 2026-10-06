#!/bin/bash
# Grok bot MCP supervisor — launchd KeepAlive is the backstop.
# HTTP on 127.0.0.1:8744 so the process stays up (stdio would exit on closed stdin).
set -u
export HOME="/Users/sam"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="/Users/sam/Render-Studio"
LOGDIR="$HOME/Library/Application Support/Render3D/logs"
LOGIN_LOG="$LOGDIR/grok-bot.log"
PORT="${GROK_MCP_PORT:-8744}"
HOST="${GROK_MCP_HOST:-127.0.0.1}"
mkdir -p "$LOGDIR"

for f in "$LOGDIR/grok-bot.log" "$LOGDIR/grok-bot.err.log"; do
  if [ -f "$f" ]; then
    sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
    if [ "$sz" -gt 10485760 ]; then
      : > "$f"
    fi
  fi
done

unset VIRTUAL_ENV || true
export PYTHONHOME=""
export PYTHONPATH="$ROOT"
export GROK_MCP_HTTP=1
export GROK_MCP_HOST="$HOST"
export GROK_MCP_PORT="$PORT"

cd "$ROOT" || {
  echo "$(date) cannot cd $ROOT" >>"$LOGDIR/grok-bot.err.log"
  exit 78
}

listening() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

child=""
stop_child() {
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null || true
    sleep 2
    kill -KILL "$child" 2>/dev/null || true
  fi
  child=""
}

on_signal() {
  echo "$(date) grok-bot supervisor received signal — stopping" >>"$LOGIN_LOG"
  stop_child
  exit 0
}
trap on_signal TERM INT HUP

while true; do
  if listening; then
    echo "$(date) $PORT already listening — supervisor holding" >>"$LOGIN_LOG"
    while listening; do
      sleep 8
    done
    echo "$(date) $PORT dropped — starting grok-bot MCP" >>"$LOGIN_LOG"
  fi
  echo "$(date) starting grok-bot HTTP MCP ROOT=$ROOT" >>"$LOGIN_LOG"
  PYTHON="$ROOT/.venv/bin/python"
  if [ ! -x "$PYTHON" ]; then
    PYTHON="/usr/bin/python3"
  fi
  "$PYTHON" "$ROOT/mcp/grok-bot/server.py" --http --host "$HOST" --port "$PORT" &
  child=$!
  wait "$child"
  code=$?
  child=""
  echo "$(date) grok-bot exited code=$code — restart in 2s" >>"$LOGIN_LOG"
  sleep 2
done
