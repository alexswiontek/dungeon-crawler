#!/bin/sh
set -eu

if [ -z "${REDIS_PASSWORD:-}" ]; then
  echo "REDIS_PASSWORD is required" >&2
  exit 1
fi

exec redis-server --appendonly yes --appendfsync everysec --dir /data --requirepass "$REDIS_PASSWORD"
