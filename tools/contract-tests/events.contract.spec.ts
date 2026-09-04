import type { INestApplication } from '@nestjs/common';
import { FIXTURE, authAs, closeFixturePool } from './src/fixtures.js';
import { compare, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 3 parity gate for the four deployed event endpoints.
 *
 * `POST /api/admin/schools/:schoolId/classes/:classId/events` is deployed under
 * `/api/admin` and is covered in phase 5. The two Express-only routes
 * (`/class/:classId/events`, `/class/:classId/days-until-next`) are not ported;
 * see docs §9.4.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/events.ts`
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

describe('GET /api/schools/:schoolId/classes/:classId/events', () => {
  it('matches, chronologically', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listEventsHandler, {
      method: 'get',
      path: `/api/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}/events`,
      pathParameters: {
        schoolId: String(FIXTURE.school.id),
        classId: String(FIXTURE.class.id),
      },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.events.map((e: any) => e.title)).toEqual([
      FIXTURE.reunionEvent.title,
      FIXTURE.picnicEvent.title,
    ]);
  });

  /**
   * `event_date` must come back as the literal 'YYYY-MM-DD' the query's
   * `to_char` produces. If it were handed to the driver as a DATE it would
   * become a JS Date in the server's zone and shift a day for anyone west of
   * UTC — which is exactly the bug the `to_char` exists to prevent.
   */
  it('returns event_date as a plain date string, not a timestamp', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listEventsHandler, {
      method: 'get',
      path: `/api/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}/events`,
      pathParameters: {
        schoolId: String(FIXTURE.school.id),
        classId: String(FIXTURE.class.id),
      },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.events[0].event_date).toBe(FIXTURE.reunionEvent.date);
    expect((a as any).body.events[0].event_time).toBe(FIXTURE.reunionEvent.time);
  });

  it('joins the school timezone', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listEventsHandler, {
      method: 'get',
      path: `/api/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}/events`,
      pathParameters: {
        schoolId: String(FIXTURE.school.id),
        classId: String(FIXTURE.class.id),
      },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.events[0].timezone).toBe(FIXTURE.school.timezone);
  });

  it('matches for a class with no events', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listEventsHandler, {
      method: 'get',
      path: `/api/schools/${FIXTURE.school.id}/classes/${FIXTURE.otherClass.id}/events`,
      pathParameters: {
        schoolId: String(FIXTURE.school.id),
        classId: String(FIXTURE.otherClass.id),
      },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 200, body: { events: [] } });
  });

  it('matches with no token', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.listEventsHandler, {
      method: 'get',
      path: `/api/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}/events`,
      pathParameters: {
        schoolId: String(FIXTURE.school.id),
        classId: String(FIXTURE.class.id),
      },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });
});

describe('GET /api/events/:eventId', () => {
  it('matches for an existing event', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getEventHandler, {
      method: 'get',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.event.title).toBe(FIXTURE.reunionEvent.title);
  });

  /**
   * No class check — any authenticated user can read any event by id, even one
   * belonging to a class they are not in. Deployed behaviour; docs §9.2.
   */
  it('lets a non-member read an event by id', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getEventHandler, {
      method: 'get',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: authAs(FIXTURE.outsiderUser),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('matches for an unknown event', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getEventHandler, {
      method: 'get',
      path: '/api/events/9999',
      pathParameters: { eventId: '9999' },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Event not found.' } });
  });
});

describe('PUT /api/events/:eventId', () => {
  it('lets a super admin edit any event', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asAdmin(),
      body: { title: 'Reunion Brunch' },
    });

    expect(b).toEqual(a);
    expect((a as any).body.event.title).toBe('Reunion Brunch');
  });

  it('keeps omitted fields, via COALESCE', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asAdmin(),
      body: { title: 'Reunion Brunch' },
    });

    expect(b).toEqual(a);
    expect((a as any).body.event.location).toBe(FIXTURE.reunionEvent.location);
    expect((a as any).body.event.event_date).toBe(FIXTURE.reunionEvent.date);
  });

  it('splits an ISO event_date across the date and time columns', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asAdmin(),
      body: { event_date: '2031-07-04T20:30:00.000Z' },
    });

    expect(b).toEqual(a);
    expect((a as any).body.event.event_date).toBe('2031-07-04');
    expect((a as any).body.event.event_time).toBe('20:30:00');
  });

  /**
   * The PUT response has no `timezone` — the UPDATE does not join `schools`,
   * unlike every read query. One field narrower than the GET for the same
   * event; the source's asymmetry, pinned so it cannot drift.
   */
  it('omits timezone from the update response', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asAdmin(),
      body: { title: 'Reunion Brunch' },
    });

    expect(b).toEqual(a);
    expect((a as any).body.event).not.toHaveProperty('timezone');
  });

  it('refuses an ordinary member of the class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asActive(),
      body: { title: 'Hijacked' },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: {
        error: 'Access denied. You can only manage events for your class.',
      },
    });
  });

  it('refuses a class admin from a different class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asClassAdmin(),
      body: { title: 'Wrong class' },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });

  it('reports 404 before 403 for an unknown event', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: '/api/events/9999',
      pathParameters: { eventId: '9999' },
      headers: asActive(),
      body: { title: 'Nowhere' },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Event not found.' } });
  });

  it('500s identically on an unparseable event_date', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.updateEventHandler, {
      method: 'put',
      path: `/api/events/${FIXTURE.reunionEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.reunionEvent.id) },
      headers: asAdmin(),
      body: { event_date: 'not-a-date' },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 500,
      body: { error: 'Internal server error.' },
    });
  });
});

