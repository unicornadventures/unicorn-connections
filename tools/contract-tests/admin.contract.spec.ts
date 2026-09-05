import type { INestApplication } from '@nestjs/common';
import {
  FIXTURE,
  authAs,
  closeFixturePool,
  resetFixture,
} from './src/fixtures.js';
import {
  compare,
  expectDivergence,
  invokeNest,
  type LegacyHandler,
} from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 5 parity gate for the ten deployed `/api/admin` user-administration
 * endpoints.
 *
 * The guard levels vary per route and are the most interesting thing to pin.
 * Docs §5.5 and §9.2 recorded several of these as carrying no guard at all —
 * true of the Express router, false of the deployed handlers, each of which
 * opens with its own `is_admin` check. These tests are what establish which
 * account can reach what.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/admin.ts`
  )) as unknown as Record<string, LegacyHandler>;

  app = await createNestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixturePool();
});

const asActive = () => authAs(FIXTURE.activeUser);
const asAdmin = () => authAs({ ...FIXTURE.adminUser, is_admin: true });
const asClassAdmin = () =>
  authAs({ ...FIXTURE.classAdminUser, is_class_admin: true });

describe('GET /api/admin/users', () => {
  it('matches for a super admin', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAdminUsersHandler,
      { method: 'get', path: '/api/admin/users', headers: asAdmin() },
    );

    expect(b).toEqual(a);
    expect((a as any).body.users).toHaveLength(5);
  });

  it('refuses a class admin — this one is super-admin only', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAdminUsersHandler,
      { method: 'get', path: '/api/admin/users', headers: asClassAdmin() },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Admin access required.' },
    });
  });

  it('refuses an ordinary user', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAdminUsersHandler,
      { method: 'get', path: '/api/admin/users', headers: asActive() },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });

  it('matches with no token', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAdminUsersHandler,
      { method: 'get', path: '/api/admin/users' },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });
});

describe('GET /api/admin/classes/:classId/users', () => {
  it('matches, paginated', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassUsersHandler,
      {
        method: 'get',
        path: `/api/admin/classes/${FIXTURE.class.id}/users`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    // Page size defaults to 10 here, not the 20 that GET /api/users uses.
    expect(a).toMatchObject({
      status: 200,
      body: { total: 2, page: 1, pageSize: 10 },
    });
  });

  it('filters by last-name prefix', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassUsersHandler,
      {
        method: 'get',
        path: `/api/admin/classes/${FIXTURE.class.id}/users`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        query: { lastName: 'Love' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.users).toHaveLength(1);
    expect((a as any).body.total).toBe(1);
  });

  /** Prefix, not contains — 'ovelace' must not match 'Lovelace'. */
  it('does not match mid-name', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassUsersHandler,
      {
        method: 'get',
        path: `/api/admin/classes/${FIXTURE.class.id}/users`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        query: { lastName: 'ovelace' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toMatchObject({ status: 200, body: { total: 0 } });
  });

  it('honours page and pageSize', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassUsersHandler,
      {
        method: 'get',
        path: `/api/admin/classes/${FIXTURE.class.id}/users`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        query: { page: '2', pageSize: '1' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.users).toHaveLength(1);
  });
});

describe('PUT /api/admin/users/:userId', () => {
  it('promotes a user to class admin', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserClassAdminHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: { is_class_admin: true },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.user.is_class_admin).toBe(true);
  });

  it('demotes as well as promotes', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserClassAdminHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.classAdminUser.id}`,
        pathParameters: { userId: String(FIXTURE.classAdminUser.id) },
        headers: asAdmin(),
        body: { is_class_admin: false },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.user.is_class_admin).toBe(false);
  });

  it('matches on a missing flag', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserClassAdminHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: {},
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Missing required fields.' },
    });
  });

  it('matches for an unknown user', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserClassAdminHandler,
      {
        method: 'put',
        path: '/api/admin/users/9999',
        pathParameters: { userId: '9999' },
        headers: asAdmin(),
        body: { is_class_admin: true },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'User not found.' } });
  });

  it('refuses a class admin', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserClassAdminHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asClassAdmin(),
        body: { is_class_admin: true },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });
});

