#!/usr/bin/env bash
# Purpose: Verifies that the database has normalized microorganism IDs and lookup data.
set -euo pipefail

DB_PATH="${1:-backend/sql/microbes.db}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "[ERROR] Database not found: $DB_PATH" >&2
  exit 1
fi

echo "[INFO] Checking schema in $DB_PATH"
TABLE_EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='microorganism_dim';")
if [[ "$TABLE_EXISTS" != "1" ]]; then
  echo "[ERROR] Missing table: microorganism_dim" >&2
  exit 1
fi

COLUMN_EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('microbes') WHERE name='microorganism_id';")
if [[ "$COLUMN_EXISTS" != "1" ]]; then
  echo "[ERROR] Missing column: microbes.microorganism_id" >&2
  exit 1
fi

CATEGORIES_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM microorganism_dim;")
NULL_FK_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM microbes WHERE microorganism_id IS NULL;")
ORPHAN_FK_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM microbes m LEFT JOIN microorganism_dim c ON m.microorganism_id = c.microorganism_id WHERE m.microorganism_id IS NOT NULL AND c.microorganism_id IS NULL;")

echo "[OK] microorganism_dim rows: $CATEGORIES_COUNT"
echo "[OK] microbes rows with NULL microorganism_id: $NULL_FK_COUNT"
echo "[OK] orphan microorganism_id references: $ORPHAN_FK_COUNT"

if [[ "$NULL_FK_COUNT" != "0" ]]; then
  echo "[ERROR] There are microbes rows without microorganism_id." >&2
  exit 1
fi

if [[ "$ORPHAN_FK_COUNT" != "0" ]]; then
  echo "[ERROR] There are orphan microorganism_id values in microbes." >&2
  exit 1
fi

echo "[DONE] Microorganism ID migration checks passed."
