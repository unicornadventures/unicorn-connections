#!/usr/bin/env bash
#
# Dumps the production database to a file on this machine.
#
#   ./scripts/backup-db.sh                  # writes tmp/backups/class_reunion-<UTC stamp>.dump
#   ./scripts/backup-db.sh --out ~/Backups  # somewhere else
#   ./scripts/backup-db.sh --keep-running   # leave the bastion up afterwards
#
# The Aurora cluster is not publicly accessible, so this goes through the
# stack's Session Manager bastion (BastionInstance in infra/template.yaml):
# start it if it is stopped, forward a local port to the cluster, pg_dump over
# that, then stop the bastion. No SSH and no open inbound port — access is your
# AWS identity's ssm:StartSession.
#
# It stops the bastion even when it found it running, because a deploy that
# creates or replaces the instance leaves it running and nothing else would
# stop it. That ends any other session through it; --keep-running opts out.
#
# Needs, locally:
#   * the Session Manager plugin   brew install --cask session-manager-plugin
#   * pg_dump 17 or newer          brew install libpq  (pg_dump refuses to dump
#                                  a server newer than itself, so the
#                                  postgresql@14 used for local dev cannot)
#
# The output is pg_dump's custom format (-Fc): compressed, restored with
# pg_restore, and --no-owner so it loads under any role. It covers the one
# database, not cluster-wide roles. It holds every member's personal data and
# password hashes, so it is written mode 600 under tmp/ (gitignored) by default.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${STACK:-classyear-nest}"
REGION="${REGION:-us-east-1}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
DATABASE_HOST="${DATABASE_HOST:-classyear-dev.cluster-cezswsoi8m3o.us-east-1.rds.amazonaws.com}"
DATABASE_SECRET_ARN="${DATABASE_SECRET_ARN:-arn:aws:secretsmanager:us-east-1:372666940943:secret:rds!cluster-328925d7-720f-4ad3-9694-8c52236e81f2-yt8gVR}"
OUT_DIR="$REPO_ROOT/tmp/backups"
KEEP_RUNNING=false

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR="${2:?--out needs a directory}"; shift 2 ;;
    --keep-running) KEEP_RUNNING=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

major() { "$1" --version | sed -E 's/[^0-9]*([0-9]+).*/\1/'; }

# Prefer a pg_dump new enough for the server, wherever Homebrew put it. psql
# and pg_restore are taken from the same directory so the three always match.
PG_DIR=""
for dir in "${PG_BIN:-}" "$(dirname "$(command -v pg_dump 2>/dev/null || echo .)")" \
           /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do
  if [ -n "$dir" ] && [ -x "$dir/pg_dump" ] && [ "$(major "$dir/pg_dump")" -ge 17 ]; then
    PG_DIR="$dir"; break
  fi
done
if [ -z "$PG_DIR" ]; then
  echo "No pg_dump 17+ found. Install one with: brew install libpq" >&2
  echo "(or point PG_BIN at a directory that has one)" >&2
  exit 1
fi
export PATH="$PG_DIR:$PATH"

if ! command -v session-manager-plugin >/dev/null; then
  echo "The Session Manager plugin is missing: brew install --cask session-manager-plugin" >&2
  exit 1
fi

echo "==> Finding the bastion ($STACK)"
INSTANCE="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BastionInstanceId'].OutputValue" --output text)"
if [ -z "$INSTANCE" ] || [ "$INSTANCE" = "None" ]; then
  echo "The stack has no BastionInstanceId output. Deploy it with the bastion enabled" >&2
  echo "(it is off by default: JWT_SECRET=… ENABLE_BASTION=true ./scripts/deploy.sh)." >&2
  exit 1
fi

if nc -z localhost "$LOCAL_PORT" 2>/dev/null; then
  echo "Port $LOCAL_PORT is already in use here; set LOCAL_PORT to a free one." >&2
  exit 1
fi

TUNNEL_PID=""
TUNNEL_LOG="$(mktemp -t backup-db-tunnel)"

