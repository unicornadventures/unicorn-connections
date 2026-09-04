# ClassYear → NestJS Conversion Approach

**Target directory:** `/Users/crgdncn/Code/ClassYearNest`
**Source of truth (read-only):** `/Users/crgdncn/Code/ClassYear`
**Status:** phase 3 complete (2026-09-03) — §13 phase 0, §14 the contract decision, §15 phase 2, §16 phase 3
**Written:** 2026-09-03

> The existing ClassYear repo is the behavioural spec: every decision below is stated in
> terms of "what the current app does" so the port can be verified against it rather than
> against memory. **No application code in that repo is modified.** The one exception is
> infrastructure: phase 8 edits its `template.yaml` and `samconfig.toml` to hand
> `reunion-connect.org` over to the new app (§8.6). That is the last phase, and everything
> before it leaves the existing app and both its live domains exactly as they are.

---

## 1. Goal

Produce a working, feature-identical class-reunion platform whose **backend is NestJS**
instead of Express-routers-plus-hand-written-Lambda-handlers. The React/Vite frontend is
carried over essentially unchanged — it talks to the same HTTP contract, so if the contract
holds, the frontend needs one env var changed and nothing else.

"Identical" means, concretely:

- Same URL paths, same HTTP methods, same request bodies/query params.
- Same response shapes, including the exact JSON keys the frontend destructures.
- Same status codes, including the specific 400/401/403/404/409 choices per endpoint.
- Same error message strings (the frontend surfaces several of them verbatim).
- Same database schema, so an existing Postgres volume can be pointed at the new app.

**Identical to which implementation?** The source app implements everything twice (§2.1) and
the two have drifted apart on the wire, not just internally. **The Lambda handlers are the
reference** — see §14 for the decision and the evidence. Where this document describes
behaviour in terms of the Express routers, the Lambda version wins on conflict.

Anything we deliberately change (§9) is listed explicitly rather than changed silently.

---

## 2. What exists today

### 2.1 Backend, two parallel implementations

The current backend implements every feature **twice**:

| Path | Files | Lines | Used by |
|---|---|---|---|
| Express routers | `backend/src/routes/*.ts` (12 files) | ~2,550 | `npm run dev` local server |
| Lambda handlers | `backend/src/lambda/*.ts` (15 files) | ~3,100 | SAM local + deployed AWS |

Both call the same `db.query()`, `schema.ts`, `types.ts`, and `utils/`. They have drifted:
the Lambda handlers are the deployed truth, the Express routers are the ones with 338 Jest
tests and ~95% coverage. **This duplication is the single biggest reason to port.**

Deployment today is **59 individually-defined Lambda functions** in a ~51k-line
`template.yaml`, wired to **68 API Gateway route events**. Adding one endpoint means editing
YAML in three places.

### 2.2 Route surface

74 Express route handlers across 12 routers, mounted in `server.ts`:

```
/api/auth            authRoutes          10 handlers
/api/users           userRoutes           5
/api/users           photoRoutes          8   (same mount point as userRoutes)
/api/users           commentRoutes        7   (same router, mounted twice)
/api/comments        commentRoutes        7   (…here as well)
/api/schools         schoolRoutes         5
/api/classes         classRoutes          7
/api/events          eventRoutes          5
/api/feedback        feedbackRoutes       2
/api/admin           adminRoutes          8
/api/admin/schools   adminSchoolRoutes   11
/api/admin/classes   adminClassRoutes     3
/api/admin/events    adminEventRoutes     3
```

Note `commentRoutes` is mounted at **both** `/api/users` and `/api/comments`, so
`GET /:targetUserId/comments` resolves under `/api/users/...` while
`GET /my-comments/:commenterId` and `GET /pending` are reached under `/api/comments/...`.
The port must reproduce both mounts (§5.3).

### 2.3 Data model

Ten tables, created and migrated idempotently by `schema.ts` (`CREATE TABLE IF NOT EXISTS`
plus `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` plus a few `DO $$ ... $$` blocks):

`schools`, `classes`, `class_school` (M2M), `users`, `profiles` (1:1),
`class_user` (M2M with `school_id` context), `events`, `comments`, `gallery_photos`,
`password_reset_tokens`, `email_verification_tokens`, `feedback`.

`schema.ts` also seeds class years 1950 → current year and contains a one-shot migration
that collapses the old `classes.school_id` column into `class_school`.

### 2.4 Frontend

React 18 + Vite 5 + Tailwind 3 + react-router 7. ~30 components, `apiClient.ts` as the
typed API surface, `AppContext.tsx` for auth state, Vitest unit tests, Playwright e2e.
No server-side coupling beyond `VITE_API_BASE_URL`.

---

## 3. Target architecture

### 3.1 The core decision: one Nest app, two entry points

NestJS gives us what the current codebase lacks — **one implementation, two runtimes**:

```
src/main.ts          → standalone HTTP server (local dev, docker, ECS if ever needed)
src/lambda.ts        → same AppModule wrapped by @codegenie/serverless-express
```

`src/lambda.ts` caches the bootstrapped Nest instance at module scope so warm invocations
skip bootstrap. This replaces 59 SAM functions with **one** `ApiFunction` behind a
`{proxy+}` catch-all route. `template.yaml` drops from ~51k lines to a few hundred.

Trade-off, stated plainly: a single Lambda means one cold-start profile for all endpoints
and no per-endpoint memory/timeout tuning or per-endpoint IAM scoping. For an app at this
traffic level that is the right trade — the current per-function setup is buying isolation
nobody is using, at the cost of an unmaintainable template and a duplicated codebase. The
warmer function stays and now only has to keep one function warm instead of 59.

### 3.2 Module map

One Nest module per current router group, plus shared infrastructure. The API is one
workspace of a monorepo (§3.4), so these paths are all under `apps/api/`:

```
apps/api/src/
├── main.ts                     # local HTTP bootstrap
├── lambda.ts                   # serverless-express handler (cached)
├── app.module.ts               # imports all feature modules
├── config/
│   └── configuration.ts        # typed @nestjs/config, validated at boot
├── database/
│   ├── database.module.ts      # @Global — provides DatabaseService
│   ├── database.service.ts     # pg Pool + query(); ports the 28P01 self-heal
│   ├── schema.service.ts       # port of schema.ts; OnModuleInit
│   └── seed.service.ts         # port of seed.ts (admin seeding)
├── common/
│   ├── guards/
│   │   ├── jwt-auth.guard.ts        # ← utils/auth.ts authenticateToken
│   │   ├── admin.guard.ts           # ← middleware requireAdmin
│   │   ├── super-admin.guard.ts     # ← middleware requireSuperAdmin
│   │   ├── user-admin.guard.ts      # ← middleware requireUserAdmin
│   │   └── event-admin.guard.ts     # ← middleware requireEventAdmin
│   ├── decorators/current-user.decorator.ts
│   ├── filters/all-exceptions.filter.ts
│   └── interceptors/…
├── auth/            AuthModule       ← authRoutes + lambda/auth.ts + forgotPassword.ts
├── users/           UsersModule      ← userRoutes + lambda/users.ts
├── profiles/        (inside UsersModule)
├── photos/          PhotosModule     ← photoRoutes + lambda/photos.ts + s3Service.ts
├── schools/         SchoolsModule    ← schoolRoutes + adminSchoolRoutes
├── classes/         ClassesModule    ← classRoutes + adminClassRoutes
├── events/          EventsModule     ← eventRoutes + adminEventRoutes
├── comments/        CommentsModule   ← commentRoutes
├── feedback/        FeedbackModule   ← feedbackRoutes (feature-flagged)
├── admin/           AdminModule      ← adminRoutes
├── email/           EmailModule      ← services/emailService.ts (SES)
├── tokens/          TokensModule     ← services/tokenService.ts
└── health/          HealthModule     ← /pulse
```

