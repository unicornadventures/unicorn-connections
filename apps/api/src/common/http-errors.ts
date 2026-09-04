import {
  HttpException,
  InternalServerErrorException,
  type Logger,
} from '@nestjs/common';

/**
 * The `catch` every ported handler ends with.
 *
 * Each source handler wraps its whole body in `try/catch` and answers an
 * endpoint-specific 500 string — 'Internal server error.' for most, but
 * 'Internal server error (auth.ts).' for login. Deliberate failures are already
 * expressed as HttpExceptions with the exact status and message the contract
 * requires, so those pass through untouched; anything else is a genuine bug or
 * a database error and becomes the 500 the source would have sent.
 *
 * Declared `never` so callers can write `catch (e) { rethrow(e, msg) }` without
 * TypeScript deciding the function might fall through and return undefined.
 */
export function rethrowAsInternal(
  error: unknown,
  message: string,
  logger: Logger,
): never {
  if (error instanceof HttpException) throw error;

  logger.error(message, error as Error);
  throw new InternalServerErrorException({ error: message });
}
