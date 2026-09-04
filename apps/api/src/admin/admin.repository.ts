import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

export interface AdminUserRow {
  id: number;
  email: string | null;
  is_admin: boolean;
  is_class_admin: boolean;
  created_at: Date;
  first_name: string | null;
  last_name: string | null;
}

export interface ClassRosterRow {
  id: number;
  email: string | null;
  is_deceased: boolean;
  first_name: string | null;
  last_name: string | null;
  former_first_name: string | null;
  former_last_name: string | null;
}

export interface NewRosterEntry {
  email?: string | null;
  first_name?: string;
  last_name?: string;
  original_first_name?: string | null;
  original_last_name?: string | null;
  is_deceased?: boolean;
}

@Injectable()
export class AdminRepository {
  constructor(private readonly db: DatabaseService) {}

  async listAllUsers(): Promise<AdminUserRow[]> {
    const result = await this.db.query<AdminUserRow>(`
      SELECT
        u.id,
        u.email,
        u.is_admin,
        u.is_class_admin,
        u.created_at,
        p.first_name,
        p.last_name
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      ORDER BY u.created_at DESC;
    `);
    return result.rows;
  }

  async userExists(userId: number | string): Promise<boolean> {
    const result = await this.db.query('SELECT id FROM users WHERE id = $1', [
      userId,
    ]);
    return result.rows.length > 0;
  }

