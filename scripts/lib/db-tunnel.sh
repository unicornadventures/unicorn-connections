# shellcheck shell=bash
#
# Sourced, not run: the connection to the production database that
# scripts/backup-db.sh and scripts/restore-db.sh share.
#
#   . "$REPO_ROOT/scripts/lib/db-tunnel.sh"
#   db_tunnel_open        # PG* exported, pg_dump/psql/pg_restore on PATH
#
# The Aurora cluster is not publicly accessible, so this goes through the
# stack's Session Manager bastion (BastionInstance in infra/template.yaml).
# It is off by default — deploy with ENABLE_BASTION=true first, and normally
# again afterwards to remove it. With it present, this starts it if it is
# stopped, forwards a local port to the cluster, and on exit closes the tunnel
# and stops the bastion — even one it found running, because a deploy that
# creates or replaces the instance leaves it running and nothing else would
# stop it. Set KEEP_RUNNING=true before calling to opt out. No SSH
# and no open inbound port: access is your AWS identity's ssm:StartSession.
#
# Needs, locally:
#   * the Session Manager plugin   brew install --cask session-manager-plugin
#   * PostgreSQL client 17+        brew install libpq  (pg_dump refuses to dump
#                                  a server newer than itself, so the
#                                  postgresql@14 used for local dev cannot)
#
# Installs an EXIT trap. A caller needing its own cleanup should do it before
# returning rather than replace the trap.

STACK="${STACK:-classyear-nest}"
REGION="${REGION:-us-east-1}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
DATABASE_HOST="${DATABASE_HOST:-classyear-dev.cluster-cezswsoi8m3o.us-east-1.rds.amazonaws.com}"
DATABASE_SECRET_ARN="${DATABASE_SECRET_ARN:-arn:aws:secretsmanager:us-east-1:372666940943:secret:rds!cluster-328925d7-720f-4ad3-9694-8c52236e81f2-yt8gVR}"
KEEP_RUNNING="${KEEP_RUNNING:-false}"

pg_major() { "$1" --version | sed -E 's/[^0-9]*([0-9]+).*/\1/'; }

_db_tunnel_cleanup() {
  if [ -n "${TUNNEL_PID:-}" ]; then
    # The plugin is a child of the aws process; take both down.
    pkill -P "$TUNNEL_PID" 2>/dev/null || true
    kill "$TUNNEL_PID" 2>/dev/null || true
    local session
    session="$(sed -nE 's/.*SessionId: ([^ ]+).*/\1/p' "$TUNNEL_LOG" | head -1)"
    [ -n "$session" ] && aws ssm terminate-session --region "$REGION" \
      --session-id "$session" >/dev/null 2>&1 || true
  fi
  rm -f "${TUNNEL_LOG:-}"
  if [ -n "${INSTANCE:-}" ] && ! $KEEP_RUNNING; then
    echo "==> Stopping the bastion"
    aws ec2 stop-instances --region "$REGION" --instance-ids "$INSTANCE" >/dev/null
  fi
}

_db_instance_state() {
  aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE" \
    --query 'Reservations[0].Instances[0].State.Name' --output text
}

db_tunnel_open() {
  # Prefer a client new enough for the server, wherever Homebrew put it. psql,
  # pg_dump and pg_restore are taken from one directory so they always match.
  local dir PG_DIR=""
  for dir in "${PG_BIN:-}" "$(dirname "$(command -v pg_dump 2>/dev/null || echo .)")" \
             /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do
    if [ -n "$dir" ] && [ -x "$dir/pg_dump" ] && [ "$(pg_major "$dir/pg_dump")" -ge 17 ]; then
      PG_DIR="$dir"; break
    fi
  done
  if [ -z "$PG_DIR" ]; then
    echo "No PostgreSQL 17+ client found. Install one with: brew install libpq" >&2
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
    INSTANCE=""
    echo "The stack has no BastionInstanceId output. Deploy it with the bastion enabled" >&2
    echo "(it is off by default: JWT_SECRET=… ENABLE_BASTION=true ./scripts/deploy.sh)." >&2
    exit 1
  fi

  if nc -z localhost "$LOCAL_PORT" 2>/dev/null; then
    echo "Port $LOCAL_PORT is already in use here; set LOCAL_PORT to a free one." >&2
    exit 1
  fi

  TUNNEL_PID=""
  TUNNEL_LOG="$(mktemp -t db-tunnel)"
  trap _db_tunnel_cleanup EXIT

  case "$(_db_instance_state)" in
    running) echo "    $INSTANCE is running" ;;
    pending) aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE" ;;
    stopping|stopped)
      aws ec2 wait instance-stopped --region "$REGION" --instance-ids "$INSTANCE"
      echo "    starting $INSTANCE"
      aws ec2 start-instances --region "$REGION" --instance-ids "$INSTANCE" >/dev/null
      aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE"
      ;;
    *) echo "Bastion $INSTANCE is $(_db_instance_state); not touching it." >&2; exit 1 ;;
  esac

  # Session Manager's PingStatus can still read Online from before a stop, so it
  # is not trusted on its own: the tunnel is retried until it actually opens.
  echo "==> Opening the tunnel (localhost:$LOCAL_PORT → cluster:5432)"
  local attempt
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
  local secret
  secret="$(aws secretsmanager get-secret-value --region "$REGION" \
    --secret-id "$DATABASE_SECRET_ARN" --query SecretString --output text)"
  PGUSER="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["username"])' <<<"$secret")"
  PGPASSWORD="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' <<<"$secret")"
  export PGUSER PGPASSWORD
  export PGHOST=localhost PGPORT="$LOCAL_PORT" PGDATABASE="${PGDATABASE:-class_reunion}"
  # require, not verify-full: the certificate names the cluster, not localhost.
  export PGSSLMODE=require
  # The cluster auto-pauses at 0 ACU; the first connection waits while it resumes.
  export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-90}"

  echo "==> Connecting (may wait while the cluster resumes)"
  SERVER_MAJOR="$(( $(psql -XtAc 'show server_version_num') / 10000 ))"
  if [ "$(pg_major pg_dump)" -lt "$SERVER_MAJOR" ]; then
    echo "The PostgreSQL $(pg_major pg_dump) client cannot handle a PostgreSQL $SERVER_MAJOR server." >&2
    exit 1
  fi
}

# Tables in a database, one per line, schema-qualified.
db_tables() {
  psql -XtA -d "$1" -c "select schemaname || '.' || tablename from pg_tables
    where schemaname not in ('pg_catalog','information_schema') order by 1"
}

# "table<TAB>rows" for every table in a database, exact counts.
db_row_counts() {
  local db="$1" t
  for t in $(db_tables "$db"); do
    printf '%s\t%s\n' "$t" "$(psql -XtA -d "$db" -c "select count(*) from $t")"
  done
}
