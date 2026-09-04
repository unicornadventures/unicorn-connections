#!/usr/bin/env bash
#
# Phase 6 gate: drive the web client against a **real** Nest server.
#
# Every other Playwright spec mocks the API with page.route, so the suite would
# pass against no backend at all. This boots the API, seeds a minimal class, and
# runs e2e/live-api.spec.ts, which logs in for real.
#
#   ./scripts/smoke-web.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export DB_HOST="${DB_HOST:-localhost}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-classyear_smoke}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-password}"
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD"

export JWT_SECRET="${JWT_SECRET:-smoke-test-secret}"
export PORT="${PORT:-5001}"
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
export NODE_ENV=development
# The client reaches the API through the Vite dev proxy, so it is same-origin
# and CORS never enters into it — the same path a developer uses.
export VITE_API_BASE_URL=/api

if ! command -v createdb >/dev/null 2>&1; then
  export PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH"
fi

API_PID=""
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Resetting smoke database ($DB_NAME)"
dropdb --if-exists "$DB_NAME"
createdb "$DB_NAME"

echo "==> Building"
npm --prefix "$REPO_ROOT" run build --silent >/dev/null

echo "==> Starting the API on :$PORT (this also runs the migrations)"
node "$REPO_ROOT/apps/api/dist/main.js" >"${TMPDIR:-/tmp}/smoke-api.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 40); do
  curl -sf -o /dev/null --max-time 1 "http://localhost:${PORT}/pulse" && break
  sleep 0.5
done
if ! curl -sf -o /dev/null --max-time 1 "http://localhost:${PORT}/pulse"; then
  echo "API did not come up; see ${TMPDIR:-/tmp}/smoke-api.log" >&2
  exit 1
fi

echo "==> Seeding one school, one class, one member"
# The password hash is generated rather than pasted, so it is genuinely the
# hash of what the test types.
HASH="$(node -e "console.log(require('bcryptjs').hashSync('correct-horse', 10))")"
psql -d "$DB_NAME" -q <<SQL
INSERT INTO schools (id, name, location, timezone)
  VALUES (1, 'Springfield High', 'Springfield', 'America/Chicago');
INSERT INTO classes (id, year) VALUES (1, 1994) ON CONFLICT DO NOTHING;
INSERT INTO class_school (class_id, school_id)
  SELECT id, 1 FROM classes WHERE year = 1994;
INSERT INTO users (id, email, password, is_admin, is_class_admin)
  VALUES (10, 'ada@example.com', '$HASH', false, false);
INSERT INTO profiles (user_id, first_name, last_name) VALUES (10, 'Ada', 'Lovelace');
INSERT INTO class_user (class_id, user_id, school_id)
  SELECT id, 10, 1 FROM classes WHERE year = 1994;
SELECT setval('users_id_seq', 100, false);
SELECT setval('profiles_id_seq', 100, false);
SELECT setval('schools_id_seq', 100, false);
SQL

echo "==> Running the live-API e2e"
cd "$REPO_ROOT/apps/web"
E2E_LIVE_API=1 npx playwright test e2e/live-api.spec.ts --project=chromium --reporter=line
