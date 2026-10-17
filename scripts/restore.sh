#!/usr/bin/env bash
# Restore a backup produced by scripts/backup.sh. DESTRUCTIVE: replaces objects in the target DB.
# Usage: scripts/restore.sh backups/fos_YYYYmmddTHHMMSSZ.dump        (DATABASE_URL or PG* env)
#        COMPOSE=1 scripts/restore.sh backups/fos_....dump           (into the compose "db" service)
set -euo pipefail
FILE="${1:?usage: restore.sh <dump-file>}"
[[ -f "$FILE.sha256" ]] && sha256sum -c "$FILE.sha256"
read -r -p "Restore $FILE and OVERWRITE the target database? type 'yes': " ok
[[ "$ok" == "yes" ]] || { echo "aborted"; exit 1; }
if [[ "${COMPOSE:-0}" == "1" ]]; then
  docker compose stop api
  docker compose exec -T db pg_restore -U fos -d fos --clean --if-exists --no-owner --single-transaction < "$FILE"
  docker compose start api
else
  URL="${DATABASE_URL:-}"
  URL="${URL/postgresql+psycopg:/postgresql:}"
  pg_restore ${URL:+--dbname="$URL"} --clean --if-exists --no-owner --single-transaction "$FILE"
fi
echo "restore complete; the API runs 'alembic upgrade head' on start to apply newer migrations"
