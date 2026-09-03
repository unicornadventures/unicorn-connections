import { Controller, Get } from '@nestjs/common';

/**
 * `/pulse` is the one route that lives outside the `/api` prefix — it is what
 * the SAM warmer function and uptime checks hit. The global prefix is applied
 * in main.ts with `pulse` excluded, so this stays at the root.
 *
 * Response shape must stay `{ status, timestamp }`; the deployed warmer and the
 * Express `/pulse` route both return exactly this.
 */
@Controller()
export class HealthController {
  @Get('pulse')
  pulse(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