describe('DELETE /api/admin/users/:userId', () => {
  it('lets a super admin delete anyone', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteUserHandler, {
      method: 'delete',
      path: `/api/admin/users/${FIXTURE.activeUser.id}`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
      headers: asAdmin(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'User deleted successfully.' },
    });
  });

  /**
   * The one route behind AdminGuard rather than SuperAdminGuard: a class admin
   * gets past the guard, then `canManageUser` decides. Their classmate is
   * fair game.
   */
  it('lets a class admin delete a classmate', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteUserHandler, {
      method: 'delete',
      path: `/api/admin/users/${FIXTURE.outsiderUser.id}`,
      pathParameters: { userId: String(FIXTURE.outsiderUser.id) },
      headers: asClassAdmin(),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('refuses a class admin outside their class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteUserHandler, {
      method: 'delete',
      path: `/api/admin/users/${FIXTURE.activeUser.id}`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
      headers: asClassAdmin(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Access denied. You can only manage users in your class.' },
    });
  });

  it('refuses an ordinary user at the guard', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteUserHandler, {
      method: 'delete',
      path: `/api/admin/users/${FIXTURE.outsiderUser.id}`,
      pathParameters: { userId: String(FIXTURE.outsiderUser.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Admin access required.' },
    });
  });

  it('reports 404 before 403 for an unknown user', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteUserHandler, {
      method: 'delete',
      path: '/api/admin/users/9999',
      pathParameters: { userId: '9999' },
      headers: asClassAdmin(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'User not found.' } });
  });
});

describe('PUT /api/admin/users/:userId/profile', () => {
  it('updates names and the deceased flag', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserProfileHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: {
          is_deceased: true,
          first_name: 'Augusta',
          last_name: 'King',
          former_last_name: 'Byron',
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.user).toMatchObject({
      is_deceased: true,
      first_name: 'Augusta',
      former_last_name: 'Byron',
    });
  });

  it('requires is_deceased to be a boolean, not merely present', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserProfileHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: { is_deceased: 'yes', first_name: 'A', last_name: 'B' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Missing required fields.' },
    });
  });

  it('reports the name-specific message when names are missing', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserProfileHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: { is_deceased: false },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Missing required fields: first_name and last_name.' },
    });
  });

  /**
   * This route has no admin guard at the route level — only a valid token —
   * so an ordinary user reaches the 403 from `canManageUser` rather than the
   * guard's 'Admin access required.'. The distinct message is the evidence.
   */
  it('refuses an ordinary user with the scope message, not the guard message', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserProfileHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.outsiderUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.outsiderUser.id) },
        headers: asActive(),
        body: { is_deceased: false, first_name: 'A', last_name: 'B' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Access denied. You can only manage users in your class.' },
    });
  });

  it('lets a class admin edit a classmate', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateUserProfileHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.outsiderUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.outsiderUser.id) },
        headers: asClassAdmin(),
        body: { is_deceased: false, first_name: 'Robert', last_name: 'Newby' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });
});

describe('PUT /api/admin/users/:userId/move-class', () => {
  it('moves a user to another class', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.moveUserClassHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/move-class`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: { class_id: FIXTURE.otherClass.id },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'User moved to new class successfully.' },
    });
  });

  it('rejects a move to the class they are already in', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.moveUserClassHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/move-class`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: { class_id: FIXTURE.class.id },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'User is already in that class.' },
    });
  });

  it('matches on a missing class_id', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.moveUserClassHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/move-class`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: {},
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'class_id is required.' },
    });
  });

  it('matches for an unknown class', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.moveUserClassHandler,
      {
        method: 'put',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/move-class`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: { class_id: 9999 },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Class not found.' } });
  });
});

