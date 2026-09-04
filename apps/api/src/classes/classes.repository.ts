import { Injectable } from '@nestjs/common';
import type { ClassEntity } from '@classyear/shared-types';
import { DatabaseService } from '../database/database.service.js';

export type ClassYear = Pick<ClassEntity, 'id' | 'year'>;

/** A class year as it appears in a school's class list, with its headcount. */
export interface SchoolClassRow extends ClassYear {
  member_count: number;
}

export interface ClassDetailRow extends ClassYear {
  school_id: number | null;
  school_name: string | null;
  created_at: Date;
}

export interface ClassMemberRow {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** The richer row the directory page renders; photo fields are S3 keys. */
export interface DirectoryEntryRow {
  id: number;
  email: string | null;
  is_deceased: boolean;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  former_first_name: string | null;
  former_last_name: string | null;
  now_photo_url: string | null;
  then_photo_url: string | null;
  avatar_color: string | null;
  tags: string[] | null;
}

@Injectable()
export class ClassesRepository {
  constructor(private readonly db: DatabaseService) {}

  async listAllClasses(): Promise<ClassYear[]> {
    const result = await this.db.query<ClassYear>(
      'SELECT id, year FROM classes ORDER BY year DESC;',
    );
    return result.rows;
  }

  async findClass(classId: string): Promise<ClassDetailRow | undefined> {
    const result = await this.db.query<ClassDetailRow>(
      `SELECT c.id, c.year, cs.school_id, s.name AS school_name, c.created_at
       FROM classes c
       LEFT JOIN class_school cs ON c.id = cs.class_id
       LEFT JOIN schools s ON cs.school_id = s.id
       WHERE c.id = $1
       LIMIT 1;`,
      [classId],
    );
    return result.rows[0];
  }

  /**
   * `LIMIT 1` on a LEFT JOIN that can match several schools: a class year
   * linked to two schools reports whichever the planner returns. The source
   * does this, and the frontend uses the result to look up "the" school for a
   * class, so a class shared across schools already misreports today.
   */
  async listSchoolClasses(schoolId: string): Promise<SchoolClassRow[]> {
    const result = await this.db.query<SchoolClassRow>(
      `SELECT c.id, c.year, COUNT(cu.user_id)::int AS member_count
       FROM classes c
       JOIN class_school cs ON c.id = cs.class_id
       LEFT JOIN class_user cu ON c.id = cu.class_id AND cu.school_id = cs.school_id
       WHERE cs.school_id = $1
       GROUP BY c.id, c.year
       ORDER BY c.year DESC;`,
      [schoolId],
    );
    return result.rows;
  }

