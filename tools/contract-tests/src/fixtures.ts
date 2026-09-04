import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pkg from 'pg';

const { Pool } = pkg;

/** The year the auto-link branch in `GET /api/schools/:id/classes` looks for. */
const CURRENT_YEAR = new Date().getFullYear();

/**
 * Fixture data both implementations run against.
 *
 * Ids are fixed so the two sides produce byte-identical bodies — an
 * auto-incrementing sequence would drift between resets and every response
 * containing an id would false-positive.
 *
 * `created_at` is set explicitly for every user for the same reason. The
 * schema defaults it to CURRENT_TIMESTAMP, `GET /api/users` sorts by it
 * descending, and rows seeded milliseconds apart would tie and come back in
 * whatever order the planner felt like.
 */
export const FIXTURE = {
  school: {
    id: 1,
    name: 'Springfield High',
    location: 'Springfield',
    timezone: 'America/Chicago',
  },
  // Set up but with no class years linked: proves the auto-link branch does
  // *not* fire for a school nobody has configured.
  emptySchool: { id: 2, name: 'Shelbyville High', location: 'Shelbyville' },
  class: { id: 1, year: 1994 },
  // A second class at the same school, used to prove non-members are refused.
  otherClass: { id: 2, year: 1995 },
  // Seeded but deliberately *not* linked to any school, so listing school 1's
  // classes has a current-year row to find and link on the way past.
  currentClass: { id: 3, year: CURRENT_YEAR },
  activeUser: {
    id: 10,
    email: 'ada@example.com',
    password: 'correct-horse',
    first_name: 'Ada',
    last_name: 'Lovelace',
    nickname: 'Countess',
    bio: 'First programmer.',
    avatar_color: '#3F51B5',
    tags: ['mathematics', 'engines'],
    then_photo_url: 'photos/1/1/10/then.jpg',
    now_photo_url: 'photos/1/1/10/now.jpg',
    gallery_key: 'photos/1/1/10/gallery-1.jpg',
  },
  // Admin-created roster entry: no email, no password, waiting to be claimed.
  unclaimedUser: {
    id: 11,
    first_name: 'Grace',
    last_name: 'Hopper',
    former_last_name: 'Murray',
  },
  // Super admin, in no class at all — exercises the admin bypass on the
  // class-scoped reads, which must work without membership.
  adminUser: {
    id: 12,
    email: 'admin@example.com',
    password: 'admin-horse',
    first_name: 'Root',
    last_name: 'Admin',
  },
  // In `otherClass`, so they are a valid authenticated user who is nonetheless
  // a stranger to `class` — the 403 case for directory and photos.
  outsiderUser: {
    id: 13,
    email: 'bob@example.com',
    password: 'bob-horse',
    first_name: 'Bob',
    last_name: 'Newby',
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
 * Mints a token the way `POST /api/auth/login` does.
 *
 * Both implementations verify against the same `JWT_SECRET`, so one token is
 * accepted by both sides of a comparison — which is the point: the two must be
 * given byte-identical credentials or an authorization difference would show up
 * as a body difference and be blamed on the wrong thing.
 *
 * The claims list is the deployed one (docs §14): `id`, `email`, `is_admin`,
 * `is_class_admin`, and nothing else.
 */
export function tokenFor(user: {
  id: number;
  email?: string;
  is_admin?: boolean;
  is_class_admin?: boolean;
}): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email ?? null,
      is_admin: user.is_admin ?? false,
      is_class_admin: user.is_class_admin ?? false,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' },
  );
}

/** `Authorization` header for a fixture user, ready to spread into a call. */
export function authAs(user: Parameters<typeof tokenFor>[0]) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

/**
 * Truncates and re-seeds. Called before *each* side of every comparison, so a
 * mutating endpoint (reset-password, claim-account, update-profile) sees
 * identical starting state whichever implementation is about to run.
 */