describe('POST /api/admin/users/:userId/password-link', () => {
  it('mints a set-password link', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createPasswordLinkHandler,
      {
        method: 'post',
        path: `/api/admin/users/${FIXTURE.activeUser.id}/password-link`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    // The random token is masked by the harness; the rest of the URL is not.
    expect((a as any).body.passwordSetupUrl).toBe(
      'http://localhost:5173/reset-password?token=<token>',
    );
  });

  it('refuses a user with no email on file', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createPasswordLinkHandler,
      {
        method: 'post',
        path: `/api/admin/users/${FIXTURE.unclaimedUser.id}/password-link`,
        pathParameters: { userId: String(FIXTURE.unclaimedUser.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: {
        error:
          'User has no email on file and cannot log in. Add an email first.',
      },
    });
  });

  it('matches for an unknown user', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createPasswordLinkHandler,
      {
        method: 'post',
        path: '/api/admin/users/9999/password-link',
        pathParameters: { userId: '9999' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'User not found.' } });
  });
});

describe('POST /api/admin/registration-links', () => {
  it('mints a link for a class at a school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createRegistrationLinkHandler,
      {
        method: 'post',
        path: '/api/admin/registration-links',
        headers: asAdmin(),
        body: { classId: FIXTURE.class.id, schoolId: FIXTURE.school.id },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.class).toMatchObject({ year: FIXTURE.class.year });
    expect((a as any).body.registrationUrl).toContain(
      'http://localhost:5173/register/',
    );
  });

  it('404s when the class is not linked to that school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createRegistrationLinkHandler,
      {
        method: 'post',
        path: '/api/admin/registration-links',
        headers: asAdmin(),
        body: { classId: FIXTURE.class.id, schoolId: FIXTURE.emptySchool.id },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Class not found.' } });
  });

  it('matches on missing fields', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createRegistrationLinkHandler,
      {
        method: 'post',
        path: '/api/admin/registration-links',
        headers: asAdmin(),
        body: {},
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Missing required fields: classId and schoolId.' },
    });
  });
});

describe('POST /api/admin/schools/:schoolId/classes/:classId/users', () => {
  const path = `/api/admin/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}/users`;
  const pathParameters = {
    schoolId: String(FIXTURE.school.id),
    classId: String(FIXTURE.class.id),
  };

  it('creates a roster entry with an email', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createUserHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: {
        email: '  NEW@Example.COM ',
        first_name: 'Alan',
        last_name: 'Turing',
      },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
    expect((a as any).body.user.email).toBe('new@example.com');
  });

  /** No email means an unclaimed entry — null password, waiting to be claimed. */
  it('creates an unclaimed roster entry without an email', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createUserHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: { first_name: 'Alonzo', last_name: 'Church' },
    });

    expect(b).toEqual(a);
    expect((a as any).body.user.email).toBeNull();
  });

  it('maps original_* onto the former_* columns', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createUserHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: {
        first_name: 'Emmy',
        last_name: 'Smith',
        original_last_name: 'Noether',
      },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
  });

  it('409s on a duplicate email', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createUserHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: {
        email: FIXTURE.activeUser.email,
        first_name: 'Ada',
        last_name: 'Twin',
      },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 409,
      body: { error: 'A user with this email already exists.' },
    });
  });

  it('matches on missing names', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createUserHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: { email: 'nameless@example.com' },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'first_name and last_name are required.' },
    });
  });

  it('treats whitespace-only names as missing', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createUserHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: { first_name: '   ', last_name: 'Ghost' },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(400);
  });

  it('refuses a class admin', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createUserHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asClassAdmin(),
      body: { first_name: 'Nope', last_name: 'Nope' },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });
});

