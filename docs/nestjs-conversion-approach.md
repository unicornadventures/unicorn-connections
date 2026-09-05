# ClassYear → NestJS Conversion Approach

**Target directory:** `/Users/crgdncn/Code/ClassYearNest`
**Source of truth (read-only):** `/Users/crgdncn/Code/ClassYear`
**Status:** phase 6 complete (2026-09-04) — API and web client both done. §13 phase 0, §14
the contract decision, §15–§19 phases 2–6, §20 SES (**corrected by §25**), §21 the §9.2 fixes, §22–§24
phase 7 and the shared database, §25 SES resolved. **Phase 7 is deployed and its
gate is met, and phase 8 is unblocked.**

> Open bugs live in [`known-bugs.md`](known-bugs.md). Two of them gate phase 8
> and have external lead time — start those first.

> **Before phase 8:** the `unicornconnections.org` SES identity does not exist and the
> account is in the SES sandbox (§20). Both are lead-time items on that phase's critical
> path, and the sandbox affects the *existing* app today.
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

### 8.1 `s3Service.updatePhotoUrlInDatabase` is broken — **resolved in phase 4: dead code, not ported**

```ts
await query(`UPDATE users SET ${fieldName} = $1 WHERE user_id = $2`, [url, userId]);
```

`users` has neither `then_photo_url`/`now_photo_url` (those are on `profiles`) nor a
`user_id` column. This function throws whenever it is called. Determine whether any live
path reaches it; if not, drop it from the port rather than carrying a broken function
forward. If something does reach it, it is an existing production bug and fixing it is
part of the port (record it in §9).

### 8.2 Multipart uploads under Lambda — ~~open~~ **resolved in phase 4, §17**

> **This section was wrong.** It assumed the multipart route was deployed. It is not.
> Every deployed photo endpoint is presigned-URL based, the browser PUTs files directly to
> S3, and the API never receives file bytes. `binaryMimeTypes` / `BinarySettings` are
> **not needed in phase 7**, and there is no `FileInterceptor` in the port. Kept here for
> the record; see §17 for the evidence.

The original text: Express dev uses `multer` memory storage. Under API Gateway the body
arrives base64-encoded, which is why a second `POST /:userId/photo/upload/:photoType`
presigned-URL endpoint exists. With a single Nest proxy function, `serverless-express`
needs `binaryMimeTypes` configured for `FileInterceptor` to work.

What was missed: `routes/photoRoutes.ts` is the *only* thing with a multipart handler, and
that router is never deployed. The multipart and presigned versions share a method and a
path — `POST /api/users/:userId/photo/:photoType` — while having entirely different
contracts, which is the sharpest example yet of why §14 chose the Lambda handlers.

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
2. ~~**Unguarded admin endpoints**~~ — **WITHDRAWN in phase 5 (§18).** True of the Express
   router, false of the deployed handlers, every one of which opens with its own
   `is_admin` check. Since the deployed handlers are the contract (§14), the port is
   guarded and there is nothing to fix. `POST /api/admin/seed` has no deployed route at
   all and is not ported.
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

And in phase 4:

| Route / function | Why not |
|---|---|
| `POST /api/users/:userId/photo/:photoType` (**the multipart variant**) | Not deployed. The same method and path *are* deployed as a presigned-URL endpoint, which is what the port implements (§17) |
| `POST /api/users/:userId/photo/upload/:photoType` | Not deployed, no caller |
| `PUT /api/users/:userId/photo/:photoType` | Not deployed, no caller |
| `s3Service.updatePhotoUrlInDatabase` | Throws whenever called — wrong table, wrong column. Referenced only by its own unit test (§8.1) |
| `s3Service.uploadFileToS3` | Only consumer is the undeployed multipart route |

And in phase 5:

| Route | Why not |
|---|---|
| `POST /api/admin/seed` | Not deployed. Admin seeding happens at boot from an SSM SecureString (§8.4), not over HTTP |

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
| **4** ✅ | `PhotosModule` + S3 (**no multipart — none is deployed, §17**) | Upload/delete verified against a real object store; binary handling n/a — see §17 |
| **5** ✅ | `AdminModule` + `adminSchools`/`adminClasses`/`adminEvents` incl. CSV import + bulk link | Full contract suite green — see §18 |
| **6** ✅ | Frontend: copy `frontend/` across, point `VITE_API_BASE_URL` at the Nest server | Vitest + Playwright green; a live-API smoke suite covers the "against Nest" half — see §19 |
| **7** ✅ | Deployment: minimal SAM template, single proxy function, warmer, email worker; new stack `classyear-nest`, **shared** database (§23), served at `nest.reunion-connect.org` | Gate met — see §24 |
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

1. ~~**Multipart under a single proxy Lambda**~~ — **CLOSED in phase 4 (§17).** No spike was
   needed: no deployed endpoint accepts a file body. Uploads are presigned PUTs the browser
   performs directly against S3. Phase 7 needs no binary handling and no second function.
2. ~~**SES identity for `noreply@unicornconnections.org`**~~ — **ANSWERED 2026-09-04, and the
   answer is no on both counts.** See §20. It gates phase 8 exactly as feared, and it also
   surfaced a live production problem that has nothing to do with the port.
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

---

## 17. Phase 4 — done (2026-09-03)

`PhotosModule` + S3. Seven deployed endpoints.

### Gate

The phase gate was "upload/delete verified against real S3 **and** through API
Gateway binary handling". The first half is met; **the second half does not
exist**, for the reason below.

| Gate | Result |
|---|---|
| Contract tests green | ✅ 164 assertions across 8 spec files |
| Upload/delete against a real object store | ✅ MinIO, real objects PUT and DELETEd |
| API Gateway binary handling | ➖ **not applicable** — no endpoint accepts a body of bytes |
| Schema parity still green | ✅ 78 statements, zero diff |
| Unit + e2e | ✅ 173 unit, 3 e2e |

### The finding: there is no multipart to port

§8.2 called multipart "the one place where the single-function architecture is
meaningfully harder than per-function handlers" and open question #1 wanted a
spike before this phase committed to an architecture. Reading the deployed
handlers settles it without a spike:

- **Every deployed photo endpoint is presigned-URL based.** `POST
  /api/users/:userId/photo/:photoType` takes no body; it returns
  `{ presignedUrl, key }` and records the key. The browser then PUTs the file
  **directly to S3** — `UserProfile.tsx:141-144` does exactly that.
- **The API never receives file bytes.** Not in the deployed handlers, not in
  the frontend's calls.
- The multipart handler exists only in `routes/photoRoutes.ts`, which uses
  `multer.memoryStorage()` and **is not deployed**. It is reachable solely by
  running the Express server locally.

