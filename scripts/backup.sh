#!/usr/bin/env bash
# PostgreSQL backup for ITMC FenestrationOS (custom-format dump, compressed, timestamped, retention).
# Usage:
#   scripts/backup.sh                       # uses DATABASE_URL or PG* env vars
#   COMPOSE=1 scripts/backup.sh             # dump from the docker compose "db" service
# Env: BACKUP_DIR (default ./backups), RETENTION_DAYS (default 14)
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
OUT="$BACKUP_DIR/fos_${STAMP}.dump"

if [[ "${COMPOSE:-0}" == "1" ]]; then
  docker compose exec -T db pg_dump -U fos -d fos --format=custom --no-owner --compress=6 > "$OUT"
else
  URL="${DATABASE_URL:-}"
  URL="${URL/postgresql+psycopg:/postgresql:}"
  if [[ -n "$URL" ]]; then
    pg_dump --dbname="$URL" --format=custom --no-owner --compress=6 --file="$OUT"
  else
    pg_dump --format=custom --no-owner --compress=6 --file="$OUT"   # PGHOST/PGUSER/PGDATABASE/PGPASSWORD
  fi
fi
chmod 600 "$OUT"
# integrity check: the archive TOC must be readable
pg_restore --list "$OUT" > /dev/null
sha256sum "$OUT" > "$OUT.sha256"
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"
find "$BACKUP_DIR" -name 'fos_*.dump*' -type f -mtime +"$RETENTION_DAYS" -print -delete
