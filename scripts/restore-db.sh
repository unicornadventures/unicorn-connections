#!/usr/bin/env bash
#
# Restores a scripts/backup-db.sh dump onto the production cluster.
#
#   ./scripts/restore-db.sh <file.dump>                         # into a NEW database
#   ./scripts/restore-db.sh <file.dump> --into <name>           # ...with that name
#   ./scripts/restore-db.sh <file.dump> --replace class_reunion # over production
#   ./scripts/restore-db.sh --drop <name>                       # remove a restore database
#
# **By default it never touches an existing database.** It creates a new one
# on the cluster (class_reunion_restore_<stamp>) and restores into that, so a
# backup can be inspected — or single rows copied back out of it — while the
# live app carries on. Drop it afterwards; the command is printed at the end.
#
# --replace overwrites a database in place, and naming it is the safeguard:
# `--replace class_reunion` is production, the one database the app uses.
# Every write made since the dump was taken is lost. In order, it:
#
#   1. takes a safety dump of the database as it is now, to tmp/backups/,
#      and stops if that fails — so a replace can itself be undone by
#      restoring that file the same way;
#   2. restores with --clean in a single transaction, so it either completes
#      or changes nothing. Each statement waits at most LOCK_TIMEOUT (30s) for
#      a lock rather than queueing behind the app indefinitely; if one times
#      out, the whole restore rolls back and the database is as it was;
#   3. prints every table's row count before and after.
#
# --clean drops only what is in the dump. A table added to the live database
# since then is left alone, and if it has a foreign key to a restored table
# the drop fails — which rolls the restore back, rather than cascading.
#
# **After replacing production, rotate JWT_SECRET** (redeploy with a new one,
# which signs everyone out). Tokens are stateless JWTs, valid for 24h and
# checked without a database lookup, and the restore rewinds the id sequences.
# So an account created after the dump keeps a valid token for an id that no
# longer exists — until the next signup is given that id, at which point the
# old token acts as the new person's account.
#
# It reaches the cluster through the Session Manager bastion; see
# scripts/lib/db-tunnel.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/tmp/backups"
LOCK_TIMEOUT="${LOCK_TIMEOUT:-30s}"
KEEP_RUNNING=false
DUMP=""
INTO=""
REPLACE=""
DROP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --into) INTO="${2:?--into needs a database name}"; shift 2 ;;
    --replace) REPLACE="${2:?--replace needs the name of the database to overwrite}"; shift 2 ;;
    --drop) DROP="${2:?--drop needs a database name}"; shift 2 ;;
    --keep-running) KEEP_RUNNING=true; shift ;;
    -*) echo "Unknown argument: $1" >&2; exit 2 ;;
    *) [ -z "$DUMP" ] || { echo "Only one dump file, please." >&2; exit 2; }; DUMP="$1"; shift ;;
  esac
done

