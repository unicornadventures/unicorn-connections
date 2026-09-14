# Known bugs

Everything found during the NestJS port, in one place. The conversion doc
(`nestjs-conversion-approach.md`) explains each in context; this is the working
list.

**Read the "Affects" column first.** The two apps share one database (§23) and
one photo bucket (§27), so several of these are live for real users *today*
regardless of which app they hit.

**#3–#8 are now closed.** The apex handover (§29) stopped any public name
routing to the old app, and stripping its stack (§30) removed the handlers
themselves — there is no API Gateway left to name. Each is pinned by a test in
this repo, so they stay closed; where that pin was missing it was added rather
than assumed.

| Affects | Meaning |
|---|---|
| 🔴 **live** | Broken in production right now |
| 🟠 **live, degraded** | Works, but constrained or exposed |
| 🟡 **ported** | Reproduced deliberately in the new app, awaiting a decision |
| ⚪️ **fixed** | Closed during the port; listed so it is not rediscovered |

---

## ⚪️ 1. SES quota was at sandbox limits — **resolved**

**Affected:** password-reset and verification email at volume.

**Resolved 2026-09-14.** Production access was granted. Confirmed against the
live account, not inferred:

| Signal | Was | Now |
|---|---|---|
| `ProductionAccessEnabled` | `false` | **`true`** |
| `Max24HourSend` | 200/day | **50,000/day** |
| `MaxSendRate` | 1/second | **14/second** |
| `ReviewDetails.Status` | `PENDING` | **`GRANTED`** |

The 1/second ceiling was the part worth caring about — a class-wide reset event
would have queued behind it and throttled the SQS worker. At 14/second it is no
longer a constraint worth planning around.

**Worth remembering how this entry went wrong.** It originally read "password
reset does not work for anyone", inferred from `ProductionAccessEnabled: false`
and never tested. One cheap experiment — a real send — falsified it: SES
delivered to an address absent from the identity list. The lesson was the
inference, not the flag: a boolean in an API response was treated as a
user-visible symptom without anyone checking.

**Action taken:** resubmitted via `PutAccountDetails` on 2026-09-05, granted
within nine days.

---

## ⚪️ 2. No SES identity for `unicornconnections.org` — **resolved**

**Was:** phase 8 changes the old stack's `DomainName` to
`unicornconnections.org`, which changes `SES_FROM_EMAIL` to
`noreply@unicornconnections.org` — an identity that did not exist. Email from
the existing app would have started failing the moment that deploy landed.

**Resolved 2026-09-05.** The domain is a verified SES identity with DKIM
signing enabled, and SES accepts a send **as `noreply@unicornconnections.org`**
— the exact sender phase 8 switches to. Proven, not assumed.

Three DKIM CNAMEs were added to zone `Z04780762C3Q0K0DKRGSP`. Purely additive:
the zone had no MX, TXT or `_domainkey` records, and the A records serving the
live site were untouched (both domains verified still-200 afterwards).
Reversible by deleting the identity and those three records.

**This unblocks phase 8.**

---

## ⚪️ 3. Email verification was broken in production — fixed

**Affected:** anyone who clicked a verification link.

`VerifyEmail.tsx` posted to `/api/auth/verify-email`. The route existed in the
old app's router but had **no deployed Lambda and no entry in its template**, so
in production it hit nothing.

**Evidence:** §14.
**Status:** ⚪️ **fixed.** `AuthController` serves it and `AuthService.verifyEmail`
implements it. The app that had no route for it no longer exists (§30).

Pinned by `apps/api/src/auth/verify-email.spec.ts` — missing token, unrecognised
token, success, and that the token is looked up **by hash** rather than by value.
Until 2026-09-14 nothing in this package tested the route at all; it was covered
only by its own existence.

---

## ⚪️ 4. `setActivePanel` was not defined — admin filters threw — fixed

**Affects:** any admin using the user manager.

`UsersManager.tsx` calls `setActivePanel('list')` in two `onChange` handlers.
It is never defined — no `useState`, no import. Changing the school or
class-year filter throws a `ReferenceError`.

It survived because the frontend shipped with **no `tsconfig.json`**: Vite
strips types with esbuild and never checks them, so nothing had ever
type-checked that file.

**Evidence:** §19.
**Status:** ⚪️ **fixed.** The call is gone from `apps/web`, and the old frontend
it survived in is no longer served (§30).

It cannot come back the same way: `apps/web` now has a `tsconfig.json` and
`npm run typecheck` runs over it, so an undefined identifier fails the build
rather than reaching a user. That absence of type-checking was the root cause,
not the typo.

---

## ⚪️ 5. `GET /api/photos/presigned` presigned any key it was given — fixed

**Affects:** nothing, now — see Status.

