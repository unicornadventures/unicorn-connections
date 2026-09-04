import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommentsService } from './comments.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';
import type { CreateCommentDto } from './dto/comment.dto.js';

/**
 * The comments that hang off a profile, at `/api/users/:userId/comments`.
 *
 * This is the second mount of the source's single `commentRoutes` router
 * (docs §5.3). It shares `CommentsService` with `CommentsController` — one
 * implementation, two prefixes, which is the shape the source had by accident
 * and this port has on purpose.
 *
 * **Ordering.** `CommentsModule` is imported *after* `UsersModule` in
 * AppModule. Both own routes under `/api/users`, and the paths here are all
 * two segments deeper than `UsersController`'s `@Get(':userId')`, so they never
 * actually collide — but Express resolved `GET /api/users/pending` against
 * `userRoutes` purely because it was mounted first, and keeping the same order
 * means that stays true if a one-segment route is ever added here.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserCommentsController {
  constructor(private readonly comments: CommentsService) {}

  /** Published comments only — what a visitor sees on the profile. */
  @Get(':userId/comments')
  list(@Param('userId') userId: string) {
    return this.comments.getComments(userId);
  }

  /**
   * Declared before the POST sibling for the same literal-beats-parameter
   * reason as `/pending` in CommentsController.
   */
  @Get(':userId/comments/pending')
  listPending(@Param('userId') userId: string, @CurrentUser() user: AuthUser) {
    return this.comments.getPendingComments(userId, user);
  }

  /** 201, and the comment starts unpublished. */
  @Post(':userId/comments')
  create(
    @Param('userId') userId: string,
    @Body() body: CreateCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.createComment(userId, body?.content, user);
  }
}
