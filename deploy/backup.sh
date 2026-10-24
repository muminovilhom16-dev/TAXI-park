#!/bin/sh
# Daily database backup, run by the `backup` service in docker-compose.yml.
# Writes /backups/taxi_YYYY-MM-DD_HHMMSS.dump (pg_dump custom format) once a day
# at BACKUP_HOUR_UTC (default 22 = 03:00 Tashkent) and deletes dumps older than
# BACKUP_KEEP_DAYS. These files sit on the same server: copy them elsewhere too.
set -eu
# Dumps hold passport data: readable by root only.
umask 077
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-22}"

backup() {
  ts=$(date -u +%Y-%m-%d_%H%M%S)
  file="/backups/taxi_${ts}.dump"
  # Written under a temporary name so a half-written dump is never mistaken for a good one.
  pg_dump --format=custom --file="${file}.part"
  mv "${file}.part" "$file"
  find /backups -name 'taxi_*.dump' -mtime +"$KEEP_DAYS" -delete
  echo "backup written: $file ($(du -h "$file" | cut -f1))"
}

if [ "${1:-}" = "now" ]; then
  backup
  exit 0
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today ${HOUR}:00" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow ${HOUR}:00" +%s)
  sleep $((next - now))
  backup || echo "backup FAILED" >&2
done
