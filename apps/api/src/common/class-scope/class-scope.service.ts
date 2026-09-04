import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import type { AuthUser } from '../auth-user.js';

/**
 * The per-class authorization checks the source performs *inside* its handlers.
 *
 * Docs §3.2 originally planned these as route-level guards (`UserAdminGuard`,
 * `EventAdminGuard`); §14 deferred them once it was clear the deployed handlers
 * run them after argument parsing, against ids that are only known once the row
 * has been fetched — a comment's authorization depends on who wrote it and whose
 * profile it is on, neither of which a guard can see. So they are a service,
 * injected where needed, exactly as §14 predicted.
 *
 * **The two checks disagree about where roles come from, and that is faithful.**
 * `canModerateComments` re-reads `is_admin` / `is_class_admin` from the users
 * table; `canManageEvent` trusts the JWT claims. The practical difference: a
 * user promoted to admin can moderate comments immediately but cannot manage
 * events until their token is reissued, and a demoted one loses comment
 * moderation immediately while keeping event control for up to 24h. That is a
 * real inconsistency in the source. It is reproduced rather than harmonised
 * because harmonising it either adds a database read to event handling or
 * removes one from comment handling, and both are behaviour changes that belong
 * in §9 with a decision attached.
 */
@Injectable()
export class ClassScopeService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Can `requesterId` publish, unpublish or delete a comment written by
   * `commenterId` on `targetUserId`'s profile?
   *
   * Three ways to qualify, checked in the source's order:
   *   1. it is your own profile;
   *   2. you are a super admin;
   *   3. you are a class admin **and the commenter is in one of your classes**.
   *
   * Note (3) scopes on the *commenter*, not the profile owner — a class admin
   * moderates what their classmates wrote, wherever they wrote it.
   */
  async canModerateComments(
    requesterId: number,
    commenterId: number,
    targetUserId: number,
  ): Promise<boolean> {
    if (requesterId === targetUserId) return true;

    // Deliberately re-read rather than trusting the token; see the class comment.
    const userResult = await this.db.query<{
      is_admin: boolean;
      is_class_admin: boolean;
    }>('SELECT is_admin, is_class_admin FROM users WHERE id = $1', [
      requesterId,
    ]);

    const user = userResult.rows[0];
    if (!user) return false;
    if (user.is_admin) return true;

    if (user.is_class_admin) {
      const sameClass = await this.db.query(
        `SELECT cu1.class_id
         FROM class_user cu1
         WHERE cu1.user_id = $1
         AND cu1.class_id IN (
           SELECT cu2.class_id FROM class_user cu2 WHERE cu2.user_id = $2
         )`,
        [requesterId, commenterId],
      );
      return sameClass.rows.length > 0;
    }

    return false;
  }

  /**
   * Can this user upload or delete `targetUserId`'s then/now photos?
   *
   * Yourself, a super admin, or a class admin who shares a class with the
   * target. Note the shared-class subquery is on the *target*, unlike
   * `canModerateComments` where it is on the commenter — photos belong to the
   * person, comments to their author.
   *
   * Roles come from the token, like `canManageEvent` and unlike
   * `canModerateComments`. See the class comment.
   */
  async canManagePhotos(
    authUser: AuthUser,
    targetUserId: number,
  ): Promise<boolean> {
    if (authUser.id === targetUserId) return true;
    if (authUser.is_admin) return true;

    if (authUser.is_class_admin) {
      return this.sharesAClass(authUser.id, targetUserId);
    }

    return false;
  }

  /**
   * Can this user *see* `targetUserId`'s gallery?
   *
   * Broader than managing: **any** classmate can view, not only class admins.
   * That single missing `is_class_admin` check is the whole difference between
   * this and the method above, which is exactly why they are adjacent here
   * rather than one parameterised helper — the asymmetry should be readable.
   */
  async canViewPhotos(
    authUser: AuthUser,
    targetUserId: number,
  ): Promise<boolean> {
    if (authUser.id === targetUserId) return true;
    if (authUser.is_admin) return true;

    return this.sharesAClass(authUser.id, targetUserId);
  }

  /**
   * Can this user edit or delete `targetUserId`'s account — their name, their
   * deceased flag, or the row itself?
   *
   * Super admins anywhere; class admins only for someone in one of their
   * classes; nobody else. Roles come from the token.
   *
   * This is §3.2's `UserAdminGuard`, which §14 deferred and phase 5 built here
   * for the same reason as the others: it needs the target's id, which is a
   * route parameter the handler has already parsed and validated by the time
   * the question is worth asking.
   */
  async canManageUser(
    authUser: AuthUser,
    targetUserId: number,
  ): Promise<boolean> {
    if (authUser.is_admin) return true;
    if (!authUser.is_class_admin) return false;

    return this.sharesAClass(authUser.id, targetUserId);
  }

  /**
   * Do these two users have any class in common?
   *
   * The source writes this two ways — a self-join in `photos.ts`, an
   * `IN (SELECT …)` subquery in `comments.ts` and `admin.ts` — which are the
   * same existence question and return the same answer. One form here rather
   * than two, since the contract suite would catch any behavioural difference.
   */
  private async sharesAClass(
    userId: number,
    otherUserId: number,
  ): Promise<boolean> {
    const result = await this.db.query(
      `
      SELECT 1 FROM class_user cu1
      JOIN class_user cu2 ON cu1.class_id = cu2.class_id
      WHERE cu1.user_id = $1 AND cu2.user_id = $2
      LIMIT 1
    `,
      [userId, otherUserId],
    );
    return result.rows.length > 0;
  }

  /**
   * Can this user edit or delete events for `classId`?
   *
   * Super admins anywhere; class admins only for a class they belong to;
   * everyone else never. Roles come from the token here — see the class comment
   * for why this differs from the check above.
   */
  async canManageEvent(authUser: AuthUser, classId: string): Promise<boolean> {
    if (authUser.is_admin) return true;
    if (!authUser.is_class_admin) return false;

    const result = await this.db.query(
      'SELECT id FROM class_user WHERE user_id = $1 AND class_id = $2',
      [authUser.id, classId],
    );
    return result.rows.length > 0;
  }
}
