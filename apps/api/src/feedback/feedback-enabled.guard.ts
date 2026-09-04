import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/**
 * Turns the whole feedback module off when `FEEDBACK_ENABLED=false`.
 *
 * Three things about this are deliberate:
 *
 * 1. **It reads `process.env` per request, not config at boot.** The source
 *    does the same (`const feedbackDisabled = () => process.env.FEEDBACK_ENABLED
 *    === 'false'`), which is what lets a test flip the flag without restarting.
 *    Reading `ConfigService` here would cache the value at startup and the
 *    "both states" gate in docs §10 would need two app boots to check.
 *
 * 2. **It is a guard, not conditional module loading.** Docs §6 calls this out:
 *    if the module were only registered when the flag is on, the routes would
 *    404 with Nest's own body rather than `{ error: 'Feedback is not enabled.' }`,
 *    and the flag would stop being observable at runtime.
 *
 * 3. **It must run before JwtAuthGuard.** The source checks the flag on the
 *    first line, before it looks at the token, so a disabled endpoint answers
 *    404 to everyone rather than 401 to the signed-out and 404 to the signed-in.
 *    Guard order in `@UseGuards(FeedbackEnabledGuard, JwtAuthGuard)` is what
 *    enforces that — do not reorder them.
 *
 * Only the literal string 'false' disables it; anything else, including unset,
 * leaves feedback on.
 */
@Injectable()
export class FeedbackEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.FEEDBACK_ENABLED === 'false') {
      throw new NotFoundException({ error: 'Feedback is not enabled.' });
    }
    return true;
  }
}
