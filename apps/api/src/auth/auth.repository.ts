import { Injectable } from '@nestjs/common';
import type { Profile, User } from '@classyear/shared-types';
import { DatabaseService } from '../database/database.service.js';

/** The columns login selects — deliberately not `SELECT *`. */
export type LoginCandidate = Pick<
  User,
  'id' | 'email' | 'password' | 'is_admin' | 'is_class_admin'
>;

export interface ClaimMatch {
  id: number;
  first_name: string | null;
  last_name: string | null;
  maiden_name: string | null;
  class_year: number | null;
  school_name: string | null;
}

/**
 * All auth SQL, kept character-for-character as the deployed handlers wrote it.
 * Divergence here is invisible until it produces a different row set, so the
 * queries are copied rather than rewritten.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly db: DatabaseService) {}

  async findLoginCandidate(email: string): Promise<LoginCandidate | undefined> {
    const result = await this.db.query<LoginCandidate>(
      'SELECT id, email, password, is_admin, is_class_admin FROM users WHERE email = $1',
      [email],
    );
    return result.rows[0];
  }

  async findProfile(userId: number): Promise<Profile | null> {
    const result = await this.db.query<Profile>(
      'SELECT * FROM profiles WHERE user_id = $1',
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async findNameOnlyProfile(
    userId: number,
  ): Promise<Pick<Profile, 'first_name' | 'last_name'> | null> {
    const result = await this.db.query<
      Pick<Profile, 'first_name' | 'last_name'>
    >('SELECT first_name, last_name FROM profiles WHERE user_id = $1', [userId]);
    return result.rows[0] ?? null;
  }

  async findSchool(schoolId: number) {
    const result = await this.db.query(
      'SELECT id, name, location FROM schools WHERE id = $1',
      [schoolId],
    );
    return result.rows[0] ?? null;
  }

  /** Only returns the class when it is actually linked to that school. */
  async findClassInSchool(classId: number, schoolId: number) {
    const result = await this.db.query(
      `SELECT c.id, c.year FROM classes c
       JOIN class_school cs ON c.id = cs.class_id
       WHERE c.id = $1 AND cs.school_id = $2`,
      [classId, schoolId],
    );
    return result.rows[0] ?? null;
  }

  async findUserIdByEmail(email: string): Promise<number | undefined> {
    const result = await this.db.query<Pick<User, 'id'>>(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    return result.rows[0]?.id;
  }

  async deletePasswordResetTokens(userId: number): Promise<void> {
    await this.db.query(
      'DELETE FROM password_reset_tokens WHERE user_id = $1',
      [userId],
    );
  }

  async insertPasswordResetToken(
    userId: number,
    tokenHash: string,
    expiresAt: string,
  ): Promise<void> {
    await this.db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt],
    );
  }

  /**
   * Looked up **by hash**, which is the point. The Express version selected the
   * most recent unexpired token globally and then compared — see docs §14.
   */
  async findUserIdByResetTokenHash(
    tokenHash: string,
  ): Promise<number | undefined> {
    const result = await this.db.query<{ user_id: number }>(
      'SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash],
    );
    return result.rows[0]?.user_id;
  }

  async updatePassword(userId: number, hashedPassword: string): Promise<void> {
    await this.db.query('UPDATE users SET password = $1 WHERE id = $2', [
      hashedPassword,
      userId,
    ]);
  }

  async findUserIdByVerificationTokenHash(
    tokenHash: string,
  ): Promise<number | undefined> {
    const result = await this.db.query<{ user_id: number }>(
      `SELECT user_id FROM email_verification_tokens
       WHERE token_hash = $1 AND expires_at > NOW() AND verified = FALSE`,
      [tokenHash],
    );
    return result.rows[0]?.user_id;
  }

  async markEmailVerified(userId: number): Promise<void> {
    await this.db.query(
      'UPDATE users SET email_verified = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [userId],
    );
    await this.db.query(
      'UPDATE email_verification_tokens SET verified = TRUE WHERE user_id = $1',
      [userId],
    );
  }

  /** Unclaimed (email IS NULL), living roster entries in one class. */
  async searchClaimable(
    firstName: string,
    lastName: string,
    classId: number,
  ): Promise<ClaimMatch[]> {
    const result = await this.db.query<ClaimMatch>(
      `
      SELECT u.id, p.first_name, p.last_name, p.former_last_name AS maiden_name,
             c.year AS class_year, s.name AS school_name
      FROM users u
      JOIN profiles p ON u.id = p.user_id
      JOIN class_user cu ON u.id = cu.user_id
      JOIN classes c ON cu.class_id = c.id
      LEFT JOIN class_school cs ON c.id = cs.class_id
      LEFT JOIN schools s ON cs.school_id = s.id
      WHERE u.email IS NULL
        AND u.is_deceased = FALSE
        AND cu.class_id = $3
        AND p.first_name ILIKE $1
        AND (p.last_name ILIKE $2 OR p.former_last_name ILIKE $2)
      ORDER BY p.last_name, p.first_name
    `,
      [firstName, lastName, classId],
    );
    return result.rows;
  }

  async findUnclaimedUser(userId: number): Promise<number | undefined> {
    const result = await this.db.query<Pick<User, 'id'>>(
      'SELECT id FROM users WHERE id = $1 AND email IS NULL',
      [userId],
    );
    return result.rows[0]?.id;
  }

  async claimAccount(
    userId: number,
    email: string,
    hashedPassword: string,
  ): Promise<Pick<User, 'id' | 'email' | 'is_admin' | 'is_class_admin'>> {
    const result = await this.db.query<
      Pick<User, 'id' | 'email' | 'is_admin' | 'is_class_admin'>
    >(
      'UPDATE users SET email = $1, password = $2 WHERE id = $3 RETURNING id, email, is_admin, is_class_admin',
      [email, hashedPassword, userId],
    );
    return result.rows[0];
  }
}