cleanup() {
  if [ -n "$TUNNEL_PID" ]; then
    # The plugin is a child of the aws process; take both down.
    pkill -P "$TUNNEL_PID" 2>/dev/null || true
    kill "$TUNNEL_PID" 2>/dev/null || true
    session="$(sed -nE 's/.*SessionId: ([^ ]+).*/\1/p' "$TUNNEL_LOG" | head -1)"
    [ -n "$session" ] && aws ssm terminate-session --region "$REGION" \
      --session-id "$session" >/dev/null 2>&1 || true
  fi
  rm -f "$TUNNEL_LOG"
  if ! $KEEP_RUNNING; then
    echo "==> Stopping the bastion"
    aws ec2 stop-instances --region "$REGION" --instance-ids "$INSTANCE" >/dev/null
  fi
}
trap cleanup EXIT

state() {
  aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE" \
    --query 'Reservations[0].Instances[0].State.Name' --output text
}

case "$(state)" in
  running) echo "    $INSTANCE is running" ;;
  pending) aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE" ;;
  stopping|stopped)
    aws ec2 wait instance-stopped --region "$REGION" --instance-ids "$INSTANCE"
    echo "    starting $INSTANCE"
    aws ec2 start-instances --region "$REGION" --instance-ids "$INSTANCE" >/dev/null
    aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE"
    ;;
  *) echo "Bastion $INSTANCE is $(state); not touching it." >&2; exit 1 ;;
esac

# Session Manager's PingStatus can still read Online from before a stop, so it
# is not trusted on its own: the tunnel is retried until it actually opens.
echo "==> Opening the tunnel (localhost:$LOCAL_PORT → cluster:5432)"
for attempt in $(seq 1 12); do
  : >"$TUNNEL_LOG"
  aws ssm start-session --region "$REGION" --target "$INSTANCE" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "host=$DATABASE_HOST,portNumber=5432,localPortNumber=$LOCAL_PORT" \
    >"$TUNNEL_LOG" 2>&1 </dev/null &
  TUNNEL_PID=$!
  for _ in $(seq 1 20); do
    grep -q 'Waiting for connections' "$TUNNEL_LOG" && break 2
    kill -0 "$TUNNEL_PID" 2>/dev/null || break
    sleep 1
  done
  pkill -P "$TUNNEL_PID" 2>/dev/null || true
  kill "$TUNNEL_PID" 2>/dev/null || true
  TUNNEL_PID=""
  [ "$attempt" = 12 ] && { cat "$TUNNEL_LOG" >&2; echo "The tunnel never opened." >&2; exit 1; }
  echo "    not ready yet (the agent registers a minute or so after boot), retrying"
  sleep 10
done

echo "==> Reading credentials from Secrets Manager"
SECRET="$(aws secretsmanager get-secret-value --region "$REGION" \
  --secret-id "$DATABASE_SECRET_ARN" --query SecretString --output text)"
PGUSER="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["username"])' <<<"$SECRET")"
PGPASSWORD="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' <<<"$SECRET")"
unset SECRET
export PGUSER PGPASSWORD
export PGHOST=localhost PGPORT="$LOCAL_PORT" PGDATABASE="${PGDATABASE:-class_reunion}"
# require, not verify-full: the certificate names the cluster, not localhost.
export PGSSLMODE=require
# The cluster auto-pauses at 0 ACU; the first connection waits while it resumes.
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-90}"

echo "==> Connecting to $PGDATABASE (may wait while the cluster resumes)"
SERVER_MAJOR="$(( $(psql -XtAc 'show server_version_num') / 10000 ))"
if [ "$(major pg_dump)" -lt "$SERVER_MAJOR" ]; then
  echo "pg_dump $(major pg_dump) cannot dump a PostgreSQL $SERVER_MAJOR server." >&2
  exit 1
fi
TABLES="$(psql -XtAc "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")"
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
echo "  Restore into a PostgreSQL $SERVER_MAJOR+ server: pg_restore --no-owner -d <db> \"$FILE\""
