# @classyear/web

The React 18 + Vite 5 + Tailwind 3 SPA, carried over from `ClassYear/frontend` in
phase 6.

```bash
npm run dev --workspace @classyear/web    # http://localhost:5173
```

It needs the API running (`npm run dev` at the repo root, port 5001). Copy
`.env.example` to `.env` to route requests through the Vite proxy; without it,
`src/api.ts` falls back to `http://localhost:5001/api` directly, which also works
because `main.ts` enables CORS for `FRONTEND_URL`.

## Tests

| Command | What it covers |
|---|---|
| `npm test` | Vitest — component and `apiClient` unit tests |
| `npm run test:e2e` | Playwright — 75 specs × 4 browser projects |
| `npm run typecheck` | `tsc --noEmit`; see below |
| `../../scripts/smoke-web.sh` | The only tests that touch a real server |

**Every Playwright spec mocks the API with `page.route`** — except
`e2e/live-api.spec.ts`, which is skipped unless `E2E_LIVE_API=1`. That matters:
the mocked suite would pass against a backend that does not exist, so it proves
the client's own behaviour and nothing about the API. `scripts/smoke-web.sh`
boots the real server, seeds a class, and logs in for real.

## Type checking

The source frontend had **no `tsconfig.json`**. Vite strips types with esbuild
and never checks them, so none of this code had ever been type-checked. Adding
one surfaced 72 errors, including a `setActivePanel` call that was never defined
— a live `ReferenceError` in the admin user manager's filters — and 61 instances
of a `user_id` the API returns and the type did not declare.

Entity types are **derived** from `@classyear/shared-types` via `Serialized<T>`,
which maps a row type's `Date` fields to the `string` they become over the wire.
Do not restate them here; that is what drifted in the source app. Response
envelopes and genuinely client-side shapes (`CurrentUser`, `SlideshowPhoto`) do
belong in `src/types.ts`.

See `docs/nestjs-conversion-approach.md` §19.
