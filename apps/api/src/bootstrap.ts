import {
  BadRequestException,
  INestApplication,
  RequestMethod,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

/**
 * Setup shared by every entry point: the local HTTP server (main.ts), the
 * Lambda handler (lambda.ts, phase 7), and the e2e tests.
 *
 * It lives in its own module so importing it does not execute main.ts's
 * top-level `bootstrap()`.
 */
export function configureApp(app: INestApplication): void {
  // JwtAuthGuard accepts a token from the Authorization header or the httpOnly
  // cookie the Express app's /login used to set.
  app.use(cookieParser());

  // Every error becomes { error: "..." } — the shape the frontend reads as
  // err.response.data.error. See the filter for why this matters.
  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // Nothing is stripped. Handlers were written against whatever the client
      // sent, and silently dropping unknown fields would change behaviour in
      // ways no test would catch.
      whitelist: false,
      // Validation failures must look like every other error. Only the first
      // message survives, because the contract is one string per response.
      exceptionFactory: (errors: ValidationError[]) => {
        const first = errors[0];
        const message = first?.constraints
          ? Object.values(first.constraints)[0]
          : 'Validation failed.';
        return new BadRequestException({ error: message });
      },
    }),
  );

  // Every route is under /api except /pulse, which the SAM warmer and uptime
  // checks hit at the root — matching the Express app, where /pulse was
  // registered directly on the app and the routers were mounted under /api/*.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'pulse', method: RequestMethod.GET }],
  });
}