No ownership check at all. Any authenticated user can mint a viewing URL for
any object in the bucket if they can name it. The millisecond suffix in
generated keys makes guessing impractical, which is mitigation, not a control.

**Evidence:** §9.2 item 6, §17.
**Status:** ⚪️ **fixed** (§21) — the key's owner is resolved from the database and
`canViewPhotos` applied; an unknown key and an unauthorised one are refused
identically, so the endpoint cannot be used to probe which keys exist.

This entry used to carry a caveat: the fix was ineffective while the old app was
live on the same data, because an attacker could call its endpoint instead. That
app is gone (§30), so the caveat is spent.

Pinned by `photos.service.spec.ts` — a key belonging to someone outside the
caller's classes is refused.

---

## ⚪️ 6. `GET /api/users` listed every user to any authenticated caller — fixed

**Affects:** nothing, now — see Status.

An unfiltered list of every user in the system, no role check. Nothing in the
frontend calls it.

**Evidence:** §9.2 item 5.
**Status:** ⚪️ **fixed** (§21) — behind `SuperAdminGuard`. The old app that served
it to any authenticated caller is gone (§30), so #5's caveat is spent here too.

Pinned by `route-guards.spec.ts`, which asserts the **wiring** rather than the
guard's logic. `guards.spec.ts` already covered what `SuperAdminGuard` decides,
but nothing checked it was attached: the decorator could be deleted from
`UsersController.list` and every test in the package still passed. The only thing
that caught it was the contract suite, which needs a checkout of an application
that no longer exists. Verified by removing the guard and watching the new test
fail.

---

## ⚪️ 7. `PUT /api/comments/:commentId` 500'd when sent both fields — fixed

**Affects:** nothing, now — the old app that had it is gone (§30).

Sending `content` **and** `published` builds
`SET content = $1, published = false, published = $2`. Postgres rejects the
duplicate assignment, so the request cannot succeed. Nothing in the frontend
sends both, which is why it has never been noticed.

**Evidence:** §9.2 item 4, §16.
**Status:** ⚪️ fixed in the port (§21). The content side effect wins, so an edit
still returns the comment to moderation — deliberately not last-write-wins,
which would let an author rewrite an approved comment and re-approve it.

---

## ⚪️ 8. Three handlers used `BEGIN`/`COMMIT` that were not transactions — fixed

**Affects:** nothing, now — the old app that had it is gone (§30).

`updateUserProfileHandler`, `moveUserClassHandler` and `createSchoolHandler`
wrap writes in `BEGIN`/`COMMIT`. None is a transaction: `db.ts`'s `query()`
calls `pool.query()`, which checks out an arbitrary idle client per statement,
so the `BEGIN` and the writes can land on different connections. Under
concurrency it leaves a connection idle-in-transaction while the write goes
through unwrapped.

**Evidence:** §18.
**Status:** ⚪️ fixed in the port (§21) via `DatabaseService.withTransaction`,
verified to roll back and commit for real.

---

## ⚪️ 9. `?requesterId=` is trivially spoofable — fixed

**Affects:** the old app, and the frontend still sends it.

Comments and photos took identity from a query parameter. The deployed handlers
already ignore it where it matters most — `/directory`, `/photos` and
`/comments/pending` all use the token (§14) — so the exposure is smaller than it
looks, but the parameter is still on the wire.

**Evidence:** §9.2 item 1.
**Status:** ⚪️ **fixed** — the parameter is off the wire. `apiClient.ts` no
longer accepts or sends it and every call site was updated; the API already
ignored it. Still spoofable against the old app's endpoints by anyone crafting
a request directly, so this closes when that app retires.

---

## ⚪️ 10. `move-class` drops the school context — fixed

**Affects:** both apps.

The INSERT supplies no `school_id`, so a moved user's membership loses it and
`GET /api/users/:id/class` reports a null school for anyone who has been moved.

**Evidence:** §18.
**Status:** ⚪️ **fixed** — the INSERT now takes the school from the target
class's own `class_school` link, so a moved user lands at the new school rather
than losing the context entirely. Pinned by a divergence test that moves a user
and then reads their class back.

---

## ⚪️ 11. Deleting a user orphans their gallery objects — fixed

**Affects:** both apps.

`DELETE /api/admin/users/:userId` sweeps the two profile photos but not the
user's gallery uploads, which stay in S3 forever.

**Evidence:** §18.
**Status:** ⚪️ **fixed** — `findAllPhotoKeys` returns the profile photos *and*
every `gallery_photos.s3_key`, and the delete sweeps all of them. S3 failures
are still swallowed individually so one stale key cannot make an account
undeletable.

---

## 🟡 12. New uploads never overwrite old objects — fixed for then/now

**Affects:** 🟡 the objects already orphaned in the bucket. Nothing creates new
ones: the only app writing there now deletes what it displaces.

