# Known bugs

Everything found during the NestJS port, in one place. The conversion doc
(`nestjs-conversion-approach.md`) explains each in context; this is the working
list.

**Read the "Affects" column first.** The two apps now share one database
(§23), so several of these are live for real users *today* regardless of which
app they hit.

| Affects | Meaning |
|---|---|
| 🔴 **live** | Broken in production right now |
| 🟠 **live, degraded** | Works, but constrained or exposed |
| 🟠 **live (old app only)** | Fixed in the port; still reachable through the Express/Lambda app until it is retired |
| 🟡 **ported** | Reproduced deliberately in the new app, awaiting a decision |
| ⚪️ **fixed** | Closed during the port; listed so it is not rediscovered |

---

## 🟠 1. SES quota is at sandbox limits; production access requested

**Affects:** password-reset and verification email at volume.

**Corrected 2026-09-05.** This entry previously read "password reset does not
work for anyone", on the strength of `ProductionAccessEnabled: false`. A test
send disproved the strong form: SES **delivered** to
`crgdncn+sestest@gmail.com`, an address absent from the identity list. Sending
is not categorically blocked.

What remains true is that the account reports sandbox-level limits:

| Signal | Value |
|---|---|
| `ProductionAccessEnabled` | `false` |
| `Max24HourSend` | 200/day |
| `MaxSendRate` | 1/second |

The two readings were never fully separated: either production access is active
and the flag is stale, or SES normalised the `+sestest` label against the
verified `crgdncn@gmail.com` and the account really is sandboxed. The decisive
test needs a genuine third-party address — mailing a stranger, or deliberately
hard-bouncing at a domain with no MX, which against a near-zero send history is
how you *lose* production access. Neither was worth it, and the remedy is the
same either way.

**Action taken:** production access resubmitted via `PutAccountDetails`
(2026-09-05). `ReviewDetails.Status` moved `GRANTED` → `PENDING`, which also
clears the stale `GRANTED` that made the account state self-contradictory.

**Still to do:** watch for the outcome. If granted, `ProductionAccessEnabled`
flips true and the quota rises. 1/second is the constraint worth caring about —
a class-wide reset event would queue behind it, and the SQS worker would throttle.

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

## 🔴 3. Email verification is broken in production

**Affects:** anyone who clicks a verification link.

`VerifyEmail.tsx` posts to `/api/auth/verify-email`. That route exists in the
Express router and has **no deployed Lambda and no entry in `template.yaml`** —
so in production it hits nothing.

**Evidence:** §14.
**Status:** the port implements it, so it works on the new app. Still broken on
the old one.

---

## 🔴 4. `setActivePanel` is not defined — admin filters throw

**Affects:** any admin using the user manager.

`UsersManager.tsx` calls `setActivePanel('list')` in two `onChange` handlers.
It is never defined — no `useState`, no import. Changing the school or
class-year filter throws a `ReferenceError`.

It survived because the frontend shipped with **no `tsconfig.json`**: Vite
strips types with esbuild and never checks them, so nothing had ever
type-checked that file.

**Evidence:** §19.
**Status:** ⚪️ fixed in `apps/web`; still live in the old frontend.

---

## 🟠 5. `GET /api/photos/presigned` presigns any key it is given

**Affects:** old app only — but that is the same database.

No ownership check at all. Any authenticated user can mint a viewing URL for
any object in the bucket if they can name it. The millisecond suffix in
generated keys makes guessing impractical, which is mitigation, not a control.

**Evidence:** §9.2 item 6, §17.
**Status:** ⚪️ fixed in the port (§21) — the key's owner is resolved from the
database and `canViewPhotos` applied. **The fix is ineffective while the old app
is live on the same data**, since an attacker can simply call the old endpoint.

---

## 🟠 6. `GET /api/users` lists every user to any authenticated caller

**Affects:** old app only — same database.

An unfiltered list of every user in the system, no role check. Nothing in the
frontend calls it.

**Evidence:** §9.2 item 5.
**Status:** ⚪️ fixed in the port (§21) — now behind `SuperAdminGuard`. Same
caveat as #5: reachable through the old app until it retires.

---

## 🟠 7. `PUT /api/comments/:commentId` always 500s when sent both fields

**Affects:** old app only.

Sending `content` **and** `published` builds
`SET content = $1, published = false, published = $2`. Postgres rejects the
duplicate assignment, so the request cannot succeed. Nothing in the frontend
sends both, which is why it has never been noticed.

**Evidence:** §9.2 item 4, §16.
**Status:** ⚪️ fixed in the port (§21). The content side effect wins, so an edit
still returns the comment to moderation — deliberately not last-write-wins,
which would let an author rewrite an approved comment and re-approve it.

---

## 🟠 8. Three handlers use `BEGIN`/`COMMIT` that are not transactions

**Affects:** old app only.

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

## 🟡 12. New uploads never overwrite old objects

**Affects:** both apps.

Every mint gets a fresh `Date.now()` suffix, so re-uploading a photo orphans the
previous object. Nothing sweeps them; storage grows with every re-upload.

**Evidence:** §17.
**Status:** **deliberately not fixed.** The obvious fix — delete the previous
object when minting a new key — is worse than the bug. The key is recorded
*before* the browser uploads, so deleting the old object at mint time destroys a
user's existing photo whenever the upload is abandoned or fails. Losing a photo
is worse than orphaning one. This wants a background sweep of unreferenced keys,
which is a separate piece of work.

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

#12 was examined and deliberately left: see its entry.

---

## Ordering suggestion

1. ~~**#1 and #2**~~ — **done 2026-09-05.** #2 is resolved outright and phase 8
   is unblocked. #1 was overstated and is corrected above; a production-access
   request is submitted and pending.
2. **#5 and #6** — the two security items. Already fixed in the port, so the
   real decision is whether to backport to the old app or accept the exposure
   until it retires. Retiring it sooner closes both.
3. **#3 and #4** — user-visible breakage, already fixed in the port; they close
   themselves as traffic moves across.
4. **#9–#14** — none is urgent. Each needs a small decision more than it needs
   effort.
