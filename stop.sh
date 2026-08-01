#!/usr/bin/env bash
# Stop the golf_api explorer started by start.sh.
set -euo pipefail
cd "$(dirname "$0")"

PID_FILE=".server.pid"
PORT="${PORT:-8600}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "Stopped pid $PID."
  else
    echo "No live process for pid $PID."
  fi
  rm -f "$PID_FILE"
else
  # Fallback: whatever is bound to the port.
  PID="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
  if [[ -n "$PID" ]]; then
    kill $PID && echo "Stopped process on port $PORT (pid $PID)."
  else
    echo "Nothing to stop."
  fi
fi