describe('POST /api/admin/schools/:schoolId/classes/:classId/users/import', () => {
  const path = `/api/admin/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}/users/import`;
  const pathParameters = {
    schoolId: String(FIXTURE.school.id),
    classId: String(FIXTURE.class.id),
  };

  it('imports a batch', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.importUsersHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: {
        users: [
          { first_name: 'Alan', last_name: 'Turing' },
          { first_name: 'Emmy', last_name: 'Noether', email: 'emmy@example.com' },
        ],
      },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 201, body: { created: 2, skipped: [] } });
  });

  /**
   * The point of the endpoint: a bad row is skipped with a reason and the rest
   * still land. A transaction around the loop would roll the whole batch back
   * and make `{ created, skipped }` a lie.
   */
  it('skips bad rows and imports the rest', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.importUsersHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: {
        users: [
          { first_name: 'Good', last_name: 'Row' },
          { first_name: '', last_name: 'Nameless' },
          { first_name: 'Dupe', last_name: 'Email', email: FIXTURE.activeUser.email },
          { first_name: 'Also', last_name: 'Good' },
        ],
      },
    });

    expect(b).toEqual(a);
    expect((a as any).body.created).toBe(2);
    expect((a as any).body.skipped).toEqual([
      { index: 1, name: 'Row 2', reason: 'Missing first or last name' },
      { index: 2, name: 'Dupe Email', reason: 'Email already exists' },
    ]);
  });

  it('matches on an empty array', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.importUsersHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: { users: [] },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'users array is required.' },
    });
  });

  it('matches on a missing users field', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.importUsersHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: {},
    });

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe('users array is required.');
  });

  it('enforces the 500-row cap', async () => {
    const users = Array.from({ length: 501 }, (_, i) => ({
      first_name: `First${i}`,
      last_name: `Last${i}`,
    }));

    const { legacy: a, nest: b } = await compare(app, legacy.importUsersHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: { users },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Maximum 500 users per import.' },
    });
  });
});

// ---- known-bugs fixes -------------------------------------------------------

describe('known-bugs fixes', () => {
  /**
   * **Deliberate divergence** (known-bugs #10). The source's move INSERT
   * supplied no `school_id`, so `GET /api/users/:id/class` reported a null
   * school for anyone who had ever been moved. The school is now taken from the
   * target class's own `class_school` link.
   *
   * Asserted through the *read* rather than the move, because the move's own
   * response body is just a message and never showed the bug.
   */
  it('diverges: a moved user keeps a school on their membership', async () => {
    await resetFixture();

    await invokeNest(app, {
      method: 'put',
      path: `/api/admin/users/${FIXTURE.activeUser.id}/move-class`,
      headers: asAdmin(),
      body: { class_id: FIXTURE.otherClass.id },
    });

    const after = (await invokeNest(app, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}/class`,
      headers: asAdmin(),
    })) as { status: number; body: { class: { school_id: number | null } } };

    expect(after.status).toBe(200);
    // The source would have reported null here.
    expect(after.body.class.school_id).toBe(FIXTURE.school.id);
  });

  /**
   * **Deliberate divergence** (known-bugs #14). A non-numeric id used to reach
   * Postgres, fail on `invalid input syntax for type integer`, and answer 500 —
   * the server claiming it broke when the caller sent nonsense.
   */
  it('diverges: a non-numeric id is now a 400, not a 500', async () => {
    const observed = await compare(app, legacy.deleteUserHandler, {
      method: 'delete',
      path: '/api/admin/users/abc',
      pathParameters: { userId: 'abc' },
      headers: asAdmin(),
    });

    expect((observed.legacy as any).status).toBe(500);
    expectDivergence(
      observed,
      { status: 400, body: { error: 'Invalid id.' } },
      'known-bugs #14 — non-numeric ids reached SQL',
    );
  });

  /**
   * `parseInt('1x')` is `1`, so a lenient check would have quietly served user
   * 1 here. Worse than a 400, which is why the pipe's pattern is strict.
   */
  it('rejects a partially-numeric id rather than truncating it', async () => {
    const observed = await compare(app, legacy.deleteUserHandler, {
      method: 'delete',
      path: `/api/admin/users/${FIXTURE.activeUser.id}x`,
      pathParameters: { userId: `${FIXTURE.activeUser.id}x` },
      headers: asAdmin(),
    });

    expect((observed.nest as any).status).toBe(400);
  });
});
