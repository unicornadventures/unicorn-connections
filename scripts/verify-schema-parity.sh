#!/usr/bin/env bash
#
# Phase 0 gate: prove the ported SchemaService produces a schema identical to
# the one the Express app's schema.ts produces.
#
# Builds both schemas into throwaway databases, dumps each with pg_dump
# --schema-only, and diffs. Exits non-zero on any difference.
#
#   ./scripts/verify-schema-parity.sh
#
# Requires a reachable PostgreSQL 14 (Homebrew service or docker-compose) and a
# checkout of the source app at $LEGACY_REPO.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY_REPO="${LEGACY_REPO:-$HOME/Code/ClassYear}"
LEGACY_SCHEMA_SRC="$LEGACY_REPO/backend/src/schema.ts"

OLD_DB="${OLD_DB:-classyear_parity_legacy}"
NEW_DB="${NEW_DB:-classyear_parity_nest}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/tmp/schema-parity}"

# Defaults target the Postgres container on :5432. Override any of them for a
# different server — a Homebrew install typically wants PGUSER=$(whoami) and
# ignores the password entirely, since it uses trust auth.
export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-password}"

if [ ! -f "$LEGACY_SCHEMA_SRC" ]; then
  echo "Source schema not found at $LEGACY_SCHEMA_SRC" >&2
  echo "Set LEGACY_REPO to the ClassYear checkout." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

reset_db() {
  dropdb --if-exists "$1"
  createdb "$1"
}

echo "==> Resetting scratch databases ($OLD_DB, $NEW_DB)"
reset_db "$OLD_DB"
reset_db "$NEW_DB"

echo "==> Building legacy schema with the Express app's schema.ts"
# Copied, never committed: the source repo stays the only home for this file.
cp "$LEGACY_SCHEMA_SRC" "$REPO_ROOT/tools/legacy-schema/schema.ts"
trap 'rm -f "$REPO_ROOT/tools/legacy-schema/schema.ts"' EXIT
PGDATABASE="$OLD_DB" node "$REPO_ROOT/tools/legacy-schema/run.js" >"$OUT_DIR/legacy-run.log" 2>&1

echo "==> Building ported schema with SchemaService"
npm --prefix "$REPO_ROOT/apps/api" run build >/dev/null
DB_NAME="$NEW_DB" DB_HOST="$PGHOST" DB_PORT="$PGPORT" \
  DB_USER="$PGUSER" DB_PASSWORD="$PGPASSWORD" \
  node "$REPO_ROOT/apps/api/dist/cli/init-schema.js" >"$OUT_DIR/nest-run.log" 2>&1

dump() {
  # \restrict/\unrestrict carry a per-invocation random nonce (pg_dump 14.20+),
  # so they differ between any two dumps and have to be filtered out.
  pg_dump --schema-only --no-owner --no-privileges --no-comments -d "$1" \
    | grep -vE '^--|^$|^SET |^SELECT pg_catalog\.set_config|^\\(un)?restrict ' \
    > "$2"
}

echo "==> Dumping and comparing"
dump "$OLD_DB" "$OUT_DIR/legacy.sql"
dump "$NEW_DB" "$OUT_DIR/nest.sql"

if diff -u "$OUT_DIR/legacy.sql" "$OUT_DIR/nest.sql" > "$OUT_DIR/schema.diff"; then
  echo
  echo "✅ Schema parity: the ported schema is identical to the source app's."
  echo "   $(grep -c ';' "$OUT_DIR/nest.sql") statements compared."
  exit 0
fi

echo
echo "❌ Schema parity FAILED — differences below (also in $OUT_DIR/schema.diff):"
echo
cat "$OUT_DIR/schema.diff"
exit 1
