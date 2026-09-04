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