Each feature module is `Controller → Service → Repository`. Controllers hold only HTTP
concerns (params, status codes, response shaping). Services hold the logic currently inlined
in route handlers. Repositories hold SQL.

### 3.3 Data access: keep raw SQL

**Do not introduce TypeORM or Prisma in this port.** Reasons:

- The existing SQL is non-trivial (recursive-ish joins across `class_user`/`class_school`,
  `ILIKE` matching, `jsonb` tags with a GIN index, `generate_series` seeding). Re-expressing
  it in an ORM is where behavioural drift would creep in.
- The port is already changing the framework, the deployment topology, and the test
  strategy. Changing the data layer at the same time makes any parity failure ambiguous.
- Keeping SQL byte-identical makes the parity diff reviewable.

So: `DatabaseService.query(text, params)` is a near-verbatim port of `db.ts`, including the
**28P01 stale-credential self-heal** added in commit `6355eb4` (tear down the pool, refetch
the Secrets Manager secret, retry once). Repositories wrap it. If an ORM is wanted later,
it can be introduced repository-by-repository behind the same interface.

Migrations stay as `SchemaService.initialize()` — a direct port of `schema.ts` — run from
`OnModuleInit`. One fix: the current version swallows errors in a `catch` that only logs.
The port should rethrow (§9.1), so a broken migration fails loudly instead of leaving the
app running against a half-built schema.

### 3.4 Repository shape: a monorepo

npm workspaces, `packages/*` before `apps/*` so shared libraries build first:

```
apps/api          @classyear/api            the NestJS backend
apps/web          @classyear/web            React SPA (phase 6)
packages/shared-types  @classyear/shared-types   entity types for both
tools/contract-tests   the §7.3 parity gate (phase 1)
tools/legacy-schema    shim that runs the source app's schema.ts unmodified
infra/                 SAM template + deploy scripts (phase 7)
scripts/               verify-schema-parity.sh
```

The motivating case is `shared-types`. The source app defines its entity types **twice** —
`backend/src/types.ts` and `frontend/src/types.ts` — and both drifted from each other and
from `schema.ts`. Its `User` still declares `email: string` and `password: string` when the
schema dropped NOT NULL on both (unclaimed roster entries have neither, which is the whole
premise of `POST /api/auth/claim-account`), and it has no `is_class_admin`,
`email_verified`, or `is_deceased` at all despite every one of those driving authorization.
One package, consumed by both apps, removes the drift by construction.

Build orchestration is plain npm workspaces. With two apps and one library that is
sufficient; Turborepo/Nx would buy task caching and real topological ordering, and is worth
adding if `packages/` grows past a couple of entries — not before.

---

## 4. Auth: the part that needs the most care

The current app has **two independent auth mechanisms** that behave differently, and both
must be preserved because different endpoints depend on each.

### 4.1 `authenticateToken` (`utils/auth.ts`)

- Reads the token from `req.cookies.token` **or** the `Authorization: Bearer` header.
- `jwt.verify` only — **no database lookup**. `req.user` is the decoded JWT payload.
- Fallback secret when `JWT_SECRET` is unset: `'fallback-super-secret-key'`.
- Used by: `GET /api/auth/me`, all of `/api/feedback`.

→ Ports to `JwtAuthGuard`. Because it does no DB lookup, `req.user.is_class_admin` is
**absent** from the login token payload (login signs `id`, `email`, `is_admin`, `profile`,
`user_id`, `first_name`, `last_name` — not `is_class_admin`). Do not "fix" this by adding
the claim; downstream code that needs it re-reads the DB, and changing the payload changes
what `/api/auth/me` returns to the frontend.

### 4.2 The `middleware/adminAuth.ts` family

- **Bearer header only** — ignores cookies.
- Always re-reads the user row: `SELECT * FROM users WHERE id = $1`. `req.user` is the **DB
  row**, not the JWT payload.
- Four variants with distinct rules:

| Middleware | Rule | Failure codes |
|---|---|---|
| `requireAdmin` | `is_admin \|\| is_class_admin` | 401 no/invalid token, 401 user not found, 403 |
| `requireSuperAdmin` | `is_admin` only | 401, 401, 403 "Super admin access required." |
| `requireUserAdmin` | super admin → allow; class admin → only if target `:userId` shares a `class_user.class_id` | 403 "Access denied. You can only manage users in your class." |
| `requireEventAdmin` | super admin → allow; class admin → must share a class with the event's `class_id` (from `:id` on update/delete, or `body.class_id`/`params.classId` on create) | 404 if event missing, 403 if wrong class, 400 if no class_id on create |

→ Port to four guards. `requireEventAdmin` reads route params **and** body, so the guard
needs `ExecutionContext.switchToHttp().getRequest()` and must run after body parsing —
which is the default for guards, so this works, but it means it cannot be a middleware.

### 4.3 The `requesterId` query-param pattern

Several endpoints — notably `commentRoutes` and `photoRoutes` — do **not** derive identity
from the JWT. They read `?requesterId=` from the query string and authorize against that:

```ts
const { requesterId } = req.query;
if (!requesterId) return res.status(400).json({ error: 'requesterId query parameter is required.' });
```

This is a genuine authorization weakness — any caller can pass any user's id. It is flagged
in §9.2. **The port reproduces it as-is in phase 1** so parity is verifiable, and fixing it
is proposed as a separate, explicitly-approved change with a coordinated frontend update.

### 4.4 JWT secret inconsistency

`utils/auth.ts` and `middleware/adminAuth.ts` fall back to `'fallback-super-secret-key'`.
`lambda/authUtils.ts` and the `claim-account` handler fall back to `'fallback-secret'`.
When `JWT_SECRET` is unset, a token minted by `claim-account` fails verification in
`authenticateToken`. In the port, `JWT_SECRET` becomes **required** via config validation
(§6), which removes the fallback path entirely and makes the inconsistency moot.

---

## 5. Endpoint mapping

The full contract. Every row must be reachable at the identical path with the identical
method after the port. Response-shape parity is verified by the contract tests in §7.3.