The trap here is that the multipart route and the presigned route share a method
and a path — `POST /api/users/:userId/photo/:photoType` — while having entirely
different contracts. It is the sharpest illustration so far of why §14 picked
the Lambda handlers as the reference.

**Consequences:**

1. **Open question #1 is closed.** No spike needed, nothing to decide.
2. **Phase 7 does not need `binaryMimeTypes` or `BinarySettings: ['*/*']`.**
   §8.2's warning can be struck; the single-proxy architecture has no multipart
   problem because there is no multipart.
3. **No `FileInterceptor`, no multer, no body-size limits** anywhere in the port.

### §8.1 resolved: `updatePhotoUrlInDatabase` is dead

§8.1 asked whether any live path reaches the broken function that does
`UPDATE users SET ${fieldName} = $1 WHERE user_id = $2` against a table with
neither those columns nor a `user_id`. It does not. The only references in the
entire source repo are its own definition and its own unit test — no route, no
handler, no Lambda. It is **not ported** (§9.4).

Worth recording why it survived: the source's test suite mocks the database, so
a test asserting that a broken query was issued passes happily. §7.1's objection
to porting that pattern now has a concrete example behind it.

### Shipped

| Method | Path | Auth |
|---|---|---|
| POST | `/api/users/:userId/photo/:photoType` | self, admin, or class admin sharing a class |
| DELETE | `/api/users/:userId/photo/:photoType` | same |
| GET | `/api/photos/presigned?key=` | any authenticated caller — **no ownership check** |
| GET | `/api/users/:userId/gallery` | self, admin, or **any** classmate |
| POST | `/api/users/:userId/gallery` | self or admin only |
| PUT | `/api/users/:userId/gallery/:photoId` | self or admin only |
| DELETE | `/api/users/:userId/gallery/:photoId` | self or admin only |

