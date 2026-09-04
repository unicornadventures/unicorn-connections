import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CommentsService } from './comments.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';
import type { UpdateCommentDto } from './dto/comment.dto.js';

/**
 * `/api/comments` — the moderation-side half of the comments surface.
 *
 * The source mounts one Express router at two prefixes (docs §2.2, §5.3). This
 * port uses two controllers over one service instead, which is the same routing
 * with the ownership made visible: this one is about acting on a comment you
 * already know the id of, `UserCommentsController` is about a profile's
 * comments.
 *
 * `/pending` is declared before `/:commentId` so the literal wins. There is no
 * GET on `/:commentId` today, but the two would collide the moment one is
 * added, and declaration order is the only thing preventing it.
 */
@Controller('comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  /**
   * The frontend sends `?requesterId=` here and it is ignored — standing comes
   * from the token. Same §9.2 story as the class directory in phase 2.
   */
  @Get('pending')
  getAllPending(@CurrentUser() user: AuthUser) {
    return this.comments.getAllPendingComments(user);
  }

  @Get('my-comments/:commenterId')
  getMyComments(
    @Param('commenterId') commenterId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.getMyComments(commenterId, user);
  }

  @Put(':commentId')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('commentId') commentId: string,
    @Body() body: UpdateCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.updateComment(commentId, body ?? {}, user);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.deleteComment(commentId, user);
  }
}
