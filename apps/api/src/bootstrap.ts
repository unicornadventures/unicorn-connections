import {
  BadRequestException,
  INestApplication,
  Logger,
  RequestMethod,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  // CORS lives here rather than in main.ts so the Lambda entry point inherits
  // it. Under the single proxy function there is nowhere else for it to go:
  // the source's handlers each wrote `Access-Control-Allow-Origin: *` by hand
  // and template.yaml declared OPTIONS routes for a handful of paths, which is
  // partial coverage this replaces with one uniform rule (docs §6, §9.1).
  //
  // Deployed, the SPA and the API share a domain behind CloudFront, so nothing
  // is cross-origin and this never fires; it is local development — a Vite
  // server on 5173 talking to 5001 — that needs it.
  // Resolved leniently: some test slices boot a single module with no
  // ConfigModule at all (test/pulse.e2e-spec.ts mounts HealthModule alone so it
  // needs no database), and those do not need CORS. Skipping can only ever
  // under-permit, never over-permit, so the safe direction is the default — but
  // it is logged, because silently unconfigured CORS is exactly the sort of
  // thing that is discovered from a browser console three environments later.
  // try/catch rather than a flag: `app.get()` throws UnknownElementException
  // when the provider is absent, with or without `strict: false`.
  let corsOrigin: string | undefined;
  try {
    corsOrigin = app
      .get(ConfigService, { strict: false })
      .get<string>('frontendUrl');
  } catch {
    corsOrigin = undefined;
  }

  if (corsOrigin) {
    Logger.log(`🔧 CORS Origin: ${corsOrigin}`, 'Bootstrap');
    app.enableCors({ origin: corsOrigin, credentials: true });
  } else {
    Logger.warn('No FRONTEND_URL in context — CORS not enabled.', 'Bootstrap');
  }

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