Every mint gets a fresh `Date.now()` suffix, so re-uploading a photo orphans the
previous object. Nothing sweeps them; storage grows with every re-upload.

**Evidence:** §17, §26.
**Status:** ⚪️ **fixed for then/now** — `createPhotoUploadUrl` deletes the
object it displaces. A profile keeps one `then` and one `now`; there is no photo
history.

This entry previously read "deliberately not fixed", on the argument that
deleting at mint time destroys a photo whenever the upload is abandoned. That
argument was wrong. `setPhotoKey` repoints the column in the same breath as the
mint, so from that moment the old key is referenced by no row, resolvable by no
endpoint, and recoverable by nobody — an abandoned upload loses the photo either
way. All the old behaviour bought was bytes nobody could reach.

The delete happens *after* the column is repointed, so no window names an object
that is already gone, and a failed delete is logged and swallowed: it leaves
exactly the orphan the source always left, which is no reason to fail an upload.

**Still open:** gallery photos and any orphan already in the bucket. Gallery
uploads are additive rather than replacing, so nothing displaces them; the
pre-existing orphans want a sweep of unreferenced keys, which is its own piece
of work.

---

## ⚪️ 13. Admin event creation 500s when `location` is omitted — fixed

**Affects:** both apps.

`location` is optional on the wire and `NOT NULL` in the schema, so omitting it
fails the INSERT. That endpoint also validates *before* authorizing, unlike its
update and delete siblings — a member with no rights and an incomplete body gets
the 400, not the 403.

**Evidence:** §18.
**Status:** ⚪️ **`location` fixed** — it is rejected with
`400 location is required.` instead of failing the INSERT. The
validation-before-authorization ordering is **unchanged**: it is a contract
nuance rather than a bug, and altering it would change which error an
unauthorized caller sees.

---

## ⚪️ 14. Non-numeric path parameters 500 instead of 400 — fixed

**Affects:** both apps.

`GET /api/users/abc` reaches Postgres, fails on `invalid input syntax for type
integer`, and answers 500. A `ParseIntPipe` would make it a 400 with different
wording, so the port deliberately does not add one.

**Evidence:** §15.
**Status:** ⚪️ **fixed** — `NumericIdPipe` rejects them with
`400 Invalid id.` across all 46 id parameters. It validates without coercing,
because every repository takes ids as strings by design (§3.3).

Two things it deliberately gets strict about: `parseInt('1x')` is `1`, so a
lenient check would have quietly served user 1 for `/api/users/1x`; and a
digits-only string beyond `int4` still overflows in Postgres and produces the
very 500 the pipe exists to prevent, so the range is bounded too. The second was
caught by its own unit test rather than by reasoning.

---

## ⚪️ 15. Fixed during the port, recorded so they are not rediscovered

| What | Where |
|---|---|
| `DatabaseService.getPool()` raced and leaked a connection pool per cold start whose first request fanned out | §18 |
| `S3_ENDPOINT` defaulted to a LocalStack URL, so every deployed environment would have addressed `localhost:4566` | §15 |
| `EventsManager` submitted with a null school id, building `/admin/schools/null/...` | §19 |
| `CurrentUser` never declared `user_id`, which 61 call sites read | §19 |
| `s3Service.updatePhotoUrlInDatabase` targets a table and column that do not exist — dead, not ported | §17 |
| Express `reset-password` could never succeed; the deployed handler is correct | §14 |
| `deploy.sh --dry-run` executed its changeset and created the stack | §22 |

---

---

## Fixed on `fix/known-bugs`

#9, #10, #11, #13 (the `location` half) and #14. Each changes behaviour, so each
is pinned by an `expectDivergence` assertion in the contract suite — the port's
new answer *and* the fact that it still differs from the source, so a later
refactor that reverts a fix fails rather than passing quietly.

#12 was examined, deliberately left, then reopened and fixed for then/now
photos; see its entry.

---

## What is left

**One entry, #12's remainder:** objects already orphaned in the photo bucket
from before delete-on-replace existed. Nothing creates new ones. It wants a
sweep of keys that no `profiles` or `gallery_photos` row references, which is
its own small piece of work and is not urgent.

Everything else on this list is closed, and each fix has a test in this repo
holding it closed rather than relying on the contract suite, which needs a
checkout of an application that no longer exists.

**The gap that is not on this list:** the app has almost no real traffic. Over
the seven days to 2026-09-14 API Gateway served **66 requests**, three of the
last four days being zero — the ~864 daily Lambda invocations are the warmer
hitting `/pulse` directly, not users. So "no errors in seven days" is a much
weaker statement than it looks, and no real user has been observed logging in
and uploading a photo end to end. That is the biggest unverified thing about
this system, and no bug report will surface it.
