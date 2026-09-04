# ClassYear (NestJS)

A NestJS port of the [ClassYear](../ClassYear) class-reunion platform. The conversion plan,
including the full endpoint inventory and the phased migration, lives in
[`docs/nestjs-conversion-approach.md`](docs/nestjs-conversion-approach.md).

**Status: phase 6 complete — API and web client both done.** 64 endpoints across `/pulse`,
`/api/auth`, `/api/users`, `/api/schools`, `/api/classes`, `/api/comments`, `/api/events`,
`/api/feedback`, `/api/photos` and `/api/admin`, plus the React SPA in `apps/web`. What
remains is deployment (phase 7) and the domain split (8).

Every one of those is checked against the deployed Lambda handler by the contract suite —
`npm run contract:verify`. That gate, not the unit tests, is what makes the port safe.

## Quick start

```bash
cp .env.example .env          # then edit DB_USER/DB_PASSWORD for your Postgres
npm install
npm run dev                   # http://localhost:5001
curl http://localhost:5001/pulse
```

You need a PostgreSQL 14 and, for the contract tests, an object store:

```bash
docker compose up -d          # postgres :5432, scratch db :5433, minio :9000, minio_test :9100
```

`minio_test` is separate from `minio` on purpose — it sets `MINIO_DOMAIN` so the contract
harness can address buckets virtual-host style, and it keeps a suite that deletes objects
away from your local photos. See the comments in `docker-compose.yml`.

Native installs work too (`brew install postgresql@14 minio`); the harness falls back to
starting its own MinIO when nothing is listening on `:9100`. Set `DB_USER` to your own
username in `.env` for a Homebrew Postgres, which uses trust auth.

**Read credentials off the running container, not off a compose file.** Postgres and MinIO
bake theirs into their data volume at first init, so editing compose does nothing to an
existing volume — you would need `docker compose down -v`, which destroys the data:

```bash
docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'POSTGRES_|MINIO_ROOT'
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Watch-mode server on `PORT` (default 5001) |
| `npm run build` | `nest build` → `apps/api/dist` |
| `npm test` | Vitest unit tests (`*.spec.ts` under `apps/api/src`) |
| `npm run test:e2e` | Vitest e2e tests (`*.e2e-spec.ts` under `apps/api/test`) |
| `npm run typecheck` | `tsc --noEmit` over src **and** specs — `nest build` skips specs |
| `npm run smoke:web` | **Live-API gate** — drives the SPA against a real Nest server |
| `./scripts/bundle-lambda.sh` | esbuild the API into `infra/build/` Lambda artifacts |
| `JWT_SECRET=… ./scripts/deploy.sh --dry-run` | Changeset only — proves the template applies |
| `npm run schema:verify` | **Schema parity gate** — see below |
| `npm run contract:verify` | **Endpoint parity gate** — see below |

## Schema parity gate

The port keeps the source app's SQL byte-identical so the two schemas can be compared
mechanically rather than by eye:

```bash
npm run schema:verify
```

It builds the source app's `schema.ts` and this app's `SchemaService` into two throwaway
databases, dumps both with `pg_dump --schema-only`, and diffs. It reads the source repo
(default `~/Code/ClassYear`, override with `LEGACY_REPO`) but never writes to it.

```
✅ Schema parity: the ported schema is identical to the source app's.
   78 statements compared.
