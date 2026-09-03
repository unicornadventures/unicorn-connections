import { INestApplication, RequestMethod } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/**
 * Setup shared by every entry point: the local HTTP server (main.ts), the
 * Lambda handler (lambda.ts, phase 7), and the e2e tests.
 *
 * It lives in its own module so importing it does not execute main.ts's
 * top-level `bootstrap()`.
 */
export function configureApp(app: INestApplication): void {
  // JwtAuthGuard reads req.cookies.token, matching the source's utils/auth.ts,
  // which accepts either an httpOnly cookie or an Authorization: Bearer header.
  app.use(cookieParser());

  // Every route is under /api except /pulse, which the SAM warmer and uptime
  // checks hit at the root — matching the Express app, where /pulse was
  // registered directly on the app and the routers were mounted under /api/*.
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'pulse', method: RequestMethod.GET }],
  });
}
