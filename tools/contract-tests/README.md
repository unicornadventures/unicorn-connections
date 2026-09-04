# contract-tests — the parity gate

For each ported endpoint, issues the same request against **both** the source implementation
and this NestJS app, seeded from the same fixture database, and asserts:

- identical status code
- deep-equal response body

Run it from the repo root:

```bash
npm run contract:verify           # everything
npm run contract:verify -- users  # filter by test name
```

`scripts/run-contract-tests.sh` creates a scratch database, points both implementations at
it, builds the API, and runs the suite. The source repo (`LEGACY_REPO`, default
`~/Code/ClassYear`) is only ever read.

## The source side is the Lambda handlers, not the Express server

§7.3 of the conversion doc assumed this would boot the old Express app from a git worktree
and diff HTTP. It does not. The deployed truth is the **Lambda handlers** — API Gateway
routes to them, the Express server only ever runs on a developer's laptop, and the two have
drifted on the wire (docs §14). Diffing against Express would certify the port against
behaviour nobody runs.

The handlers are plain functions of `APIGatewayProxyEvent → APIGatewayProxyResult`, so
`harness.ts` calls them directly. That is simpler than the worktree-plus-server approach and
removes a whole category of "is the old server even up?" flakiness. `vitest.config.ts`
carries one plugin to make it work: the source is TS-ESM (`import … from './db.js'` where the
file is `db.ts`), and the `.js → .ts` remap is scoped to importers inside the source repo so
it can never affect this repo's own modules.

## What is normalized, and why so little

Every excluded field is parity given up, so the list is short:

- `token`, `created_at`, `updated_at`, `timestamp` — a JWT embeds `iat`, and rows are
  inserted at two different instants.
- The **query string** of a presigned S3 URL. Its signature derives from `X-Amz-Date`, so
  two invocations a second apart differ. Scheme, host, and key are all still compared, so a
  photo that resolved to the wrong object, the wrong bucket, or not at all still fails.

Nothing else. Error strings in particular are compared exactly — several of them are
rendered verbatim by the frontend.

## Fixtures

`src/fixtures.ts` seeds fixed ids (an auto-incrementing sequence would drift between resets
and every response containing an id would false-positive) and explicit `created_at` values
(`GET /api/users` sorts by it, and rows seeded microseconds apart would tie).

`resetFixture()` runs before **each side** of every comparison, which is what makes mutating
endpoints — `reset-password`, `claim-account`, `update-profile` — comparable at all.

The cast: two schools (one deliberately with no class years), three class years (one
deliberately unlinked, so the current-year auto-link branch has something to find), and four
users — an active member with photos and tags, an unclaimed roster entry, a super admin in
no class, and a member of a *different* class who exists to be refused.

`tokenFor()` / `authAs()` mint a token with the deployed claim set. Both implementations
verify against the same `JWT_SECRET`, so one token works on both sides — which matters:
handing the two sides different credentials would surface as a body difference and get
blamed on the wrong thing.

## Adding a phase

1. Extend `src/fixtures.ts` rather than starting a second fixture.
2. Add `<module>.contract.spec.ts` importing the handlers from
   `${LEGACY_REPO}/backend/src/lambda/<module>.ts`.
3. Any intentional divergence gets an allow-list entry with a comment pointing at §9 of the
   conversion doc.
