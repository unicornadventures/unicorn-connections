// Minimal stand-in for the Express app's `backend/src/db.ts`.
//
// It exists so that app's `schema.ts` can be executed verbatim against a
// scratch database, without importing anything else from that repo and without
// copying its dotenv/Secrets Manager plumbing. Only `query` is needed — that is
// the entire surface schema.ts uses.
//
// Plain .js on purpose: schema.ts imports './db.js', and this way that specifier
// resolves literally, with no TypeScript extension-rewriting in play.
import pkg from 'pg';

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

export const query = (text, params = []) => pool.query(text, params);

export const end = () => pool.end();
