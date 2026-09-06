#!/bin/sh
set -eu

if [ "${EMBEDDED_REDIS:-}" != "true" ]; then
  exec node apps/api/dist/index.js
fi

# The API talks to the server started below, not to whatever the environment says.
export REDIS_URL=redis://127.0.0.1:6379

redis-server \
  --appendonly yes \
  --appendfsync everysec \
  --dir /data \
  --bind 127.0.0.1 \
  --port 6379 &
redis_pid=$!

# The API exits at startup when Redis is unreachable, so it cannot go first.
waited=0
until redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; do
  if ! kill -0 "$redis_pid" 2>/dev/null; then
    echo "redis-server exited before accepting connections" >&2
    exit 1
  fi
  if [ "$waited" -ge 30 ]; then
    echo "redis-server did not accept connections within 30s" >&2
    exit 1
  fi
  waited=$((waited + 1))
  sleep 1
done

node apps/api/dist/index.js &
api_pid=$!

# The API flushes checkpoints on SIGTERM and needs Redis alive while it does.
stop_children() {
  kill -TERM "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  kill -TERM "$redis_pid" 2>/dev/null || true
  wait "$redis_pid" 2>/dev/null || true
}

trap 'trap - TERM INT; stop_children; exit 0' TERM INT

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$redis_pid" 2>/dev/null; do
  sleep 1
done

# A zero exit would read as a finished job, so Fly would not restart the machine.
echo "api or redis-server exited on its own; stopping the machine" >&2
stop_children
exit 1
