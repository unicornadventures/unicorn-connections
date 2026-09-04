import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { rethrowAsInternal } from '../common/http-errors.js';
import { FeedbackRepository } from './feedback.repository.js';

/**
 * `/api/feedback`, ported from `lambda/feedback.ts`.
 *
 * The feature flag is not checked here — `FeedbackEnabledGuard` does it, before
 * authentication, which is the order the source uses.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(private readonly repo: FeedbackRepository) {}

  /**
   * `comment` is coerced with `String()` before trimming, so a client sending a
   * number or an object gets it stringified and stored rather than rejected.
   * That is the source's behaviour; only empty or whitespace-only input is a
   * 400. Not tightened here because a validation pipe would also change the
   * message and the status for every other malformed body.
   */
  async createFeedback(comment: unknown, authUser: AuthUser) {
    try {
      if (!comment || !String(comment).trim()) {
        throw new BadRequestException({ error: 'Comment is required.' });
      }

      const feedback = await this.repo.insert(
        authUser.id,
        String(comment).trim(),
      );

      return { feedback };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async listMyFeedback(authUser: AuthUser) {
    try {
      return { feedback: await this.repo.listForUser(authUser.id) };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
