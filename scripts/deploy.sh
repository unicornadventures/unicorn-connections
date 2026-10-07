#!/usr/bin/env bash
#
# Deploys the `classyear-nest` stack.
#
#   JWT_SECRET=... ./scripts/deploy.sh              # deploy
#   JWT_SECRET=... ./scripts/deploy.sh --dry-run    # changeset only, no execute
#
# This stack serves the four public names. That was not always true: through
# phases 7-8 it was additive, reachable only at nest.reunion-connect.org while
# classyear-serverless kept serving the apexes, and the handover was a separate
# step. The handover is done, the old stack is gone, and `CLAIM_PUBLIC_NAMES`
# now defaults to 'true' because this distribution is what answers for those
# names — see the parameter below for why the default matters.
#
# Only the Lambda and the infrastructure are deployed here. The SPA is
# `scripts/deploy-web.sh`, and it runs *after* this one.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# The full parameter set, in one place. Overridable from the environment so a
# different VPC or domain does not need an edit. These VPC ids are the ones
# classyear-serverless uses: this stack shares its network, its S3/SecretsManager/
# SSM endpoints, its Aurora cluster and its photo bucket.
ENVIRONMENT="${ENVIRONMENT:-nest}"
# The canonical domain. The other three public names are served by the
# same distribution; only this one goes in FRONTEND_URL and email links.
DOMAIN_NAME="${DOMAIN_NAME:-unicornconnections.org}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-Z04780762C3Q0K0DKRGSP}"
SECONDARY_DOMAIN_NAME="${SECONDARY_DOMAIN_NAME:-reunion-connect.org}"
SECONDARY_HOSTED_ZONE_ID="${SECONDARY_HOSTED_ZONE_ID:-Z0466195259YGZ44DUBMY}"
STAGING_DOMAIN_NAME="${STAGING_DOMAIN_NAME:-nest.reunion-connect.org}"
# 'true' since the cutover. This distribution holds the four public names and
# their DNS records, so the default has to assert that rather than ask for it:
# the parameter is what *creates* those records, and a deploy that defaulted to
# 'false' would quietly remove them — taking all four public domains down as a
# side effect of shipping something unrelated. It defaulted to 'false' through
# phases 7-8, when the old stack still held the aliases and claiming them early
# would have failed the deploy.
#
# `CLAIM_PUBLIC_NAMES=false ./scripts/deploy.sh` is now the deliberate rollback,
# and it is not a quiet one: it releases the aliases and deletes the records.
CLAIM_PUBLIC_NAMES="${CLAIM_PUBLIC_NAMES:-true}"
SES_SENDER_DOMAIN="${SES_SENDER_DOMAIN:-unicornconnections.org}"
VPC_ID="${VPC_ID:-vpc-021940e171925bd53}"
SUBNET_1="${SUBNET_1:-subnet-0dfdb663652cba578}"
SUBNET_2="${SUBNET_2:-subnet-08320caa36be4fa6c}"

# The EXISTING cluster and the security group that reaches it. This stack shares
# the database rather than creating one — the two apps are one product on two
# domains, and separate databases would fork the data.
DATABASE_HOST="${DATABASE_HOST:-classyear-dev.cluster-cezswsoi8m3o.us-east-1.rds.amazonaws.com}"
# The EXISTING photo bucket, shared for the same reason. A bucket of this
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

