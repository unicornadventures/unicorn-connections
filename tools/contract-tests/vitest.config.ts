import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const LEGACY_REPO =
  process.env.LEGACY_REPO ?? resolve(process.env.HOME ?? '', 'Code/ClassYear');

/**
 * The source app is TypeScript written in the TS-ESM idiom: `import { query }
 * from '../db.js'` where the file on disk is `db.ts`. Node's native type
 * stripping does not perform that remap, and neither does Vite by default, so
 * importing those handlers fails on the first relative import.
 *
 * This rewrites `./x.js` -> `./x.ts` for importers inside the source repo only.
 * Scoped that narrowly on purpose: it must never affect this repo's own
 * modules, where a `.js` specifier means what it says.
 */
const resolveLegacyTsExtensions = {
  name: 'legacy-js-to-ts',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer?.startsWith(LEGACY_REPO)) return null;
    if (!source.startsWith('.') || !source.endsWith('.js')) return null;

    const candidate = resolve(dirname(importer), source.replace(/\.js$/, '.ts'));
    return existsSync(candidate) ? candidate : null;
  },
};

export default defineConfig({
  plugins: [resolveLegacyTsExtensions],
  test: {
    globals: true,
    include: ['**/*.contract.spec.ts'],
    // The handlers talk to a real database and bcrypt at cost factor 10.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One database, shared. Parallel files would race on the fixture reset.
    fileParallelism: false,
  },
});
