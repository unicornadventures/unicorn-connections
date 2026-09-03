import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration, validate } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Fail the boot rather than start with a half-configured app. The Express
      // version silently fell back to defaults, which is how two different JWT
      // fallback secrets ended up in the codebase. `validate` reports every
      // missing/invalid var at once.
      validate,
      // Mirrors the source layout: a single .env at the repo root, with an
      // optional backend-local override taking precedence.
      envFilePath: ['.env', '../.env'],
    }),
    DatabaseModule,
    HealthModule,
    // Feature modules land here in phases 1–5:
    // AuthModule, UsersModule, SchoolsModule, ClassesModule,
    // CommentsModule, EventsModule, PhotosModule, FeedbackModule, AdminModule
  ],
})
export class AppModule {}
