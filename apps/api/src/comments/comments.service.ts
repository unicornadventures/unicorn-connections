import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import { rethrowAsInternal } from '../common/http-errors.js';
import { CommentsRepository } from './comments.repository.js';
import type { UpdateCommentDto } from './dto/comment.dto.js';

/**
 * `/api/comments` and `/api/users/:userId/comments`, ported from
 * `lambda/comments.ts`.
 *
 * Comments are unpublished when written and become visible once the profile
 * owner or a moderator approves them, so almost every method here is really an
 * authorization question. Those questions live in `ClassScopeService`.
 */
@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly repo: CommentsRepository,
    private readonly scope: ClassScopeService,
  ) {}

  /**
   * The commenter is always the authenticated user — the frontend also sends a
   * `commenterId` in the body, and the deployed handler ignores it. Worth
   * stating explicitly: honouring it would let anyone post as anyone.
   */
  async createComment(
    targetUserId: string,
    content: string | undefined,
    authUser: AuthUser,
  ) {
    try {
      if (!targetUserId || !content) {
        throw new BadRequestException({ error: 'Missing required fields.' });
      }

      const [targetExists, commenterExists] = await Promise.all([
        this.repo.userExists(targetUserId),
        this.repo.userExists(authUser.id),
      ]);

      if (!targetExists || !commenterExists) {
        throw new NotFoundException({ error: 'User not found.' });
      }

      const comment = await this.repo.insertComment(
        targetUserId,
        authUser.id,
        content,
      );

      return { comment };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async getComments(targetUserId: string) {
    try {
      return { comments: await this.repo.listPublishedFor(targetUserId) };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Every comment on a profile that the requester is allowed to act on.
   *
   * Filtered **per comment**, not per profile, because a class admin's reach
   * depends on who wrote each one: they see comments by their own classmates
   * and not the rest, on the same profile, in the same response. That is why
   * this is a loop over `canModerateComments` rather than one query — the
   * source does the same, and the N+1 is the price of the rule.
   *
   * A requester with no standing gets `{ comments: [] }` rather than a 403,
   * which is also the source's behaviour.
   */
  async getPendingComments(targetUserId: string, authUser: AuthUser) {
    try {
      const targetUserIdNum = parseInt(String(targetUserId));
      const comments = await this.repo.listAllFor(targetUserIdNum);

      const authorized = [];
      for (const comment of comments) {
        if (
          await this.scope.canModerateComments(
            authUser.id,
            comment.commenter_id,
            targetUserIdNum,
          )
        ) {
          authorized.push(comment);
        }
      }

      return { comments: authorized };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async getMyComments(commenterId: string, authUser: AuthUser) {
    try {
      if (authUser.id !== parseInt(commenterId, 10) && !authUser.is_admin) {
        throw new ForbiddenException({
          error: 'You can only view your own comments.',
        });
      }

      return { comments: await this.repo.listByCommenter(commenterId) };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * The whole moderation queue in one query, so the client does not fetch
   * per-profile pending comments in a loop.
   *
   * Roles come from the **token** here, unlike `getPendingComments` above which
   * goes through `ClassScopeService` and re-reads them. Both are the source's;
   * see that service for why the inconsistency is preserved.
   */
  async getAllPendingComments(authUser: AuthUser) {
    try {
      if (authUser.is_admin) {
        return { comments: await this.repo.listAllPending() };
      }

      if (authUser.is_class_admin) {
        return {
          comments: await this.repo.listPendingForClassAdmin(authUser.id),
        };
      }

      throw new ForbiddenException({
        error: 'Not authorized to moderate comments.',
      });
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Publish/unpublish, edit, or — if you send both — neither.
   *
   * Sending `content` **and** `published` together produces
   * `SET content = $1, published = false, published = $2`, which Postgres
   * rejects outright ("multiple assignments to same column"), so the request
   * 500s. That is preserved bug-for-bug: it is what the deployed handler does,
   * a contract test pins it, and the fix belongs in §9 with a decision attached
   * rather than smuggled in here. Nothing in the frontend sends both.
   */
  async updateComment(
    commentId: string,
    body: UpdateCommentDto,
    authUser: AuthUser,
  ) {
    try {
      const { content, published } = body;

      if (content === undefined && published === undefined) {
        throw new BadRequestException({
          error: 'At least one of content or published is required.',
        });
      }

      const comment = await this.repo.findOwnership(commentId);
      if (!comment) {
        throw new NotFoundException({ error: 'Comment not found.' });
      }

      // Moderating and editing are different rights: anyone with standing over
      // the comment can publish it, but only its author can change the words.
      if (published !== undefined) {
        const allowed = await this.scope.canModerateComments(
          authUser.id,
          comment.commenter_id,
          comment.target_user_id,
        );
        if (!allowed) {
          throw new ForbiddenException({
            error: 'Not authorized to moderate this comment.',
          });
        }
      }

      if (content !== undefined && authUser.id !== comment.commenter_id) {
        throw new ForbiddenException({
          error: 'You can only edit your own comments.',
        });
      }

      const updated = await this.repo.updateComment(commentId, {
        content,
        published,
      });
      if (!updated) {
        throw new NotFoundException({ error: 'Comment not found.' });
      }

      return { comment: updated };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /** Your own comment, or one you have standing to moderate. */
  async deleteComment(commentId: string, authUser: AuthUser) {
    try {
      const comment = await this.repo.findOwnership(commentId);
      if (!comment) {
        throw new NotFoundException({ error: 'Comment not found.' });
      }

      const allowed =
        authUser.id === comment.commenter_id ||
        (await this.scope.canModerateComments(
          authUser.id,
          comment.commenter_id,
          comment.target_user_id,
        ));

      if (!allowed) {
        throw new ForbiddenException({
          error: 'Not authorized to delete this comment.',
        });
      }

      await this.repo.deleteComment(commentId);

      return { message: 'Comment deleted successfully.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
