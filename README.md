# UnicornConnections

A class-reunion platform: schools, class years, a member directory, comments, events, and
then-and-now photos.

Live at **[unicornconnections.org](https://unicornconnections.org)**, which is the canonical
name; `www.unicornconnections.org`, `reunion-connect.org` and `www.reunion-connect.org` serve
the same app.

NestJS 12 API on Lambda behind API Gateway, a React 18 SPA on CloudFront, Aurora PostgreSQL,
and photos in S3. Raw SQL throughout — no ORM.

Known issues are tracked in [`docs/known-bugs.md`](docs/known-bugs.md).

## Quick start

```bash
cp .env.example .env          # then set DB_USER/DB_PASSWORD for your Postgres
npm install
npm run dev                   # http://localhost:5001
curl http://localhost:5001/pulse
```

You need PostgreSQL 14 and, for the photo tests, an S3-compatible store:

```bash
docker compose up -d          # postgres :5432, scratch db :5433, minio :9000, minio_test :9100
```

Native installs work too (`brew install postgresql@14 minio`). For a Homebrew Postgres, which
uses trust auth, set `DB_USER` to your own username in `.env`.

**Read credentials off the running container, not off the compose file.** Postgres and MinIO
bake theirs into their data volume at first init, so editing `docker-compose.yml` does nothing
to a volume that already exists — changing them means `docker compose down -v`, which destroys
the data:

```bash
docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'POSTGRES_|MINIO_ROOT'
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Watch-mode server on `PORT` (default 5001) |
| `npm run build` | Build every workspace |
| `npm test` | Unit tests (`*.spec.ts` under `apps/api/src`) |
| `npm run test:e2e` | End-to-end tests (`*.e2e-spec.ts` under `apps/api/test`) |
| `npm run typecheck` | `tsc --noEmit` over src **and** specs — `nest build` skips specs |
| `npm run smoke:web` | Drives the SPA against a real server, not a mock |
| `./scripts/bundle-lambda.sh` | esbuild the API into `infra/build/` Lambda artifacts |
| `JWT_SECRET=… ./scripts/deploy.sh --dry-run` | Changeset only — proves the template applies |
| `./scripts/smoke-deployed.sh` | Post-deploy gate against the live stack |

## Deployment

One SAM stack, `classyear-nest`, defined in `infra/template.yaml`:

- **One Lambda** behind `{proxy+}/ANY`, with Nest's router doing the routing. Adding an
  endpoint is a code change, not a template change.
- **A CloudFront distribution** serving the SPA from S3, holding all four public names plus
  `nest.reunion-connect.org`, which is kept as a name of the app's own for checking a deploy
  without going through the public ones.
- **`ClaimPublicNames`** gates the four public aliases and their DNS records. A CloudFront
  alias belongs to one distribution account-wide, so this exists to sequence a handover.

```bash
JWT_SECRET=… ./scripts/deploy.sh --dry-run   # changeset only
JWT_SECRET=… ./scripts/deploy.sh             # executes
./scripts/smoke-deployed.sh                  # verify
```

`smoke-deployed.sh` checks that the stack answers, that photos resolve and uploads are allowed
to preflight, and that all four public names are served by this distribution. It compares which
distribution actually holds each alias rather than settling for an HTTP 200, because a name can
answer 200 while pointing somewhere else entirely.

### Shared with the legacy app

An older Express/Lambda app is still deployed, dark, pending removal. Until it goes, the two
share **one Aurora cluster and one S3 photo bucket** — they are one product, and separate
storage would fork the data. Two consequences:

- This app runs with **`RUN_MIGRATIONS=false`**. Only one app may own the schema, and the older
  one keeps it until it is retired.
- The photo bucket's CORS rules live in the legacy app's template, so an origin this app is
  served from has to be added *there*. Uploads are presigned `PUT`s straight from the browser,
  so the bucket answers the preflight.

## Layout

An npm-workspaces monorepo. `packages/*` is listed before `apps/*` so shared libraries build
first.

```
apps/
├── api/                    @classyear/api — the NestJS backend
│   └── src/
│       ├── main.ts         local HTTP entry point
│       ├── lambda.ts       Lambda entry point
│       ├── bootstrap.ts    setup shared by both entry points and the e2e tests
│       ├── cli/            init-schema — run migrations and exit
│       ├── config/         Zod-validated environment contract
│       ├── common/         guards, filters, decorators, shared helpers
│       ├── database/       DatabaseService (pg pool), SchemaService, SeedService
│       ├── auth/           /api/auth
│       ├── users/          /api/users
│       ├── schools/        /api/schools
│       ├── classes/        /api/classes + /api/schools/:id/classes
│       ├── comments/       /api/comments + /api/users/:id/comments
│       ├── events/         /api/events + /api/schools/:id/classes/:id/events
│       ├── feedback/       /api/feedback, behind a per-request feature flag
│       ├── photos/         /api/photos + /api/users/:id/photo|gallery, and the S3 client
│       ├── admin/          /api/admin — user administration, roster import
│       ├── email/          SES + the password-reset dispatcher
│       ├── tokens/         reset and verification token minting
│       └── health/         /pulse
└── web/                    @classyear/web — React 18 + Vite 5 + Tailwind 3 SPA
    ├── src/                components, apiClient.ts, AppContext.tsx
    └── e2e/                Playwright; all mocked except live-api.spec.ts
packages/
└── shared-types/           @classyear/shared-types — entity types for api + web
infra/                      SAM template + samconfig for the classyear-nest stack
scripts/                    build, deploy and verification scripts
docs/                       known bugs, and the historical record
```

Entity types are defined once, in `@classyear/shared-types`, and consumed by both the API and
the web client. `Serialized<T>` maps a row type's `Date` fields to the `string` they become over
the wire, so the client's types are derived from the server's rather than restated alongside
them.

Run scripts across every workspace with `npm run build`, `npm test`, `npm run lint` from the
root; target one with `--workspace @classyear/api`.

## Notes for anyone picking this up

- **Environment is validated at boot and the app refuses to start if it is wrong.** There are
  no fallback defaults — a missing `JWT_SECRET` is a failure to boot, not a silently different
  signing key. See `apps/api/src/config/configuration.ts`.
- **`/pulse` is the only route outside `/api`.** The global prefix excludes it; the Lambda
  warmer hits it at the root.
- **Errors are always `{ "error": "..." }`.** `AllExceptionsFilter` guarantees it, because the
  frontend reads `err.response.data.error` and a differently-shaped body makes the message
  vanish from the UI.
- **CORS is a list, not a single origin.** The SPA calls the API's own URL, so every deployed
  request is cross-origin. `FRONTEND_URL` is the canonical origin and goes in email links;
  `CORS_ORIGINS` carries the rest. A single origin would leave three of the four public names
  failing every request in the browser with a healthy server and empty logs.
- **Per-class authorization is a service, not a guard.** `ClassScopeService`'s five predicates
  answer "may this user moderate this comment / manage this event / manage or view these photos
  / manage this user", because the answer depends on rows the request does not carry.
- **Admin guard levels vary per route, deliberately.** Most of `/api/admin` is
  `SuperAdminGuard`, but `DELETE /users/:userId` accepts class admins, and a couple of routes
  are behind nothing but a valid token, with `ClassScopeService` doing the gating.
- **Module import order in `app.module.ts` is deliberate.** `CommentsModule` and `PhotosModule`
  both mount routes under `/api/users`, so they follow `UsersModule`.
- **Nothing uploads through the API.** Photo uploads are presigned S3 PUTs the browser performs
  directly; the API mints the URL and records the key. There is no multipart handling anywhere.
  A profile keeps one `then` and one `now` photo — replacing either deletes the object it
  displaced, so there is no photo history.
- **Path parameters are validated by `NumericIdPipe`,** which answers 400 for a non-numeric id
  rather than letting it reach Postgres.
- **The Playwright suite mocks every API call** except `e2e/live-api.spec.ts`. It would pass
  against no backend at all, which is why `npm run smoke:web` exists.

## History

This app began as a rewrite of an older Express/Lambda application, and for a while was held
to matching it response-for-response. That constraint has been lifted — the rewrite is the
product now, and new behaviour needs no justification against what came before.

[`docs/nestjs-conversion-approach.md`](docs/nestjs-conversion-approach.md) is the record of how
it got here: the decisions, the deployments, the things that broke and why. It is history, not
specification. The `§N` references scattered through code comments point at its sections.

Two gates left over from that period still work, and both need a checkout of the legacy app
(`LEGACY_REPO`, default `~/Code/ClassYear`):

| Command | What it compares |
|---|---|
| `npm run contract:verify` | ~250 request/response paths, against a real database and object store |
| `npm run schema:verify` | Both schemas, dumped with `pg_dump` and diffed |

They are a regression net, not a specification. A test that fails because this app
deliberately improved something should be rewritten to assert the new behaviour, not reverted.
They retire with the legacy app.
