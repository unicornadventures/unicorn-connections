#!/usr/bin/env bash
#
# Deploys the `classyear-nest` stack (docs §8.5, §8.6).
#
#   JWT_SECRET=... ./scripts/deploy.sh              # deploy
#   JWT_SECRET=... ./scripts/deploy.sh --dry-run    # changeset only, no execute
#
# This stack is **additive**. It is served from nest.reunion-connect.org, a
# subdomain alias that does not touch the apex records pointing at the old
# distribution — so both live domains keep being served by classyear-serverless
# throughout. Handing over the apex is phase 8 and is not done here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# The full parameter set, in one place. Overridable from the environment so a
# different VPC or domain does not need an edit. These VPC ids are the ones
# classyear-serverless uses: this stack shares its network, its S3/SecretsManager/
# SSM endpoints, its Aurora cluster (§23) and its photo bucket (§27).
ENVIRONMENT="${ENVIRONMENT:-nest}"
# The canonical domain (§29). The other three public names are served by the
# same distribution; only this one goes in FRONTEND_URL and email links.
DOMAIN_NAME="${DOMAIN_NAME:-unicornconnections.org}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-Z04780762C3Q0K0DKRGSP}"
SECONDARY_DOMAIN_NAME="${SECONDARY_DOMAIN_NAME:-reunion-connect.org}"
SECONDARY_HOSTED_ZONE_ID="${SECONDARY_HOSTED_ZONE_ID:-Z0466195259YGZ44DUBMY}"
STAGING_DOMAIN_NAME="${STAGING_DOMAIN_NAME:-nest.reunion-connect.org}"
# 'false' until the old stack has released the four public aliases. Flipping it
# to 'true' IS the cutover.
CLAIM_PUBLIC_NAMES="${CLAIM_PUBLIC_NAMES:-false}"
SES_SENDER_DOMAIN="${SES_SENDER_DOMAIN:-unicornconnections.org}"
VPC_ID="${VPC_ID:-vpc-021940e171925bd53}"
SUBNET_1="${SUBNET_1:-subnet-0dfdb663652cba578}"
SUBNET_2="${SUBNET_2:-subnet-08320caa36be4fa6c}"

# The EXISTING cluster and the security group that reaches it. This stack shares
# the database rather than creating one — the two apps are one product on two
# domains, and separate databases would fork the data (§23).
DATABASE_HOST="${DATABASE_HOST:-classyear-dev.cluster-cezswsoi8m3o.us-east-1.rds.amazonaws.com}"
# The EXISTING photo bucket, shared for the same reason (§27). A bucket of this
# stack's own holds none of the objects the shared database's keys name.
FILE_BUCKET_NAME="${FILE_BUCKET_NAME:-classyear-file-storage-372666940943-dev}"
DATABASE_SECRET_ARN="${DATABASE_SECRET_ARN:-arn:aws:secretsmanager:us-east-1:372666940943:secret:rds!cluster-328925d7-720f-4ad3-9694-8c52236e81f2-yt8gVR}"
LAMBDA_SECURITY_GROUP_ID="${LAMBDA_SECURITY_GROUP_ID:-sg-02fa56b60b644cc22}"

if [ -z "${JWT_SECRET:-}" ]; then
  echo "JWT_SECRET is required (NoEcho in the template, never committed)." >&2
  echo "  JWT_SECRET=\$(openssl rand -hex 32) ./scripts/deploy.sh" >&2
  exit 1
fi

echo "==> Bundling Lambda artifacts"
"$REPO_ROOT/scripts/bundle-lambda.sh"

cd "$REPO_ROOT/infra"

echo "==> Validating"
sam validate --lint --region us-east-1

