import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller.js';
import { UserCommentsController } from './user-comments.controller.js';
import { CommentsService } from './comments.service.js';
import { CommentsRepository } from './comments.repository.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ClassScopeModule } from '../common/class-scope/class-scope.module.js';

@Module({
  imports: [ClassScopeModule],
  controllers: [CommentsController, UserCommentsController],
  providers: [CommentsService, CommentsRepository, JwtAuthGuard],
  exports: [CommentsService],
})
export class CommentsModule {}
