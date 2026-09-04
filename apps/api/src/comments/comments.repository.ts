import { Injectable } from '@nestjs/common';
import type { Comment } from '@classyear/shared-types';
import { DatabaseService } from '../database/database.service.js';

/** A comment plus the commenter's name, as the profile page renders it. */
export interface CommentWithCommenter extends Comment {
  commenter_first_name: string | null;
  commenter_last_name: string | null;
}

/** A comment plus the *target's* name, as the "my comments" page renders it. */
export interface CommentWithTarget extends Comment {
  target_first_name: string | null;
  target_last_name: string | null;
}

/** The moderation queue shows both ends, so it selects both name pairs. */
export interface CommentWithBothNames
  extends CommentWithCommenter,
    CommentWithTarget {}

/** Just enough to decide who may act on a comment. */
export type CommentOwnership = Pick<
  Comment,
  'id' | 'target_user_id' | 'commenter_id'
>;

/**
 * The column list `c.id, c.target_user_id, … c.updated_at` is repeated verbatim
 * by five of the source's seven handlers. It is one constant here because the
 * five must agree — the frontend renders the same comment object from all of
 * them, and a column added to one and not the others is a bug that only shows
 * up on whichever page happened to use the other query.
 */
const COMMENT_COLUMNS = `c.id, c.target_user_id, c.commenter_id, c.content, c.published, c.created_at, c.updated_at`;

@Injectable()
export class CommentsRepository {
  constructor(private readonly db: DatabaseService) {}

  async userExists(userId: string | number): Promise<boolean> {
    const result = await this.db.query('SELECT id FROM users WHERE id = $1', [
      userId,
    ]);
    return result.rows.length > 0;
  }

  async insertComment(
    targetUserId: string,
    commenterId: number,
    content: string,
  ): Promise<Comment> {
    // Always unpublished: every comment waits for the profile owner or a
    // moderator, which is the whole premise of the pending queue below.
    const result = await this.db.query<Comment>(
      `INSERT INTO comments (target_user_id, commenter_id, content, published)
       VALUES ($1, $2, $3, false)
       RETURNING id, target_user_id, commenter_id, content, published, created_at, updated_at;`,
      [targetUserId, commenterId, content],
    );
    return result.rows[0];
  }

  /** Published comments only — this is the public view of a profile. */
  async listPublishedFor(
    targetUserId: string,
  ): Promise<CommentWithCommenter[]> {
    const result = await this.db.query<CommentWithCommenter>(
      `SELECT ${COMMENT_COLUMNS},
              p.first_name AS commenter_first_name, p.last_name AS commenter_last_name
       FROM comments c
       LEFT JOIN profiles p ON c.commenter_id = p.user_id
       WHERE c.target_user_id = $1 AND c.published = true
       ORDER BY c.created_at DESC;`,
      [targetUserId],
    );
    return result.rows;
  }

  /**
   * *All* comments on a profile, published and not, unpublished first. The
   * service filters this down per-comment; see CommentsService.
   */
  async listAllFor(targetUserId: number): Promise<CommentWithCommenter[]> {
    const result = await this.db.query<CommentWithCommenter>(
      `SELECT ${COMMENT_COLUMNS},
              p.first_name AS commenter_first_name, p.last_name AS commenter_last_name
       FROM comments c
       LEFT JOIN profiles p ON c.commenter_id = p.user_id
       WHERE c.target_user_id = $1
       ORDER BY c.published ASC, c.created_at DESC;`,
      [targetUserId],
    );
    return result.rows;
  }

  async listByCommenter(commenterId: string): Promise<CommentWithTarget[]> {
    const result = await this.db.query<CommentWithTarget>(
      `SELECT ${COMMENT_COLUMNS},
              tp.first_name AS target_first_name, tp.last_name AS target_last_name
       FROM comments c
       LEFT JOIN profiles tp ON c.target_user_id = tp.user_id
       WHERE c.commenter_id = $1
       ORDER BY c.created_at DESC;`,
      [commenterId],
    );
    return result.rows;
  }

