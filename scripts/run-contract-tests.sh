#!/usr/bin/env bash
#
# Runs the old-vs-new endpoint parity gate.
#
# Creates a scratch database, points both implementations at it, and runs the
# contract suite. The source repo is only ever read.
#
#   ./scripts/run-contract-tests.sh            # all contract specs
#   ./scripts/run-contract-tests.sh auth       # filter by name
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LEGACY_REPO="${LEGACY_REPO:-$HOME/Code/ClassYear}"

if [ ! -d "$LEGACY_REPO/backend/src/lambda" ]; then
  echo "Source handlers not found at $LEGACY_REPO/backend/src/lambda" >&2
  echo "Set LEGACY_REPO to the ClassYear checkout." >&2
  exit 1
fi

# Defaults target the Postgres container on :5432. The scratch database is
# created and dropped here, so it never collides with whatever else that server
# is hosting. Override for a different server — a Homebrew install typically
# wants DB_USER=$(whoami) and ignores the password.
export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-classyear_contract}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-password}"

# createdb/dropdb below read these rather than the DB_* names.
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD"

# Both implementations must sign with the same key for tokens to be comparable.
export JWT_SECRET="${JWT_SECRET:-contract-test-secret}"
export NODE_ENV=test
export FEEDBACK_ENABLED=true
# Unset so EmailService logs instead of calling SES, and forgot-password sends
# inline instead of reaching for a queue that does not exist locally.
unset SES_FROM_EMAIL PASSWORD_RESET_QUEUE_URL ADMIN_SEED_PASSWORD_PARAM || true

# --- object storage -----------------------------------------------------------
#
# Phase 4 endpoints do not just *sign* URLs, they delete real objects, so the
# suite runs against a scratch MinIO rather than signing into the void.
#
# Pointing **both** implementations at it is the awkward part. The source builds
# `new S3Client({ region })` with no endpoint and no way to configure one, so it
# cannot be aimed at MinIO through anything in this repo. The SDK's standard
# AWS_ENDPOINT_URL_S3 variable does it from outside, without touching the source
# — which is why S3_ENDPOINT (this app's own setting) stays unset: using it
# would redirect only the port, and the two sides would address different
# stores.
#
# That leaves addressing style. AWS_ENDPOINT_URL_S3 yields virtual-host URLs
# (bucket.localhost:9100) and the JS SDK has no env var for path-style, so MinIO
# is started with MINIO_DOMAIN=localhost to make it accept them. `*.localhost`
# resolves to loopback on macOS and Linux.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-contracttest}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-contracttest123}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
# Must match the literal the source falls back to, or the two sides would
# address different buckets.
export S3_BUCKET_NAME="${S3_BUCKET_NAME:-classyear-dev}"
export MINIO_PORT="${MINIO_PORT:-9100}"
export AWS_ENDPOINT_URL_S3="http://localhost:${MINIO_PORT}"
unset AWS_SESSION_TOKEN AWS_PROFILE || true
# Set to empty rather than unset. `unset` is not enough: ConfigModule loads the
# repo-root .env from disk and only fills in keys that are *absent* from the
# environment, so an S3_ENDPOINT there would come back and point the port at a
# different MinIO than the one the legacy side is using. An empty value is
# present, so dotenv leaves it alone, and the config treats it as unset.
export S3_ENDPOINT=""

MINIO_DATA="${TMPDIR:-/tmp}/classyear-contract-minio"
MINIO_PID=""

stop_minio() {
  if [ -n "$MINIO_PID" ]; then
    echo "==> Stopping scratch MinIO"
    kill "$MINIO_PID" 2>/dev/null || true
    wait "$MINIO_PID" 2>/dev/null || true
  fi
}
# Only ever stops an instance this script started; an already-running one on the
# port is left alone.
trap stop_minio EXIT

# Normally the `minio_test` service from docker-compose.yml is already up and
# this reuses it. The local-binary branch is a fallback for a machine without
# Docker — phases 0–3 were built that way.
if curl -sf -o /dev/null --max-time 2 "http://localhost:${MINIO_PORT}/minio/health/live"; then
  echo "==> Reusing MinIO already listening on :${MINIO_PORT}"
elif command -v minio >/dev/null 2>&1; then
  echo "==> Starting scratch MinIO on :${MINIO_PORT}"
  rm -rf "$MINIO_DATA" && mkdir -p "$MINIO_DATA"
  MINIO_ROOT_USER="$AWS_ACCESS_KEY_ID" \
  MINIO_ROOT_PASSWORD="$AWS_SECRET_ACCESS_KEY" \
  MINIO_DOMAIN=localhost \
    minio server "$MINIO_DATA" --address ":${MINIO_PORT}" \
    >"${MINIO_DATA}.log" 2>&1 &
  MINIO_PID=$!

  for _ in $(seq 1 30); do
    curl -sf -o /dev/null --max-time 1 "http://localhost:${MINIO_PORT}/minio/health/live" && break
    sleep 0.5
  done
  if ! curl -sf -o /dev/null --max-time 1 "http://localhost:${MINIO_PORT}/minio/health/live"; then
    echo "MinIO failed to start; see ${MINIO_DATA}.log" >&2
    exit 1
  fi
else
  echo "Nothing listening on :${MINIO_PORT}, and no local minio binary." >&2
  echo "The photo contract tests delete real objects, so an object store is required." >&2
  echo "  docker compose up -d minio_test     # preferred" >&2
  echo "  brew install minio                  # fallback, no Docker needed" >&2
  exit 1
fi

# psql/dropdb/createdb, wherever they live.
if ! command -v createdb >/dev/null 2>&1; then
  export PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH"
fi

echo "==> Resetting scratch database ($DB_NAME)"
dropdb --if-exists "$DB_NAME"
createdb "$DB_NAME"

echo "==> Building the API (contract tests import its compiled AppModule)"
npm --prefix "$REPO_ROOT" run build --silent >/dev/null

echo "==> Running contract suite"
cd "$REPO_ROOT/tools/contract-tests"
# Not `exec` — that would replace this shell and skip the EXIT trap, leaving the
# scratch MinIO running.
if [ $# -gt 0 ]; then
  npx vitest run -t "$1"
else
  npx vitest run
fi
