import type { INestApplication } from '@nestjs/common';
import { FIXTURE, authAs, closeFixturePool } from './src/fixtures.js';
import { compare, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 2 parity gate for `/api/schools` reads.
 *
 * The write handlers in the same source file are deployed under
 * `/api/admin/schools` and are covered in phase 5.
 *
 * `POST /api/schools` — unauthenticated school creation, Express-only, never
 * deployed — is not ported and so is not tested; see docs §9.4.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/schools.ts`
  )) as unknown as Record<string, LegacyHandler>;

  app = await createNestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixturePool();
});

describe('GET /api/schools', () => {
  it('matches without a token — the list is deliberately public', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listSchoolsHandler,
      { method: 'get', path: '/api/schools' },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
    // Alphabetical by name, so Shelbyville precedes Springfield.
    expect((a as any).body.schools.map((s: any) => s.name)).toEqual([
      FIXTURE.emptySchool.name,
      FIXTURE.school.name,
    ]);
  });

  it('matches with a token too', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listSchoolsHandler,
      {
        method: 'get',
        path: '/api/schools',
        headers: authAs(FIXTURE.activeUser),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });
});

describe('GET /api/schools/:schoolId', () => {
  it('matches for an existing school', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getSchoolHandler, {
      method: 'get',
      path: `/api/schools/${FIXTURE.school.id}`,
      pathParameters: { schoolId: String(FIXTURE.school.id) },
      headers: authAs(FIXTURE.activeUser),
    });

    expect(b).toEqual(a);
    expect((a as any).body.school).toMatchObject({
      name: FIXTURE.school.name,
      timezone: FIXTURE.school.timezone,
    });
  });

  it('matches for an unknown school', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getSchoolHandler, {
      method: 'get',
      path: '/api/schools/9999',
      pathParameters: { schoolId: '9999' },
      headers: authAs(FIXTURE.activeUser),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'School not found.' } });
  });

  /**
   * The asymmetry that makes this endpoint worth pinning: the *list* is public
   * but a *single* school needs a token. Nothing is gained by it, but it is
   * deployed, so the port reproduces it (docs §9.2).
   */
  it('matches when unauthenticated — unlike the list, this one 401s', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getSchoolHandler, {
      method: 'get',
      path: `/api/schools/${FIXTURE.school.id}`,
      pathParameters: { schoolId: String(FIXTURE.school.id) },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });
});

// ---- phase 5: /api/admin/schools -------------------------------------------

const asAdmin = () => authAs({ ...FIXTURE.adminUser, is_admin: true });
const asClassAdmin = () =>
  authAs({ ...FIXTURE.classAdminUser, is_class_admin: true });

describe('POST /api/admin/schools', () => {
  it('creates a school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createSchoolHandler,
      {
        method: 'post',
        path: '/api/admin/schools',
        headers: asAdmin(),
        body: {
          name: 'Capitol High',
          location: 'Capitol City',
          timezone: 'America/New_York',
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
    expect((a as any).body.school).toMatchObject({
      name: 'Capitol High',
      timezone: 'America/New_York',
    });
  });

  it('defaults optional fields to null', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createSchoolHandler,
      {
        method: 'post',
        path: '/api/admin/schools',
        headers: asAdmin(),
        body: { name: 'Bare School' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.school).toMatchObject({
      location: null,
      timezone: null,
    });
  });

  it('matches on a missing name', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createSchoolHandler,
      {
        method: 'post',
        path: '/api/admin/schools',
        headers: asAdmin(),
        body: {},
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'School name is required.' },
    });
  });

  it('refuses a class admin', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createSchoolHandler,
      {
        method: 'post',
        path: '/api/admin/schools',
        headers: asClassAdmin(),
        body: { name: 'Nope' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Admin access required.' },
    });
  });
});

describe('PUT /api/admin/schools/:schoolId', () => {
  it('updates a school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateSchoolHandler,
      {
        method: 'put',
        path: `/api/admin/schools/${FIXTURE.school.id}`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: { name: 'Springfield Senior High', location: 'Springfield' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.school.name).toBe('Springfield Senior High');
  });

  /**
   * A full replace, not a patch: omitting `timezone` nulls it, unlike the
   * COALESCE updates elsewhere in the app. Worth pinning — it is the kind of
   * thing a well-meaning refactor would "fix" into a patch.
   */
  it('nulls omitted fields rather than keeping them', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateSchoolHandler,
      {
        method: 'put',
        path: `/api/admin/schools/${FIXTURE.school.id}`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: { name: 'Springfield High' },
      },
    );

    expect(b).toEqual(a);
    // The fixture seeds a timezone; sending only a name clears it.
    expect((a as any).body.school.timezone).toBeNull();
  });

  it('matches for an unknown school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateSchoolHandler,
      {
        method: 'put',
        path: '/api/admin/schools/9999',
        pathParameters: { schoolId: '9999' },
        headers: asAdmin(),
        body: { name: 'Ghost School' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'School not found.' } });
  });
});

describe('DELETE /api/admin/schools/:schoolId', () => {
  it('deletes the school, its users, and their photos', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteSchoolHandler,
      {
        method: 'delete',
        path: `/api/admin/schools/${FIXTURE.school.id}`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'School deleted successfully.' },
    });
  });

  it('matches for an unknown school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteSchoolHandler,
      {
        method: 'delete',
        path: '/api/admin/schools/9999',
        pathParameters: { schoolId: '9999' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'School not found.' } });
  });

  it('refuses a class admin', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteSchoolHandler,
      {
        method: 'delete',
        path: `/api/admin/schools/${FIXTURE.school.id}`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asClassAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });
});