export async function resetFixture(): Promise<void> {
  const db = getPool();
  const [activeHash, adminHash, outsiderHash] = await Promise.all([
    bcrypt.hash(FIXTURE.activeUser.password, 10),
    bcrypt.hash(FIXTURE.adminUser.password, 10),
    bcrypt.hash(FIXTURE.outsiderUser.password, 10),
  ]);
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
    'INSERT INTO schools (id, name, location, timezone) VALUES ($1, $2, $3, $4)',
    [
      FIXTURE.school.id,
      FIXTURE.school.name,
      FIXTURE.school.location,
      FIXTURE.school.timezone,
    ],
  );
  await db.query(
    'INSERT INTO schools (id, name, location, timezone) VALUES ($1, $2, $3, NULL)',
    [
      FIXTURE.emptySchool.id,
      FIXTURE.emptySchool.name,
      FIXTURE.emptySchool.location,
    ],
  );

  for (const klass of [
    FIXTURE.class,
    FIXTURE.otherClass,
    FIXTURE.currentClass,
  ]) {
    await db.query('INSERT INTO classes (id, year) VALUES ($1, $2)', [
      klass.id,
      klass.year,
    ]);
  }

  // currentClass is left unlinked on purpose — see its comment above.
  await db.query(
    'INSERT INTO class_school (class_id, school_id) VALUES ($1, $2), ($3, $2)',
    [FIXTURE.class.id, FIXTURE.school.id, FIXTURE.otherClass.id],
  );

  await db.query(
    `INSERT INTO users (id, email, password, is_admin, is_class_admin, email_verified, created_at)
     VALUES ($1, $2, $3, false, false, false, TIMESTAMP '2024-01-01 00:00:00')`,
    [FIXTURE.activeUser.id, FIXTURE.activeUser.email, activeHash],
  );
  await db.query(
    `INSERT INTO profiles (user_id, first_name, last_name, nickname, bio,
                           avatar_color, tags, then_photo_url, now_photo_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      FIXTURE.activeUser.id,
      FIXTURE.activeUser.first_name,
      FIXTURE.activeUser.last_name,
      FIXTURE.activeUser.nickname,
      FIXTURE.activeUser.bio,
      FIXTURE.activeUser.avatar_color,
      JSON.stringify(FIXTURE.activeUser.tags),
      FIXTURE.activeUser.then_photo_url,
      FIXTURE.activeUser.now_photo_url,
    ],
  );
  await db.query(
    'INSERT INTO class_user (class_id, user_id, school_id) VALUES ($1, $2, $3)',
    [FIXTURE.class.id, FIXTURE.activeUser.id, FIXTURE.school.id],
  );
  await db.query(
    'INSERT INTO gallery_photos (user_id, s3_key) VALUES ($1, $2)',
    [FIXTURE.activeUser.id, FIXTURE.activeUser.gallery_key],
  );

  await db.query(
    `INSERT INTO users (id, email, password, is_admin, is_class_admin, is_deceased, created_at)
     VALUES ($1, NULL, NULL, false, false, false, TIMESTAMP '2024-01-02 00:00:00')`,
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
    `INSERT INTO users (id, email, password, is_admin, is_class_admin, created_at)
     VALUES ($1, $2, $3, true, false, TIMESTAMP '2024-01-03 00:00:00')`,
    [FIXTURE.adminUser.id, FIXTURE.adminUser.email, adminHash],
  );
  await db.query(
    'INSERT INTO profiles (user_id, first_name, last_name) VALUES ($1, $2, $3)',
    [
      FIXTURE.adminUser.id,
      FIXTURE.adminUser.first_name,
      FIXTURE.adminUser.last_name,
    ],
  );

  await db.query(
    `INSERT INTO users (id, email, password, is_admin, is_class_admin, created_at)
     VALUES ($1, $2, $3, false, false, TIMESTAMP '2024-01-04 00:00:00')`,
    [FIXTURE.outsiderUser.id, FIXTURE.outsiderUser.email, outsiderHash],
  );
  await db.query(
    'INSERT INTO profiles (user_id, first_name, last_name) VALUES ($1, $2, $3)',
    [
      FIXTURE.outsiderUser.id,
      FIXTURE.outsiderUser.first_name,
      FIXTURE.outsiderUser.last_name,
    ],
  );
  await db.query(
    'INSERT INTO class_user (class_id, user_id, school_id) VALUES ($1, $2, $3)',
    [FIXTURE.otherClass.id, FIXTURE.outsiderUser.id, FIXTURE.school.id],
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
