#!/usr/bin/env bash
#
# Builds the SPA and publishes it to the `classyear-nest` frontend bucket.
#
#   ./scripts/deploy-web.sh              # build, sync, invalidate
#   ./scripts/deploy-web.sh --dry-run    # build and report, change nothing
#
# This is the second half of a deploy. `scripts/deploy.sh` ships the Lambda and
# the infrastructure; nothing in it touches the SPA, and its closing message
# used to hand that step to whoever was reading. Doing it by hand is how the
# client ends up a release behind the API it talks to.
#
# **Run this after deploy.sh, never before.** The API accepting something the
# UI does not yet offer is invisible; a UI offering something the API still
# rejects is a user-visible error.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${STACK:-classyear-nest}"
REGION="${REGION:-us-east-1}"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null
}

echo "==> Reading stack outputs ($STACK)"
BUCKET="$(out FrontendBucketName)"
DISTRIBUTION="$(out FrontendDistributionId)"
API_ENDPOINT="$(out ApiEndpoint)"
FRONTEND_URL="$(out FrontendUrl)"

for pair in "FrontendBucketName:$BUCKET" "FrontendDistributionId:$DISTRIBUTION" \
            "ApiEndpoint:$API_ENDPOINT" "FrontendUrl:$FRONTEND_URL"; do
  if [ -z "${pair#*:}" ] || [ "${pair#*:}" = "None" ]; then
    echo "Missing stack output ${pair%%:*} — has ./scripts/deploy.sh run?" >&2
    exit 1
  fi
done

# The deployed SPA calls the API **cross-origin**, at its API Gateway URL.
#
# Not the relative `/api` that apps/web/.env.example suggests: the CloudFront
# distribution has exactly one origin, the S3 bucket, and no /api behaviour. A
# relative call would hit S3, 404, and come back as index.html with a 200 from
# the SPA fallback — an API client receiving HTML where it expects JSON. The
# template says as much where it sets CORS_ORIGINS ("every deployed API call is
# cross-origin") and lists this bucket's origin there so the browser allows it.
export VITE_API_BASE_URL="${API_ENDPOINT}/api"

printf '    %-24s %s\n' "bucket" "$BUCKET"
printf '    %-24s %s\n' "distribution" "$DISTRIBUTION"
printf '    %-24s %s\n' "VITE_API_BASE_URL" "$VITE_API_BASE_URL"
printf '    %-24s %s\n' "serving" "$FRONTEND_URL"

echo "==> Building the SPA"
npm --prefix "$REPO_ROOT" run build --workspace @classyear/shared-types --silent
npm --prefix "$REPO_ROOT" run build --workspace @classyear/web --silent

DIST="$REPO_ROOT/apps/web/dist"
[ -f "$DIST/index.html" ] || { echo "No build output in $DIST" >&2; exit 1; }

# Vite fingerprints everything under assets/, so those are immutable and cached
# hard. index.html is not fingerprinted — it is the file that names the current
# bundles, so caching it is how a browser keeps loading last release's assets.
if $DRY_RUN; then
  echo "==> Dry run: would sync these, then invalidate (nothing is uploaded)"
  aws s3 sync "$DIST" "s3://$BUCKET" --delete --exclude index.html \
    --region "$REGION" --dryrun
  aws s3 cp "$DIST/index.html" "s3://$BUCKET/index.html" --region "$REGION" --dryrun
  echo
  echo "==> Nothing changed. Drop --dry-run to publish."
  exit 0
fi

echo "==> Syncing fingerprinted assets"
aws s3 sync "$DIST" "s3://$BUCKET" --delete --exclude index.html \
  --region "$REGION" --cache-control 'public,max-age=31536000,immutable'

echo "==> Uploading index.html (never cached)"
aws s3 cp "$DIST/index.html" "s3://$BUCKET/index.html" --region "$REGION" \
  --cache-control 'no-cache,no-store,must-revalidate' --content-type text/html

# Only index.html needs purging — the assets it points at are new paths. The
# wildcard is for the edge case of a rolled-back bundle whose name repeats.
echo "==> Invalidating CloudFront ($DISTRIBUTION)"
INVALIDATION="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" \
  --paths '/*' --query 'Invalidation.Id' --output text)"
echo "    invalidation $INVALIDATION created (propagation takes a minute or two)"

echo
echo "==> Published to $FRONTEND_URL"
echo "Next: ./scripts/smoke-deployed.sh"
