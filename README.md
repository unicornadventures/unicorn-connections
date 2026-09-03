# ClassYear (NestJS)

A NestJS port of the [ClassYear](../ClassYear) class-reunion platform. The conversion plan,
including the full endpoint inventory and the phased migration, lives in
[`docs/nestjs-conversion-approach.md`](docs/nestjs-conversion-approach.md).

**Status: phase 0 complete** — scaffold, config validation, database layer, schema
migrations, and `/pulse`. No feature endpoints yet; those are phases 1–5.

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
| `npm run build` | `nest build` → `backend/dist` |
| `npm test` | Vitest unit tests (`*.spec.ts` under `backend/src`) |
| `npm run test:e2e` | Vitest e2e tests (`*.e2e-spec.ts` under `backend/test`) |
| `npm run schema:verify` | **Schema parity gate** — see below |

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

## Layout

```
backend/src/
├── main.ts             # local HTTP entry point
├── bootstrap.ts        # setup shared by main.ts, lambda.ts (phase 7), and e2e tests
├── app.module.ts
├── cli/init-schema.ts  # run migrations and exit
├── config/             # Zod-validated environment contract
├── database/           # DatabaseService (pg pool), SchemaService, SeedService
└── health/             # /pulse
scripts/
├── verify-schema-parity.sh
└── legacy-schema/      # shim that runs the source app's schema.ts unmodified
```

## Notes for anyone picking this up

- **Environment is validated at boot and the app refuses to start if it is wrong.** The
  source app fell back to defaults, which is how it ended up with two different JWT signing
  secrets. There is no fallback here — see `backend/src/config/configuration.ts`.
- **`/pulse` is the only route outside `/api`.** The global prefix excludes it, matching the
  source, where the SAM warmer hits it at the root.
- **Raw SQL, no ORM.** Deliberate; see §3.3 of the conversion doc.
