import { Injectable } from '@nestjs/common';
import type { School } from '@classyear/shared-types';
import { DatabaseService } from '../database/database.service.js';

/**
 * The columns the deployed handlers select — notably **not** `updated_at`,
 * even though the table has one. `SELECT *` would add it to every response and
 * quietly widen the contract, which is why the list is written out.
 */
export type SchoolSummary = Pick<
  School,
  'id' | 'name' | 'location' | 'timezone' | 'created_at'
>;

@Injectable()
export class SchoolsRepository {
  constructor(private readonly db: DatabaseService) {}

  async listSchools(): Promise<SchoolSummary[]> {
    const result = await this.db.query<SchoolSummary>(`
      SELECT id, name, location, timezone, created_at
      FROM schools
      ORDER BY name ASC;
    `);
    return result.rows;
  }

  async findSchool(schoolId: string): Promise<SchoolSummary | undefined> {
    const result = await this.db.query<SchoolSummary>(
      'SELECT id, name, location, timezone, created_at FROM schools WHERE id = $1',
      [schoolId],
    );
    return result.rows[0];
  }

  async createSchool(
    name: string,
    location: string | null,
    timezone: string | null,
  ): Promise<SchoolSummary> {
    const result = await this.db.query<SchoolSummary>(
      'INSERT INTO schools (name, location, timezone) VALUES ($1, $2, $3) RETURNING id, name, location, timezone, created_at',
      [name, location, timezone],
    );
    return result.rows[0];
  }

  /**
   * Returns `updated_at` as well as the usual columns — the only place it
   * reaches a client. Every other query omits it, so the update response is one
   * field wider than the fetch. The source's asymmetry, kept.
   */
  async updateSchool(
    schoolId: string,
    name: string,
    location: string | null,
    timezone: string | null,
  ): Promise<(SchoolSummary & { updated_at: Date }) | undefined> {
    const result = await this.db.query<SchoolSummary & { updated_at: Date }>(
      'UPDATE schools SET name = $1, location = $2, timezone = $3, updated_at = NOW() WHERE id = $4 RETURNING id, name, location, timezone, created_at, updated_at',
      [name, location, timezone, schoolId],
    );
    return result.rows[0];
  }

  /** Every user who has a membership at this school, deduplicated. */
  async findUserIdsAtSchool(schoolId: string): Promise<number[]> {
    const result = await this.db.query<{ id: number }>(
      `SELECT DISTINCT u.id FROM class_user cu JOIN users u ON cu.user_id = u.id WHERE cu.school_id = $1`,
      [schoolId],
    );
    return result.rows.map((row) => row.id);
  }

  async deleteUsers(userIds: number[]): Promise<void> {
    await this.db.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }

  /** Cascades to classes → class_user and events. */
  async deleteSchool(schoolId: string): Promise<void> {
    await this.db.query('DELETE FROM schools WHERE id = $1', [schoolId]);
  }
}
