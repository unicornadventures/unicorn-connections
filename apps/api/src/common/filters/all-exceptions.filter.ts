import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Renders every error as `{ "error": "<message>" }`.
 *
 * This is not cosmetic. The source app's handlers return
 * `{ error: 'Invalid credentials.' }`, and the frontend reads
 * `err.response?.data?.error` directly — see Login.tsx, which falls back to a
 * generic string only when that field is absent. Nest's default error body is
 * `{ statusCode, message, error }`, which would make every server-side message
 * silently disappear from the UI.
 *
 * Unhandled (non-HttpException) errors become a 500 whose message the throwing
 * service chooses, because the source uses endpoint-specific 500 text — e.g.
 * login answers 'Internal server error (auth.ts).' while the rest of auth
 * answers 'Internal server error.'.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.extractMessage(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({ error: message });
  }

  private extractMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      if (typeof body === 'string') return body;

      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;

        // Thrown as `new BadRequestException({ error: '...' })` — the shape the
        // services use so they control the exact string.
        if (typeof record.error === 'string') return record.error;

        // Nest's built-in exceptions put the text in `message`, which may be an
        // array when it came from the ValidationPipe.
        if (typeof record.message === 'string') return record.message;
        if (Array.isArray(record.message) && record.message.length > 0) {
          return String(record.message[0]);
        }
      }

      return exception.message;
    }

    // Never leak an internal error message or stack to the client.
    return 'Internal server error.';
  }
}