### 5.1 Auth — `AuthController` @ `/api/auth`

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST | `/login` | — | Returns `{ token, user }`; also sets httpOnly `token` cookie |
| GET | `/me` | `JwtAuthGuard` | Returns `{ user: <jwt payload> }` |
| POST | `/logout` | — | Clears cookie |
| GET | `/registration-link/:hash` | — | base64url decode → `{ school, class }` |
| POST | `/register` | — | **Returns 403 immediately** — see §9.3 |
| POST | `/forgot-password` | — | Always 200 (no user enumeration) |
| POST | `/reset-password` | — | See §9.4 |
| POST | `/verify-email` | — | See §9.4 |
| POST | `/claim-search` | — | `ILIKE` match on unclaimed (`email IS NULL`) non-deceased users |
| POST | `/claim-account` | — | Sets email+password on an unclaimed row; 409 on email conflict |

### 5.2 Users — `UsersController` @ `/api/users`

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST | `/register` | — | Distinct from `/api/auth/register` |
| GET | `/:id` | — | Profile fetch |
| GET | `/:id/class` | — | |
| POST | `/:userId/assign-class` | — | |
| PUT | `/:userId/profile` | — | |

### 5.3 Comments — mounted twice

`CommentsController` needs **two** controller classes (or one with two `@Controller`
prefixes registered) to reproduce both mount points:

| Method | Path | Notes |
|---|---|---|
| GET | `/api/comments/pending` | All moderatable pending comments, `?requesterId=` |
| GET | `/api/comments/my-comments/:commenterId` | |
| PUT | `/api/comments/:commentId` | Publish/unpublish/edit |
| DELETE | `/api/comments/:commentId` | |
| GET | `/api/users/:targetUserId/comments` | |
| GET | `/api/users/:targetUserId/comments/pending` | |
| POST | `/api/users/:targetUserId/comments` | |

**Ordering hazard:** in Express, `userRoutes` is mounted at `/api/users` *before*
`commentRoutes`, so `GET /api/users/pending` matches `userRoutes`' `GET /:id` with
`id="pending"` and never reaches the comments router. Nest resolves routes by registration
order within a controller and by module import order across controllers — the port must
register `UsersController` before the users-mounted `CommentsController` to preserve this,
or (better) verify no client actually calls that path and note the divergence.

### 5.4 Photos — `PhotosController` @ `/api/users`

| Method | Path | Notes |
|---|---|---|
| POST | `/:userId/photo/:photoType` | `multipart/form-data`, field `file` — see §8.2 |
| POST | `/:userId/photo/upload/:photoType` | Presigned-URL flow |
| PUT | `/:userId/photo/:photoType` | |
| DELETE | `/:userId/photo/:photoType` | |
| GET | `/:userId/gallery` | |
| POST | `/:userId/gallery` | |
| PUT | `/:userId/gallery/:photoId` | Caption edit |
| DELETE | `/:userId/gallery/:photoId` | |

`photoType` is constrained to `'then' | 'now'` → `ParseEnumPipe`, but the 400 message must
stay `'photoType must be "then" or "now".'`.

Authorization helpers `canManagePhotos` / `canViewPhotos` move into `PhotosService` verbatim.

### 5.5 Schools / Classes / Events / Feedback / Admin

| Method | Path | Guard |
|---|---|---|
| GET | `/api/schools`, `/api/schools/:id`, `/api/schools/:id/classes` | — |
| POST | `/api/schools` | — |
| GET | `/api/schools/:schoolId/classes/:classId/events` | — |
| GET | `/api/classes`, `/api/classes/:id` | — |
| GET | `/api/classes/:id/members`, `/directory`, `/photos`, `/alumni-count`, `/message-count` | — |
| GET | `/api/events/:eventId`, `/api/events/class/:classId/events`, `/days-until-next` | — |
| PUT DELETE | `/api/events/:id` | `EventAdminGuard` |
| GET POST | `/api/feedback` | `JwtAuthGuard` + feature flag |
| POST | `/api/admin/seed` | — |
| GET | `/api/admin/users`, `/api/admin/classes/:classId/users` | — |
| DELETE PUT | `/api/admin/users/:userId`, `/:userId/profile` | `UserAdminGuard` |
| PUT | `/api/admin/users/:userId`, `/:userId/move-class` | — |
| POST | `/api/admin/registration-links` | — |
| ALL | `/api/admin/schools/*` (11 routes incl. bulk + CSV import) | `SuperAdminGuard` |
| GET | `/api/admin/classes/*` (3 routes) | `SuperAdminGuard` |
| POST PUT DELETE | `/api/admin/events` | `EventAdminGuard` |
| POST | `/api/admin/schools/:schoolId/classes/:classId/events` | `EventAdminGuard` |
| GET | `/pulse` | — (note: **not** under `/api`) |

Several `/api/admin/*` routes carry **no guard at all** today (`POST /api/admin/seed`,
`GET /api/admin/users`, `PUT /api/admin/users/:userId`, `/move-class`,
`POST /api/admin/registration-links`). That is flagged in §9.2; phase 1 reproduces it.

---

## 6. Cross-cutting concerns

**Config.** `@nestjs/config` with a Joi/Zod schema validated at boot. Required:
`JWT_SECRET`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (or `DATABASE_SECRET_ARN`).
Optional with defaults: `DB_PORT=5432`, `DB_CONNECT_TIMEOUT_MS=30000`, `AWS_REGION`,
`FRONTEND_URL`, `SES_FROM_EMAIL`, `FEEDBACK_ENABLED`, `ADMIN_SEED_PASSWORD_PARAM`,
`S3_ENDPOINT`, `S3_BUCKET_NAME`. Boot fails fast on a missing required var — an
improvement over the current silent fallbacks, and safe because deploys already set them.

**Validation.** Global `ValidationPipe` with DTOs, but configured
`{ whitelist: true, forbidNonWhitelisted: false, transform: true }` and **custom error
formatting** so the response body stays `{ error: "..." }` with the current message rather
than Nest's default `{ statusCode, message: [...], error }`. This is the highest-risk
parity item; see §7.3.

**Errors.** A global `AllExceptionsFilter` renders every error as `{ error: string }`,
mapping `HttpException` → its status and unhandled errors → 500 with the module's current
message (e.g. `'Internal server error during login.'`). Nest's default shape would break
the frontend's `err.response.data.error` reads.

**CORS.** `app.enableCors({ origin: FRONTEND_URL, credentials: true })` for the HTTP server.
Under Lambda, the current handlers each emit `Access-Control-Allow-Origin: *` manually and
the template defines explicit `OPTIONS` routes for a handful of paths. With one proxy
function, Nest's CORS middleware handles preflight for **all** routes uniformly — a
simplification, and strictly more permissive-correct than today's partial coverage.

**Cookies.** `cookie-parser` is still needed (`JwtAuthGuard` reads `req.cookies.token`).
Register via `app.use(cookieParser())` in both entry points.

**Feature flag.** `FEEDBACK_ENABLED=false` → all `/api/feedback` routes 404 with
`{ error: 'Feedback is not enabled.' }`. Current code checks this **per request** (so tests
can toggle it), not at boot. Reproduce with a guard, not with conditional module loading.