# The apex guard.
#
# It used to refuse any apex DOMAIN_NAME outright, on the grounds that the old
# distribution held those aliases and CloudFront allows one owner per alias
# account-wide. The cutover is when that stopped being true, so refusing by
# *name* would now block the very deploy it was written to protect.
#
# So it asks CloudFront instead. An alias held by *another* distribution is the
# actual failure condition, and this reports it before a rollback does.
#
# Since the default became 'true' this runs on every deploy, which is worth
# having: it is the one check that would notice the names drifting to another
# distribution. "ours" and "unclaimed" are reported separately, because after
# the cutover they mean different things — the first is the expected steady
# state, the second says the records are missing and this deploy will recreate
# them.
if [ "$CLAIM_PUBLIC_NAMES" = "true" ]; then
  echo "==> Checking the four public aliases"
  OURS="$(aws cloudformation describe-stacks --stack-name classyear-nest --region us-east-1 \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" \
    --output text 2>/dev/null || echo none)"

  blocked=0
  for name in "$DOMAIN_NAME" "www.$DOMAIN_NAME" \
              "$SECONDARY_DOMAIN_NAME" "www.$SECONDARY_DOMAIN_NAME"; do
    holder="$(aws cloudfront list-distributions --region us-east-1 \
      --query "DistributionList.Items[?contains(Aliases.Items || \`[]\`, '$name')].Id | [0]" \
      --output text 2>/dev/null || echo None)"

    if [ "$holder" = "$OURS" ]; then
      printf '    %-32s ours\n' "$name"
    elif [ "$holder" = "None" ] || [ -z "$holder" ]; then
      printf '    %-32s unclaimed — this deploy will claim it\n' "$name"
    else
      printf '    %-32s HELD by %s\n' "$name" "$holder" >&2
      blocked=1
    fi
  done

  if [ "$blocked" = "1" ]; then
    echo >&2
    echo "One or more aliases still belong to another distribution. Deploy the" >&2
    echo "OLD stack with its aliases and DNS records removed first — CloudFront" >&2
    echo "allows one owner per alias account-wide." >&2
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

  # Trust nothing: prove afterwards that the stack did not move.
  #
  # This used to read the stack status and accept only ABSENT or
  # REVIEW_IN_PROGRESS, on the grounds that a dry-run leaves nothing behind.
  # That holds for a stack which has never been deployed, and is wrong for
  # every dry-run after the first: a *pending* changeset correctly leaves an
  # existing stack UPDATE_COMPLETE, so the check fired "the changeset was
  # executed" on honest dry-runs. A warning that cries wolf every time is one
  # nobody reads the day it is right.
  #
  # Whether it ran is a question about change, so compare before and after
  # rather than guessing which statuses are reachable.
  fingerprint() {
    aws cloudformation describe-stacks --stack-name classyear-nest \
      --region us-east-1 --query 'Stacks[0].[StackStatus,LastUpdatedTime]' \
      --output text 2>/dev/null || echo ABSENT
  }
  before="$(fingerprint)"

  # Both flags. --no-execute-changeset alone was not enough: with
  # confirm_changeset=true in samconfig, a dry-run created the stack anyway.
  #
  # Output is captured rather than streamed because the exit status has to be
  # inspected: `sam deploy` treats an empty changeset as an *error*, and under
  # `set -e` that killed the dry-run before it reported anything at all.
  # "Nothing to deploy" is the most reassuring thing a dry-run can say.
  set +e
  sam_out="$(sam deploy --no-execute-changeset --no-confirm-changeset \
    --parameter-overrides "${OVERRIDES[@]}" 2>&1)"
  sam_rc=$?
  set -e
  printf '%s\n' "$sam_out"

  if [ "$sam_rc" -ne 0 ]; then
    if printf '%s' "$sam_out" | grep -q 'No changes to deploy'; then
      echo
      echo "==> No changes — the deployed stack already matches this template."
      exit 0
    fi
    echo >&2
    echo "==> sam deploy failed (exit $sam_rc) — see the output above." >&2
    exit "$sam_rc"
  fi

  after="$(fingerprint)"
  echo
  echo "==> Stack after dry-run: $after"

  # The one legitimate transition: the first changeset against a stack that
  # does not exist yet brings it into being as REVIEW_IN_PROGRESS.
  if [ "$before" = "$after" ]; then
    echo "    unchanged — changeset created, not executed."
  elif [ "$before" = "ABSENT" ] && [ "${after%%[[:space:]]*}" = "REVIEW_IN_PROGRESS" ]; then
    echo "    new stack in REVIEW_IN_PROGRESS — changeset created, not executed."
  else
    echo "    ^ the stack CHANGED (was: $before). The changeset was executed." >&2
    exit 1
  fi
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
