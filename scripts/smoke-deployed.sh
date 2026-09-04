#!/usr/bin/env bash
#
# The phase 7 gate, in two halves (docs §10):
#
#   1. the deployed stack answers, and
#   2. **both live domains are still served by the old app**.
#
# The second half is the one that matters. Everything through phase 7 is
# additive, and this is what proves it — if either live domain has started
# resolving to the new distribution, something has gone wrong and the deploy
# needs backing out, not debugging.
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

echo
echo "==> Both live domains must still be served by the OLD app ($OLD_STACK)"

OLD_DIST="$(out "$OLD_STACK" FrontendDistributionId)"
NEW_DIST="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" --output text 2>/dev/null)"
OLD_HOST="$(aws cloudfront get-distribution --id "$OLD_DIST" \
  --query 'Distribution.DomainName' --output text 2>/dev/null || echo unknown)"

for domain in reunion-connect.org www.reunion-connect.org \
              unicornconnections.org www.unicornconnections.org; do
  target="$(dig +short "$domain" CNAME | head -1)"
  [ -z "$target" ] && target="$(dig +short "$domain" A | head -1)"
  # An alias record resolves to the distribution's addresses, so compare the
  # answering CloudFront host rather than the IP.
  served="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$domain" || echo 000)"
  printf '  %-30s HTTP %s\n' "$domain" "$served"
  [ "$served" = "200" ] || fail=1
done

echo
echo "  old distribution: $OLD_DIST ($OLD_HOST)"
echo "  new distribution: $NEW_DIST  <- must NOT be serving the four names above"

echo
if [ "$fail" = "0" ]; then
  echo "✅ Phase 7 gate: new stack answers, both live domains untouched."
else
  echo "❌ Phase 7 gate failed — see above." >&2
  exit 1
fi