**Logging.** Nest's `Logger` replacing `console.log`. Keep the emoji-prefixed startup lines
— they are how the current app is eyeballed in CloudWatch.

---

## 7. Testing strategy

### 7.1 What to carry over

The existing 338 Jest tests use a mock-database pattern: an in-memory `mockDb` object plus
`jest.mock('../../db')` with `sql.includes('...')` pattern matching. That pattern is
**brittle and tied to Express route internals** — it asserts on SQL strings, not behaviour.
Do not port it mechanically.

### 7.2 What to write instead

- **Unit tests** per service, with the repository injected as a mock. Fast, and they test
  logic rather than SQL text.
- **Integration tests** per controller via `@nestjs/testing` + `supertest`, hitting a **real
  Postgres** in Docker (Testcontainers, or the existing `docker-compose` service against a
  scratch database). This is a real upgrade: the current tests never execute the SQL they
  assert on, so a malformed query passes.

### 7.3 Contract tests — the parity gate

The most valuable artifact of this port. A single table-driven suite that, for each of the
74 endpoints, issues the same request against **both** the old Express server and the new
Nest server, seeded from the same fixture database, and asserts:

```
status code equal
response body deep-equal (with id/timestamp normalization)
```

Run it before merging each phase. Any intentional divergence gets an allow-list entry with
a comment pointing at §9. This turns "identical" from an aspiration into a check.

The old app can be run for this purpose from a git worktree of the ClassYear repo — no
modification to that repo is required.

---

## 8. Things that need real work, not mechanical translation

### 8.1 `s3Service.updatePhotoUrlInDatabase` is broken

```ts
await query(`UPDATE users SET ${fieldName} = $1 WHERE user_id = $2`, [url, userId]);
```

`users` has neither `then_photo_url`/`now_photo_url` (those are on `profiles`) nor a
`user_id` column. This function throws whenever it is called. Determine whether any live
path reaches it; if not, drop it from the port rather than carrying a broken function
forward. If something does reach it, it is an existing production bug and fixing it is
part of the port (record it in §9).

### 8.2 Multipart uploads under Lambda

Express dev uses `multer` memory storage. Under API Gateway the body arrives
base64-encoded, which is why a second `POST /:userId/photo/upload/:photoType` presigned-URL
endpoint exists. With a single Nest proxy function, `serverless-express` needs
`binaryMimeTypes` configured (or API Gateway `BinarySettings: ['*/*']`) for `FileInterceptor`
to work. **Verify this end-to-end early** — it is the one place where the single-function
architecture is meaningfully harder than per-function handlers. Keep both endpoints either
way; the frontend uses them for different flows.

### 8.3 Two SES/email paths

`emailService.ts` short-circuits to `console.log` when `SES_FROM_EMAIL` is unset. Preserve
this — it is what makes local password-reset testing possible. Port as `EmailService` with
the dev-mode branch intact.

There is also an async path: `forgotPassword` Lambda enqueues to SQS and `emailWorker`
consumes it. Under the single-function architecture, decide explicitly:
**(a)** keep SQS + a separate small worker function, or **(b)** send inline like the Express
path does. Recommend **(a)** — the queue exists because SES sends were slowing the
forgot-password response, and that reason still holds.

### 8.4 Cold-start DB initialization

`lambda/init.ts` exports a module-scope `dbReady` promise that every handler awaits, so
migrations and admin seeding run exactly once per container. In Nest, `OnModuleInit` on
`SchemaService` gives this for free, since bootstrap is cached in `lambda.ts`. Keep the SSM
SecureString fetch for the admin seed password — **never** put the password in the repo,
the template, or env vars.

### 8.5 The 51k-line template

Replace with a minimal SAM template: one `ApiFunction` (`{proxy+}` / `ANY`), one warmer,
one email worker, plus the existing Aurora/S3/CloudFront/Route53/ACM resources lifted
across. Domain handling is its own problem — see §8.6.

**Name collisions between the two stacks.** The new stack cannot simply reuse the old
template's names. At minimum:

| Resource | Current | Why it collides |
|---|---|---|
| Stack | `classyear-serverless` | Must be a new name, e.g. `classyear-nest` |
| File bucket | `classyear-file-storage-${AWS::AccountId}-${Environment}` | Account+environment scoped — a second stack with `Environment=dev` fails on "bucket already exists" |
| Frontend bucket | stack-derived | Verify before first deploy |
| SAM artifact prefix | `s3_prefix = "classyear-serverless"` | Cosmetic, but change it |

Give the new stack a distinct `Environment` value (`nest`) or parameterize the bucket name
directly. Catch this in phase 0, not on the phase 7 deploy.

**Database.** "Work on each independently" implies the two apps do **not** share an Aurora
cluster — otherwise a migration or a bad write in one breaks the other. The new stack gets
its own cluster, restored from a snapshot of the live one so the data is realistic. This is
also what makes the §7.3 contract tests meaningful: both apps can be pointed at identical
data without either mutating the other's.

### 8.6 Domain split: the new app takes reunion-connect.org

Today **both** public names are aliases on the **same** CloudFront distribution in the
**same** stack (`classyear-serverless`):

| Name | Param | Hosted zone |
|---|---|---|
| `reunion-connect.org`, `www.reunion-connect.org` | `DomainName` | `Z0466195259YGZ44DUBMY` |
| `unicornconnections.org`, `www.unicornconnections.org` | `SecondaryDomainName` | `Z04780762C3Q0K0DKRGSP` |

One ACM certificate covers all four names; one `FrontendDistribution` lists all four as
`Aliases`; two `RecordSetGroup`s point the two zones at it.

**Target end state:**

| App | Domain |
|---|---|
| Existing Express/Lambda app (`classyear-serverless`) | `unicornconnections.org` + `www` |
| New NestJS app (`classyear-nest`) | `reunion-connect.org` + `www` |

Because both names hang off one distribution in one stack, the split is not something the
new app can do unilaterally — the existing stack **has to give up `reunion-connect.org`**
before the new one can take it. The changes to the old repo's `template.yaml` are small and
mechanical, but they are real edits to production infrastructure:

1. `DomainName` default → `unicornconnections.org`, `HostedZoneId` → `Z04780762C3Q0K0DKRGSP`.
2. Delete the `SecondaryDomainName` / `SecondaryHostedZoneId` params, the
   `SecondaryFrontendDNSRecords` group, and the `SecondaryFrontendURL` output — the old app
   is down to one domain, so the primary/secondary distinction disappears.
3. Cert SANs and distribution `Aliases` drop to `unicornconnections.org` + `www`.
4. `FrontendURL` override in `samconfig.toml` → `https://unicornconnections.org`.
5. S3 CORS `AllowedOrigins` drops the reunion-connect entries.

#### The hard constraint: CloudFront alias exclusivity

**An alternate domain name can be attached to only one CloudFront distribution at a time.**
The new distribution cannot claim `reunion-connect.org` until the old one releases it. Two
ways to sequence this:

