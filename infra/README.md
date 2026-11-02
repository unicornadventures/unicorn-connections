# infra — the `classyear-nest` stack

`template.yaml` is the ~51k-line SAM template of the source app, rebuilt at
about 450 lines: **one** `ApiFunction` behind `{proxy+}/ANY` instead of 59
individually-declared functions wired to 68 route events, plus a warmer and the
password-reset email worker.

```bash
JWT_SECRET=$(openssl rand -hex 32) ../scripts/deploy.sh --dry-run   # changeset only
JWT_SECRET=…                       ../scripts/deploy.sh            # for real
../scripts/smoke-deployed.sh                                        # the phase 7 gate
```

## Status

Built and **changeset-verified against the real account** — CloudFormation
accepted a 32-resource changeset, so every `!Ref`/`!GetAtt`/`!Sub` resolves —
but **not deployed**. See `docs/nestjs-conversion-approach.md` §22.

## Things that are load-bearing

**`Environment` defaults to `nest`, not `dev`.** Several names are
account-scoped and `classyear-serverless` already occupies the `dev` variants.

**VPC endpoints are reused, not created.** The shared VPC already carries S3,
Secrets Manager and SSM endpoints from the old stack. AWS rejects a second
interface endpoint with private DNS for the same service, and a second S3
gateway endpoint on the same route table conflicts — declaring them again is
fatal, not redundant. Only SQS is created, because it genuinely does not exist
and the in-VPC proxy needs it to enqueue.

**`SesSenderDomain` is separate from `DomainName`.** They are both
`unicornconnections.org` today, but they answer different questions — where the
app is served versus which identity SES will accept — and SES has an identity
for the apex and none for `nest.`.

**The database is not shared.** Its own Aurora cluster, so neither app's
migrations can break the other. `SNAPSHOT_IDENTIFIER` restores it from a
snapshot of the live one for realistic data.

**No `BinarySettings`.** §8.2 expected multipart to need it; §17 established
there is no multipart anywhere — photo uploads are presigned PUTs the browser
performs directly against S3.

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
`reunion-connect.org` was served here too until it was retired on 2026-11-01.
