#!/bin/sh
# Apply migrations, then run the API (single worker: the login rate limiter is in-process).
set -eu
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 \
  --proxy-headers --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
  --no-server-header --no-access-log
