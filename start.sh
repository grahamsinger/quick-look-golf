#!/usr/bin/env bash
# Start the golf_api explorer (FastAPI + uvicorn) in the background.
set -euo pipefail
cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8600}"   # 8600 to avoid the marathon_training app on :8000
PID_FILE=".server.pid"
LOG_FILE="server.log"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Already running (pid $(cat "$PID_FILE")) — http://$HOST:$PORT"
  exit 0
fi

echo "Starting golf_api on http://$HOST:$PORT ..."
# `python -m uvicorn` puts the cwd on sys.path so `pga.server` imports cleanly.
uv run python -m uvicorn pga.server:app --host "$HOST" --port "$PORT" \
  > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait briefly for it to come up.
for _ in $(seq 1 20); do
  if curl -sf "http://$HOST:$PORT/api/schedule?year=2026" >/dev/null 2>&1; then
    echo "Ready:"
    echo "  Shot Explorer : http://$HOST:$PORT/"
    echo "  GraphiQL      : http://$HOST:$PORT/graphiql"
    echo "  REST docs     : http://$HOST:$PORT/docs"
    echo "  logs          : tail -f $LOG_FILE   ·   stop: ./stop.sh"
    exit 0
  fi
  sleep 0.5
done

echo "Server did not respond in time — check $LOG_FILE" >&2
exit 1
