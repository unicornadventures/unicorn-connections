import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';
import { FeedbackRepository } from './feedback.repository.js';
import { FeedbackEnabledGuard } from './feedback-enabled.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

/**
 * Always imported, regardless of `FEEDBACK_ENABLED` — the flag is enforced per
 * request by a guard, not by whether this module is loaded. See the guard for
 * why.
 */
@Module({
  controllers: [FeedbackController],
  providers: [
    FeedbackService,
    FeedbackRepository,
    FeedbackEnabledGuard,
    JwtAuthGuard,
  ],
  exports: [FeedbackService],
})
export class FeedbackModule {}
