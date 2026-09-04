import type { AuthUser } from '../common/auth-user.js';
import type { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { EventsService } from './events.service.js';
import type { EventsRepository, EventRow } from './events.repository.js';

const asUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 10,
  email: 'ada@example.com',
  is_admin: false,
  is_class_admin: false,
  ...over,
});

const scopeAlways = (allowed: boolean) =>
  ({ canManageEvent: async () => allowed }) as unknown as ClassScopeService;

function serviceWith(
  repo: Partial<EventsRepository>,
  scope: ClassScopeService = scopeAlways(true),
) {
  return new EventsService(repo as EventsRepository, scope);
}

/** Fixed, not `new Date()`: two calls a millisecond apart made this flaky. */
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

const row = (over: Partial<EventRow> = {}): EventRow =>
  ({
    id: 1,
    class_id: 1,
    school_id: 1,
    title: 'Reunion Dinner',
    description: null,
    event_date: '2030-06-15',
    event_time: '18:00:00',
    location: 'The Old Hall',
    created_at: FIXED_DATE,
    updated_at: FIXED_DATE,
    timezone: 'America/Chicago',
    ...over,
  }) as EventRow;

describe('EventsService.getEvent', () => {
  it('404s for an unknown event', async () => {
    const service = serviceWith({ findEvent: async () => undefined });

    await expectRejection(service.getEvent('9999'), 404, 'Event not found.');
  });

  it('has no class check — any authenticated caller may read one', async () => {
    const service = serviceWith({ findEvent: async () => row() }, scopeAlways(false));

    await expect(service.getEvent('1')).resolves.toEqual({ event: row() });
  });
});

describe('EventsService date splitting', () => {
  it('splits an ISO timestamp into separate date and time columns', async () => {
    let seen: Record<string, unknown> | null = null;
    const service = serviceWith({
      findEventClass: async () => ({ id: 1, class_id: 1 }),
      updateEvent: async (_id, update) => {
        seen = update;
        return row();
      },
    });

    await service.updateEvent(
      '1',
      { event_date: '2031-07-04T20:30:00.000Z' },
      asUser({ is_admin: true }),
    );

    expect(seen).toMatchObject({
      eventDate: '2031-07-04',
      eventTime: '20:30:00',
    });
  });

  it('passes nulls when no date is sent, so COALESCE keeps the old values', async () => {
    let seen: Record<string, unknown> | null = null;
    const service = serviceWith({
      findEventClass: async () => ({ id: 1, class_id: 1 }),
      updateEvent: async (_id, update) => {
        seen = update;
        return row();
      },
    });

    await service.updateEvent('1', { title: 'New name' }, asUser({ is_admin: true }));

    expect(seen).toMatchObject({ eventDate: null, eventTime: null });
  });

  /**
   * `new Date('nonsense').toISOString()` throws, and the handler's catch turns
   * that into a 500. Preserved rather than made a 400 — see the service.
   */
  it('500s on an unparseable date rather than 400ing', async () => {
    const service = serviceWith({
      findEventClass: async () => ({ id: 1, class_id: 1 }),
    });

    await expectRejection(
      service.updateEvent(
        '1',
        { event_date: 'not-a-date' },
        asUser({ is_admin: true }),
      ),
      500,
      'Internal server error.',
    );
  });
});

describe('EventsService authorization', () => {
  it('reports 404 before 403 for an unknown event', async () => {
    const service = serviceWith(
      { findEventClass: async () => undefined },
      scopeAlways(false),
    );

    await expectRejection(
      service.updateEvent('9999', { title: 'x' }, asUser()),
      404,
      'Event not found.',
    );
  });

  it('403s an update without standing over the class', async () => {
    const service = serviceWith(
      { findEventClass: async () => ({ id: 1, class_id: 1 }) },
      scopeAlways(false),
    );

    await expectRejection(
      service.updateEvent('1', { title: 'x' }, asUser()),
      403,
      'Access denied. You can only manage events for your class.',
    );
  });

  it('403s a delete without standing over the class', async () => {
    const service = serviceWith(
      { findEventClass: async () => ({ id: 1, class_id: 1 }) },
      scopeAlways(false),
    );

    await expectRejection(
      service.deleteEvent('1', asUser()),
      403,
      'Access denied. You can only manage events for your class.',
    );
  });

  it('scopes the check on the event’s class, not one supplied by the caller', async () => {
    let checkedClass: string | null = null;
    const scope = {
      canManageEvent: async (_u: AuthUser, classId: string) => {
        checkedClass = classId;
        return true;
      },
    } as unknown as ClassScopeService;

    const service = serviceWith(
      {
        findEventClass: async () => ({ id: 1, class_id: 7 }),
        deleteEvent: async () => {},
      },
      scope,
    );

    await service.deleteEvent('1', asUser());

    expect(checkedClass).toBe('7');
  });

  it('deletes and reports the source message', async () => {
    const service = serviceWith({
      findEventClass: async () => ({ id: 1, class_id: 1 }),
      deleteEvent: async () => {},
    });

    await expect(service.deleteEvent('1', asUser())).resolves.toEqual({
      message: 'Event deleted successfully.',
    });
  });
});
