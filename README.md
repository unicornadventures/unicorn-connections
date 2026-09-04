# ClassYear (NestJS)

A NestJS port of the [ClassYear](../ClassYear) class-reunion platform. The conversion plan,
including the full endpoint inventory and the phased migration, lives in
[`docs/nestjs-conversion-approach.md`](docs/nestjs-conversion-approach.md).

**Status: phase 2 complete.** Live endpoints: `/pulse`, `/api/auth` (10), `/api/users` (4),
`/api/schools` (2), `/api/classes` (5), and `GET /api/schools/:schoolId/classes`. Comments,
events, feedback, photos and admin land in phases 3–5.

Every one of those is checked against the deployed Lambda handler by the contract suite —
`npm run contract:verify`. That gate, not the unit tests, is what makes the port safe.

## Quick start

```bash
cp .env.example .env          # then edit DB_USER/DB_PASSWORD for your Postgres
npm install
npm run dev                   # http://localhost:5001
curl http://localhost:5001/pulse
```

You need a PostgreSQL 14 to talk to. Either:

```bash
docker-compose up -d          # postgres on 5432, scratch test db on 5433
```

or a native install (`brew install postgresql@14 && brew services start postgresql@14`),
in which case set `DB_USER` to your own username in `.env`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Watch-mode server on `PORT` (default 5001) |
| `npm run build` | `nest build` → `apps/api/dist` |
| `npm test` | Vitest unit tests (`*.spec.ts` under `apps/api/src`) |
| `npm run test:e2e` | Vitest e2e tests (`*.e2e-spec.ts` under `apps/api/test`) |
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
and body match exactly — including error strings. Tokens and timestamps are normalized away,
as is the clock-dependent query string of a presigned S3 URL; nothing else is.

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
│       ├── photos/         presigned URL resolution (grows into PhotosModule, phase 4)
│       ├── email/          SES + the password-reset dispatcher
│       ├── tokens/         reset and verification token minting
│       └── health/         /pulse
└── web/                    @classyear/web — React SPA (phase 6, placeholder)
packages/
└── shared-types/           @classyear/shared-types — entity types for api + web
tools/
├── contract-tests/         old-vs-new endpoint parity gate
└── legacy-schema/          shim that runs the source app's schema.ts unmodified
infra/                      SAM template and deploy scripts (phase 7, placeholder)
scripts/
├── verify-schema-parity.sh
└── run-contract-tests.sh
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
