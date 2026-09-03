// Executes the Express app's schema.ts against the database named by PGDATABASE.
//
// `schema.ts` is copied in next to this file by verify-schema-parity.sh — it is
// never committed here, so the source repo stays the single home for that code.
//
// Node runs the .ts file directly via native type stripping (Node 22.6+).
import { initializeDatabase } from './schema.ts';
import { end } from './db.js';

// Note: the source's initializeDatabase() catches its own errors and only logs
// them, so a failure here still exits 0. The pg_dump diff is what actually
// catches a partially-applied schema.
await initializeDatabase();
await end();
