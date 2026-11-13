import { Controller, Get } from '@nestjs/common';

/**
 * `/pulse` is the one route that lives outside the `/api` prefix — it is what
 * uptime checks and smoke-deployed.sh hit. The global prefix is applied
 * in main.ts with `pulse` excluded, so this stays at the root.
 *
 * Response shape must stay `{ status, timestamp }`, as the Express `/pulse`
 * route returned.
 */
@Controller()
export class HealthController {
  @Get('pulse')
  pulse(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
