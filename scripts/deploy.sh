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
# classyear-serverless uses: this stack shares the network (and reuses its
# S3/SecretsManager/SSM endpoints) but NOT the database — §8.5 gives it its own
# Aurora cluster so neither app's migrations can break the other.
ENVIRONMENT="${ENVIRONMENT:-nest}"
DOMAIN_NAME="${DOMAIN_NAME:-nest.reunion-connect.org}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-Z0466195259YGZ44DUBMY}"
SES_SENDER_DOMAIN="${SES_SENDER_DOMAIN:-reunion-connect.org}"
VPC_ID="${VPC_ID:-vpc-021940e171925bd53}"
SUBNET_1="${SUBNET_1:-subnet-0dfdb663652cba578}"
SUBNET_2="${SUBNET_2:-subnet-08320caa36be4fa6c}"

# The EXISTING cluster and the security group that reaches it. This stack shares
# the database rather than creating one — the two apps are one product on two
# domains, and separate databases would fork the data (§23).
DATABASE_HOST="${DATABASE_HOST:-classyear-dev.cluster-cezswsoi8m3o.us-east-1.rds.amazonaws.com}"
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

# A guard, not a formality: if this stack ever claims an apex alias while the
# old one still holds it, CloudFront rejects the deploy — an alias is exclusive
# to one distribution account-wide (§8.6). Better to say so here than to read
# it out of a CloudFormation rollback.
case "$DOMAIN_NAME" in
  reunion-connect.org | www.reunion-connect.org | unicornconnections.org | www.unicornconnections.org)
    echo "DOMAIN_NAME is an apex/www name still aliased to the old distribution." >&2
    echo "That handover is phase 8: CloudFront allows one owner per alias" >&2
    echo "account-wide, so the old stack must release it first (§8.6)." >&2
    exit 1
    ;;
esac

OVERRIDES=(
  "JWTSecret=$JWT_SECRET"
  "Environment=$ENVIRONMENT"
  "DomainName=$DOMAIN_NAME"
  "HostedZoneId=$HOSTED_ZONE_ID"
  "SesSenderDomain=$SES_SENDER_DOMAIN"
  "VPC=$VPC_ID"
  "PrivateSubnet1=$SUBNET_1"
  "PrivateSubnet2=$SUBNET_2"
  "DatabaseHost=$DATABASE_HOST"
  "DatabaseSecretArn=$DATABASE_SECRET_ARN"
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