- **Simple:** deploy the old stack without the alias, then deploy the new stack with it.
  There is a window — minutes, bounded by two CloudFormation updates and DNS TTL — where
  `reunion-connect.org` serves nothing.
- **Lower-downtime:** `aws cloudfront associate-alias --target-distribution-id <new> --alias
  reunion-connect.org`, which moves an alias between distributions in the same account. The
  new distribution must already be deployed *and* already hold a certificate covering the
  name. Do this before the CloudFormation updates, then reconcile both templates to match
  reality on the next deploy.

Recommend the simple path: this is a dev-stage site, and a few minutes of apex downtime on a
planned change is cheaper than the drift of hand-moved aliases that the templates don't know
about.

#### Two ACM certificate replacements

Editing a cert's SAN list forces CloudFormation to **replace** the certificate resource. Both
stacks take one: the old cert drops to 2 names, the new cert is issued for 2. This already
happened cleanly once (commit `6921216`, when unicornconnections.org was added) via automatic
Route53 DNS validation, and both zones are properly delegated, so it should be uneventful —
but it is not instant, and the certificate must exist before the distribution referencing it
can deploy.

#### Knock-on effects of the `DomainName` change on the old app

`DomainName` is not only DNS. Two things derive from it:

- **`SES_FROM_EMAIL: !Sub 'noreply@${DomainName}'`.** Flipping the old app's `DomainName` to
  `unicornconnections.org` changes its sender to `noreply@unicornconnections.org`. **Verify
  that SES domain identity (and DKIM) before the change lands**, or password-reset and
  email-verification sends from the old app start failing. This is the single most likely
  way to break the existing app during the split, and it has nothing to do with DNS.
- **`FRONTEND_URL`.** It is baked into reset/verification **email links**. Old app →
  `https://unicornconnections.org`, new app → `https://reunion-connect.org`. A link minted
  before the switch points at the other app's domain; reset tokens live 1 hour, so pick a
  low-traffic window and accept that a handful of in-flight links may land on the wrong app.

The new stack needs its own verified SES identity for `noreply@reunion-connect.org`, and a
fresh production-access check if the account's SES is still sandboxed for that identity.

#### Where the new app lives during phases 0–6

The new app should not hold `reunion-connect.org` while it is half-built. Until phase 7 it
uses either the distribution's default `*.cloudfront.net` name or — cleaner, and what this
plan assumes — a **subdomain**, `nest.reunion-connect.org`, in the existing
`Z0466195259YGZ44DUBMY` zone. A subdomain alias does **not** conflict with the apex alias on
the old distribution, so the new stack gets a real HTTPS hostname with zero impact on either
live site. Its certificate covers `nest.reunion-connect.org` initially and is extended to the
apex at phase 7.

`frontend/.env.production` (`VITE_API_BASE_URL`) currently points straight at the API Gateway
URL, not at a custom domain — so the new frontend just needs the new stack's API Gateway URL
and is unaffected by the domain choreography.

---

## 9. Deliberate divergences

Everything the port does differently from the source, in one place.

### 9.1 Fixed without asking (safe, invisible to clients)

1. `SchemaService.initialize()` rethrows on failure instead of logging and continuing.
2. `JWT_SECRET` is required at boot; the two conflicting fallback secrets are removed.
3. One implementation instead of Express-plus-Lambda duplicates.
4. Uniform CORS/preflight handling for all routes rather than 8 hand-listed `OPTIONS` routes.

### 9.2 Flagged, reproduced as-is in phase 1, fixed only on approval

1. **`?requesterId=` authorization** in comments and photos — trivially spoofable. Fix is
   to derive identity from the JWT, which requires a coordinated frontend change.
2. **Unguarded admin endpoints** — `POST /api/admin/seed`, `GET /api/admin/users`,
   `PUT /api/admin/users/:userId`, `PUT /api/admin/users/:userId/move-class`,
   `POST /api/admin/registration-links` have no guard.
3. **`reset-password` / `verify-email` token selection.** Both do
   `SELECT ... WHERE expires_at > NOW() ORDER BY created_at DESC LIMIT 1` and *then* compare
   the hash — they pick the single most-recent token **globally**, not the one matching the
   submitted token. If two users request a reset in the same window, the second request's
   token is the only one that can succeed; the first user's valid token is rejected. The fix
   is a one-line `WHERE token_hash = $1`, but it changes behaviour, so it is listed here
   rather than done silently.

### 9.3 Preserved bug-for-bug

`POST /api/auth/register` returns `403 { error: 'Registration is currently disabled.' }` on
its first line; the remaining ~80 lines are unreachable. The port keeps the 403 and ports
the dead code into the service as a private, unwired method with a comment — registration
is evidently meant to come back, and re-deriving it later would be waste.

### 9.4 Explicitly not ported

`utils/dataApiDb.ts` (RDS Data API experiment) and `routes/testHelpers.ts` unless a
dependency on them turns up.

Five Express-only route handlers, added in phase 2. None has a deployed counterpart in
`template.yaml`, and none is referenced anywhere in `frontend/src` — they are reachable only
by running the Express server on a laptop. The three writes would each add an
unauthenticated mutation the production API does not currently expose:

| Route | Why not |
|---|---|
| `POST /api/users/register` | Unauthenticated account creation, while registration is disabled app-wide (§9.3) |
| `POST /api/users/:userId/assign-class` | Unauthenticated class re-assignment; deployed path is `POST /api/admin/schools/…/users` |
| `POST /api/schools` | Unauthenticated school creation; deployed path is `POST /api/admin/schools`, admin-gated |
| `GET /api/classes/:id/alumni-count` | Dead read, no caller |
| `GET /api/classes/:id/message-count` | Dead read, no caller |

Two more in phase 3, on the same evidence — not deployed, not referenced in
`frontend/src` — but without the security argument, since both are reads:

| Route | Why not |
|---|---|
| `GET /api/events/class/:classId/events` | Dead read; the deployed list is `/api/schools/:schoolId/classes/:classId/events` |
| `GET /api/events/class/:classId/days-until-next` | Dead read, no caller |

Each is a dozen lines to restore if a consumer turns up. Contrast §14's treatment of the
three Express-only *auth* endpoints, which were included: `/verify-email` had a live
frontend caller, and `/me` and `/logout` are read-only and free.

---

## 10. Phased plan

Each phase ends at a green gate. Nothing merges past a red contract test.