```

## Endpoint parity gate

The same idea applied to responses:

```bash
npm run contract:verify           # all specs
npm run contract:verify -- users  # filter by name
```

For each ported endpoint it issues the same request against the **deployed Lambda handler**
and against this app, both reading a freshly-seeded scratch database, and asserts the status
and body match exactly — including error strings.

Four assertions deliberately assert the *opposite*: the approved §9.2 fixes (see §21) change
behaviour on purpose, so they use `expectDivergence`, which pins the new answer **and**
checks the two sides still differ. A silent revert therefore fails the suite rather than
quietly passing it. Those tests are named `diverges: …`. Tokens and timestamps are normalized away,
as is the clock-dependent query string of a presigned S3 URL and the millisecond suffix in a
freshly minted photo key; nothing else is.

Photo endpoints run against the **`minio_test`** container, because half of what they do is
delete objects — the tests seed real objects and assert they are gone afterwards. If nothing
is listening on `:9100` the script starts a throwaway MinIO itself and stops it afterwards.

The reference is the Lambda handlers rather than the Express routers, because API Gateway
routes to the handlers and the Express server only ever runs on a laptop. The two have
drifted on the wire — see §14 of the conversion doc. The handlers are invoked as functions
with a synthetic `APIGatewayProxyEvent`, so no second server is booted and the source repo
is only ever read.

## Layout

An npm-workspaces monorepo. `packages/*` is listed before `apps/*` so shared libraries
build first.

```
apps/
├── api/                    @classyear/api — the NestJS backend
│   └── src/
│       ├── main.ts         local HTTP entry point
│       ├── bootstrap.ts    setup shared by main.ts, lambda.ts (phase 7), and e2e tests
│       ├── app.module.ts
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
tools/
├── contract-tests/         old-vs-new endpoint parity gate
└── legacy-schema/          shim that runs the source app's schema.ts unmodified
infra/                      SAM template + samconfig for the classyear-nest stack
scripts/
├── verify-schema-parity.sh
├── run-contract-tests.sh
├── smoke-web.sh
├── bundle-lambda.sh        esbuild the Lambda artifacts
├── deploy.sh               sam deploy the classyear-nest stack
└── smoke-deployed.sh       phase 7 gate, incl. "old app still serves both domains"
docs/
└── nestjs-conversion-approach.md
```

Why a monorepo: the source app keeps entity types in **two** places
(`backend/src/types.ts` and `frontend/src/types.ts`) that drifted from each other and from
the schema. `@classyear/shared-types` is the single definition, and the API and web client
both consume it.

Run scripts across every workspace with `npm run build`, `npm test`, `npm run lint` from
the root; target one with `--workspace @classyear/api`.

## Notes for anyone picking this up

- **Environment is validated at boot and the app refuses to start if it is wrong.** The
  source app fell back to defaults, which is how it ended up with two different JWT signing
  secrets. There is no fallback here — see `apps/api/src/config/configuration.ts`.
- **`/pulse` is the only route outside `/api`.** The global prefix excludes it, matching the
  source, where the SAM warmer hits it at the root.
- **Raw SQL, no ORM.** Deliberate; see §3.3 of the conversion doc.
- **The deployed Lambda handlers are the contract, not the Express routers.** Where the two
  disagree — response shape, error wording, whether a check exists at all — the handler
  wins, because that is what production serves. §14 of the conversion doc has the evidence.
- **Path parameters stay strings.** `GET /api/users/abc` reaches Postgres and answers 500
  today. A `ParseIntPipe` would turn that into a 400 with different wording, so there is
  none. It looks like an oversight; it is the contract.
- **Errors are always `{ "error": "..." }`.** `AllExceptionsFilter` guarantees it, because
  the frontend reads `err.response.data.error` and Nest's default body would make every
  server-side message vanish from the UI.
- **Per-class authorization is a service, not a guard.** `ClassScopeService`'s five
  predicates answer "may this user moderate this comment / manage this event / manage or
  view these photos / manage this user", because the answer depends on rows the request
  does not carry. They deliberately source roles differently — comment moderation re-reads
  the user, the rest trust the token — matching the source; see §16 and §18.
- **Admin guard levels vary per route, deliberately.** Most of `/api/admin` is
  `SuperAdminGuard`, but `DELETE /users/:userId` accepts class admins, and two routes are
  behind nothing but a valid token with `ClassScopeService` doing all the gating. §18 has
  the table.
- **Module import order in `app.module.ts` is deliberate.** `CommentsModule` and
  `PhotosModule` both mount routes under `/api/users`, so they follow `UsersModule`. §5.3
  explains what breaks otherwise.
- **The web client's entity types are derived, not restated.** `Serialized<T>` in
  `@classyear/shared-types` maps a row type's `Date` fields to the `string` they become over
  the wire, so one definition serves both sides. The source restated them by hand and they
  had drifted — 61 call sites read a `user_id` the type never declared. See §19.
- **The Playwright suite mocks every API call** except `e2e/live-api.spec.ts`. It would pass
  against no backend at all, which is why `npm run smoke:web` exists.
- **Nothing uploads through the API.** Photo uploads are presigned S3 PUTs the browser
  performs directly; the API mints the URL and records the key. There is no multipart
  handling anywhere, and phase 7 needs no API Gateway binary configuration — see §17.
