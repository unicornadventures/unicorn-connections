#!/usr/bin/env bash
#
# The deployment gate, in three parts:
#
#   1. the stack answers,
#   2. photos resolve and uploads are allowed to preflight (§27), and
#   3. **all four public names are served by the new distribution** (§29).
#
# Part 3 was the reverse of this until the apex handover: through phase 7 every
# change was additive, and the gate asserted that neither live domain had
# started resolving to the new distribution. Phase 8 inverted it. The check was
# rewritten rather than deleted, because the weak version — "all four answer
# 200" — passed happily on the morning after the cutover while asserting the
# opposite of what had just been done. A gate that cannot fail is not a gate,
# so this one compares the distribution actually serving each name.
#
#   ./scripts/smoke-deployed.sh
set -euo pipefail

STACK="${STACK:-classyear-nest}"
REGION="${REGION:-us-east-1}"
OLD_STACK="${OLD_STACK:-classyear-serverless}"

out() {
  aws cloudformation describe-stacks --stack-name "$1" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text 2>/dev/null
}

fail=0
check() { # description, expected, actual
  if [ "$2" = "$3" ]; then
    printf '  ✅ %-52s %s\n' "$1" "$3"
  else
    printf '  ❌ %-52s got %s, expected %s\n' "$1" "$3" "$2"
    fail=1
  fi
}

echo "==> New stack ($STACK)"
PULSE="$(out "$STACK" PulseUrl)"
FRONTEND="$(out "$STACK" FrontendUrl)"

if [ -z "$PULSE" ]; then
  echo "  Stack not found or has no outputs — has it been deployed?" >&2
  exit 1
fi

# A cold Aurora cluster takes ~15s to resume, and /pulse does not touch the
# database — but the function's cold start still has to complete.
code="$(curl -s -o /tmp/pulse-body -w '%{http_code}' --max-time 60 "$PULSE" || echo 000)"
check "GET /pulse" 200 "$code"
if [ "$code" = "200" ]; then
  printf '     %s\n' "$(cat /tmp/pulse-body)"
fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "${PULSE%/pulse}/api/schools" || echo 000)"
check "GET /api/schools (public, hits the database)" 200 "$code"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${PULSE%/pulse}/api/users/1" || echo 000)"
check "GET /api/users/1 unauthenticated is refused" 401 "$code"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$FRONTEND" || echo 000)"
check "frontend over HTTPS" 200 "$code"

# ---------------------------------------------------------------------------
# Photos (docs §27)
# ---------------------------------------------------------------------------
#
# This section exists because the four checks above all passed for a day while
# every photo on the site 404'd. The stack had its own file bucket, the shared
# database's keys named objects in the *other* one, and nothing here ever
# loaded an image. Four green ticks and a feature that had never once worked.
#
# No login needed for any of it: the bucket is asked directly.

echo
echo "==> Photos"

BUCKET="$(aws lambda get-function-configuration \
  --function-name "classyear-nest-api-${ENVIRONMENT:-nest}" --region "$REGION" \
  --query 'Environment.Variables.S3_BUCKET_NAME' --output text 2>/dev/null)"

# The keys live in the shared database, so the bucket the API signs against has
# to be the one holding the objects. An empty bucket here is the §27 bug.
# --max-keys, not --max-items: the latter is CLI-side pagination and prints the
# NextToken as a second line, which silently turns $KEY into two lines.
KEY="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix photos/ --max-keys 1 \
  --query 'Contents[0].Key' --output text 2>/dev/null || echo None)"

if [ "$KEY" = "None" ] || [ -z "$KEY" ]; then
  printf '  ❌ %-52s %s\n' "photo bucket holds objects" "$BUCKET is EMPTY"
  fail=1
else
  printf '  ✅ %-52s %s\n' "photo bucket holds objects" "$BUCKET"
  url="$(aws s3 presign "s3://$BUCKET/$KEY" --region "$REGION" --expires-in 120)"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$url" || echo 000)"
  check "presigned GET of a real photo" 200 "$code"
fi

# Uploads are presigned PUTs from the browser, so the *bucket* answers the
# preflight. Display needs none of this — which is why a missing origin looks
# like "uploads are broken" while pictures still appear. Both directions are
# checked: the origin must be allowed, and an unlisted one must not be.
preflight() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X OPTIONS \
    "https://${BUCKET}.s3.amazonaws.com/${KEY}" \
    -H "Origin: $1" -H 'Access-Control-Request-Method: PUT' || echo 000
}
check "upload preflight from $FRONTEND" 200 "$(preflight "$FRONTEND")"
check "upload preflight from an unlisted origin is refused" 403 \
  "$(preflight https://not-an-origin.example.com)"

echo
echo "==> All four public names must be served by the NEW app ($STACK)"

NEW_DIST="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" --output text 2>/dev/null)"
NEW_HOST="$(aws cloudfront get-distribution --id "$NEW_DIST" \
  --query 'Distribution.DomainName' --output text 2>/dev/null || echo unknown)"

for domain in unicornconnections.org www.unicornconnections.org \
              reunion-connect.org www.reunion-connect.org; do
  # An alias record resolves to the distribution's addresses, so the IP says
  # nothing — ask which distribution actually holds the alias.
  holder="$(aws cloudfront list-distributions --region "$REGION" \
    --query "DistributionList.Items[?contains(Aliases.Items || \`[]\`, '$domain')].Id | [0]" \
    --output text 2>/dev/null || echo None)"
  served="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$domain" || echo 000)"

  if [ "$served" = "200" ] && [ "$holder" = "$NEW_DIST" ]; then
    printf '  ✅ %-30s HTTP %s, served by %s\n' "$domain" "$served" "$holder"
  else
    printf '  ❌ %-30s HTTP %s, alias held by %s (expected %s)\n' \
      "$domain" "$served" "$holder" "$NEW_DIST" >&2
    fail=1
  fi
done

# The old distribution must hold nothing. A name left behind there is the one
# way this could look right per-name and still be half migrated.
OLD_DIST="$(out "$OLD_STACK" FrontendDistributionId)"
if [ -n "$OLD_DIST" ] && [ "$OLD_DIST" != "None" ]; then
  remaining="$(aws cloudfront get-distribution-config --id "$OLD_DIST" \
    --query 'DistributionConfig.Aliases.Quantity' --output text 2>/dev/null || echo 0)"
  check "old distribution ($OLD_DIST) holds no aliases" 0 "$remaining"
else
  printf '  ✅ %-52s %s\n' "old stack is gone" "no distribution to check"
fi

echo
echo "  new distribution: $NEW_DIST ($NEW_HOST)"

echo
if [ "$fail" = "0" ]; then
  echo "✅ Gate: the new app answers, serves all four public names, and photos work."
else
  echo "❌ Gate failed — see above." >&2
  exit 1
fi
