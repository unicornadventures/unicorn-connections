import { Injectable } from '@nestjs/common';
import type { Profile, User } from '@classyear/shared-types';
import { DatabaseService } from '../database/database.service.js';

/**
 * The joined user+profile row every `/api/users` response is built from.
 * `then_photo_url` and `now_photo_url` are S3 **keys** here; the service
 * resolves them to presigned URLs before they reach the client.
 */
export interface UserWithProfileRow
  extends Pick<User, 'id' | 'email' | 'is_admin' | 'is_class_admin'>,
    Pick<
      Profile,
      | 'first_name'
      | 'last_name'
      | 'nickname'
      | 'former_first_name'
      | 'former_last_name'
      | 'bio'
      | 'then_photo_url'
      | 'now_photo_url'
      | 'avatar_color'
    > {
  /** jsonb; null when the profile row is missing entirely (LEFT JOIN). */
  tags: string[] | null;
}

export interface UserClassRow {
  id: number;
  year: number;
  school_id: number | null;
  school_name: string | null;
  location: string | null;
}

export interface DirectoryListRow {
  id: number;
  email: string | null;
  created_at: Date;
  first_name: string | null;
  last_name: string | null;
}

export interface ProfileUpdate {
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  former_first_name?: string | null;
  former_last_name?: string | null;
  bio?: string | null;
  tags?: string[] | null;
}

/**
 * SQL for `/api/users`, copied from `lambda/users.ts` rather than rewritten.
 *
 * The column list in `selectUserWithProfile` is repeated by the source in both
 * the read and the write handler; it is one method here because the two must
 * agree — an update that returned a different column set than the fetch would
 * be a contract break no type checker would catch.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findUserWithProfile(
    userId: string,
  ): Promise<UserWithProfileRow | undefined> {
    const result = await this.db.query<UserWithProfileRow>(
      `SELECT u.id, u.email, u.is_admin, u.is_class_admin,
              p.first_name, p.last_name, p.nickname, p.former_first_name, p.former_last_name,
              p.bio, p.then_photo_url, p.now_photo_url, p.avatar_color, p.tags
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [userId],
    );
    return result.rows[0];
  }

  /**
   * The user's class membership, with the school it was at. `LIMIT 1` is the
   * source's: a user can be in several classes, and this endpoint answers with
   * whichever the planner returns first. Preserved rather than made
   * deterministic, because "their class" is what every caller means and adding
   * an ORDER BY would change which row some user sees.
   */
  async findUserClass(userId: string): Promise<UserClassRow | undefined> {
    const result = await this.db.query<UserClassRow>(
      `SELECT c.id, c.year, cu.school_id, s.name as school_name, s.location
       FROM class_user cu
       JOIN classes c ON cu.class_id = c.id
       LEFT JOIN schools s ON cu.school_id = s.id
       WHERE cu.user_id = $1
       LIMIT 1`,
      [userId],
    );
    return result.rows[0];
  }

  async countUsers(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users',
    );
    return parseInt(result.rows[0].count, 10);
  }

  async listUsers(
    limit: number,
    offset: number,
  ): Promise<DirectoryListRow[]> {
    const result = await this.db.query<DirectoryListRow>(
      `SELECT u.id, u.email, u.created_at, p.first_name, p.last_name
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return result.rows;
  }

  /** Is this email already taken by someone other than `userId`? */
  async isEmailTaken(email: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId],
    );
    return result.rows.length > 0;
  }

  async updateEmail(userId: string, email: string): Promise<void> {
    await this.db.query('UPDATE users SET email = $1 WHERE id = $2', [
      email,
      userId,
    ]);
  }

  /**
   * COALESCE means an omitted field keeps its current value, so a partial body
   * is a partial update. It also means a field can never be *cleared* through
   * this path — passing null is indistinguishable from omitting it. That is the
   * source's behaviour; `avatar_color` is the one field that needed clearing,
   * which is why it has its own method below.
   */
  async updateProfile(userId: string, update: ProfileUpdate): Promise<void> {
    await this.db.query(
      `UPDATE profiles SET
         first_name        = COALESCE($1, first_name),
         last_name         = COALESCE($2, last_name),
         nickname          = COALESCE($3, nickname),
         former_first_name = COALESCE($4, former_first_name),
         former_last_name  = COALESCE($5, former_last_name),
         bio               = COALESCE($6, bio),
         tags              = COALESCE($8, tags)
       WHERE user_id = $7`,
      [
        update.first_name,
        update.last_name,
        update.nickname,
        update.former_first_name,
        update.former_last_name,
        update.bio,
        userId,
        update.tags !== undefined ? JSON.stringify(update.tags) : null,
      ],
    );
  }

  /** Separate because null here means "reset to no colour", not "unchanged". */
  async updateAvatarColor(
    userId: string,
    avatarColor: string | null,
  ): Promise<void> {
    await this.db.query(
      'UPDATE profiles SET avatar_color = $1 WHERE user_id = $2',
      [avatarColor, userId],
    );
  }
}