if [ -n "$DROP" ]; then
  [ -z "$DUMP$INTO$REPLACE" ] || { echo "--drop takes only a database name." >&2; exit 2; }
  # Production is never a restore database; there is no flag that drops it.
  if [ "$DROP" = "class_reunion" ] || [ "$DROP" = "postgres" ]; then
    echo "Refusing to drop $DROP." >&2; exit 2
  fi
  [[ "$DROP" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "Not a plain database name: $DROP" >&2; exit 2; }
  # shellcheck source=lib/db-tunnel.sh
  . "$REPO_ROOT/scripts/lib/db-tunnel.sh"
  db_tunnel_open
  echo "==> Dropping $DROP"
  psql -Xq -v ON_ERROR_STOP=1 -d postgres -c "drop database $DROP"
  echo "Done: $DROP dropped."
  exit 0
fi

[ -n "$DUMP" ] || { echo "Usage: $0 <file.dump> [--into <name> | --replace <name>]" >&2; exit 2; }
[ -f "$DUMP" ] || { echo "No such file: $DUMP" >&2; exit 1; }
if [ -n "$INTO" ] && [ -n "$REPLACE" ]; then
  echo "--into and --replace are opposites; pick one." >&2; exit 2
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEFAULT_NAME="${STAMP%Z}"; DEFAULT_NAME="class_reunion_restore_${DEFAULT_NAME/T/_}"
TARGET="${REPLACE:-${INTO:-$DEFAULT_NAME}}"
# Names go into SQL unquoted-safe only if they are plain identifiers.
if ! [[ "$TARGET" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
  echo "Database name must be lowercase letters, digits and underscores: $TARGET" >&2; exit 2
fi

# shellcheck source=lib/db-tunnel.sh
. "$REPO_ROOT/scripts/lib/db-tunnel.sh"
db_tunnel_open

# Read the archive before anything is changed: a file pg_restore cannot list
# would otherwise be discovered halfway through.
echo "==> Reading $(basename "$DUMP")"
DUMP_TABLES="$(pg_restore --list "$DUMP" | grep -c ' TABLE DATA ' || true)"
DUMP_FROM="$(pg_restore --list "$DUMP" | sed -nE 's/^;[[:space:]]+Archive created at (.*)/\1/p')"
[ "$DUMP_TABLES" -gt 0 ] || { echo "The dump holds no table data; refusing to restore it." >&2; exit 1; }
echo "    taken $DUMP_FROM, data for $DUMP_TABLES tables"

exists() { [ "$(psql -XtA -d postgres -c "select 1 from pg_database where datname = '$1'")" = 1 ]; }

restore_into() {
  PGOPTIONS="-c lock_timeout=$LOCK_TIMEOUT" pg_restore --no-owner --exit-on-error \
    --single-transaction "$@" -d "$TARGET" "$DUMP"
}

if [ -z "$REPLACE" ]; then
  if exists "$TARGET"; then
    echo "Database $TARGET already exists. --into takes a new name; --replace overwrites." >&2
    exit 1
  fi
  echo "==> Creating database $TARGET"
  psql -Xq -d postgres -c "create database $TARGET"
  echo "==> Restoring into $TARGET"
  if ! restore_into; then
    echo "Restore failed; dropping the new database $TARGET." >&2
    psql -Xq -d postgres -c "drop database $TARGET" || true
    exit 1
  fi
  RESTORED="$(db_tables "$TARGET" | wc -l | tr -d ' ')"
  echo
  db_row_counts "$TARGET" | awk -F'\t' '{printf "    %-36s %8s rows\n", $1, $2}'
  echo
  echo "Done: $TARGET holds the dump from $DUMP_FROM ($RESTORED tables)."
  echo "  It is on the production cluster, reachable through the bastion like class_reunion."
  echo "  Drop it when done:  ./scripts/restore-db.sh --drop $TARGET"
  exit 0
fi

# ---- --replace -------------------------------------------------------------

if ! exists "$TARGET"; then
  echo "There is no database $TARGET to replace. To restore into a new one, use --into." >&2
  exit 1
fi
if [ "$TARGET" = "class_reunion" ]; then
  echo "==> REPLACING PRODUCTION ($TARGET) with the dump from $DUMP_FROM"
else
  echo "==> Replacing $TARGET with the dump from $DUMP_FROM"
fi

mkdir -p "$OUT_DIR"
umask 077
SAFETY="$OUT_DIR/${TARGET}-before-restore-$STAMP.dump"
echo "==> Safety dump of $TARGET as it is now"
pg_dump -Fc --no-owner -d "$TARGET" -f "$SAFETY"
LIVE_TABLES="$(db_tables "$TARGET" | wc -l | tr -d ' ')"
SAFE_TABLES="$(pg_restore --list "$SAFETY" | grep -c ' TABLE DATA ' || true)"
if [ "$SAFE_TABLES" -ne "$LIVE_TABLES" ]; then
  echo "Safety dump has $SAFE_TABLES tables of $LIVE_TABLES; not restoring without it." >&2
  exit 1
fi
echo "    $SAFETY"

BEFORE="$(mktemp -t restore-before)"
db_row_counts "$TARGET" >"$BEFORE"

echo "==> Restoring (one transaction; lock timeout $LOCK_TIMEOUT)"
if ! restore_into --clean --if-exists; then
  rm -f "$BEFORE"
  echo >&2
  echo "Restore failed and was rolled back; $TARGET is unchanged." >&2
  exit 1
fi

echo
printf '    %-36s %8s  %8s\n' table before after
db_row_counts "$TARGET" | while IFS=$'\t' read -r t n; do
  b="$(awk -F'\t' -v t="$t" '$1 == t {print $2}' "$BEFORE")"
  printf '    %-36s %8s  %8s\n' "$t" "${b:--}" "$n"
done
rm -f "$BEFORE"

echo
echo "Done: $TARGET now holds the dump from $DUMP_FROM."
echo "  To undo: ./scripts/restore-db.sh \"$SAFETY\" --replace $TARGET"
if [ "$TARGET" = "class_reunion" ]; then
  echo
  echo "  NOW ROTATE JWT_SECRET: JWT_SECRET=\$(openssl rand -hex 32) ./scripts/deploy.sh"
  echo "  Tokens issued after the dump can otherwise act as the wrong account once"
  echo "  the rewound id sequences hand their ids out again (see this script's header)."
fi
