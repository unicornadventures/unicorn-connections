# contract-tests — placeholder (phase 1)

The parity gate for the port, described in `docs/nestjs-conversion-approach.md` §7.3.

For each of the 74 endpoints, it issues the same request against **both** the source
Express app and this NestJS app, seeded from the same fixture database, and asserts:

- identical status code
- deep-equal response body (with id/timestamp normalization)

Any intentional divergence gets an allow-list entry pointing at §9 of the conversion doc.
That turns "identical" from an aspiration into something CI can check.

The source app is run from a **git worktree** of `~/Code/ClassYear`, so nothing in that
repo is modified.

`scripts/verify-schema-parity.sh` is the same idea applied to the schema, and already
works — it is the template to follow here.