  /** Every unpublished comment, for a super admin. */
  async listAllPending(): Promise<CommentWithBothNames[]> {
    const result = await this.db.query<CommentWithBothNames>(
      `SELECT ${COMMENT_COLUMNS},
              p.first_name AS commenter_first_name, p.last_name AS commenter_last_name,
              tp.first_name AS target_first_name, tp.last_name AS target_last_name
       FROM comments c
       LEFT JOIN profiles p ON c.commenter_id = p.user_id
       LEFT JOIN profiles tp ON c.target_user_id = tp.user_id
       WHERE c.published = false
       ORDER BY c.created_at DESC;`,
    );
    return result.rows;
  }

  /**
   * Unpublished comments written by anyone sharing a class with `classAdminId`.
   *
   * Scoped on the **commenter**, not the profile owner — the same rule
   * `ClassScopeService.canModerateComments` applies one comment at a time,
   * expressed as a single query so the queue does not need N round-trips.
   */
  async listPendingForClassAdmin(
    classAdminId: number,
  ): Promise<CommentWithBothNames[]> {
    const result = await this.db.query<CommentWithBothNames>(
      `SELECT ${COMMENT_COLUMNS},
              p.first_name AS commenter_first_name, p.last_name AS commenter_last_name,
              tp.first_name AS target_first_name, tp.last_name AS target_last_name
       FROM comments c
       LEFT JOIN profiles p ON c.commenter_id = p.user_id
       LEFT JOIN profiles tp ON c.target_user_id = tp.user_id
       WHERE c.published = false
         AND c.commenter_id IN (
           SELECT cu2.user_id FROM class_user cu2
           WHERE cu2.class_id IN (SELECT cu1.class_id FROM class_user cu1 WHERE cu1.user_id = $1)
         )
       ORDER BY c.created_at DESC;`,
      [classAdminId],
    );
    return result.rows;
  }

  async findOwnership(
    commentId: string,
  ): Promise<CommentOwnership | undefined> {
    const result = await this.db.query<CommentOwnership>(
      'SELECT id, target_user_id, commenter_id FROM comments WHERE id = $1',
      [commentId],
    );
    return result.rows[0];
  }

  /**
   * Built dynamically because content and published are independently optional,
   * and editing content carries its own side effect: the comment goes back to
   * unpublished.
   *
   * **`published` is assigned at most once.** The source appended it twice when
   * both fields were sent — once for the content side effect, once for the
   * explicit value — producing `SET content = $1, published = false,
   * published = $2`, which Postgres rejects as a duplicate assignment, so the
   * request always 500'd. That is §9.2 item 4, approved for fixing in §21.
   *
   * Where the two disagree, **the content side effect wins**: an edit always
   * unpublishes. Letting an explicit `published: true` through alongside new
   * content would let an author rewrite an approved comment and re-approve it
   * in the same request, which is precisely the moderation step the side effect
   * exists to enforce. So the fix is deliberately not "last write wins".
   */
  async updateComment(
    commentId: string,
    update: { content?: string; published?: boolean },
  ): Promise<Comment | undefined> {
    const fields: string[] = [];
    const params: unknown[] = [];
    let paramCount = 1;

    if (update.content !== undefined) {
      fields.push(`content = $${paramCount++}`);
      params.push(update.content);
    }

    if (update.content !== undefined) {
      // An edit returns the comment to moderation, whatever else was sent.
      fields.push('published = false');
    } else if (update.published !== undefined) {
      fields.push(`published = $${paramCount++}`);
      params.push(update.published);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(commentId);

    const result = await this.db.query<Comment>(
      `UPDATE comments
       SET ${fields.join(', ')}
       WHERE id = $${paramCount}
       RETURNING id, target_user_id, commenter_id, content, published, created_at, updated_at;`,
      params,
    );
    return result.rows[0];
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.db.query('DELETE FROM comments WHERE id = $1;', [commentId]);
  }
}
