import type { INestApplication } from '@nestjs/common';

/**
 * Boots the NestJS app the same way main.ts and lambda.ts do — via
 * configureApp — so the global prefix, exception filter and pipes under test
 * are the real ones rather than a test-only approximation.
 */
export async function createNestApp(): Promise<INestApplication> {
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('@classyear/api/dist/app.module.js');
  const { configureApp } = await import('@classyear/api/dist/bootstrap.js');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return app;
}
