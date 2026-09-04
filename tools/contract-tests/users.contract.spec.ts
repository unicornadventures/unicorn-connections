import type { INestApplication } from '@nestjs/common';
import { FIXTURE, authAs, closeFixturePool } from './src/fixtures.js';
import { compare, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 2 parity gate for `/api/users`.
 *
 * Four endpoints, all authenticated. Each case runs the deployed Lambda handler
 * and the NestJS endpoint against identically-seeded databases and asserts the
 * status and body match exactly, modulo tokens, timestamps, and the clock-
 * dependent part of a presigned S3 URL (see harness `normalize`).
 *
 * The two Express-only routes that shared this mount — `POST /register` and
 * `POST /:userId/assign-class` — are not ported and so are not tested; docs
 * §9.4 records why.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/users.ts`
  )) as unknown as Record<string, LegacyHandler>;

  app = await createNestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixturePool();
});

const asActive = () => authAs(FIXTURE.activeUser);
const asAdmin = () => authAs({ ...FIXTURE.adminUser, is_admin: true });

describe('GET /api/users/:userId', () => {
  it('matches for an existing user, photo keys resolved to URLs', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getProfileHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
    // Guards the normalization itself: if both sides returned raw S3 keys, or
    // both returned null, the deep-equal above would still pass.
    expect((a as any).body.profile.then_photo_url).toContain(
      FIXTURE.activeUser.then_photo_url,
    );
  });

  it('matches for a user with no photos', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getProfileHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.unclaimedUser.id}`,
      pathParameters: { userId: String(FIXTURE.unclaimedUser.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.profile.then_photo_url).toBeNull();
  });

  it('matches for an unknown user', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getProfileHandler, {
      method: 'get',
      path: '/api/users/9999',
      pathParameters: { userId: '9999' },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'User not found.' } });
  });

  it('matches with no token', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getProfileHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });

  it('matches with a token signed by the wrong key', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getProfileHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
      headers: { Authorization: 'Bearer not-a-real-token' },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(401);
  });

  it('lets any authenticated user read any other profile, identically', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getProfileHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
      // An outsider from a different class — no scoping applies (docs §9.2).
      headers: authAs(FIXTURE.outsiderUser),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });
});

describe('GET /api/users/:userId/class', () => {
  it('matches for a user in a class', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getUserClassHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/class`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.class.year).toBe(FIXTURE.class.year);
  });

  it('matches for a user in no class', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getUserClassHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.adminUser.id}/class`,
        pathParameters: { userId: String(FIXTURE.adminUser.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 404,
      body: { error: 'User not in any class.' },
    });
  });
});

describe('GET /api/users', () => {
  it('matches on the default page', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listUsersHandler, {
      method: 'get',
      path: '/api/users',
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toMatchObject({ status: 200, body: { total: 4, page: 1, pageSize: 20 } });
  });

  it('matches on an explicit page and size', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listUsersHandler, {
      method: 'get',
      path: '/api/users',
      query: { page: '2', pageSize: '2' },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.users).toHaveLength(2);
  });

  it('matches on a page past the end', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listUsersHandler, {
      method: 'get',
      path: '/api/users',
      query: { page: '99', pageSize: '10' },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.users).toEqual([]);
  });
});

describe('PUT /api/users/:userId/profile', () => {
  it('matches when a user edits their own profile', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { bio: 'Updated bio.', nickname: 'Ada L.' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.profile.bio).toBe('Updated bio.');
  });

  it('matches on the COALESCE semantics of an omitted field', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { bio: 'Only the bio changes.' },
      },
    );

    expect(b).toEqual(a);
    // nickname was not sent, so it must survive rather than become null.
    expect((a as any).body.profile.nickname).toBe(FIXTURE.activeUser.nickname);
  });

  it('matches when clearing avatar_color with an explicit null', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { avatar_color: null },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.profile.avatar_color).toBeNull();
  });

  it('matches on an avatar_color outside the palette', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { avatar_color: '#123456' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Invalid avatar color.' },
    });
  });

  it('matches on replacing tags', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { tags: ['looms'] },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.profile.tags).toEqual(['looms']);
  });

  it('matches when a stranger tries to edit someone else', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: authAs(FIXTURE.outsiderUser),
        body: { bio: 'Vandalised.' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'You can only edit your own profile.' },
    });
  });

  it('matches when an admin edits someone else', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
        body: { bio: 'Moderated.' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('matches on an email already in use', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { email: FIXTURE.outsiderUser.email },
      },
    );

    expect(b).toEqual(a);
    // 400, not the 409 the unused Express route answered with (docs §14).
    expect(a).toEqual({
      status: 400,
      body: { error: 'Email already in use.' },
    });
  });

  it('matches on a successful email change, normalized', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateProfileHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/profile`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { email: '  ADA@NEW.EXAMPLE.COM ' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.user.email).toBe('ada@new.example.com');
  });
});
