# infra — the `classyear-nest` stack

`template.yaml` is the ~51k-line SAM template of the source app, rebuilt at
about 730 lines: **one** `ApiFunction` behind `{proxy+}/ANY` instead of 59
individually-declared functions wired to 68 route events, plus the
password-reset email worker.

```bash
JWT_SECRET=… ../scripts/deploy.sh --dry-run   # changeset only
JWT_SECRET=… ../scripts/deploy.sh             # for real: Lambda + infrastructure
../scripts/deploy-web.sh                      # then the SPA
../scripts/smoke-deployed.sh                  # post-deploy check
```

`JWT_SECRET` must be the production value: a different one deploys cleanly and
signs every user out. It is `NoEcho`, so it comes from wherever it is kept,
never from `openssl rand` unless a forced sign-out is the intent.

## Status

Deployed, serving `unicornconnections.org`, `www.` and
`nest.unicornconnections.org`. Every number below was true in November 2026.

## What this stack does not own

The Aurora cluster (`classyear-dev`), the photo bucket, the database and Lambda
security groups, and the S3 gateway endpoint belong to **`classyear-serverless`**,
the stack the old Express app left behind. It runs no code any more; it is
storage and networking. This stack references those resources by parameter,
so CloudFormation here can never replace or delete them.

Its template is not in this repo. To change one of its resources — as was done
for its endpoints, backup retention and the bucket's CORS rules — fetch the
deployed template, edit it, and apply a changeset that keeps every parameter:

```bash
aws cloudformation get-template --stack-name classyear-serverless \
  --template-stage Original --query TemplateBody --output text > serverless.yaml
# edit, then create-change-set with UsePreviousValue=true for every parameter
# (pass them as a JSON file), check the changeset, execute it
```

The VPC is the account's **default VPC** and belongs to no stack. Its IPv6
range was attached directly; see "Outbound IPv6" in `template.yaml`.

## Things that are load-bearing

**`Environment` defaults to `nest`, not `dev`.** Several names are
account-scoped and `classyear-serverless` already occupies the `dev` variants.

**No interface endpoints: outbound IPv6 instead.** The API function sits in
the private subnets to reach the database, and the VPC has no NAT. It reaches
Secrets Manager and SQS over IPv6 through a free egress-only internet gateway,
which replaced about $44 a month of interface endpoints (SSM, Secrets Manager,
SQS) in November 2026. See "Outbound IPv6" in `template.yaml`. S3 still goes
through the free gateway endpoint the old stack created.

**`SesSenderDomain` is separate from `DomainName`.** They are both
`unicornconnections.org` today, but they answer different questions — where the
app is served versus which identity SES will accept — and SES has an identity
for the apex and none for `nest.`.

**The schema is not this stack's to change.** `RUN_MIGRATIONS=false`, so a boot
never alters it; `apps/api/src/cli/init-schema.ts` applies schema changes
deliberately.

**No `BinarySettings`.** There is no multipart anywhere — photo uploads are
presigned PUTs the browser performs directly against S3.

**No warmer.** A scheduled function used to ping the API to keep it warm. It
was removed in November 2026: cold starts are acceptable at this traffic, and
the database auto-pauses after 15 idle minutes regardless.

**The account allows 10 concurrent Lambda executions.** Far above real traffic,
but a burst past it is throttled, and API Gateway answers a throttled request
with a 500 — which reads like an application failure. A load test needs a
quota increase first.

## The bastion is off by default

`BastionInstance` is a Session Manager host that `scripts/backup-db.sh` and
`scripts/restore-db.sh` tunnel through to the private cluster. It exists only
while `EnableBastion` is true, and `deploy.sh` defaults that to false, so the
next ordinary deploy removes it. To take a backup:

```bash
JWT_SECRET=… ENABLE_BASTION=true ../scripts/deploy.sh   # bastion back
../scripts/backup-db.sh
JWT_SECRET=… ../scripts/deploy.sh                       # and gone again
```

For recovery without it, the cluster keeps 7 days of automated backups for
point-in-time restore from the RDS console.

## Parameters live in `scripts/deploy.sh`, not here

`sam deploy --parameter-overrides` **replaces** `samconfig.toml`'s list rather
than merging with it, and `JWTSecret` has to come from the command line because
it is `NoEcho`. Splitting them guarantees the config-file half gets dropped —
which is exactly what happened the first time. `samconfig.toml` keeps only stack
name, region and bucket settings.

## The domains

This stack serves `unicornconnections.org` and `www.`, plus
`nest.unicornconnections.org` as a name of its own for checking a deploy. A
CloudFront alias is exclusive to one distribution account-wide, so `deploy.sh`
checks before every deploy that no *other* distribution holds the public names.
`reunion-connect.org` was served here too until November 2026, when it was
retired: its DNS zone, SES identity and registration are all deleted.