| Phase | Scope | Gate |
|---|---|---|
| **0** ✅ | Scaffold: Nest CLI project, `DatabaseModule`, `SchemaService`, config validation, `docker-compose` Postgres, `/pulse` | `GET /pulse` returns the same JSON; `initialize()` builds a schema `pg_dump`-identical to the old one |
| **1** ✅ | `AuthModule` + three guards (two deferred, §14) + global exception filter + validation pipe | All 10 auth endpoints pass contract tests, including error-message strings |
| **2** ✅ | `UsersModule`, `SchoolsModule`, `ClassesModule` — the read-heavy core | Contract tests green; frontend directory + profile pages work against Nest — see §15 |
| **3** ✅ | `CommentsModule` (both mounts), `EventsModule`, `FeedbackModule` | Contract tests green; feature flag verified in both states — see §16 |
| **4** | `PhotosModule` + S3 + multipart | Upload/delete verified against real S3 **and** through API Gateway binary handling |
| **5** | `AdminModule` + `adminSchools`/`adminClasses`/`adminEvents` incl. CSV import + bulk link | Full 74-endpoint contract suite green |
| **6** | Frontend: copy `frontend/` across, point `VITE_API_BASE_URL` at the Nest server | Vitest + Playwright e2e green against Nest |
| **7** | Deployment: minimal SAM template, single proxy function, warmer, email worker; new stack `classyear-nest`, own Aurora cluster, served at `nest.reunion-connect.org` (§8.6) | Smoke test against deployed stack; **both** live domains still served by the old app |
| **8** | Domain split (§8.6): verify SES identity for `noreply@unicornconnections.org` → old stack drops to `unicornconnections.org` only → new stack claims `reunion-connect.org` + `www` | `unicornconnections.org` serves the old app, `reunion-connect.org` serves the new app, both HTTP 200 with valid certs; password reset sends correctly from both |
| **9** | *Later, optional, separately approved* — move `unicornconnections.org` to the new app too and retire the old stack | — |

Phase 8 is the only phase that touches the existing production stack. It is deliberately
last, deliberately small, and deliberately separable: everything before it is additive and
leaves both live domains exactly as they are today.

Phases 2–5 are independent of each other and could be parallelized; phases 0 and 1 are
strictly blocking.

---

## 11. Immediate next steps

1. `nest new` scaffold into `/Users/crgdncn/Code/ClassYearNest` as the `apps/api` workspace
   of the monorepo described in §3.4, `git init`.
2. Copy `docker-compose.yml` and add a second `postgres_test` service for integration tests.
3. Build phase 0 and stand up the contract-test harness against a worktree of the old repo —
   the harness pays for itself from phase 1 onward.
4. **Cheap infra checks that can happen now, in parallel with phase 0** — all read-only,
   none of them touch the running app, and each de-risks a later phase:
   - Is there a verified SES domain identity for `unicornconnections.org`, and is it out of
     the sandbox? (Gates phase 8; §8.6.)
   - Confirm the file-bucket naming collision (§8.5) and pick the new stack's `Environment`
     value before the first `sam deploy`.
   - Confirm `nest.reunion-connect.org` is free in zone `Z0466195259YGZ44DUBMY`.
5. Confirm the open questions below — #1 before phase 4, #2 and #3 before phase 8.

## 12. Open questions

1. **Multipart under a single proxy Lambda** (§8.2) — needs a spike before phase 4 commits
   to the architecture. If binary handling proves painful, the fallback is a second small
   function for the two upload routes.
2. **SES identity for `noreply@unicornconnections.org`** (§8.6) — does it already exist and
   is it out of the sandbox? This gates phase 8 and is the likeliest way to break the
   *existing* app. Check it early; it needs no code and can be done during phase 0.
3. **Apex downtime during the alias move** (§8.6) — accept a few minutes on
   `reunion-connect.org`, or use `associate-alias` for a near-zero-downtime move at the cost
   of template drift? Assumed: accept the window.
4. **SQS email path** (§8.3) — keep the queue or inline the send. Assumed: keep.
5. **Aurora data for the new stack** (§8.5) — snapshot-restore from live, or start empty and
   seed? Assumed: snapshot-restore, so contract tests run against realistic data.

---

## 13. Phase 0 — done (2026-09-03)

### Gates

Both passed.

| Gate | Result |
|---|---|
| `GET /pulse` returns the same JSON as the source | ✅ `{"status":"ok","timestamp":"…"}`, served at the root, `/api/pulse` correctly 404s |
| `SchemaService` builds a `pg_dump`-identical schema | ✅ 78 statements, zero diff — `npm run schema:verify` |

The schema gate is automated and repeatable (`scripts/verify-schema-parity.sh`): it runs the
source app's `schema.ts` **unmodified** against one scratch database and `SchemaService`
against another, then diffs `pg_dump --schema-only` output. It reads the source repo and
never writes to it. This is the pattern the §7.3 contract tests will follow for endpoints.

### Shipped

`apps/api/src/` — `config/` (Zod-validated env), `database/` (`DatabaseService`,
`SchemaService`, `SeedService`), `health/` (`/pulse`), `cli/init-schema.ts`,
`bootstrap.ts` (setup shared by `main.ts`, the future `lambda.ts`, and e2e tests).
12 tests passing across unit + e2e. Root workspace, `docker-compose.yml`, `README.md`.

### Decisions that differ from what this document assumed

