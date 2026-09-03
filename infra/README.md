# infra — placeholder (phase 7)

Deployment lives here: the SAM template, `samconfig.toml`, and the deploy scripts.

The point of the port, infrastructure-wise, is that this becomes small. The source app
declares **59 individual Lambda functions** wired to 68 API Gateway route events in a
~51,000-line `template.yaml`; adding one endpoint means editing YAML in three places.
Here it is one `ApiFunction` behind a `{proxy+}` catch-all, plus the warmer and the SQS
email worker, with the Aurora/S3/CloudFront/Route53/ACM resources carried across.

Two things to get right before the first deploy — both are in
`docs/nestjs-conversion-approach.md` §8.5–8.6:

- **Name collisions.** A second stack cannot reuse `classyear-serverless` or the
  account-and-environment-scoped bucket name `classyear-file-storage-${AWS::AccountId}-${Environment}`.
  Pick a distinct `Environment` value.
- **Domains.** This stack serves `nest.reunion-connect.org` until phase 8, then takes
  `reunion-connect.org` while the existing app keeps `unicornconnections.org`.
