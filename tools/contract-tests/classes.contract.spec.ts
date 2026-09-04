import type { INestApplication } from '@nestjs/common';
import { FIXTURE, authAs, closeFixturePool } from './src/fixtures.js';
import { compare, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 2 parity gate for `/api/classes` and `GET /api/schools/:id/classes`.
 *
 * The link/bulk-link/unlink handlers in the same source file are deployed under
 * `/api/admin/schools/…` and are covered in phase 5. The Express-only
 * `/alumni-count` and `/message-count` routes are not ported; see docs §9.4.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/classes.ts`
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

describe('GET /api/classes', () => {
  it('matches, newest year first', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listAllClassesHandler,
      { method: 'get', path: '/api/classes', headers: asActive() },
    );

    expect(b).toEqual(a);
    expect((a as any).body.classes[0].year).toBe(FIXTURE.currentClass.year);
  });

  it('matches with no token', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listAllClassesHandler,
      { method: 'get', path: '/api/classes' },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });
});

describe('GET /api/classes/:classId', () => {
  it('matches for an existing class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getClassHandler, {
      method: 'get',
      path: `/api/classes/${FIXTURE.class.id}`,
      pathParameters: { classId: String(FIXTURE.class.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.class).toMatchObject({
      year: FIXTURE.class.year,
      school_name: FIXTURE.school.name,
    });
  });

  it('matches for a class linked to no school', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getClassHandler, {
      method: 'get',
      path: `/api/classes/${FIXTURE.currentClass.id}`,
      pathParameters: { classId: String(FIXTURE.currentClass.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.class.school_id).toBeNull();
  });

  it('matches for an unknown class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getClassHandler, {
      method: 'get',
      path: '/api/classes/9999',
      pathParameters: { classId: '9999' },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Class not found.' } });
  });
});

describe('GET /api/schools/:schoolId/classes', () => {
  /**
   * The interesting one. The fixture seeds the current year as an unlinked
   * class, so both implementations must notice it is missing, link it (because
   * the school already has 1994 and 1995), and then include it in the result.
   */
  it('matches, auto-linking the current year on the way past', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listClassesHandler,
      {
        method: 'get',
        path: `/api/schools/${FIXTURE.school.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.classes.map((c: any) => c.year)).toEqual([
      FIXTURE.currentClass.year,
      FIXTURE.otherClass.year,
      FIXTURE.class.year,
    ]);
  });

  it('matches member counts per class', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listClassesHandler,
      {
        method: 'get',
        path: `/api/schools/${FIXTURE.school.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
      },
    );

    expect(b).toEqual(a);
    const byYear = Object.fromEntries(
      (a as any).body.classes.map((c: any) => [c.year, c.member_count]),
    );
    expect(byYear[FIXTURE.class.year]).toBe(2);
    // outsiderUser and classAdminUser.
    expect(byYear[FIXTURE.otherClass.year]).toBe(2);
  });

  it('does not auto-link for a school with no classes configured', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listClassesHandler,
      {
        method: 'get',
        path: `/api/schools/${FIXTURE.emptySchool.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.emptySchool.id) },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 200, body: { classes: [] } });
  });

  /**
   * An unknown school is an empty list, not a 404 — the Express route checked
   * the school existed, the deployed one does not, and deployed wins (§14).
   */
  it('matches for an unknown school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listClassesHandler,
      {
        method: 'get',
        path: '/api/schools/9999/classes',
        pathParameters: { schoolId: '9999' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 200, body: { classes: [] } });
  });
});

describe('GET /api/classes/:classId/members', () => {
  it('matches for any authenticated caller, member or not', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassMembersHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/members`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        // Deliberately an outsider: this endpoint has no membership check.
        headers: authAs(FIXTURE.outsiderUser),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.members).toHaveLength(2);
  });
});

describe('GET /api/classes/:classId/directory', () => {
  it('matches for a member, photo keys resolved to URLs', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassDirectoryHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/directory`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    const ada = (a as any).body.users.find(
      (u: any) => u.id === FIXTURE.activeUser.id,
    );
    expect(ada.now_photo_url).toContain(FIXTURE.activeUser.now_photo_url);
  });

  it('matches sorting by maiden name where one exists', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassDirectoryHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/directory`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    // Hopper sorts under Murray, so Lovelace comes first.
    expect((a as any).body.users.map((u: any) => u.last_name)).toEqual([
      FIXTURE.activeUser.last_name,
      FIXTURE.unclaimedUser.last_name,
    ]);
  });

  it('matches when a non-member asks', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassDirectoryHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/directory`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        headers: authAs(FIXTURE.outsiderUser),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Access denied. You are not in this class.' },
    });
  });

  it('matches for an admin who is in no class at all', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassDirectoryHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/directory`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  /**
   * Identity comes from the token, never the query string. A non-member passing
   * a member's id must still be refused — this is the hole the Express route
   * had and the deployed handler does not (docs §14).
   */
  it('ignores a spoofed ?userId=', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassDirectoryHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/directory`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        query: { userId: String(FIXTURE.activeUser.id) },
        headers: authAs(FIXTURE.outsiderUser),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });
});