describe('DELETE /api/events/:eventId', () => {
  it('lets a super admin delete an event', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteEventHandler, {
      method: 'delete',
      path: `/api/events/${FIXTURE.picnicEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.picnicEvent.id) },
      headers: asAdmin(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'Event deleted successfully.' },
    });
  });

  it('refuses an ordinary member', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteEventHandler, {
      method: 'delete',
      path: `/api/events/${FIXTURE.picnicEvent.id}`,
      pathParameters: { eventId: String(FIXTURE.picnicEvent.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });

  it('matches for an unknown event', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deleteEventHandler, {
      method: 'delete',
      path: '/api/events/9999',
      pathParameters: { eventId: '9999' },
      headers: asAdmin(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Event not found.' } });
  });
});

// ---- phase 5: POST /api/admin/schools/:schoolId/classes/:classId/events -----

describe('POST /api/admin/schools/:schoolId/classes/:classId/events', () => {
  const path = `/api/admin/schools/${FIXTURE.school.id}/classes/${FIXTURE.class.id}/events`;
  const pathParameters = {
    schoolId: String(FIXTURE.school.id),
    classId: String(FIXTURE.class.id),
  };

  it('creates an event', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createEventHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: {
        title: 'Homecoming',
        event_date: '2031-09-20T19:00:00.000Z',
        location: 'The Field',
        description: 'Bring a dish.',
      },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
    expect((a as any).body.event).toMatchObject({
      title: 'Homecoming',
      event_date: '2031-09-20',
      event_time: '19:00:00',
    });
  });

  /**
   * The only admin route a class admin can reach — it is guarded by
   * `canManageEvent`, not by an `is_admin` check.
   */
  it('lets a class admin create for their own class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createEventHandler, {
      method: 'post',
      path: `/api/admin/schools/${FIXTURE.school.id}/classes/${FIXTURE.otherClass.id}/events`,
      pathParameters: {
        schoolId: String(FIXTURE.school.id),
        classId: String(FIXTURE.otherClass.id),
      },
      headers: asClassAdmin(),
      body: {
        title: 'Class of 95 Meetup',
        event_date: '2031-05-01T18:00:00.000Z',
        location: 'The Diner',
      },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
  });

  it('refuses a class admin for a class they are not in', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createEventHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asClassAdmin(),
      body: {
        title: 'Wrong class',
        event_date: '2031-05-01T18:00:00.000Z',
        location: 'Nowhere',
      },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: {
        error: 'Access denied. You can only manage events for your class.',
      },
    });
  });

  it('refuses an ordinary member of the class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createEventHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asActive(),
      body: {
        title: 'Unauthorised',
        event_date: '2031-05-01T18:00:00.000Z',
        location: 'Nowhere',
      },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });

  /**
   * Validation runs *before* authorization here, the opposite of update and
   * delete. A member with no rights and an incomplete body gets the 400.
   */
  it('reports missing fields before checking authorization', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createEventHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asActive(),
      body: { title: 'No date' },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'schoolId, classId, title, and event_date are required.' },
    });
  });

  it('404s when the class is not linked to that school', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createEventHandler, {
      method: 'post',
      path: `/api/admin/schools/${FIXTURE.emptySchool.id}/classes/${FIXTURE.class.id}/events`,
      pathParameters: {
        schoolId: String(FIXTURE.emptySchool.id),
        classId: String(FIXTURE.class.id),
      },
      headers: asAdmin(),
      body: {
        title: 'Orphan',
        event_date: '2031-05-01T18:00:00.000Z',
        location: 'Nowhere',
      },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 404,
      body: { error: 'Class is not linked to this school.' },
    });
  });

  /**
   * `location` is optional on the wire but NOT NULL in the schema, so omitting
   * it fails the INSERT and 500s. Preserved bug-for-bug; docs §18.
   */
  it('500s identically when location is omitted', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.createEventHandler, {
      method: 'post',
      path,
      pathParameters,
      headers: asAdmin(),
      body: { title: 'No location', event_date: '2031-05-01T18:00:00.000Z' },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 500,
      body: { error: 'Internal server error.' },
    });
  });
});
