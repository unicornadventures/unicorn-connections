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
}