`PhotoUrlService` (phase 2's stopgap) was folded into `S3Service` rather than
left beside it, as the phase-3 handover asked. `canManagePhotos` and
`canViewPhotos` joined `ClassScopeService`. Viewing is deliberately broader than
managing — any classmate may look at a gallery, only class admins may change one
— which is one missing role check apart in the source and is now a tabulated
unit test.

### Testing against a real object store

Deletes are half of what this module does, so the contract suite runs against a
scratch **MinIO** that `scripts/run-contract-tests.sh` starts and stops, rather
than signing URLs into the void. Objects are seeded by `resetFixture` and the
tests assert they are actually gone afterwards; `DeleteObject` is idempotent, so
without seeded objects both implementations would "pass" while proving only that
neither crashed. One test uploads through a minted URL and reads the bytes back,
which is the only way to catch a URL that is signed correctly but points at the
wrong bucket or region.

Pointing **both** implementations at MinIO took some care. The source builds
`new S3Client({ region })` with no endpoint and no way to configure one, so it
cannot be aimed at MinIO from inside this repo — using this app's own
`S3_ENDPOINT` would redirect only the port and the two sides would silently
address different stores. The SDK's standard `AWS_ENDPOINT_URL_S3` does it from
outside, for both, without touching the source. That yields virtual-host
addressing (`bucket.localhost:9100`) and the JS SDK has no environment variable
for path-style, so MinIO runs with `MINIO_DOMAIN=localhost` to accept it.

One more normalization was needed: keys end in `Date.now().toString(36)`, so the
two sides never mint the same one. Only the suffix is masked — the school, class,
user and photo type in the prefix stay compared, so a key built under the wrong
class still fails.

### Divergences found while porting

**The `photoType` 400 message.** §5.4 recorded it as
`'photoType must be "then" or "now".'`. That is the Express router's wording;
the deployed handler says `'Valid userId and photoType (then/now) required.'`.
Deployed wins (§14), and a contract test pins it.

**`GET /api/photos/presigned` has no ownership check.** Any authenticated user
can mint a viewing URL for any key in the bucket, including another class's, if
they can name it. Keys are guessable in principle but the millisecond suffix
makes it impractical. Deployed as-is; added to §9.2 rather than tightened, since
a fix needs a product rule about who may view what.

**A new upload never overwrites the old object.** Each mint gets a fresh
suffix, so the previous object is orphaned in S3 and nothing sweeps it. Storage
grows with every re-upload. Faithful, and now written down.

**The database row is written when the URL is minted, not when the upload
succeeds.** A client that requests a URL and abandons the upload leaves a key
pointing at nothing, which is why every read path tolerates a missing object.

### Notes for phase 5

- `S3Service.deleteFolder` is already ported and has **no phase-4 consumer** —
  it exists for `DELETE /api/admin/schools/:schoolId` and the cascade branch of
  `DELETE /api/admin/schools/:schoolId/classes/:classId`, which sweep whole
  photo prefixes. Use it rather than writing a second sweep.
- `ClassScopeService` now has four predicates. §14's `UserAdminGuard` work —
  the per-user checks in `adminRoutes` — should land there as a fifth rather
  than as a guard.
- Several `/api/admin/*` routes carry no guard at all (§9.2 item 2). Phase 5
  reproduces that; it is not the phase to fix it in.
- The contract harness now manages both Postgres *and* MinIO. Admin school and
  class deletes will exercise `deleteFolder` against real objects, so seed a few
  under a prefix that is meant to be swept.

---

## 18. Phase 5 — done (2026-09-03)

`AdminModule` plus the admin halves of Schools, Classes and Events. Seventeen
endpoints, and the last of the API surface.

### Gate

| Gate | Result |
|---|---|
| Full contract suite green | ✅ 240 assertions across 9 spec files |
| Schema parity still green | ✅ 78 statements, zero diff |
| Unit + e2e | ✅ 221 unit, 3 e2e |
| Typecheck | ✅ new `npm run typecheck` |

### The correction: the deployed admin routes *are* guarded

§5.5 and §9.2 item 2 both recorded that several `/api/admin/*` routes "carry no
guard at all today" — naming `GET /api/admin/users`, `PUT /api/admin/users/:userId`,
`/move-class`, `POST /api/admin/registration-links` and `POST /api/admin/seed`.

**That is true of the Express router and false of the deployed handlers.** Every
one of those Lambda handlers opens with

```ts
if (!authUser) return errorResponse(401, 'Authentication required.');
if (!authUser.is_admin) return errorResponse(403, 'Admin access required.');
```

Since the deployed handlers are the contract (§14), the port is guarded, and the
security concern §9.2 raised does not exist in production. §9.2 item 2 is struck.
`POST /api/admin/seed` has no deployed route at all and is not ported (§9.4).

Three guard levels are in play, and the contract tests pin which account reaches
what:

| Guard | Routes |
|---|---|
| `SuperAdminGuard` (`is_admin`) | 14 of the 17 |
| `AdminGuard` (`is_admin` **or** `is_class_admin`) then `canManageUser` | `DELETE /api/admin/users/:userId` |
| `JwtAuthGuard` only, with `canManageUser` doing all the gating | `PUT /api/admin/users/:userId/profile` |
| `JwtAuthGuard` only, with `canManageEvent` doing all the gating | `POST /api/admin/schools/…/events` |

The last two are genuinely only token-guarded at the route level. An ordinary
user reaching `PUT /users/:userId/profile` gets `Access denied. You can only
manage users in your class.` rather than the guard's `Admin access required.` —
the distinct message is how the tests tell the two paths apart.

### `ClassScopeService` is complete

`canManageUser` joins the four predicates from phases 3 and 4, finishing §14's
`UserAdminGuard` replacement. Five predicates, and only `canModerateComments`
re-reads roles from the database; the rest trust the token. That split is the
source's and is asserted by unit tests so a well-meaning harmonisation fails
loudly.

### The `BEGIN`/`COMMIT` that never worked

Three handlers wrap writes in `BEGIN`/`COMMIT` with a `ROLLBACK` in the catch:
`updateUserProfileHandler`, `moveUserClassHandler` and `createSchoolHandler`.

**None of them is a transaction.** `db.ts`'s `query()` calls `pool.query()`,
which checks out an arbitrary idle client per statement, so the `BEGIN` and the
`UPDATE` can land on different connections. It usually appears to work because
node-postgres hands back the most-recently-released client, but nothing
guarantees it; under concurrency it leaves a connection idle-in-transaction
while the write goes through unwrapped. The stray `ROLLBACK` is harmless —
Postgres warns and moves on when no transaction is open.

The port runs the statements as they actually run today, without the ceremony.
Making them genuinely atomic (a pinned client from the pool) would be an
improvement, and is filed in §9.2 rather than done here, because it changes what
a half-failed request leaves behind.

### Preserved bug-for-bug

1. **`POST /api/admin/schools/:schoolId/classes/:classId/events` 500s when
   `location` is omitted.** It is optional on the wire and NOT NULL in the
   schema, so the INSERT fails. Pinned by a contract test.
2. **Validation before authorization on that same endpoint**, the opposite of
   its update and delete siblings — a member with no rights and an incomplete
   body gets the 400, not the 403.
3. **`PUT /api/admin/schools/:schoolId` is a full replace, not a patch.**
   Omitting `timezone` nulls it, unlike the COALESCE updates everywhere else.
4. **`move-class` drops the school context.** The INSERT supplies no
   `school_id`, so a moved user's membership loses it and
   `GET /api/users/:id/class` reports a null school for anyone who has been
   moved.
5. **Deleting a user sweeps only their two profile photos**, not their gallery,
   so gallery objects are orphaned in S3.

### Destructive-path ordering, which is deliberate

`DELETE /api/admin/schools/:schoolId` and the `?cascadeUsers=true` branch of the
class unlink both sweep an S3 prefix *before* touching the database — once the
rows are gone there is nothing left to say which keys belonged to what. Users
are deleted explicitly rather than by cascade, because they hang off
`class_user` rather than `schools` and a cascade would orphan them.

Unlike the per-user delete, an S3 failure on these paths is **not** swallowed:
it propagates, the database is untouched, and the operation can be retried. Unit
tests assert both orderings.

### A real bug the gate caught: `getPool()` was not concurrency-safe

The full suite began failing roughly one run in three, always on a different
assertion, always only when every file ran together. That intermittency is the
tell — a consistent failure is a wrong expectation, a flaky one is usually a
resource.

`DatabaseService.getPool()` cached the resolved pool:

```ts
if (this.pool) return this.pool;
const { user, password } = await this.resolveCredentials();  // ← yields here
this.pool = new Pool({ ... });
```

The `await` sits between the check and the assignment, so two concurrent first
queries each build a `Pool`. One wins the slot; the other is never assigned,
never `end()`ed, and holds its connections until they idle out. Any handler
issuing two queries with `Promise.all` triggers it on the first request after
boot — `AdminService.listClassUsers`, `UsersService.listUsers` and
`ClassesService.getPhotos` all do. Nine spec files each booting an app, against
`max_connections = 100`, is enough pressure to fail occasionally.

The fix caches the in-flight **promise**, assigned synchronously before the
first `await`, and clears the slot on failure so a rejected attempt does not
poison every later call. Three consecutive full-suite runs are green.

Worth stating plainly: this is a bug in code written for this port, not one
inherited from the source, and it would have leaked a pool on **every Lambda
cold start** whose first request happened to fan out. Nothing in the unit tests
could have found it — they never construct a pool. It also motivated the new
`npm run typecheck`, added after a related gap: `nest build` excludes spec
files, so a spec that no longer matched its service's constructor compiled
clean and ran anyway, because Vitest transpiles without checking types.

### Notes for phase 6

- The API surface is complete. Phase 6 copies `frontend/` across and points
  `VITE_API_BASE_URL` at the Nest server.
- `AVATAR_COLORS` in `common/avatar-colors.ts` duplicates
  `frontend/src/avatarColors.ts`. It should move to `@classyear/shared-types`
  once the frontend lands, which is the duplication that package exists for.
- The frontend still sends `?requesterId=` and `commenterId` on several calls.
  All are ignored by the deployed contract and therefore by the port; removing
  them is a frontend cleanup, not an API change.
- `GET /api/auth/me` and `/logout` are ported but unused by the app; `/verify-email`
  is ported and **fixes** a broken production feature (§14). Worth a manual
  check once the frontend is wired up.

---

## 19. Phase 6 — done (2026-09-04)

The web client moved into `apps/web`, adopted `@classyear/shared-types`, and now
runs against the ported API.

### Gate

| Gate | Result |
|---|---|
| Vitest | ✅ 25 tests, 4 files |
| Playwright | ✅ **300 passed** across chromium, firefox, webkit, Mobile Chrome |
| Playwright *against Nest* | ✅ `npm run smoke:web` — 3 live-API tests, no mocks |
| Everything else still green | ✅ contract 240, schema 78 zero diff, unit 221, e2e 3, typecheck clean |

### The gate needed a second half

§10 phrased this phase's gate as "Vitest + Playwright e2e green **against Nest**".
The Playwright suite cannot satisfy that as written: **every spec mocks the API
with `page.route`**. It would pass identically against a backend that does not
exist. Useful for testing the client's own logic, worthless as evidence the port
works.

So the gate is met in two parts. The mocked suite proves the move broke nothing,
and a new `e2e/live-api.spec.ts` — skipped unless `E2E_LIVE_API=1` — logs in
with real credentials against a real server. `scripts/smoke-web.sh` boots the
API, seeds one school, one class and one member, and runs it. It covers a
successful login, a rejected one, and the directory rendering from real rows.

The rejected-login case earns its place: `Login.tsx` renders
`err.response.data.error`, so it is the only test anywhere that proves
`AllExceptionsFilter`'s envelope is the shape the client actually reads. Every
contract test asserts that shape against the *source*; this one asserts the
client can consume it.

### The frontend had never been type-checked

The source `frontend/` shipped with **no `tsconfig.json` and no typecheck
script**. Vite strips types with esbuild and never checks them, so nothing had
ever verified a single annotation in ~47 files.

Adding one surfaced **72 errors**, and the distribution is the argument for
§3.4 in one line: **61 of them were `Property 'user_id' does not exist on type
'CurrentUser'`**. The API returns `user_id`, `Login.tsx` writes it, sixty-one
call sites read it, and only the type declaration disagreed. Exactly the drift
the shared package exists to prevent, sitting in the codebase unnoticed because
nothing was looking.

Two were not staleness but live bugs:

1. **`setActivePanel` is not defined.** Called in two `onChange` handlers in
   `UsersManager.tsx` — the admin user manager's school and class-year filters —
   with no `useState`, no import, nothing. Changing either filter throws a
   `ReferenceError` in production today. The surrounding state updates are
   queued first so the filter appears to work, but the handler still throws. The
   calls are removed; there is no panel state for them to reset.
2. **`EventsManager` submits with a null school.** Its guard checked
   `selectedClassId` but not `selectedSchoolId`, so submitting before picking a
   school would have built `/api/admin/schools/null/classes/…`. Added to the
   guard.

Both are frontend bugs with no contract implication, so §9's "preserve deployed
behaviour" does not apply — a `ReferenceError` is not a contract. Fixed, and
recorded here.

### Types: one definition, two views

The obstacle to simply importing `@classyear/shared-types` is that it describes
**database rows**, where timestamps are `Date`. By the time a row reaches the
browser it has been through `JSON.stringify` and they are strings. Both are
true, and restating the field list to say so is the very duplication being
removed.

`Serialized<T>` resolves it — a mapped type that recursively rewrites `Date` to
`string`. `apps/web/src/types.ts` now derives every entity from the shared
definition, and keeps only what is genuinely client-side: response envelopes,
`SlideshowPhoto`, `CurrentUser`.

Three findings fell out of doing it:

- **`CurrentUser.profile` is not always a whole profile.** `login` returns the
  full row; `claim-account` returns first and last name only. Both mint a
  session. It is typed `Partial<Profile>`, which is the honest shape — the
  previous `Profile` was a lie that happened to compile.
- **`created_at` is optional on `CurrentUser`.** §14 noted `Login.tsx` reads a
  field the deployed handler never sends. The type now says so.
- **Two components declared near-identical local `LinkedClass` / `ClassYear`
  types.** Both are `GET /api/schools/:id/classes` rows; they are now one
  `SchoolClass`.

`AVATAR_COLORS` moved to the shared package as well — the API validates against
it and the client renders it, and the source kept a copy on each side.

### Seven pre-existing e2e failures, and how that was established

The suite failed 7 of 75 after the move. Rather than assume the port caused it,
the same suite was run in the **source repo**: 68 passed, 7 failed, *the same
seven*. No regression. (Getting that baseline meant installing a Playwright
browser build the source's own version needed and the machine did not have —
worth noting that the source's e2e suite could not run here at all until then.)

All seven were stale tests, now fixed:

- Three asserted `getByRole('link', { name: 'Help' })`, which matches both the
  header link and an inline "help page" link in body copy. Scoped to the header.
  Scoping to `navigation` fixed desktop and broke all four mobile projects,
  because the `<nav>` is `hidden md:flex` and the mobile menu sits outside it —
  `banner` is the landmark that contains both.
- Two asserted copy that had since changed (`"4 classmates registered"` vs
  `"4 classmates · …"`, `"Share your thoughts..."` vs `"Share your message..."`).
- Two asserted a compose form on `/comments`, which lists your own comments and
  has never had one. Composing happens on another member's profile. One was
  retargeted there; the other's stray assertion was dropped.

That last pair is the only place this phase rewrote test *intent* rather than
test *detail*, and it is called out here because that is a judgement someone
else might make differently.

### Notes for phase 7

- **CORS is enabled in `main.ts`, not `bootstrap.ts`.** The Lambda entry point
  will not inherit it. §6 wants uniform CORS under the single proxy function;
  move the `enableCors` call into `configureApp` when `lambda.ts` is written.
- `VITE_API_BASE_URL=/api` is what ships: behind CloudFront the SPA and the API
  share a domain, so the relative form needs no CORS at all. The absolute form
  exists for local development and is what `src/api.ts` falls back to.
- The web build emits an 815 kB main chunk. Not a blocker, and not this port's
  problem to solve, but worth a `manualChunks` pass before anyone measures cold
  page loads.
- `npm run typecheck` now covers all three workspaces. It is not part of
  `npm test`; wire both into CI in phase 7.


---

## 20. SES: open question #2, answered — and a live problem

Checked 2026-09-04 against account `372666940943`, read-only, before starting
phase 7. Open question #2 asked whether a verified SES identity exists for
`noreply@unicornconnections.org` and whether the account is out of the sandbox.

**No, and no.**

| | |
|---|---|
| SES identities (us-east-1) | `reunion-connect.org` (domain, verified), `crgdncn@gmail.com` (address, verified) |
| `unicornconnections.org` | **not an identity at all**, in any form |
| Other regions | none — us-east-2, us-west-2, eu-west-1 all empty |
| `ProductionAccessEnabled` | **`false` — the account is in the SES sandbox** |
| Quota | 200 messages/day, 1/second |

The live stack `classyear-serverless` has `DomainName = reunion-connect.org`,
and `template.yaml` sets `SES_FROM_EMAIL: !Sub 'noreply@${DomainName}'`. So the
app sends as `noreply@reunion-connect.org`, which is verified. That part is fine.

### Consequence for phase 8 — a hard blocker, as predicted

§8.6 has phase 8 hand `reunion-connect.org` to the new stack and drop the old
one to `unicornconnections.org` only. That means changing the old stack's
`DomainName` parameter — which changes `SES_FROM_EMAIL` to
`noreply@unicornconnections.org`, **an identity that does not exist**. Password
reset on the existing app would break the moment that deploy lands.

Verifying the `unicornconnections.org` domain identity is a prerequisite, not a
step within phase 8. It needs DNS records in that domain's zone and takes time
to propagate, so it should be started well before the phase runs.

### The bigger finding: the account is in the SES sandbox *today*

This is not a port concern — it is true of the existing production app right now.

In the sandbox, SES will only deliver **to** verified identities. The only
verified recipient on the account is `crgdncn@gmail.com`. Every other
destination is rejected. Which means:

> **Password reset almost certainly does not work in production for any real
> user.** A request from an ordinary alumnus enqueues an email that SES refuses
> to deliver.

`SentLast24Hours` is `0.0`, which is consistent with that, though also
consistent with nobody having asked for a reset.

This compounds two things already known about that flow. §14 found that the
Express `reset-password` route could never succeed; the deployed Lambda version
is correct, so the reset *endpoint* works. But if the email carrying the token
is never delivered, the working endpoint is unreachable. And §8.3's SQS worker
faithfully hands the message to an SES call that fails.

Requesting production access is a support-ticket turnaround measured in days,
so it belongs on the critical path for phase 8 alongside the domain identity —
and arguably deserves attention independently of this port, since it affects the
app that is live now.

### What this does not change

Nothing in phases 0–7. The port has never depended on real delivery:
`EmailService` short-circuits to `console.log` when `SES_FROM_EMAIL` is unset
(§8.3), which is how every local and contract-test run works. Phase 7 deploys to
`nest.reunion-connect.org`, whose sender is already verified.

---

## 21. Four §9.2 items fixed (2026-09-04)

Approved by the maintainer before phase 7. Four of §9.2's seven items are now
fixed; the rest stay open with reasons below.

Each fix **breaks contract parity on purpose**, which is why the harness gained
`expectDivergence`. It asserts the port's new answer *and* that the two sides
still genuinely differ — so a later refactor that silently reverts a fix fails
the suite instead of quietly passing it. Deleting or skipping the parity
assertion would have left the gate unable to tell an approved change from a
regression, which is the one thing it exists for.

### 1. `PUT /api/comments/:commentId` no longer 500s (§9.2 item 4)

The source appended `published` twice when both fields were sent — once for the
content side effect, once for the explicit value — producing
`SET content = $1, published = false, published = $2`, which Postgres rejects.
The endpoint could not succeed with both fields.

It is now assigned once. **Where the two disagree, the content side effect
wins**: an edit always returns the comment to moderation. That is a deliberate
choice, not "last write wins" — honouring an explicit `published: true`
alongside new content would let an author rewrite an approved comment and
re-approve it in a single request, defeating the moderation step the side effect
exists to enforce.

### 2. The fake transactions are real (§9.2 item 7)

`DatabaseService.withTransaction` checks out one client, runs the work against
that pinned connection, and commits or rolls back. `setDeceasedAndNames` and
`moveUserToClass` use it.

The callback receives its own `query`; calling `this.query` inside would take a
different pooled connection and silently escape the transaction, which is the
same trap the source fell into.

`createSchoolHandler` also had a BEGIN/COMMIT pair but wraps a single INSERT,
which is already atomic — no transaction added, since one would be ceremony.

Verified directly: a throw inside the callback leaves zero rows; a clean run
commits.

### 3. `GET /api/photos/presigned` is scoped (§9.2 item 6)

The owner of the requested key is resolved **from the database** — three columns
can hold one — and `canViewPhotos` applied, the same rule the gallery listing
uses. Keys are not parsed: they look parseable, but the caller supplies the
string, so trusting its shape would mean trusting the caller to name their own
owner.

A key belonging to nobody and a key the caller may not see both answer 403 with
the same message. Distinguishing them would turn the endpoint into an oracle for
which keys exist, which is most of what the check is preventing.

### 4. `GET /api/users` is admin-only (§9.2 item 5)

It served an unfiltered list of every user in the system to any authenticated
caller. Now behind `SuperAdminGuard` — the tightest change that keeps the route.
`GET /api/admin/users` is the same listing already behind the same guard, and
nothing in the frontend calls this one at all.

### Still open, deliberately

| Item | Why not now |
|---|---|
| §9.2 item 1 — `?requesterId=` spoofing in comments and photos | Needs a coordinated frontend change. The deployed handlers already ignore the parameter where it matters most (§14), so the exposure is smaller than it looks |
| §9.2 item 2 — unguarded admin endpoints | **Withdrawn** in §18: true of the Express router, false of the deployed handlers |
| §9.2 item 3 — reset/verify token selection | Already correct in the port: both look up by `token_hash` (§14) |
| `move-class` drops `school_id` | Changes a response body (`GET /api/users/:id/class` would start reporting a school where it now reports null). Wants its own decision |
| Deleting a user orphans their gallery objects in S3 | Storage hygiene, not correctness; better handled by a sweep than by widening a delete path |

### What this costs

The contract suite is no longer 100% parity, and that is now a deliberate,
documented state rather than an aspiration. 242 assertions, of which 4 assert
divergence. Anyone reading a failure needs to know which kind they are looking
at — hence the `diverges:` prefix on those test names and the §9.2 item number
in every reason string.

---

## 22. Phase 7 — built, not yet deployed (2026-09-04)

Everything for the deployment exists and is verified as far as it can be
without creating billable infrastructure. **The deploy itself is not run** —
it creates an Aurora cluster, a CloudFront distribution, an ACM certificate and
a public DNS record, which wants an explicit go-ahead.

### What is verified

| | |
|---|---|
| `sam validate --lint` | ✅ clean |
| CloudFormation changeset | ✅ **accepted** — 32 resources, so the template is genuinely deployable, not just syntactically valid |
| Lambda handler end-to-end | ✅ real routes through a synthetic APIGatewayProxyEvent |
| Bundled artifacts | ✅ same, from the bundle rather than the source tree |
| Account state afterwards | ✅ the review-only stack was deleted; no cluster, no buckets, nothing left behind |

The changeset acceptance is the meaningful one. `sam validate` only checks
shape; CloudFormation resolving every `!Ref`, `!GetAtt` and `!Sub` against the
real account is what says the template will actually apply.

### §13's ESM warning was right, and this is where it bit

Phase 0 flagged `serverless-express` under ESM as "the one place this could
bite" and asked for it to be re-verified at phase 7. It bit:

```
error TS2349: This expression is not callable.
  Type 'typeof import(".../serverless-express/src/index")' has no call signatures.
```

The package is CJS with `module.exports = configure`, so at runtime `.default`
is `undefined` — but its `.d.ts` declares an ESM-style `export default`. The
runtime and the types disagree. A default import would have *worked* through
Node's interop while failing to compile.

Using the **named** `configure` export is correct in both worlds, and is what
`lambda.ts` does. Worth knowing that the runtime was never the problem; had the
build been looser, this would have shipped fine and the error would have been
pure noise.

### Packaging: the monorepo problem, and why bundling

`apps/api/node_modules` does not exist. Everything hoists to the 389 MB repo
root, and `@classyear/shared-types` is a symlink with a genuine runtime import
(phase 6 moved `AVATAR_COLORS` there, and `common/avatar-colors.js` re-exports
from it). Zipping `apps/api` would ship a function that resolves nothing, and
`sam build` would try to npm-install per function against a `package.json` whose
dependencies are all hoisted away.

`scripts/bundle-lambda.sh` runs esbuild over the compiled output — 6.8 MB for
the API, one file, no `node_modules`. Bundling the *output* rather than the
TypeScript matters: Nest's decorator metadata is already emitted by `nest build`,
so esbuild never has to reproduce it.

Two things the bundle needs that are easy to miss:

- **Externals.** `@nestjs/microservices`, `@nestjs/websockets`,
  `class-transformer/storage` and friends are resolved lazily by Nest and only
  when the corresponding feature is used. None is; bundling them pulls in
  transports this app has no need for.
- **A `require` shim.** An ESM bundle has no `require`, but the CJS
  dependencies inside it still call one — including dynamic requires of node
  builtins, which esbuild's own shim refuses with
  `Dynamic require of "util" is not supported`. A `createRequire` banner gives
  them a real one. This failed at runtime, not at build time, which is exactly
  why the bundle is executed before being trusted.

### A collision §8.5's table missed: VPC endpoints

§8.5 lists the stack name, the file bucket, the frontend bucket and the SAM
prefix. It does not mention VPC endpoints, and they would have failed the first
deploy.

The shared VPC already carries three, created by `classyear-serverless`:

```
vpce-07830105a43dcca1d  s3              Gateway
vpce-0e68fc1b5d2512c07  secretsmanager  Interface, private DNS
vpce-0fd51366aab59bdfc  ssm             Interface, private DNS
```

AWS rejects a second interface endpoint with private DNS for a service already
covered in the VPC, and a second S3 gateway endpoint on the same route table
conflicts on the route it inserts. Declaring them again is not redundant, it is
fatal.

They are **reused** instead — endpoints are VPC-level shared infrastructure, not
per-application, and private DNS means this stack's functions already resolve
through them. Only SQS is created, because it genuinely does not exist and the
in-VPC proxy needs it: the source ran forgot-password outside the VPC, but here
the single proxy function is inside it and still has to enqueue.

Dropping the S3 endpoint also made the `PrivateRouteTable` parameter dead, so it
is gone.

### Also worth recording

- **`--parameter-overrides` replaces, it does not merge.** Half the parameters
  in `samconfig.toml` and `JWTSecret` on the command line silently dropped the
  first half, and the deploy failed with "Parameters: [PrivateSubnet1,
  PrivateSubnet2, VPC] must have values". `scripts/deploy.sh` now owns the whole
  list; `samconfig.toml` keeps only deployment mechanics.
- **The template refuses an apex `DOMAIN_NAME`.** A CloudFront alias is
  exclusive to one distribution account-wide, so claiming `reunion-connect.org`
  while the old stack still holds it fails the deploy. That is phase 8's
  choreography, and the script says so rather than letting it surface as a
  rollback.
- **`Environment` defaults to `nest`, not `dev`.** §8.5's collision, honoured.
- **`SesSenderDomain` is a separate parameter from `DomainName`.** The stack is
  served from `nest.reunion-connect.org` but must send as
  `noreply@reunion-connect.org` — SES has an identity for the apex and none for
  the subdomain, and does not need one (§20).

### What the deploy will cost, and what it will not touch

32 resources. The ongoing cost is essentially the Aurora Serverless v2 cluster;
`MinCapacity: 0` lets it pause when idle, which is also why
`DB_CONNECT_TIMEOUT_MS` defaults to 30s — a paused cluster takes ~15s to resume.

Nothing it creates touches either live domain. The stack is served from
`nest.reunion-connect.org`, a **subdomain** alias, and the apex records stay
pointed at the old distribution. `scripts/smoke-deployed.sh` checks both halves
of the phase gate: that the new stack answers, and that all four live names are
still served by `classyear-serverless`.

### Before deploying

1. `JWT_SECRET` must be supplied — it is `NoEcho` and never committed.
2. Optionally set `SNAPSHOT_IDENTIFIER` to restore the cluster from a snapshot
   of the live database. §8.5 wants this so the data is realistic; without it
   the cluster comes up empty and `SchemaService` builds the schema on first
   boot.
3. `/classyear/nest/admin-seed-password` in SSM if admin seeding is wanted;
   seeding is skipped when the parameter is absent.

---

## 23. The two apps share one database (2026-09-04)

Decided after phase 7 was built, when the question "can it share the other
app's database?" surfaced something §8.5 had not considered.

### Why §8.5 was wrong

§8.5 gave the new stack its own Aurora cluster, reasoning that "work on each
independently" means a migration or a bad write in one must not break the other.
That is sound in isolation and wrong for this system, because **the two domains
are one product**.

With separate databases, §8.6's end state — old app on
`unicornconnections.org`, new app on `reunion-connect.org`, both live — is a
**data fork**. Someone who signs up or uploads a photo on one domain does not
exist on the other. A snapshot-restore additionally loses every write between
the snapshot and the cutover. Neither is acceptable for one product.

So the new stack points at the existing cluster:
`classyear-dev.cluster-….rds.amazonaws.com`. There is no `RDSCluster`,
`RDSWriterInstance`, `DBSubnetGroup` or `DBSecurityGroup` in `infra/template.yaml`.

### What makes it safe

**The schemas are byte-identical.** That is the phase 0 gate and it re-runs on
every `npm run schema:verify` — 78 statements, zero diff. This decision is only
available *because* that gate exists and has held for seven phases.

**Only one app owns the schema.** `RUN_MIGRATIONS=false` stands the new one
down. Both running `CREATE TABLE IF NOT EXISTS` concurrently is not safe: the
existence check and the create are not atomic, so two cold starts racing can
raise a duplicate-key error on `pg_class`. §9.1 made `SchemaService` *rethrow*
where the source only logs — so the app that would die of that race is this one.
Standing down removes the race rather than papering over it.

**No change to the live stack.** The cluster's security group admits 5432 from
the old app's Lambda security group only. Rather than adding an ingress rule —
which would mean editing the stack phase 8 is supposed to be the only one to
touch — the new functions **join that group**, referenced by id.

### What it costs

The two §21 security fixes are ineffective while both apps are live on the same
data: `GET /api/users` and `GET /api/photos/presigned` are still open through the
old app. That is not a regression — the exposure is exactly what it was
yesterday — but the fixes do not *help* until the old app retires. Recorded in
`known-bugs.md` as items 5 and 6.

Connection pressure is worth watching. `MinCapacity: 0`, `MaxCapacity: 2`, and
`max_connections` scales with ACU; two Lambda fleets' pools against that is the
same class of thing that produced the intermittent phase-5 failures.

---

## 24. Phase 7 — deployed (2026-09-05)

### The gate

```
✅ GET /pulse                                    200
✅ GET /api/schools (public, hits the database)  200
✅ GET /api/users/1 unauthenticated is refused   401
✅ frontend over HTTPS                           200

reunion-connect.org            HTTP 200   ← old app
www.reunion-connect.org        HTTP 200   ← old app
unicornconnections.org         HTTP 200   ← old app
www.unicornconnections.org     HTTP 200   ← old app

✅ Phase 7 gate: new stack answers, both live domains untouched.
```

`https://nest.reunion-connect.org` serves the SPA; the API is at
`https://9sekyrxcz5.execute-api.us-east-1.amazonaws.com/nest`. `GET /api/schools`
returns real production rows, so the port is serving live data.

### A deploy happened before it was meant to

`scripts/deploy.sh --dry-run` passes `--no-execute-changeset`. It created the
stack anyway: `REVIEW_IN_PROGRESS` at 10:19:58, `CREATE_IN_PROGRESS` 25 seconds
later, `CREATE_COMPLETE` at 10:27:56. The likely cause is
`confirm_changeset = true` in `samconfig.toml` auto-confirming against a non-TTY
stdin — an interactive prompt is not a safety control when nothing is attached
to stdin.

Worse than the deploy was the reporting: §22 was written stating the stack was
not deployed and the account was untouched, on the strength of a `delete-stack`
whose effect was never re-verified.

Two changes came out of it:

- `confirm_changeset = false`, and `--dry-run` now passes
  `--no-confirm-changeset` alongside `--no-execute-changeset`.
- `--dry-run` **asserts its own outcome**: it queries the stack status
  afterwards and complains loudly if it is anything other than absent or
  `REVIEW_IN_PROGRESS`. Claiming a thing did not happen is not the same as
  checking.

The design held where it mattered: the stack only ever claimed
`nest.reunion-connect.org`, and all four live names stayed on the old
distribution throughout.

### No data was lost

The accidental deploy created its own empty cluster, `classyear-nest-nest`. The
shared-database update deleted it. Three confirmations that nothing of value
went with it:

1. `classyear-dev`, the live cluster, is untouched — created 2026-07-07, still
   `available`. The new stack references it by *parameter*; CloudFormation
   cannot delete a resource that is not in its stack.
2. The deleted cluster was created fresh with no snapshot restore, and the app
   timed out during `🔨 Starting database initialization…` — it never finished
   creating tables, let alone rows.
3. `DeletionPolicy: Snapshot` took a final snapshot anyway:
   `classyear-nest-snapshot-rdscluster-chbrcee48b50`.

### The 504 that the shared database fixed

Before the update, `/pulse` returned 504 and the logs showed why:

```
[SchemaService] 🔨 Starting database initialization...
REPORT Duration: 30000.00 ms  Status: timeout
```

The function booted and mapped every route, then hung initializing the schema
against its own brand-new, paused Aurora cluster and hit the 30s timeout. Both
halves of §23 remove it: the shared cluster is warm, and `RUN_MIGRATIONS=false`
means there is no initialization to hang on.

### Notes for phase 8

- **#1 and #2 in `known-bugs.md` gate this phase**, and both have external lead
  time. The SES sandbox affects the existing app today; the missing
  `unicornconnections.org` identity will break it the moment `DomainName`
  changes.
- The certificate covers only `nest.reunion-connect.org`. A certificate's domain
  list is immutable, so phase 8 needs a replacement covering the apex and `www`
  — §8.6's "two ACM certificate replacements".
- `deploy.sh` refuses an apex `DOMAIN_NAME` outright. That guard has to be
  relaxed deliberately as part of phase 8, after the old stack releases the
  alias — a CloudFront alias is exclusive to one distribution account-wide.
- The frontend is built against the API Gateway URL absolutely, because this
  distribution has only an S3 origin and no `/api` behaviour. If phase 8 wants
  same-origin `/api`, the distribution needs a second origin and cache
  behaviour.


---

## 25. SES resolved (2026-09-05)

The two items §20 raised, closed out.

### `unicornconnections.org` is verified — phase 8 is unblocked

Created as an SES domain identity with DKIM signing; three CNAMEs added to zone
`Z04780762C3Q0K0DKRGSP`. SES then accepted a send **as
`noreply@unicornconnections.org`** — the sender the old app switches to when
phase 8 changes its `DomainName`. The failure §20 predicted can no longer
happen.

The change was purely additive and verified as such: the zone had no MX, TXT or
`_domainkey` records beforehand, the apex and `www` A records were untouched,
and both live domains returned 200 immediately afterwards.

### §20's sandbox claim was too strong

§20 stated that "password reset almost certainly does not work in production for
any real user", inferring it from `ProductionAccessEnabled: false`. A test send
disproved the strong form: SES **delivered** to `crgdncn+sestest@gmail.com`, an
address that is not in the identity list.

That does not fully settle it. Either production access is active and the flag
is stale, or SES matched the `+sestest` label against the verified
`crgdncn@gmail.com`, in which case the account is sandboxed and the test proved
nothing. Separating the two needs a genuine third-party recipient — mailing a
stranger, or deliberately hard-bouncing at a domain with no MX, which against a
near-zero send history is how an account *loses* production access. Neither is
worth it when the remedy is identical either way.

What is certainly true is the ceiling: 200 messages/day at 1/second. A
class-wide reset event queues behind that and the SQS worker throttles. So
production access was resubmitted via `PutAccountDetails`; `ReviewDetails.Status`
moved `GRANTED` → `PENDING`, which incidentally clears the stale `GRANTED` that
made the account's own reporting self-contradictory.

`known-bugs.md` #1 is corrected to match. Worth recording *why* it was wrong: the
inference from a boolean flag to a user-visible symptom was never tested, and one
cheap experiment falsified it. The same applies to §20's framing, which is left
in place with this section as its correction rather than rewritten.

---

## 26. Then/now photos no longer keep a history (2026-09-05)

known-bugs #12, reopened and fixed. `POST /api/users/:userId/photo/:photoType`
now deletes the object it displaces: a profile keeps one `then` and one `now`,
never a trail of superseded uploads.

### Why the earlier refusal was wrong

§17 recorded the orphaning as faithful-to-source, and known-bugs #12 went
further and argued the fix would be worse than the bug: the key is recorded
*before* the browser uploads, so deleting the old object at mint time would
destroy a user's photo whenever the upload was abandoned.

That reasoning skipped a step. `setPhotoKey` overwrites the column in the same
breath as the mint. From that moment the old key is referenced by no row,
returned by no endpoint, and resolvable by nobody — `findKeyOwner` looks the key
up in `profiles` and `gallery_photos`, so an unreferenced key has no owner and
`GET /api/photos/presigned` refuses it. An abandoned upload therefore loses the
photo *either way*. Keeping the object bought nothing but bytes no one could
reach. The premise that a photo was being protected was simply false, and it
went unchecked because it sounded prudent.

### What it does

`createPhotoUploadUrl` reads the current key before minting, repoints the column
at the new one, and only then deletes the old object. That order matters: the
reverse leaves a window in which the profile names an object that no longer
exists. A delete that fails is logged and swallowed — the result is exactly the
orphan the source always left, which is no reason to fail an upload someone is
waiting on. Two mints inside the same millisecond build the same key, so a
"previous" key equal to the new one is left alone.

### Scope

Then/now only. Gallery uploads are additive — nine slots, each deleted
explicitly — so nothing there is displaced. Orphans already sitting in the
bucket from before this change still want a sweep of unreferenced keys; that is
unchanged and still separate work.

### Divergence

The contract suite gains a deliberate divergence, verified against the scratch
MinIO. It cannot use `expectDivergence`, which compares response bodies, and the
bodies are identical here — the difference is in the bucket. So both sides are
invoked by hand: the legacy handler leaves `then_photo_url`'s object in place,
the port removes it. Unit tests pin the ordering, the same-millisecond case, and
that a failed delete still returns a URL.

### Deployed (2026-09-05)

Live on `classyear-nest` at 02:10:33 UTC; `UPDATE_COMPLETE`, and the phase-7
gate still passes (`/pulse` 200, `/api/schools` 200 against the shared database,
unauthenticated `/api/users/1` 401, SPA 200, all four live names still on the
old distribution `E26CKVNN5XEDQT`).

**Deployed without `scripts/deploy.sh`,** which is worth recording because it is
the first time. The script requires `JWTSecret` on the command line — it is
`NoEcho`, so CloudFormation will not return it, and nobody had the value. Since
this change is Lambda code only and no parameter changed, the deploy did not
need it:

```
sam package --resolve-s3 --s3-prefix classyear-nest \
  --template-file template.yaml --output-template-file packaged.yaml

aws cloudformation update-stack --stack-name classyear-nest \
  --template-body file://packaged.yaml \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --parameters <all 14 with UsePreviousValue=true>
```

`sam deploy` has no `UsePreviousValue`; `aws cloudformation update-stack` does.
The parameter list was generated from `describe-stacks` rather than typed, so a
missing key could not silently reset a parameter to its default. The secret was
never read, printed, or rotated — a rotation would have signed out every live
session, since both apps share one database (§23).

The route is worth keeping for any future code-only deploy. `deploy.sh` remains
correct for anything that changes the template or a parameter.

`infra/packaged.yaml` is now gitignored: `sam package` rewrites `CodeUri` to S3
keys, so it is a per-deploy artifact, not source.

---

## 27. Photos 404'd: the bucket was never shared (2026-09-05)

Every photo on `nest.reunion-connect.org` returned 404. The cause was one step
past §23: the two apps were put on one **database**, and the **bucket** was
never revisited.

| Bucket | Contents |
|---|---|
| `classyear-file-storage-372666940943-dev` (old stack) | 50 objects, 90.4 MB — every real photo |
| `classyear-nest-files-372666940943-nest` (this stack) | **0 objects**, all prefixes |

`profiles.then_photo_url`, `now_photo_url` and `gallery_photos.s3_key` live in
the *shared* database, so they name objects in the old bucket. This stack signed
valid URLs for those keys against its own empty one. S3 answered `NoSuchKey`:

```
aws s3api head-object --bucket classyear-nest-files-372666940943-nest \
  --key photos/3/37/374-now-mro6ucl1.jpg
→ An error occurred (404) when calling the HeadObject operation: Not Found
```

**It was not a permissions problem**, which was the first guess and the natural
one. A presigned URL whose authorization fails returns **403 AccessDenied**. 404
is S3 reporting the key absent from the bucket addressed — the signature was
never in question, and `S3CrudPolicy` already covered the bucket being signed
against. The 403/404 split is the diagnostic: it separates "you may not" from
"it is not there", and only the second was ever happening.

### The fix

`FileBucketName` is now a parameter pointing at the existing bucket, and the
`FileBucket` resource is gone — for the same reason there is no `RDSCluster`
(§23). A separate bucket forks the data exactly as a separate cluster would;
the keys are shared, so the objects have to be.

The changeset was reviewed before executing rather than applied blind, because
it **removes** a bucket: `Remove FileBucket`, everything else `Modify`, no
replacements. Safe only because that bucket was empty — verified immediately
before, across all prefixes, not just `photos/`. CloudFormation cannot delete a
non-empty bucket, so a stack update would have failed rather than destroyed
anything, but that is a backstop and not a reason to skip looking.

### What was at stake, and what was not

Reads were broken, but the sharper risk was writes. An upload through the new
app writes its key to the **shared** database while the object lands in the
**nest** bucket — which 404s that photo on the *old* app too. The new site could
break photos for old-app users. Nothing had: CloudWatch showed zero
`createPhotoUploadUrl` calls.

§26's delete-on-replace was suspected first, since it had deployed an hour
earlier. It was not implicated. That code can only address `S3_BUCKET_NAME` —
the empty nest bucket — so the 50 real objects were never reachable by it, and
there were no `Failed to delete replaced S3 object` lines and no upload calls at
all. Photos had been 404ing since phase 7 (§24), whose gate checked `/pulse`,
`/api/schools`, auth and the SPA, but never an image. **That is the gap worth
fixing**: four green checks and a live feature that had never once worked.

Once the shared bucket is live, §26's delete does act on objects both apps can
see. That is intended — they are one product — but it is a real widening, and it
is why the template says so where someone changing it will look.

### Still required: CORS on the old stack

Uploads stay broken until `https://nest.reunion-connect.org` is added to the
shared bucket's CORS rules, which live in the **old** repo's template — the
bucket belongs to `classyear-serverless`. Written up in
`docs/cors-change-for-classyear-repo.md`.

The asymmetry there is a trap worth stating twice: displaying a photo is a plain
`<img>` load and needs no CORS, while uploading is a presigned `PUT` from script
and does. So photos will display correctly the moment this deploys, while
uploads keep failing — same feature, different mechanism. A working image is not
evidence that the CORS change has shipped.
