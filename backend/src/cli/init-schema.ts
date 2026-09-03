import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module.js';

/**
 * Runs the schema migrations and exits. Used by scripts/verify-schema-parity.sh
 * to materialize the ported schema into a scratch database for comparison
 * against the Express app's, and useful on its own for preparing a dev database.
 *
 * SchemaService.onModuleInit does the work; creating the application context is
 * enough to trigger it.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  await app.close();
  Logger.log('Schema initialization finished.', 'InitSchema');
}

main().catch((err) => {
  Logger.error(err instanceof Error ? err.message : String(err), 'InitSchema');
  process.exit(1);
});
