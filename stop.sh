#!/usr/bin/env bash
# Stop the background desktop launched by ./start.sh.

set -euo pipefail

PID_FILE="/tmp/purroxy-desktop.pid"

if [[ ! -f "$PID_FILE" ]]; then
  # Fall back to name match in case PID file vanished.
  PIDS="$(pgrep -f 'target/release/desktop' || true)"
  if [[ -z "$PIDS" ]]; then
    echo "[stop] no desktop process found."
    exit 0
  fi
  echo "[stop] no PID file; killing matching processes: $PIDS"
  kill $PIDS || true
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  echo "[stop] killing pid $PID"
  kill "$PID"
  for _ in 1 2 3 4 5; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.3
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "[stop] still alive, sending SIGKILL"
    kill -9 "$PID" || true
  fi
else
  echo "[stop] pid $PID not running."
fi

rm -f "$PID_FILE"
echo "[stop] done."
