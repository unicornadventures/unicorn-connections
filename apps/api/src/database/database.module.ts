import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { SchemaService } from './schema.service.js';
import { SeedService } from './seed.service.js';

/**
 * Global so feature modules can inject DatabaseService without importing this
 * module explicitly — it is infrastructure, not a domain dependency.
 *
 * SchemaService runs migrations from OnModuleInit. Under Lambda the Nest app is
 * bootstrapped once per container and cached, so this is the equivalent of the
 * Express app's `dbReady` promise in lambda/init.ts: migrations run exactly
 * once per cold start, before any handler serves a request.
 */
@Global()
@Module({
  providers: [DatabaseService, SchemaService, SeedService],
  exports: [DatabaseService, SchemaService, SeedService],
})
export class DatabaseModule {}