1. **Zod, not Joi.** `@nestjs/config` v12 takes a
   [Standard Schema](https://standardschema.dev/) (Zod/Arktype) for `validationSchema`, and
   Joi is not one. Validation goes through the `validate` hook with Zod, which also reports
   every bad var at once instead of only the first. §6 said "Joi/Zod"; it is Zod.
2. **Vitest, not Jest.** Nest 12 scaffolds Vitest + oxlint. No reason to fight it — §7's
   strategy (unit tests with mocked repositories, integration tests against real Postgres,
   contract tests as the parity gate) is unchanged, only the runner differs.
3. **ESM.** Nest 12 scaffolds `"type": "module"` with `nodenext` resolution, so imports
   carry `.js` extensions. This matches the source app, which is also ESM. Worth
   re-verifying at phase 7 — `serverless-express` under ESM is the one place this could
   bite.
4. **`strict: true`.** The source ran `strict: false`. The scaffold defaults to strict and
   nothing so far needed loosening; keep it until something genuinely fights it.

### Environment note

**Docker is not installed on this machine** — no daemon, no socket, no `docker` binary,
despite `samconfig.toml` referencing `~/.docker/run/docker.sock`. Phase 0 ran against the
Homebrew `postgresql@14` service instead (14.20, same major version as the compose image),
which is why `verify-schema-parity.sh` defaults `PGUSER` to `$(whoami)` rather than
`postgres`.

`docker-compose.yml` is committed and correct, but **untested**. This matters beyond local
convenience:

- §7.2 assumes Testcontainers or compose for integration tests against real Postgres.
- SAM local emulation needs Docker.
- `sam build` for a container-based Lambda needs Docker.

Native Postgres covers phases 1–6 fine. Docker needs to be reinstalled before phase 7, and
before any integration test that wants a disposable database. Not a blocker now; would be a
surprise later.

---

## 14. Contract decision: the Lambda handlers are the reference

Decided 2026-09-03, at the start of phase 1, once the auth port made the divergence concrete.

### The problem

§2.1 noted that the Express routers and Lambda handlers "have drifted". Reading them
side by side for `/api/auth`, the drift is **on the wire**, not just internal:

| `POST /api/auth/login` | Express | Lambda |
|---|---|---|
| response | `{token, user:{id, email, is_admin, is_class_admin, created_at, profile, user_id, first_name, last_name}}` | `{user:{user_id, email, is_admin, is_class_admin, profile}, token}` |
| 400 | `Email and password are required.` | `Email and password required.` |
| 500 | `Internal server error during login.` | `Internal server error (auth.ts).` |
| JWT claims | `id, email, is_admin, profile, user_id, first_name, last_name` | `id, email, is_admin, is_class_admin` |
| `Set-Cookie` | yes, httpOnly `token` | none |
| user with null password | `bcrypt.compare(pw, null)` throws → 500 | explicit check → 401 |

Authorization diverges too. Express uses the `middleware/adminAuth.ts` family, which
**re-reads the user row from the database** on every request and returns
`Missing or invalid authorization token.` / `Super admin access required.`. Lambda uses
`getAuthUser`, which is **bearer-only, JWT-only, no database read** — it trusts the
`is_admin`/`is_class_admin` claims — and returns `Authentication required.` /
`Admin access required.`, using that same 403 string for both admin and super-admin checks.

### The decision

**Port the Lambda behaviour.** Three reasons:

1. **It is what is deployed.** API Gateway routes to the Lambda handlers; the Express server
   only ever runs on a developer's laptop.
2. **The frontend is written against it.** `Login.tsx` reads `userData.user_id` and
   `userData.profile` — the Lambda shape. (It also reads `userData.created_at`, which Lambda
   never sends, so that field is silently `undefined` in production today.)
3. **Where they differ on correctness, Lambda is right.** Express's `reset-password` selects
   only `user_id` and then reads `resetRecord.token_hash`, which is `undefined`, so
   `verifyResetToken` compares a hash against `undefined` and always fails. That endpoint
   **cannot succeed** — it is not merely racy as §9.2 originally described. Lambda hashes the
   submitted token and looks it up by `token_hash`, which is correct.

This supersedes §9.2 item 3 for `reset-password`. It still stands for Express's
`verify-email`, which is Express-only (below).

### Endpoints that exist only in Express

`/api/auth/me`, `/api/auth/logout`, and `/api/auth/verify-email` have no Lambda function and
no route in `template.yaml`. **All three are included in the port.**

- `/me` and `/logout` are cheap and unused by the frontend app code (`logout` clears
  `localStorage` client-side; `/me` appears only in `api.test.ts`).
- `/verify-email` matters: `VerifyEmail.tsx` posts to it, so **email verification is broken
  in production today** — the call hits a route that does not exist. Including it fixes a
  live feature. Its token lookup is written the correct way (look up by `token_hash`) rather
  than reproducing the Express "most recent token globally" flaw.

### Consequences for the contract tests

The reference implementation is a set of **functions**, not a server. The old handlers take
an `APIGatewayProxyEvent` and return an `APIGatewayProxyResult`, so `tools/contract-tests`
invokes them directly rather than booting the Express app and diffing HTTP. That is simpler
than the worktree-plus-running-server approach §7.3 assumed, and it removes the risk of
accidentally certifying the port against behaviour nobody runs.

### Consequence for the guards

§3.2's five-guard module map was derived from the Express middleware. Under the Lambda
model only the first three are route-level concerns:

- `JwtAuthGuard`, `AdminGuard`, `SuperAdminGuard` — built in phase 1.
- `UserAdminGuard`, `EventAdminGuard` — **deferred**. Lambda performs these per-class checks
  *inline inside each handler*, after argument parsing and with endpoint-specific messages,
  not as route-level middleware. They become a `ClassScopeService` injected where needed,
  built in phases 3 and 5 alongside their first real consumers rather than guessed at now.

---

## 15. Phase 2 — done (2026-09-03)

`UsersModule`, `SchoolsModule`, `ClassesModule` — the read-heavy core.

### Gate

| Gate | Result |
|---|---|
| Contract tests green | ✅ 76 assertions across 4 spec files, `npm run contract:verify` |
| Schema parity still green | ✅ 78 statements, zero diff |
| Unit + e2e | ✅ 74 unit, 3 e2e |

The contract suite grew from 34 assertions (auth only) to 76. Every phase-2 endpoint is
compared against its deployed Lambda handler for status **and** body, including error
strings, with a freshly-seeded database on each side of each comparison.

### Shipped

| Method | Path | Auth |
|---|---|---|
| GET | `/api/users` | token |
| GET | `/api/users/:userId` | token |
| GET | `/api/users/:userId/class` | token |
| PUT | `/api/users/:userId/profile` | token; self or admin |
| GET | `/api/schools` | **none** |
| GET | `/api/schools/:schoolId` | token |
| GET | `/api/schools/:schoolId/classes` | **none** |
| GET | `/api/classes` | token |
| GET | `/api/classes/:classId` | token |
| GET | `/api/classes/:classId/members` | token |
| GET | `/api/classes/:classId/directory` | token; member or admin |
| GET | `/api/classes/:classId/photos` | token; member or admin |

Plus `photos/photo-url.service.ts` (presigned S3 URL resolution, extracted early because
five of the twelve endpoints above return resolved photo URLs), `common/avatar-colors.ts`,
and `common/http-errors.ts`.

### Decisions

1. **Five Express-only endpoints are not ported** (added to §9.4). None is deployed, none is
   called anywhere in the frontend, and the three writes would each open a hole that does
   not exist in production today:
   - `POST /api/users/register` — unauthenticated account creation. Registration is disabled
     app-wide (§9.3); this is the same thing by another name.
   - `POST /api/users/:userId/assign-class` — unauthenticated class re-assignment. The
     deployed way to put a user in a class is `POST /api/admin/schools/…/users`.
   - `POST /api/schools` — unauthenticated school creation. Deployed equivalent is
     `POST /api/admin/schools`, behind an admin check, arriving in phase 5.
   - `GET /api/classes/:id/alumni-count`, `GET /api/classes/:id/message-count` — dead reads.

   If any turns out to have a consumer, each is a dozen lines to add back.

2. **`PhotoUrlService` ships in phase 2, not phase 4.** `GET /api/users/:userId`, the
   directory and the slideshow all return presigned URLs rather than the S3 keys the columns
   actually hold. Deferring it would have meant returning keys and calling it parity. Phase 4
   absorbs this file into the full `PhotosModule` rather than adding a second S3 client.

3. **`S3_ENDPOINT` lost its `http://localhost:4566` default.** `ConfigModule` writes
   validated values back into `process.env`, so a schema default is indistinguishable from
   an operator setting one — every deployed environment would have pointed its S3 client at
   localhost. Unset now means real S3. Caught by the contract suite, which is the second
   thing that gate has found that no unit test would have.

4. **Presigned URLs are compared path-only.** The signature is derived from `X-Amz-Date`, so
   two invocations a second apart differ. `normalize` strips the query string and keeps
   scheme, host, and key — a field that resolved to the wrong object, to a different bucket,
   or not at all still fails. The contract script exports placeholder AWS credentials;
   presigning is pure local signing and never contacts S3.

5. **`AuthService.rethrow` moved to `common/http-errors.ts`.** Three new services end their
   handlers the same way. It also widened from a list of five exception classes to
   `instanceof HttpException`, which is strictly more general; the auth contract tests
   confirmed no behaviour changed.

### Divergences found while porting

Both are cases where the Express router and the deployed handler disagree, resolved per §14
in favour of the deployed one. Both are now pinned by a contract test.

| | Express | Lambda (ported) |
|---|---|---|
| `PUT /api/users/:userId/profile`, duplicate email | 409 | **400** `Email already in use.` |
| `GET /api/schools/:id/classes`, unknown school | 404 `School not found.` | **200** `{ classes: [] }` |

Also worth recording: `GET /api/classes/:id/directory` and `/photos` take identity from the
**token**, not from `?userId=`. The Express versions checked whichever id the caller passed,
so anyone could read any class's directory by naming a member. The frontend still sends
`?userId=`; it is ignored. This is §9.2's `requesterId` problem already fixed for these two
endpoints by the deployed code — it remains open for comments and photos.

### Notes for phase 3

- `CommentsModule` mounts at `/api/users` as well as `/api/comments`. `UsersModule` is
  listed before it in `AppModule` for the §5.3 ordering reason; keep it that way.
- `ClassesRepository` is exported specifically so events and admin can reuse its
  `class_school` / `class_user` queries rather than growing a second copy.
- The fixture now seeds two schools, three class years, and four users including a super
  admin and a deliberate non-member. Phase 3 should extend it rather than start a new one.

---

## 16. Phase 3 — done (2026-09-03)

`CommentsModule` (both mounts), `EventsModule`, `FeedbackModule`.

### Gate

| Gate | Result |
|---|---|
| Contract tests green | ✅ 136 assertions across 7 spec files |
| Feature flag verified in both states | ✅ five cases, including the check-order one below |
| Schema parity still green | ✅ 78 statements, zero diff |
| Unit + e2e | ✅ 133 unit, 3 e2e |

### Shipped

| Method | Path | Auth |
|---|---|---|
| GET | `/api/users/:userId/comments` | token |
| GET | `/api/users/:userId/comments/pending` | token; filtered per comment |
| POST | `/api/users/:userId/comments` | token |
| GET | `/api/comments/pending` | token; admin or class admin |
| GET | `/api/comments/my-comments/:commenterId` | token; self or admin |
| PUT | `/api/comments/:commentId` | token; moderator to publish, author to edit |
| DELETE | `/api/comments/:commentId` | token; author or moderator |
| GET | `/api/schools/:schoolId/classes/:classId/events` | token |
| GET | `/api/events/:eventId` | token |
| PUT DELETE | `/api/events/:eventId` | token; admin or class admin of that class |
| GET POST | `/api/feedback` | flag, then token |

That is 40 of the deployed surface across phases 1–3. Photos and admin remain.

### `ClassScopeService` — the deferred guards, resolved

§14 deferred `UserAdminGuard` and `EventAdminGuard` on the grounds that the
deployed handlers run these checks *inside* the handler, against ids only known
once a row has been fetched. Phase 3 confirms that and builds the replacement:
`common/class-scope/class-scope.service.ts`, with `canModerateComments` and
`canManageEvent`. A guard genuinely could not do this work — a comment's
authorization depends on who wrote it and whose profile it is on, neither of
which is in the request.

**The two checks disagree about where roles come from, and the port keeps the
disagreement.** `canModerateComments` re-reads `is_admin` / `is_class_admin`
from the users table; `canManageEvent` trusts the JWT claims. Concretely: a
newly promoted admin can moderate comments immediately but cannot manage events
until their token is reissued, and a demoted one loses moderation at once while
keeping event control for up to 24h. Harmonising it means either adding a
database read to every event write or removing one from every moderation check.
Both are behaviour changes, so it belongs here as a flagged item rather than a
silent fix. A unit test asserts each side's current sourcing so that "fixing"
one fails loudly.

### Decisions

1. **Two more Express-only endpoints are not ported** (added to §9.4):
   `GET /api/events/class/:classId/events` and
   `GET /api/events/class/:classId/days-until-next`. Neither is deployed, and
   neither is referenced anywhere in `frontend/src`. Same reasoning as phase 2's
   five, minus the security argument — these are dead reads, not dead writes.

2. **The feedback flag is a guard that reads `process.env` per request.** §6
   called for a guard rather than conditional module loading; the per-request
   read is the other half of it. The source's flag is a function, not a
   constant, and the phase gate asks for both states — which a boot-time read
   would make untestable without two app instances.

   **Guard order is load-bearing.** `@UseGuards(FeedbackEnabledGuard,
   JwtAuthGuard)`, in that order, because the source checks the flag on the
   handler's first line, before it looks at the token. A disabled deployment
   therefore answers 404 to *everyone*; reversing the guards would answer 401 to
   unauthenticated callers and leak the module's existence. There is a contract
   test for exactly this.

3. **One service, two controllers, for both comment mounts.** The source mounts
   a single Express router at `/api/users` and `/api/comments` (§2.2, §5.3).
   `CommentsController` and `UserCommentsController` share `CommentsService`,
   which is the same routing with the ownership made legible. `CommentsModule`
   is imported after `UsersModule` in `AppModule` for the §5.3 ordering reason;
   the routes do not actually collide today, but the order is what keeps that
   true if a one-segment route is ever added.

### Divergences found while porting

**`PUT /api/comments/:commentId` with both `content` and `published` always
500s.** The handler builds its SET list dynamically; supplying `content`
appends `published = false` (an edit returns a comment to moderation), and
supplying `published` appends `published = $n`. The result is
`SET content = $1, published = false, published = $2`, which Postgres rejects
outright as a duplicate assignment. The endpoint cannot succeed with both
fields. Nothing in the frontend sends both, so it has never been hit in
production. Reproduced bug-for-bug and pinned by a contract test; the fix is
two lines but changes behaviour, so it goes to §9.2 rather than being done
quietly.

Reaching that case in a test needs a caller who is simultaneously the comment's
author *and* a moderator of it, because either check refuses first otherwise —
authorship does not confer moderation rights. The fixture gains a self-authored
admin comment purely for this.

**`PUT /api/events/:eventId` returns one field fewer than `GET`.** Every read
query joins `schools` for `timezone`; the UPDATE's `RETURNING` clause does not.
So a PUT response has no `timezone` where the GET for the same event does. The
source's asymmetry, now pinned.

### Notes for phase 4

- `PhotoUrlService` (phase 2) already owns the S3 client, bucket and region
  config. `PhotosModule` should absorb `photos/photo-url.*` rather than sit
  beside it — two modules owning one S3 client is the duplication this port
  exists to remove.
- `canManagePhotos` / `canViewPhotos` in `lambda/photos.ts` are two more
  class-scope predicates. They belong in `ClassScopeService` alongside the two
  built here, not as private helpers in `PhotosService`.
- §8.2's multipart-under-Lambda spike is still open and gates the phase-4
  architecture. Open question #1.
- The fixture already seeds photo keys for `activeUser` and one `gallery_photos`
  row; phase 4 should extend that rather than start over.
