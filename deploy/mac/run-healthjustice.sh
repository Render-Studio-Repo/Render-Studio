#!/bin/bash
# AutoPrep gunicorn :5050 — launchd KeepAlive (no Terminal).
set -u
export HOME="/Users/sam"
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/Users/sam/.local/bin"
export PUBLIC_BASE_URL="https://autoprep.render3d.app"
ROOT="/Users/sam/AutoPrep"
SUPPORT="/Users/sam/Library/Application Support/HealthJustice"
VENV="$SUPPORT/venv311"
LOGDIR="$SUPPORT/logs"
mkdir -p "$LOGDIR"

# Truncate huge logs in-place so a live fd cannot keep filling disk.
for f in "$LOGDIR/healthjustice-app.log" "$LOGDIR/healthjustice-app.err.log" \
         "$HOME/Library/Application Support/Render3D/logs/healthjustice-app.err.log" \
         "$HOME/Library/Application Support/Render3D/logs/health-login-server.log"; do
  if [ -f "$f" ]; then
    sz=$(stat -f%z "$f" 2>/dev/null || echo 0)
    if [ "$sz" -gt 10485760 ]; then
      : > "$f"
    fi
  fi
done

if [[ ! -x "$VENV/bin/gunicorn" ]]; then
  echo "$(date) missing $VENV/bin/gunicorn" >&2
  exit 79
fi

# If another copy (login item) already bound :5050, hold so KeepAlive does
# not spawn a second master. When that process dies, fall through and bind.
if /usr/sbin/lsof -nP -iTCP:5050 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "$(date) 5050 already listening — holding" >>"$LOGDIR/healthjustice-app.log"
  while /usr/sbin/lsof -nP -iTCP:5050 -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 15
  done
  echo "$(date) 5050 dropped — taking over" >>"$LOGDIR/healthjustice-app.log"
fi

cd "$ROOT" || {
  echo "$(date) cannot cd $ROOT (TCC?)" >>"$LOGDIR/healthjustice-app.err.log"
  exit 78
}

echo "$(date) starting gunicorn 3.11 ROOT=$ROOT" >>"$LOGDIR/healthjustice-app.log"
exec "$VENV/bin/gunicorn" -w 2 -b 127.0.0.1:5050 --timeout 120 \
  --pid "$SUPPORT/gunicorn.pid" \
  --access-logfile "$LOGDIR/access.log" \
  --error-logfile "$LOGDIR/healthjustice-app.err.log" \
  wsgi:app
