# @classyear/web — placeholder (phase 6)

The React/Vite SPA lands here in **phase 6**, carried over from
`ClassYear/frontend` largely unchanged: it talks to the same HTTP contract, so if
the port holds that contract, the only edit it needs is `VITE_API_BASE_URL`.

What arrives with it:

- React 18 + Vite 5 + Tailwind 3 + react-router 7, ~30 components
- `apiClient.ts` (typed API surface), `AppContext.tsx` (auth state)
- Vitest unit tests + Playwright e2e

When it moves in, its local entity types should be deleted in favour of
`@classyear/shared-types` — keeping two copies in sync by hand is what the
source app did, and they drifted.

See `docs/nestjs-conversion-approach.md` §2.4 and §10.
