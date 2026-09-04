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

export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-classyear_contract}"
export DB_USER="${DB_USER:-$(whoami)}"
export DB_PASSWORD="${DB_PASSWORD:-postgres}"

# Both implementations must sign with the same key for tokens to be comparable.
export JWT_SECRET="${JWT_SECRET:-contract-test-secret}"
export NODE_ENV=test
export FEEDBACK_ENABLED=true
# Unset so EmailService logs instead of calling SES, and forgot-password sends
# inline instead of reaching for a queue that does not exist locally.
unset SES_FROM_EMAIL PASSWORD_RESET_QUEUE_URL ADMIN_SEED_PASSWORD_PARAM || true

# Photo fields come back as presigned S3 URLs, which the SDK refuses to build
# without credentials. Nothing is ever sent to S3 — presigning is pure local
# signing — so placeholder credentials are enough, and both implementations
# sign with the same ones. The bucket and region must match the defaults the
# source falls back to ('classyear-dev', us-east-1) or the two sides would
# address different objects. S3_ENDPOINT stays unset so neither side is
# redirected at LocalStack. The harness compares URLs path-only; see normalize.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-contract-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-contract-test}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export S3_BUCKET_NAME="${S3_BUCKET_NAME:-classyear-dev}"
unset AWS_SESSION_TOKEN AWS_PROFILE S3_ENDPOINT || true

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
if [ $# -gt 0 ]; then
  exec npx vitest run -t "$1"
fi
exec npx vitest run