describe('GET /api/classes/:classId/photos', () => {
  it('matches for a member — then, now, and gallery flattened', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassPhotosHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/photos`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    // Ada's then + now + one gallery upload; nobody else has photos.
    expect((a as any).body.photos).toHaveLength(3);
  });

  it('matches when a non-member asks', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassPhotosHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.class.id}/photos`,
        pathParameters: { classId: String(FIXTURE.class.id) },
        headers: authAs(FIXTURE.outsiderUser),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Access denied. You are not in this class.' },
    });
  });

  it('matches for a class whose members have no photos', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getClassPhotosHandler,
      {
        method: 'get',
        path: `/api/classes/${FIXTURE.otherClass.id}/photos`,
        pathParameters: { classId: String(FIXTURE.otherClass.id) },
        headers: authAs(FIXTURE.outsiderUser),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 200, body: { photos: [] } });
  });
});

// ---- phase 5: /api/admin/schools/:schoolId/classes --------------------------

describe('POST /api/admin/schools/:schoolId/classes', () => {
  /** The body carries a *year*, not a class id — classes are global rows. */
  it('links an existing class year to a school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createClassHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.emptySchool.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.emptySchool.id) },
        headers: asAdmin(),
        body: { year: FIXTURE.class.year },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 201,
      body: { class: { id: FIXTURE.class.id, year: FIXTURE.class.year } },
    });
  });

  it('409s when the year is already linked', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createClassHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: { year: FIXTURE.class.year },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 409,
      body: {
        error: `Class year ${FIXTURE.class.year} is already linked to this school.`,
      },
    });
  });

  it('404s for a year with no class row', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createClassHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: { year: 1066 },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 404,
      body: { error: 'Class year 1066 not found.' },
    });
  });

  it('404s for an unknown school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createClassHandler,
      {
        method: 'post',
        path: '/api/admin/schools/9999/classes',
        pathParameters: { schoolId: '9999' },
        headers: asAdmin(),
        body: { year: FIXTURE.class.year },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'School not found.' } });
  });

  it('matches on a missing year', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createClassHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: {},
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'School ID and year are required.' },
    });
  });

  it('refuses a class admin', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createClassHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.emptySchool.id}/classes`,
        pathParameters: { schoolId: String(FIXTURE.emptySchool.id) },
        headers: asClassAdmin(),
        body: { year: FIXTURE.class.year },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });
});

describe('POST /api/admin/schools/:schoolId/classes/bulk', () => {
  it('links every year from startYear to now, and returns the full list', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.bulkLinkClassesHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.emptySchool.id}/classes/bulk`,
        pathParameters: { schoolId: String(FIXTURE.emptySchool.id) },
        headers: asAdmin(),
        body: { startYear: FIXTURE.class.year },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
    // The fixture seeds 1994, 1995 and the current year; all three are in range.
    expect((a as any).body.classes.map((c: any) => c.year)).toEqual([
      FIXTURE.currentClass.year,
      FIXTURE.otherClass.year,
      FIXTURE.class.year,
    ]);
  });

  /** ON CONFLICT DO NOTHING, so re-running links only the gap. */
  it('is idempotent against an already-linked school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.bulkLinkClassesHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes/bulk`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: { startYear: FIXTURE.class.year },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
  });

  it('rejects a startYear before 1950', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.bulkLinkClassesHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes/bulk`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: { startYear: 1949 },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(400);
    expect((a as any).body.error).toContain('startYear must be between 1950');
  });

  it('rejects a startYear in the future', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.bulkLinkClassesHandler,
      {
        method: 'post',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes/bulk`,
        pathParameters: { schoolId: String(FIXTURE.school.id) },
        headers: asAdmin(),
        body: { startYear: new Date().getFullYear() + 1 },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(400);
  });
});

describe('DELETE /api/admin/schools/:schoolId/classes/:classId', () => {
  it('unlinks without deleting the members by default', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteClassHandler,
      {
        method: 'delete',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}`,
        pathParameters: {
          schoolId: String(FIXTURE.school.id),
          classId: String(FIXTURE.class.id),
        },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'Class unlinked from school successfully.' },
    });
  });

  it('deletes the members too with ?cascadeUsers=true', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteClassHandler,
      {
        method: 'delete',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}`,
        pathParameters: {
          schoolId: String(FIXTURE.school.id),
          classId: String(FIXTURE.class.id),
        },
        query: { cascadeUsers: 'true' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  /** Only the exact literal is destructive — not `1`, not `TRUE`. */
  it('treats any other cascadeUsers value as false', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteClassHandler,
      {
        method: 'delete',
        path: `/api/admin/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}`,
        pathParameters: {
          schoolId: String(FIXTURE.school.id),
          classId: String(FIXTURE.class.id),
        },
        query: { cascadeUsers: 'TRUE' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('404s when the class is not linked to that school', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteClassHandler,
      {
        method: 'delete',
        path: `/api/admin/schools/${FIXTURE.emptySchool.id}/classes/${FIXTURE.class.id}`,
        pathParameters: {
          schoolId: String(FIXTURE.emptySchool.id),
          classId: String(FIXTURE.class.id),
        },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 404,
      body: { error: 'Class is not linked to this school.' },
    });
  });
});
