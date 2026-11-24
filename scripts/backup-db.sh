#!/usr/bin/env bash
# Daily SQLite backup for Yuki AI (safe online backup via node:sqlite VACUUM INTO)
# Keeps the latest 7 daily backups inside data/backups/daily/

set -euo pipefail

APP_DIR="${YUKI_APP_DIR:-/home/ryukomik/Yuki---AI}"
DB_PATH="$APP_DIR/data/yuki.db"
BACKUP_DIR="$APP_DIR/data/backups/daily"
STAMP="$(TZ=Asia/Jakarta date +%Y-%m-%d)"
OUT_FILE="$BACKUP_DIR/yuki-${STAMP}.sqlite"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "[backup] Database not found at $DB_PATH" >&2
  exit 1
fi

rm -f "$OUT_FILE"

node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
const target = process.argv[2].replace(/\x27/g, "\x27\x27");
db.exec(`VACUUM INTO \x27${target}\x27`);
db.close();
' "$DB_PATH" "$OUT_FILE"

# Rotate: keep only the 7 newest daily backups
ls -1t "$BACKUP_DIR"/yuki-*.sqlite 2>/dev/null | tail -n +8 | xargs -r rm -f

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "[backup] OK -> $OUT_FILE ($SIZE)"
