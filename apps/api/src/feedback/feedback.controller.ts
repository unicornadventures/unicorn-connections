import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service.js';
import { FeedbackEnabledGuard } from './feedback-enabled.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';

/**
 * `/api/feedback` — submit, and read back your own.
 *
 * **Guard order is part of the contract.** `FeedbackEnabledGuard` runs first so
 * a disabled deployment answers 404 `Feedback is not enabled.` to everyone,
 * including unauthenticated callers, exactly as the source's first-line flag
 * check does. Swapping them would leak the module's existence to anyone without
 * a token by answering 401 instead.
 */
@Controller('feedback')
@UseGuards(FeedbackEnabledGuard, JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.feedback.listMyFeedback(user);
  }

  /** 201 on success. */
  @Post()
  create(
    @Body() body: { comment?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.createFeedback(body?.comment, user);
  }
}
