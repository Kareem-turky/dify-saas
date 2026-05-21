#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required, e.g. file:./prod.db}"
: "${BACKUP_PATH:?BACKUP_PATH is required}"

if [[ "$DATABASE_URL" != file:* ]]; then
  echo "Only SQLite file: DATABASE_URL values are supported by this script." >&2
  exit 2
fi

DB_PATH="${DATABASE_URL#file:}"
if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Backup file not found: $BACKUP_PATH" >&2
  exit 3
fi

mkdir -p "$(dirname "$DB_PATH")"
if [[ -f "$DB_PATH" ]]; then
  SAFETY_COPY="${DB_PATH}.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$DB_PATH" "$SAFETY_COPY"
  echo "Existing database copied to $SAFETY_COPY" >&2
fi

if [[ -f "${BACKUP_PATH}.sha256" ]]; then
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$BACKUP_PATH")" && sha256sum -c "$(basename "${BACKUP_PATH}.sha256")")
  else
    echo "sha256sum not available; skipping checksum verification." >&2
  fi
fi

cp "$BACKUP_PATH" "$DB_PATH"
echo "$DB_PATH"