  async isYearLinkedToSchool(
    schoolId: string,
    year: number,
  ): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM class_school cs
       JOIN classes c ON cs.class_id = c.id
       WHERE cs.school_id = $1 AND c.year = $2`,
      [schoolId, year],
    );
    return result.rows.length > 0;
  }

  async hasAnyLinkedClass(schoolId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT 1 FROM class_school WHERE school_id = $1 LIMIT 1',
      [schoolId],
    );
    return result.rows.length > 0;
  }

  async findClassIdByYear(year: number): Promise<number | undefined> {
    const result = await this.db.query<{ id: number }>(
      'SELECT id FROM classes WHERE year = $1',
      [year],
    );
    return result.rows[0]?.id;
  }

  async linkClassToSchool(classId: number, schoolId: string): Promise<void> {
    await this.db.query(
      'INSERT INTO class_school (class_id, school_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [classId, schoolId],
    );
  }

  async isClassMember(userId: number, classId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT class_id FROM class_user WHERE user_id = $1 AND class_id = $2',
      [userId, classId],
    );
    return result.rows.length > 0;
  }

  async listMembers(classId: string): Promise<ClassMemberRow[]> {
    const result = await this.db.query<ClassMemberRow>(
      `SELECT u.id, u.email, p.first_name, p.last_name
       FROM class_user cu
       JOIN users u ON cu.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE cu.class_id = $1
       ORDER BY p.last_name ASC, p.first_name ASC;`,
      [classId],
    );
    return result.rows;
  }

  /**
   * Sorted by maiden name where one exists — an alumni directory is looked up
   * under the name people graduated with, not the one they have now.
   */
  async listDirectory(classId: string): Promise<DirectoryEntryRow[]> {
    const result = await this.db.query<DirectoryEntryRow>(
      `SELECT
         u.id,
         u.email,
         u.is_deceased,
         p.first_name,
         p.last_name,
         p.nickname,
         p.former_first_name,
         p.former_last_name,
         p.now_photo_url,
         p.then_photo_url,
         p.avatar_color,
         p.tags
       FROM class_user cu
       JOIN users u ON cu.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE cu.class_id = $1
       ORDER BY COALESCE(p.former_last_name, p.last_name) ASC, COALESCE(p.former_first_name, p.first_name) ASC;`,
      [classId],
    );
    return result.rows;
  }

  async listMemberProfilePhotoKeys(
    classId: string,
  ): Promise<
    { user_id: number; then_photo_url: string | null; now_photo_url: string | null }[]
  > {
    const result = await this.db.query<{
      user_id: number;
      then_photo_url: string | null;
      now_photo_url: string | null;
    }>(
      `SELECT u.id AS user_id, p.then_photo_url, p.now_photo_url
       FROM class_user cu
       JOIN users u ON cu.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE cu.class_id = $1`,
      [classId],
    );
    return result.rows;
  }

  // ---- admin ---------------------------------------------------------------

  async schoolExists(schoolId: string): Promise<boolean> {
    const result = await this.db.query('SELECT id FROM schools WHERE id = $1', [
      schoolId,
    ]);
    return result.rows.length > 0;
  }

  async findClassByYear(
    year: number,
  ): Promise<{ id: number; year: number } | undefined> {
    const result = await this.db.query<{ id: number; year: number }>(
      'SELECT id, year FROM classes WHERE year = $1',
      [year],
    );
    return result.rows[0];
  }

  async isLinked(classId: string, schoolId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT 1 FROM class_school WHERE class_id = $1 AND school_id = $2',
      [classId, schoolId],
    );
    return result.rows.length > 0;
  }

  /** Plain INSERT, no ON CONFLICT — the caller has already checked for a link. */
  async linkClass(classId: number, schoolId: string): Promise<void> {
    await this.db.query(
      'INSERT INTO class_school (class_id, school_id) VALUES ($1, $2)',
      [classId, schoolId],
    );
  }

  async findClassesInYearRange(
    startYear: number,
    endYear: number,
  ): Promise<{ id: number; year: number }[]> {
    const result = await this.db.query<{ id: number; year: number }>(
      'SELECT id, year FROM classes WHERE year >= $1 AND year <= $2 ORDER BY year DESC;',
      [startYear, endYear],
    );
    return result.rows;
  }

  async findUserIdsInClassAtSchool(
    classId: string,
    schoolId: string,
  ): Promise<number[]> {
    const result = await this.db.query<{ id: number }>(
      `SELECT u.id FROM class_user cu JOIN users u ON cu.user_id = u.id
       WHERE cu.class_id = $1 AND cu.school_id = $2`,
      [classId, schoolId],
    );
    return result.rows.map((row) => row.id);
  }

  async deleteUsers(userIds: number[]): Promise<void> {
    await this.db.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
  }

  /** Removes memberships but leaves the users themselves. */
  async deleteClassMemberships(
    classId: string,
    schoolId: string,
  ): Promise<void> {
    await this.db.query(
      'DELETE FROM class_user WHERE class_id = $1 AND school_id = $2',
      [classId, schoolId],
    );
  }

  async unlinkClass(classId: string, schoolId: string): Promise<void> {
    await this.db.query(
      'DELETE FROM class_school WHERE class_id = $1 AND school_id = $2',
      [classId, schoolId],
    );
  }

  async listMemberGalleryKeys(
    classId: string,
  ): Promise<{ user_id: number; s3_key: string }[]> {
    const result = await this.db.query<{ user_id: number; s3_key: string }>(
      `SELECT gp.user_id, gp.s3_key
       FROM gallery_photos gp
       JOIN class_user cu ON gp.user_id = cu.user_id
       WHERE cu.class_id = $1`,
      [classId],
    );
    return result.rows;
  }
}
