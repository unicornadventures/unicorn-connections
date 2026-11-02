#!/usr/bin/env bash
#
# Dumps the production database to a file on this machine.
#
#   ./scripts/backup-db.sh                  # writes tmp/backups/class_reunion-<UTC stamp>.dump
#   ./scripts/backup-db.sh --out ~/Backups  # somewhere else
#   ./scripts/backup-db.sh --keep-running   # leave the bastion up afterwards
#
# It reaches the cluster through the Session Manager bastion; how, and what it
# needs installed locally, is in scripts/lib/db-tunnel.sh. Restore with
# scripts/restore-db.sh.
#
# The output is pg_dump's custom format (-Fc): compressed, restored with
# pg_restore, and --no-owner so it loads under any role. It covers the one
# database, not cluster-wide roles. It holds every member's personal data and
# password hashes, so it is written mode 600 under tmp/ (gitignored) by default.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/tmp/backups"
KEEP_RUNNING=false

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out needs a directory}"; shift 2 ;;
    --keep-running) KEEP_RUNNING=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# shellcheck source=lib/db-tunnel.sh
. "$REPO_ROOT/scripts/lib/db-tunnel.sh"
db_tunnel_open

TABLES="$(db_tables "$PGDATABASE" | wc -l | tr -d ' ')"
echo "    PostgreSQL $SERVER_MAJOR, $TABLES tables, $(psql -XtAc 'select pg_size_pretty(pg_database_size(current_database()))')"

mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/${PGDATABASE}-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo "==> Dumping with $(pg_dump --version)"
umask 077
pg_dump -Fc --no-owner -f "$FILE"

# A dump that exits 0 can still be missing data if it was pointed at the wrong
# database; count the table-data entries rather than trusting the exit code.
DUMPED="$(pg_restore --list "$FILE" | grep -c ' TABLE DATA ' || true)"
if [ "$DUMPED" -ne "$TABLES" ]; then
  echo "Dump has data for $DUMPED tables but the database has $TABLES — not trusting it." >&2
  exit 1
fi

echo
echo "Done: $FILE ($(du -h "$FILE" | cut -f1), data for all $DUMPED tables)"
echo "  Restore with: ./scripts/restore-db.sh \"$FILE\""
