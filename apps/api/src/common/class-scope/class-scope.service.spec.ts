import type { QueryResult } from 'pg';
import type { DatabaseService } from '../../database/database.service.js';
import type { AuthUser } from '../auth-user.js';
import { ClassScopeService } from './class-scope.service.js';

/**
 * The moderation matrix, exhaustively. The contract suite proves these rules
 * agree with the deployed handler on the fixture's five users; this proves the
 * rules themselves, including combinations the fixture does not contain.
 */

type Row = Record<string, unknown>;

/**
 * Stubs `DatabaseService.query` by matching on a distinctive fragment of each
 * statement. Matching on SQL text is normally a smell — the phase-1 notes call
 * out the source's own tests for exactly that — but here the *shape* of the
 * queries is the thing under test: which lookup happens, and whether it happens
 * at all.
 */
function dbWith(responses: { match: string; rows: Row[] }[]): DatabaseService {
  const seen: string[] = [];
  const db = {
    query: async (text: string): Promise<QueryResult<Row>> => {
      seen.push(text);
      const hit = responses.find((r) => text.includes(r.match));
      return { rows: hit?.rows ?? [] } as QueryResult<Row>;
    },
    seen,
  };
  return db as unknown as DatabaseService & { seen: string[] };
}

const queriesOf = (db: DatabaseService) =>
  (db as unknown as { seen: string[] }).seen;

const USER_LOOKUP = 'SELECT is_admin, is_class_admin FROM users';
const SHARED_CLASS = 'SELECT cu1.class_id';
const MEMBERSHIP = 'SELECT id FROM class_user';

describe('ClassScopeService.canModerateComments', () => {
  it('lets the profile owner moderate without any lookup', async () => {
    const db = dbWith([]);
    const scope = new ClassScopeService(db);

    expect(await scope.canModerateComments(10, 13, 10)).toBe(true);
    // Short-circuits before touching the database at all.
    expect(queriesOf(db)).toEqual([]);
  });

  it('lets a super admin moderate anyone', async () => {
    const db = dbWith([
      { match: USER_LOOKUP, rows: [{ is_admin: true, is_class_admin: false }] },
    ]);
    const scope = new ClassScopeService(db);

    expect(await scope.canModerateComments(12, 13, 10)).toBe(true);
  });

  it('lets a class admin moderate a classmate’s comment', async () => {
    const db = dbWith([
      { match: USER_LOOKUP, rows: [{ is_admin: false, is_class_admin: true }] },
      { match: SHARED_CLASS, rows: [{ class_id: 2 }] },
    ]);
    const scope = new ClassScopeService(db);

    expect(await scope.canModerateComments(14, 13, 10)).toBe(true);
  });

  it('refuses a class admin when the commenter is in no shared class', async () => {
    const db = dbWith([
      { match: USER_LOOKUP, rows: [{ is_admin: false, is_class_admin: true }] },
      { match: SHARED_CLASS, rows: [] },
    ]);
    const scope = new ClassScopeService(db);

    expect(await scope.canModerateComments(14, 10, 13)).toBe(false);
  });

  it('refuses an ordinary user, without checking classes', async () => {
    const db = dbWith([
      { match: USER_LOOKUP, rows: [{ is_admin: false, is_class_admin: false }] },
    ]);
    const scope = new ClassScopeService(db);

    expect(await scope.canModerateComments(13, 10, 12)).toBe(false);
    expect(queriesOf(db).some((q) => q.includes(SHARED_CLASS))).toBe(false);
  });

  it('refuses a requester who no longer exists', async () => {
    const db = dbWith([{ match: USER_LOOKUP, rows: [] }]);
    const scope = new ClassScopeService(db);

    expect(await scope.canModerateComments(999, 10, 13)).toBe(false);
  });

  /**
   * The scope is on the **commenter**, not the profile owner — a class admin
   * moderates what their classmates wrote, wherever they wrote it. Asserting on
   * the parameters is the only way to catch the two being swapped, since both
   * are numbers in the same position.
   */
  it('scopes the shared-class lookup on the commenter', async () => {
    const captured: unknown[][] = [];
    const db = {
      query: async (text: string, params: unknown[]) => {
        captured.push(params);
        return {
          rows: text.includes(USER_LOOKUP)
            ? [{ is_admin: false, is_class_admin: true }]
            : [],
        };
      },
    } as unknown as DatabaseService;

    await new ClassScopeService(db).canModerateComments(14, 13, 10);

    // [requesterId, commenterId] — the target user is absent by design.
    expect(captured[1]).toEqual([14, 13]);
  });
});

describe('ClassScopeService.canManageEvent', () => {
  const user = (over: Partial<AuthUser> = {}): AuthUser => ({
    id: 10,
    email: 'a@b.com',
    is_admin: false,
    is_class_admin: false,
    ...over,
  });

  it('lets a super admin manage any class, without a lookup', async () => {
    const db = dbWith([]);
    const scope = new ClassScopeService(db);

    expect(await scope.canManageEvent(user({ is_admin: true }), '1')).toBe(true);
    expect(queriesOf(db)).toEqual([]);
  });

  it('refuses an ordinary user before any lookup', async () => {
    const db = dbWith([]);
    const scope = new ClassScopeService(db);

    expect(await scope.canManageEvent(user(), '1')).toBe(false);
    expect(queriesOf(db)).toEqual([]);
  });

  it('lets a class admin manage a class they belong to', async () => {
    const db = dbWith([{ match: MEMBERSHIP, rows: [{ id: 1 }] }]);
    const scope = new ClassScopeService(db);

    expect(await scope.canManageEvent(user({ is_class_admin: true }), '2')).toBe(
      true,
    );
  });

  it('refuses a class admin for a class they do not belong to', async () => {
    const db = dbWith([{ match: MEMBERSHIP, rows: [] }]);
    const scope = new ClassScopeService(db);

    expect(await scope.canManageEvent(user({ is_class_admin: true }), '1')).toBe(
      false,
    );
  });

  /**
   * This check trusts the token's claims while `canModerateComments` re-reads
   * them from the database. The inconsistency is the source's and is preserved
   * deliberately — see the service's class comment. This test exists so that
   * "fixing" one of them fails loudly rather than silently changing who can do
   * what for up to a token lifetime.
   */
  it('trusts the token rather than re-reading the user row', async () => {
    const db = dbWith([
      // Would say "not an admin" if it were consulted. It must not be.
      { match: USER_LOOKUP, rows: [{ is_admin: false, is_class_admin: false }] },
    ]);
    const scope = new ClassScopeService(db);

    expect(await scope.canManageEvent(user({ is_admin: true }), '1')).toBe(true);
    expect(queriesOf(db).some((q) => q.includes(USER_LOOKUP))).toBe(false);
  });
});
