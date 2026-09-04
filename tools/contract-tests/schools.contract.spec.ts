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
