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
| 🟠 **live (old app only)** | Fixed in the port; still reachable through the Express/Lambda app until it is retired |
| 🟡 **ported** | Reproduced deliberately in the new app, awaiting a decision |
| ⚪️ **fixed** | Closed during the port; listed so it is not rediscovered |

---

## 🔴 1. Password reset does not work for anyone

**Affects:** every user who has ever clicked "forgot password".

The AWS account is in the **SES sandbox** (`ProductionAccessEnabled: false`).
SES only delivers to *verified* recipients, and the only verified address on the
account is the owner's. Every reset email to a real alumnus is rejected.

The endpoint itself is fine — §14 confirmed the deployed handler looks the token
up correctly. The token just never reaches anybody.

**Evidence:** §20. `aws sesv2 get-account --region us-east-1`.
**Fix:** request SES production access. Support-ticket turnaround, measured in
days, so start it early.
**Note:** this compounds with #2 — the queue and worker faithfully hand the
message to an SES call that fails.

---

## 🔴 2. No SES identity for `unicornconnections.org` — blocks phase 8

**Affects:** will break the *existing* app the moment phase 8 lands.

Phase 8 changes the old stack's `DomainName` to `unicornconnections.org`, which
changes `SES_FROM_EMAIL` to `noreply@unicornconnections.org` — an identity that
does not exist in any form or region. Sending from the old app starts failing
immediately.

**Evidence:** §20. Only `reunion-connect.org` and one address are verified.
**Fix:** verify the domain identity (DNS records + DKIM) **before** phase 8.
Propagation takes time; this is a prerequisite, not a step inside the phase.

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

## 🟡 9. `?requesterId=` is trivially spoofable

**Affects:** the old app, and the frontend still sends it.

Comments and photos took identity from a query parameter. The deployed handlers
already ignore it where it matters most — `/directory`, `/photos` and
`/comments/pending` all use the token (§14) — so the exposure is smaller than it
looks, but the parameter is still on the wire.

**Evidence:** §9.2 item 1.
**Status:** open. Removing it needs a coordinated frontend change; the port
already ignores it everywhere.

---

## 🟡 10. `move-class` drops the school context

**Affects:** both apps.

The INSERT supplies no `school_id`, so a moved user's membership loses it and
`GET /api/users/:id/class` reports a null school for anyone who has been moved.

**Evidence:** §18.
**Status:** open — reproduced faithfully. Fixing it changes a response body, so
it wants its own decision.

---

## 🟡 11. Deleting a user orphans their gallery objects

**Affects:** both apps.

`DELETE /api/admin/users/:userId` sweeps the two profile photos but not the
user's gallery uploads, which stay in S3 forever.

**Evidence:** §18.
**Status:** open. Storage hygiene rather than correctness — better addressed by
a sweep than by widening the delete path.

---

## 🟡 12. New uploads never overwrite old objects

**Affects:** both apps.

Every mint gets a fresh `Date.now()` suffix, so re-uploading a photo orphans the
previous object. Nothing sweeps them; storage grows with every re-upload.

**Evidence:** §17.
**Status:** open, same category as #11.

---

## 🟡 13. Admin event creation 500s when `location` is omitted

**Affects:** both apps.

`location` is optional on the wire and `NOT NULL` in the schema, so omitting it
fails the INSERT. That endpoint also validates *before* authorizing, unlike its
update and delete siblings — a member with no rights and an incomplete body gets
the 400, not the 403.

**Evidence:** §18.
**Status:** open, reproduced and pinned by a contract test.

---

## 🟡 14. Non-numeric path parameters 500 instead of 400

**Affects:** both apps.

`GET /api/users/abc` reaches Postgres, fails on `invalid input syntax for type
integer`, and answers 500. A `ParseIntPipe` would make it a 400 with different
wording, so the port deliberately does not add one.

**Evidence:** §15.
**Status:** open. Cosmetic unless something starts alerting on 5xx rates.

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

## Ordering suggestion

1. **#1 and #2** — both have external lead time (support ticket, DNS
   propagation) and #2 gates phase 8. Start them now; they need no code.
2. **#5 and #6** — the two security items. Already fixed in the port, so the
   real decision is whether to backport to the old app or accept the exposure
   until it retires. Retiring it sooner closes both.
3. **#3 and #4** — user-visible breakage, already fixed in the port; they close
   themselves as traffic moves across.
4. **#9–#14** — none is urgent. Each needs a small decision more than it needs
   effort.
