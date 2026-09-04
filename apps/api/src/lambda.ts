import { NestFactory } from '@nestjs/core';
import type { Handler } from 'aws-lambda';
// The **named** export, deliberately. §13 flagged serverless-express under ESM
// as the one place the port's `"type": "module"` could bite, and this is where
// it did: the package is CJS with `module.exports = configure`, so at runtime
// `.default` is `undefined`, while its `.d.ts` declares an ESM-style
// `export default`. A default import type-errors ("has no call signatures")
// even though Node's interop would have made it work. `configure` is the same
// function and is correct in both worlds.
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';

/**
 * The Lambda entry point — the same `AppModule` as `main.ts`, wrapped by
 * serverless-express instead of listening on a port.
 *
 * This is the whole of what replaces 59 individually-defined functions and 68
 * API Gateway route events (docs §3.1). API Gateway routes `{proxy+}/ANY` here
 * and Nest's router does the rest, so adding an endpoint no longer means
 * editing YAML in three places.
 *
 * **The cache is the point.** `handler` is module scope, so a warm container
 * reuses the bootstrapped Nest instance — including `DatabaseService`'s pool
 * and the schema initialization that `SchemaService.OnModuleInit` runs. That is
 * exactly what `lambda/init.ts`'s `dbReady` promise did by hand in the source
 * (§8.4), except Nest gives it for free.
 *
 * The promise, not the resolved handler, is cached: two requests arriving
 * together on a cold container would otherwise each bootstrap an app, and the
 * loser's would leak a connection pool. The same mistake `DatabaseService`
 * made and §18 fixed.
 */
let bootstrapped: Promise<Handler> | null = null;

async function bootstrap(): Promise<Handler> {
  const app = await NestFactory.create(AppModule, {
    // CloudWatch has its own timestamps and the emoji-prefixed lines are how
    // this app is eyeballed there (docs §6), so the default logger stays.
    bufferLogs: false,
  });

  configureApp(app);

  // Not `listen()`. `init()` builds the router and runs lifecycle hooks —
  // including the migrations — without binding a port, which is what
  // serverless-express needs.
  await app.init();

  return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

export const handler: Handler = async (event, context, callback) => {
  bootstrapped ??= bootstrap().catch((error: unknown) => {
    // Clear the slot so the next invocation retries rather than inheriting a
    // rejected promise for the life of the container.
    bootstrapped = null;
    throw error;
  });

  const server = await bootstrapped;
  return server(event, context, callback);
};
