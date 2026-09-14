import { AdminRepository } from './admin.repository.js';
import type { DatabaseService } from '../database/database.service.js';

/**
 * known-bugs #10. Moving a user between classes used to INSERT into
 * `class_user` without a `school_id`, so the membership lost its school and
 * `GET /api/users/:id/class` reported null for anyone who had ever been moved.
 *
 * The fix is in SQL, and the only thing holding it was an `expectDivergence`
 * assertion in the contract suite, which compared against an application that
 * no longer exists. These assert the statements the repository issues.
 *
 * Asserting SQL text is usually a poor test. It earns its place here because
 * the defect *was* the SQL: a column absent from an INSERT, and a subquery that
 * has to read the target class's own link rather than the user's previous one.
 * Nothing above this layer can tell the difference.
 */
function repoRecording(statements: string[]): AdminRepository {
  const query = async (sql: string) => {
    statements.push(sql);
    return { rows: [], rowCount: 0 } as never;
  };

  const db = {
    query,
    // Run the callback inline, recording the statements it issues.
    withTransaction: async (fn: (q: typeof query) => Promise<unknown>) => {
      statements.push('BEGIN');
      const result = await fn(query);
      statements.push('COMMIT');
      return result;
    },
  } as unknown as DatabaseService;

  return new AdminRepository(db);
}

describe('AdminRepository.moveUserToClass', () => {
  const statementsFor = async () => {
    const statements: string[] = [];
    await repoRecording(statements).moveUserToClass(10, 7);
    return statements;
  };

  it('supplies school_id on the INSERT', async () => {
    const insert = (await statementsFor()).find((s) => s.includes('INSERT'))!;

    expect(insert).toMatch(/INSERT INTO class_user/);
    expect(insert).toMatch(/school_id/);
  });

  /**
   * From the *target* class's link. Carrying the school over from the user's
   * previous membership would leave a cross-school move at the old school.
   */
  it('takes the school from the target class, not the previous membership', async () => {
    const insert = (await statementsFor()).find((s) => s.includes('INSERT'))!;

    expect(insert).toMatch(/SELECT school_id FROM class_school WHERE class_id/);
    expect(insert).not.toMatch(/FROM class_user/);
  });

  /** The delete and the insert must not be able to strand a user with no class. */
  it('runs the delete and insert in one transaction', async () => {
    const statements = await statementsFor();

    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.filter((s) => s.includes('DELETE FROM class_user'))).toHaveLength(1);
    expect(
      statements.indexOf(statements.find((s) => s.includes('DELETE'))!),
    ).toBeLessThan(
      statements.indexOf(statements.find((s) => s.includes('INSERT'))!),
    );
  });
});