# The apex guard, phase 8 edition.
#
# It used to refuse any apex DOMAIN_NAME outright, on the grounds that the old
# distribution held those aliases and CloudFront allows one owner per alias
# account-wide (§8.6). Phase 8 is when that stops being true, so refusing by
# *name* would now block the very deploy it was written to protect.
#
# So it asks CloudFront instead. An alias still held by another distribution is
# the actual failure condition, and this reports it before a rollback does.
if [ "$CLAIM_PUBLIC_NAMES" = "true" ]; then
  echo "==> Checking the four public aliases are free to claim"
  OURS="$(aws cloudformation describe-stacks --stack-name classyear-nest --region us-east-1 \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" \
    --output text 2>/dev/null || echo none)"

  blocked=0
  for name in "$DOMAIN_NAME" "www.$DOMAIN_NAME" \
              "$SECONDARY_DOMAIN_NAME" "www.$SECONDARY_DOMAIN_NAME"; do
    holder="$(aws cloudfront list-distributions --region us-east-1 \
      --query "DistributionList.Items[?contains(Aliases.Items || \`[]\`, '$name')].Id | [0]" \
      --output text 2>/dev/null || echo None)"

    if [ "$holder" = "None" ] || [ -z "$holder" ] || [ "$holder" = "$OURS" ]; then
      printf '    %-32s free\n' "$name"
    else
      printf '    %-32s STILL HELD by %s\n' "$name" "$holder" >&2
      blocked=1
    fi
  done

  if [ "$blocked" = "1" ]; then
    echo >&2
    echo "One or more aliases still belong to another distribution. Deploy the" >&2
    echo "OLD stack with its aliases and DNS records removed first — CloudFront" >&2
    echo "allows one owner per alias account-wide (§29)." >&2
    exit 1
  fi
fi

OVERRIDES=(
  "JWTSecret=$JWT_SECRET"
  "Environment=$ENVIRONMENT"
  "DomainName=$DOMAIN_NAME"
  "HostedZoneId=$HOSTED_ZONE_ID"
  "SecondaryDomainName=$SECONDARY_DOMAIN_NAME"
  "SecondaryHostedZoneId=$SECONDARY_HOSTED_ZONE_ID"
  "StagingDomainName=$STAGING_DOMAIN_NAME"
  "ClaimPublicNames=$CLAIM_PUBLIC_NAMES"
  "SesSenderDomain=$SES_SENDER_DOMAIN"
  "VPC=$VPC_ID"
  "PrivateSubnet1=$SUBNET_1"
  "PrivateSubnet2=$SUBNET_2"
  "DatabaseHost=$DATABASE_HOST"
  "DatabaseSecretArn=$DATABASE_SECRET_ARN"
  "FileBucketName=$FILE_BUCKET_NAME"
  "LambdaSecurityGroupId=$LAMBDA_SECURITY_GROUP_ID"
)

if $DRY_RUN; then
  echo "==> Creating a changeset only (nothing will be executed)"
  # Both flags. --no-execute-changeset alone was not enough: with
  # confirm_changeset=true in samconfig, a dry-run created the stack anyway.
  sam deploy --no-execute-changeset --no-confirm-changeset \
    --parameter-overrides "${OVERRIDES[@]}"

  # Trust nothing: report what actually exists afterwards. A dry-run should
  # leave the stack absent or REVIEW_IN_PROGRESS — anything else means it ran.
  status="$(aws cloudformation describe-stacks --stack-name classyear-nest \
    --region us-east-1 --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo ABSENT)"
  echo
  echo "==> Stack status after dry-run: $status"
  case "$status" in
    ABSENT | REVIEW_IN_PROGRESS) ;;
    *) echo "    ^ NOT a dry-run outcome. The changeset was executed." >&2 ;;
  esac
  exit 0
fi

echo "==> Deploying (this executes — no prompt)"
sam deploy --no-confirm-changeset --parameter-overrides "${OVERRIDES[@]}"

echo
echo "==> Outputs"
aws cloudformation describe-stacks --stack-name classyear-nest --region us-east-1 \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' --output table

echo
echo "Next: build the SPA against the new API and sync it to the frontend bucket,"
echo "then run ./scripts/smoke-deployed.sh to check the stack answers."
