#!/bin/sh
# Restores a backup over the current database. Everything entered after that
# backup is lost, so the current state is backed up first.
#   ./deploy/restore.sh backups/taxi_2026-10-24_220000.dump
set -eu
dump="${1:?usage: deploy/restore.sh backups/taxi_....dump}"
[ -f "$dump" ] || { echo "file not found: $dump" >&2; exit 1; }
name=$(basename "$dump")

printf 'Bazani %s holatiga qaytaraman. Undan keyin kiritilgan hamma narsa yo'\''qoladi. Davom etilsinmi? (ha/yo'\''q) ' "$name"
read -r answer
[ "$answer" = "ha" ] || { echo "Bekor qilindi."; exit 1; }

# Read the chosen dump before the safety backup below writes a new file.
copy=$(mktemp)
trap 'rm -f "$copy"' EXIT
cp "$dump" "$copy"

echo "1/4 Hozirgi holatning zaxirasi..."
docker compose exec -T backup /usr/local/bin/backup.sh now
echo "2/4 API to'xtatilmoqda..."
docker compose stop api
echo "3/4 Tiklanmoqda..."
docker compose exec -T db sh -c 'dropdb -U taxi --force taxi && createdb -U taxi taxi'
docker compose exec -T db pg_restore -U taxi -d taxi --no-owner < "$copy"
echo "4/4 API ishga tushirilmoqda..."
docker compose start api
echo "Tayyor."
