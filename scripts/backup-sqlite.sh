#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required, e.g. file:./prod.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ "$DATABASE_URL" != file:* ]]; then
  echo "Only SQLite file: DATABASE_URL values are supported by this script." >&2
  exit 2
fi

DB_PATH="${DATABASE_URL#file:}"
mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_PATH" ]]; then
  echo "SQLite database not found: $DB_PATH" >&2
  exit 3
fi

BASE_NAME="$(basename "$DB_PATH")"
BACKUP_PATH="$BACKUP_DIR/${BASE_NAME}.${TIMESTAMP}.backup"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
else
  cp "$DB_PATH" "$BACKUP_PATH"
  [[ -f "${DB_PATH}-wal" ]] && cp "${DB_PATH}-wal" "${BACKUP_PATH}-wal"
  [[ -f "${DB_PATH}-shm" ]] && cp "${DB_PATH}-shm" "${BACKUP_PATH}-shm"
fi

sha256sum "$BACKUP_PATH" > "${BACKUP_PATH}.sha256" 2>/dev/null || shasum -a 256 "$BACKUP_PATH" > "${BACKUP_PATH}.sha256"
echo "$BACKUP_PATH"
