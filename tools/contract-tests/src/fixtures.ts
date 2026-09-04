import bcrypt from 'bcryptjs';
import pkg from 'pg';

const { Pool } = pkg;

/**
 * Fixture data both implementations run against.
 *
 * Ids are fixed so the two sides produce byte-identical bodies — an
 * auto-incrementing sequence would drift between resets and every response
 * containing an id would false-positive.
 */
export const FIXTURE = {
  school: { id: 1, name: 'Springfield High', location: 'Springfield' },
  class: { id: 1, year: 1994 },
  activeUser: {
    id: 10,
    email: 'ada@example.com',
    password: 'correct-horse',
    first_name: 'Ada',
    last_name: 'Lovelace',
  },
  // Admin-created roster entry: no email, no password, waiting to be claimed.
  unclaimedUser: {
    id: 11,
    first_name: 'Grace',
    last_name: 'Hopper',
    former_last_name: 'Murray',
  },
  resetToken: 'a'.repeat(64),
} as const;

let pool: InstanceType<typeof Pool> | null = null;

function getPool() {
  pool ??= new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  return pool;
}

export async function closeFixturePool(): Promise<void> {
  await pool?.end().catch(() => {});
  pool = null;
}

/**
 * Truncates and re-seeds. Called before *each* side of every comparison, so a
 * mutating endpoint (reset-password, claim-account) sees identical starting
 * state whichever implementation is about to run.
 */
export async function resetFixture(): Promise<void> {
  const db = getPool();
  const hashed = await bcrypt.hash(FIXTURE.activeUser.password, 10);
  const { createHash } = await import('node:crypto');
  const resetHash = createHash('sha256')
    .update(FIXTURE.resetToken)
    .digest('hex');

  await db.query(`
    TRUNCATE schools, classes, class_school, users, profiles, class_user,
             events, comments, gallery_photos, feedback,
             password_reset_tokens, email_verification_tokens
    RESTART IDENTITY CASCADE
  `);

  await db.query(
    'INSERT INTO schools (id, name, location) VALUES ($1, $2, $3)',
    [FIXTURE.school.id, FIXTURE.school.name, FIXTURE.school.location],
  );
  await db.query('INSERT INTO classes (id, year) VALUES ($1, $2)', [
    FIXTURE.class.id,
    FIXTURE.class.year,
  ]);
  await db.query(
    'INSERT INTO class_school (class_id, school_id) VALUES ($1, $2)',
    [FIXTURE.class.id, FIXTURE.school.id],
  );

  await db.query(
    `INSERT INTO users (id, email, password, is_admin, is_class_admin, email_verified)
     VALUES ($1, $2, $3, false, false, false)`,
    [FIXTURE.activeUser.id, FIXTURE.activeUser.email, hashed],
  );
  await db.query(
    'INSERT INTO profiles (user_id, first_name, last_name) VALUES ($1, $2, $3)',
    [
      FIXTURE.activeUser.id,
      FIXTURE.activeUser.first_name,
      FIXTURE.activeUser.last_name,
    ],
  );
  await db.query(
    'INSERT INTO class_user (class_id, user_id, school_id) VALUES ($1, $2, $3)',
    [FIXTURE.class.id, FIXTURE.activeUser.id, FIXTURE.school.id],
  );

  await db.query(
    `INSERT INTO users (id, email, password, is_admin, is_class_admin, is_deceased)
     VALUES ($1, NULL, NULL, false, false, false)`,
    [FIXTURE.unclaimedUser.id],
  );
  await db.query(
    `INSERT INTO profiles (user_id, first_name, last_name, former_last_name)
     VALUES ($1, $2, $3, $4)`,
    [
      FIXTURE.unclaimedUser.id,
      FIXTURE.unclaimedUser.first_name,
      FIXTURE.unclaimedUser.last_name,
      FIXTURE.unclaimedUser.former_last_name,
    ],
  );
  // claim-search joins class_user, so an entry with no class membership is
  // invisible to it. Without this row the endpoint correctly returns no
  // matches and the fixture proves nothing.
  await db.query(
    'INSERT INTO class_user (class_id, user_id, school_id) VALUES ($1, $2, $3)',
    [FIXTURE.class.id, FIXTURE.unclaimedUser.id, FIXTURE.school.id],
  );

  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [FIXTURE.activeUser.id, resetHash],
  );

  // Sequences must clear the hardcoded ids or the next INSERT collides.
  await db.query("SELECT setval('users_id_seq', 100, false)");
  await db.query("SELECT setval('profiles_id_seq', 100, false)");
  await db.query("SELECT setval('schools_id_seq', 100, false)");
  await db.query("SELECT setval('classes_id_seq', 100, false)");
}
