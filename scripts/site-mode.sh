#!/usr/bin/env bash
#
# Switches the site between live and paused, without touching any data.
#
#   ./scripts/site-mode.sh status            # which mode it is in
#   ./scripts/site-mode.sh pause             # show the "back soon" page, switch the API off
#   ./scripts/site-mode.sh live              # switch the API on, republish the SPA
#   ./scripts/site-mode.sh pause --dry-run   # say what it would do, change nothing
#
# **Pausing deletes nothing.** The database, the photos, every account and every
# session stay exactly where they are; only the front door closes:
#
#   * The SPA's index.html is replaced with infra/maintenance/index.html.
#     CloudFront already answers every unknown path with index.html (the SPA
#     fallback in template.yaml), so that one file covers every URL — deep
#     links and bookmarks included. The SPA's assets stay in the bucket,
#     unreferenced, so nothing has to be put back but index.html.
#   * The API function's reserved concurrency is set to 0, so it never runs:
#     API Gateway answers every call with an error and nothing — a bot, an old
#     tab, a direct API call — can wake the database, which stays paused and
#     costs next to nothing. CloudFormation leaves this alone on later deploys,
#     because the template does not set reserved concurrency.
#
# Going live reverses that in the deploy order: the API first, then the SPA
# (via deploy-web.sh, which rebuilds and republishes it), because a UI calling
# an API that is still off is the visible failure.
#
# While paused, smoke-deployed.sh fails by design — it checks a live site.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${STACK:-classyear-nest}"
REGION="${REGION:-us-east-1}"
PAGE="$REPO_ROOT/infra/maintenance/index.html"
MARKER='name="site-mode" content="paused"'

MODE="${1:-}"
DRY_RUN=false
[ "${2:-}" = "--dry-run" ] && DRY_RUN=true
case "$MODE" in
  status|pause|live) ;;
  *) echo "Usage: $0 status | pause [--dry-run] | live [--dry-run]" >&2; exit 2 ;;
esac

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
BUCKET="$(out FrontendBucketName)"
DISTRIBUTION="$(out FrontendDistributionId)"
FRONTEND_URL="$(out FrontendUrl)"
API_FUNCTION="$(aws cloudformation describe-stack-resource --stack-name "$STACK" --region "$REGION" \
  --logical-resource-id ApiFunction --query StackResourceDetail.PhysicalResourceId --output text)"
for v in BUCKET DISTRIBUTION FRONTEND_URL API_FUNCTION; do
  if [ -z "${!v}" ] || [ "${!v}" = "None" ]; then
    echo "Could not read $v from the $STACK stack." >&2; exit 1
  fi
done

page_mode() {
  if aws s3 cp "s3://$BUCKET/index.html" - --region "$REGION" 2>/dev/null | grep -q "$MARKER"; then
    echo paused
  else
    echo live
  fi
}

api_mode() {
  local reserved
  reserved="$(aws lambda get-function-concurrency --function-name "$API_FUNCTION" \
    --region "$REGION" --query ReservedConcurrentExecutions --output text)"
  [ "$reserved" = "0" ] && echo off || echo on
}

report() {
  printf '    %-10s %s\n' "page" "$(page_mode)  (s3://$BUCKET/index.html)"
  printf '    %-10s %s\n' "API" "$(api_mode)  ($API_FUNCTION)"
}

case "$MODE" in
  status)
    echo "==> $FRONTEND_URL"
    report
    ;;

  pause)
    [ -f "$PAGE" ] || { echo "No maintenance page at $PAGE" >&2; exit 1; }
    grep -q "$MARKER" "$PAGE" || { echo "$PAGE lacks the site-mode marker." >&2; exit 1; }
    if $DRY_RUN; then
      echo "==> Dry run: would replace s3://$BUCKET/index.html with $(basename "$PAGE"),"
      echo "    invalidate $DISTRIBUTION, and set $API_FUNCTION's reserved concurrency to 0."
      report
      exit 0
    fi

    # The page first: from here on no browser is sent to the API.
    echo "==> Publishing the back-soon page"
    aws s3 cp "$PAGE" "s3://$BUCKET/index.html" --region "$REGION" \
      --cache-control 'no-cache,no-store,must-revalidate' --content-type text/html >/dev/null
    aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/*' \
      --query 'Invalidation.Id' --output text | sed 's/^/    invalidation /'

    echo "==> Switching the API off"
    aws lambda put-function-concurrency --function-name "$API_FUNCTION" --region "$REGION" \
      --reserved-concurrent-executions 0 >/dev/null

    echo
    report
    echo
    echo "Paused. CloudFront takes a minute or two to show the page everywhere."
    echo "  Back on with: ./scripts/site-mode.sh live"
    ;;

  live)
    if $DRY_RUN; then
      echo "==> Dry run: would remove $API_FUNCTION's reserved concurrency, then run"
      echo "    deploy-web.sh to rebuild and republish the SPA."
      report
      exit 0
    fi

    # The API first: a live UI calling an API that is still off is the
    # user-visible failure; the reverse is invisible.
    echo "==> Switching the API on"
    aws lambda delete-function-concurrency --function-name "$API_FUNCTION" --region "$REGION"

    echo "==> Republishing the SPA"
    "$REPO_ROOT/scripts/deploy-web.sh"

    echo
    report
    echo
    echo "Live. Check it with: ./scripts/smoke-deployed.sh"
    ;;
esac
