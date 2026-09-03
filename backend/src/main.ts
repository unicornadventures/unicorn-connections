import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';

/**
 * Local/standalone HTTP entry point. The Lambda entry point (src/lambda.ts,
 * phase 7) bootstraps the same AppModule through serverless-express; anything
 * that must apply in both lives in configureApp.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  configureApp(app);

  const corsOrigin = config.get<string>('frontendUrl')!;
  Logger.log(`🔧 CORS Origin: ${corsOrigin}`, 'Bootstrap');
  app.enableCors({ origin: corsOrigin, credentials: true });

  const port = config.get<number>('port')!;
  await app.listen(port);
  Logger.log(
    `✅ Backend server safely listening at http://localhost:${port}`,
    'Bootstrap',
  );
}

await bootstrap();