  async findUserEmail(
    userId: string,
  ): Promise<{ id: number; email: string | null } | undefined> {
    const result = await this.db.query<{ id: number; email: string | null }>(
      'SELECT id, email FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0];
  }

  async findUserIdByEmail(email: string): Promise<number | undefined> {
    const result = await this.db.query<{ id: number }>(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    return result.rows[0]?.id;
  }

  /**
   * The class roster, filtered and paginated.
   *
   * The `lastName` filter is a prefix match (`ILIKE 'smi%'`), not a contains
   * match — an admin scrolling an alphabetical roster is jumping to a letter,
   * not searching. Built dynamically because the parameter positions shift when
   * the filter is absent.
   */
  async countClassUsers(classId: string, lastName: string): Promise<number> {
    const { where, params } = this.rosterFilter(classId, lastName);
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM class_user cu
       JOIN users u ON cu.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE ${where}`,
      params,
    );
    return parseInt(result.rows[0].count, 10);
  }

  async listClassUsers(
    classId: string,
    lastName: string,
    pageSize: number,
    offset: number,
  ): Promise<ClassRosterRow[]> {
    const { where, params } = this.rosterFilter(classId, lastName);
    const result = await this.db.query<ClassRosterRow>(
      `SELECT u.id, u.email, u.is_deceased, p.first_name, p.last_name, p.former_first_name, p.former_last_name
       FROM class_user cu
       JOIN users u ON cu.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE ${where}
       ORDER BY p.last_name ASC, p.first_name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return result.rows;
  }

  private rosterFilter(classId: string, lastName: string) {
    const params: unknown[] = [classId];
    let where = 'cu.class_id = $1';

    if (lastName) {
      where += ` AND p.last_name ILIKE $${params.length + 1}`;
      params.push(`${lastName}%`);
    }

    return { where, params };
  }

  async setClassAdmin(
    userId: number,
    isClassAdmin: boolean,
  ): Promise<AdminUserRow | undefined> {
    const result = await this.db.query<AdminUserRow>(
      'UPDATE users SET is_class_admin = $1 WHERE id = $2 RETURNING id, email, is_admin, is_class_admin',
      [isClassAdmin, userId],
    );
    return result.rows[0];
  }

  async findProfilePhotoKeys(
    userId: number,
  ): Promise<{ then_photo_url: string | null; now_photo_url: string | null } | undefined> {
    const result = await this.db.query<{
      then_photo_url: string | null;
      now_photo_url: string | null;
    }>('SELECT then_photo_url, now_photo_url FROM profiles WHERE user_id = $1', [
      userId,
    ]);
    return result.rows[0];
  }

  /** Cascades to profile, comments, class_user and tokens via FK constraints. */
  async deleteUser(userId: number): Promise<void> {
    await this.db.query('DELETE FROM users WHERE id = $1', [userId]);
  }

  async setDeceasedAndNames(
    userId: number,
    isDeceased: boolean,
    names: {
      first_name: string;
      last_name: string;
      former_first_name: string | null;
      former_last_name: string | null;
    },
  ): Promise<{ id: number; email: string | null; is_deceased: boolean }> {
    const updated = await this.db.query<{
      id: number;
      email: string | null;
      is_deceased: boolean;
    }>(
      'UPDATE users SET is_deceased = $1 WHERE id = $2 RETURNING id, email, is_deceased',
      [isDeceased, userId],
    );
    await this.db.query(
      'UPDATE profiles SET first_name = $1, last_name = $2, former_first_name = $3, former_last_name = $4 WHERE user_id = $5',
      [
        names.first_name,
        names.last_name,
        names.former_first_name,
        names.former_last_name,
        userId,
      ],
    );
    return updated.rows[0];
  }

  /**
   * Creates the user, their profile, and their class membership.
   *
   * Not wrapped in a transaction, matching the source: a failure partway leaves
   * a user with no profile or no class. Reproduced rather than fixed because
   * the import path below depends on per-row failures being survivable — a
   * transaction there would roll back the whole batch on one bad row, which is
   * the opposite of what `{ created, skipped }` promises.
   */
  async createRosterUser(
    entry: NewRosterEntry,
    hashedPassword: string | null,
    classId: string,
    schoolId: string,
  ): Promise<{ id: number; email: string | null; is_deceased: boolean }> {
    const userResult = await this.db.query<{
      id: number;
      email: string | null;
      is_deceased: boolean;
    }>(
      'INSERT INTO users (email, password, is_deceased) VALUES ($1, $2, $3) RETURNING id, email, is_deceased',
      [entry.email ?? null, hashedPassword, entry.is_deceased ?? false],
    );
    const user = userResult.rows[0];

    await this.db.query(
      `INSERT INTO profiles (user_id, first_name, last_name, former_first_name, former_last_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id,
        entry.first_name!.trim(),
        entry.last_name!.trim(),
        entry.original_first_name?.trim() || null,
        entry.original_last_name?.trim() || null,
      ],
    );

    await this.db.query(
      'INSERT INTO class_user (class_id, user_id, school_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [classId, user.id, schoolId],
    );

    return user;
  }

  async findClassInSchool(
    classId: string,
    schoolId: string,
  ): Promise<{ id: number; year: number } | undefined> {
    const result = await this.db.query<{ id: number; year: number }>(
      `SELECT c.id, c.year FROM classes c
       JOIN class_school cs ON c.id = cs.class_id
       WHERE c.id = $1 AND cs.school_id = $2`,
      [classId, schoolId],
    );
    return result.rows[0];
  }

  async classExists(classId: number): Promise<boolean> {
    const result = await this.db.query('SELECT id FROM classes WHERE id = $1', [
      classId,
    ]);
    return result.rows.length > 0;
  }

  async findCurrentClassId(userId: number): Promise<number | undefined> {
    const result = await this.db.query<{ class_id: number }>(
      'SELECT class_id FROM class_user WHERE user_id = $1',
      [userId],
    );
    return result.rows[0]?.class_id;
  }

  /**
   * Moves a user by clearing every membership and inserting one.
   *
   * Note the INSERT supplies no `school_id`, so a moved user's membership loses
   * the school context that `createRosterUser` sets. That is the source's, and
   * it means `GET /api/users/:id/class` reports a null school for anyone who
   * has been moved. Left alone; flagged in docs §18.
   */
  async moveUserToClass(userId: number, classId: number): Promise<void> {
    await this.db.query('DELETE FROM class_user WHERE user_id = $1', [userId]);
    await this.db.query(
      'INSERT INTO class_user (class_id, user_id) VALUES ($1, $2)',
      [classId, userId],
    );
  }

  async deletePasswordResetTokens(userId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [userId],
    );
  }

  async insertPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt],
    );
  }
}
